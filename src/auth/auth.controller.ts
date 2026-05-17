import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Query,
  UseGuards,
  Param,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { AuthService } from "./auth.service";
import {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyEmailDto,
  ResendVerificationDto,
  RegisterAndClaimDto,
} from "./dto";
import { CurrentUser, Roles } from "../common/decorators";
import { RolesGuard } from "../common/guards";
import { Role } from "@prisma/client";
import { UsersService } from "../users/users.service";
import { UpdateMeDto } from "../users/dto/update-me.dto";

@Controller("auth")
export class AuthController {
  constructor(
    private authService: AuthService,
    private usersService: UsersService,
  ) {}

  @Post("register")
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  // Buy Now post-payment registration. Creates the user AND links the existing
  // guest payment session in one call. Zoho sync is deferred to verifyEmail.
  @Post("register-and-claim")
  registerAndClaim(@Body() dto: RegisterAndClaimDto) {
    return this.authService.registerAndClaim(dto);
  }

  @Post("login")
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post("refresh")
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Get("verify-email")
  verifyEmail(@Query() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.token);
  }

  @Post("resend-verification")
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto);
  }

  @Post("forgot-password")
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post("reset-password")
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("me")
  getMe(@CurrentUser() user: any) {
    return this.usersService.getMe(user.id);
  }

  @UseGuards(AuthGuard("jwt"))
  @Patch("me")
  updateMe(@CurrentUser() user: any, @Body() dto: UpdateMeDto) {
    return this.usersService.updateMe(user.id, dto);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles(Role.ADMIN)
  @Post("impersonate/:userId")
  impersonate(@Param("userId") userId: string) {
    return this.authService.impersonate(userId);
  }
}
