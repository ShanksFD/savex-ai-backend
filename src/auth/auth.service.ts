import {
  Injectable,
  Logger,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcrypt";
import * as crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { EmailService } from "../email/email.service";
import { ZohoService } from "../zoho/zoho.service";
import { PaymentSessionsService } from "../payment-sessions/payment-sessions.service";
import {
  RegisterDto,
  LoginDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ResendVerificationDto,
  RegisterAndClaimDto,
} from "./dto";
import {
  verificationEmailTemplate,
  passwordResetTemplate,
} from "../email/email.templates";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private emailService: EmailService,
    private zohoService: ZohoService,
    @Inject(forwardRef(() => PaymentSessionsService))
    private paymentSessionsService: PaymentSessionsService,
  ) {}

  // Create the User row + send the verification email. Shared by both the
  // classic register path and the Buy Now register-and-claim path.
  // `triggerZoho` controls whether to push the contact to Zoho immediately.
  // For guest-claim flows we set this to false: Zoho fires once at verifyEmail
  // time, after the settled guest session has been linked, so the upsert
  // includes the full picture (contact + tokens) in a single event.
  private async createUserAndSendVerification(
    dto: {
      email: string;
      password: string;
      firstName?: string;
      lastName?: string;
      phone?: string;
    },
    triggerZoho: boolean,
  ) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException("Email already registered");
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        isEmailVerified: false,
        verificationToken,
        verificationTokenExpiry,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
      },
    });

    const frontendUrl = this.configService.get<string>(
      "FRONTEND_URL",
      "http://localhost:3000",
    );
    const verifyUrl = `${frontendUrl}/verify-email?token=${verificationToken}`;
    const name = [dto.firstName, dto.lastName].filter(Boolean).join(" ");
    const template = verificationEmailTemplate(name, verifyUrl);

    this.emailService
      .sendEmail(dto.email, template.subject, template.html)
      .catch((err) => {
        this.logger.error(
          `Failed to send verification email to ${dto.email}: ${err.message}`,
        );
      });

    if (triggerZoho) {
      this.zohoService.upsertContact(user.id);
    }

    return user;
  }

  async register(dto: RegisterDto) {
    const user = await this.createUserAndSendVerification(dto, true);
    return {
      message:
        "Registration successful. Please check your email to verify your account.",
      user,
    };
  }

  // Guest Buy Now flow:
  //   1. Create the user (Zoho deferred).
  //   2. Atomically link the guest payment session to this user via claimToken,
  //      with walletAddress as a secondary verification check.
  // The single Zoho upsert then happens in verifyEmail so we never trigger
  // duplicate contacts or premature balance updates.
  async registerAndClaim(dto: RegisterAndClaimDto) {
    const user = await this.createUserAndSendVerification(dto, false);

    try {
      await this.paymentSessionsService.claimGuestSessions(
        user.id,
        dto.claimToken,
        dto.walletAddress,
      );
    } catch (err) {
      // The user record was created but the claim failed. Surface the error
      // to the caller so they can retry with the right token/wallet; we keep
      // the user so they can still log in once they verify their email.
      this.logger.warn(
        `User ${user.id} registered but claim failed: ${(err as Error).message}`,
      );
      throw err;
    }

    return {
      message:
        "Registration successful. Please check your email to verify your account.",
      user,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException("Invalid credentials");
    }

    // Check email verification
    if (!user.isEmailVerified) {
      throw new UnauthorizedException("EMAIL_NOT_VERIFIED");
    }

    // Check account status
    if (user.status === "SUSPENDED") {
      throw new UnauthorizedException("ACCOUNT_SUSPENDED");
    }

    const tokens = await this.generateTokens(
      user.id,
      user.email,
      user.role,
      user.tokenVersion,
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      ...tokens,
    };
  }

  async impersonate(userId: string) {
    // Only fetch the user details, we implicitly trust the admin calling this endpoint.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException("User not found");
    }

    if (user.status === "SUSPENDED") {
      throw new BadRequestException("Cannot impersonate a suspended account");
    }

    const tokens = await this.generateTokens(
      user.id,
      user.email,
      user.role,
      user.tokenVersion,
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      ...tokens,
    };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>("JWT_REFRESH_SECRET"),
      });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          tokenVersion: true,
        },
      });

      if (!user) {
        throw new UnauthorizedException("User not found");
      }

      // Check account status on refresh
      if (user.status === "SUSPENDED") {
        throw new UnauthorizedException("ACCOUNT_SUSPENDED");
      }

      // Check token version — if it changed, force re-login
      if (user.tokenVersion !== payload.tokenVersion) {
        throw new UnauthorizedException("Token invalidated");
      }

      const tokens = await this.generateTokens(
        user.id,
        user.email,
        user.role,
        user.tokenVersion,
      );
      return tokens;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException("Invalid refresh token");
    }
  }

  async verifyEmail(token: string) {
    const user = await this.prisma.user.findFirst({
      where: { verificationToken: token },
    });

    if (!user) {
      throw new BadRequestException("Invalid verification token");
    }

    if (
      user.verificationTokenExpiry &&
      user.verificationTokenExpiry < new Date()
    ) {
      throw new BadRequestException(
        "Verification token has expired. Please request a new one.",
      );
    }

    if (user.isEmailVerified) {
      return { message: "Email already verified" };
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        isEmailVerified: true,
        emailVerifiedAt: new Date(),
        verificationToken: null,
        verificationTokenExpiry: null,
      },
    });

    // If this user came in via the Buy Now guest claim flow, they have one
    // or more claimed-but-not-yet-Zoho-synced settled sessions. Fire a SINGLE
    // Zoho upsert now (covers contact + transaction totals) and mark the
    // sessions as synced so we never double-fire.
    const unsyncedClaimedSessions = await this.prisma.paymentSession.findMany({
      where: {
        userId: user.id,
        claimedAt: { not: null },
        zohoSyncedAt: null,
      },
      select: { id: true },
    });

    if (unsyncedClaimedSessions.length > 0) {
      try {
        await this.zohoService.upsertContact(user.id);
        await this.prisma.paymentSession.updateMany({
          where: { id: { in: unsyncedClaimedSessions.map((s) => s.id) } },
          data: { zohoSyncedAt: new Date() },
        });
      } catch (err) {
        // Don't block verification on Zoho failure; log and let an admin retry.
        this.logger.error(
          `Zoho upsert failed at verifyEmail for user ${user.id}: ${(err as Error).message}`,
        );
      }
    }

    // Issue JWTs so the frontend can auto-login the user straight after
    // verification — removes one extra step from the Buy Now funnel and is
    // safe because the token is only granted after a valid verification link.
    const tokens = await this.generateTokens(
      user.id,
      user.email,
      user.role,
      user.tokenVersion,
    );

    return {
      message: "Email verified successfully.",
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      ...tokens,
    };
  }

  async resendVerification(dto: ResendVerificationDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // Always return success to prevent email enumeration
    if (!user || user.isEmailVerified) {
      return {
        message:
          "If that email is registered and unverified, a verification email has been sent.",
      };
    }

    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { verificationToken, verificationTokenExpiry },
    });

    const frontendUrl = this.configService.get<string>(
      "FRONTEND_URL",
      "http://localhost:3000",
    );
    const verifyUrl = `${frontendUrl}/verify-email?token=${verificationToken}`;
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
    const template = verificationEmailTemplate(name, verifyUrl);

    await this.emailService.sendEmail(
      user.email,
      template.subject,
      template.html,
    );

    return {
      message:
        "If that email is registered and unverified, a verification email has been sent.",
    };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // Always return success to prevent email enumeration
    if (!user) {
      return {
        message:
          "If that email is registered, a password reset link has been sent.",
      };
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1h

    await this.prisma.user.update({
      where: { id: user.id },
      data: { resetToken, resetTokenExpiry },
    });

    const frontendUrl = this.configService.get<string>(
      "FRONTEND_URL",
      "http://localhost:3000",
    );
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
    const template = passwordResetTemplate(name, resetUrl);

    await this.emailService.sendEmail(
      user.email,
      template.subject,
      template.html,
    );

    return {
      message:
        "If that email is registered, a password reset link has been sent.",
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.prisma.user.findFirst({
      where: { resetToken: dto.token },
    });

    if (!user) {
      throw new BadRequestException("Invalid reset token");
    }

    if (user.resetTokenExpiry && user.resetTokenExpiry < new Date()) {
      throw new BadRequestException(
        "Reset token has expired. Please request a new one.",
      );
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null,
      },
    });

    return {
      message:
        "Password reset successfully. You can now log in with your new password.",
    };
  }

  private async generateTokens(
    userId: string,
    email: string,
    role: string,
    tokenVersion: number,
  ) {
    const payload = { sub: userId, email, role, tokenVersion };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>("JWT_ACCESS_SECRET"),
        expiresIn:
          this.configService.get<string>("JWT_ACCESS_EXPIRATION") ?? "15m",
      } as any),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>("JWT_REFRESH_SECRET"),
        expiresIn:
          this.configService.get<string>("JWT_REFRESH_EXPIRATION") ?? "7d",
      } as any),
    ]);

    return { accessToken, refreshToken };
  }
}
