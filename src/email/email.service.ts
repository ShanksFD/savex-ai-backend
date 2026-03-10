import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";
import * as nodemailer from "nodemailer";

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private resend: Resend | null = null;
  private smtpTransport: nodemailer.Transporter | null = null;
  private readonly fromEmail: string;

  constructor(private configService: ConfigService) {
    this.fromEmail = this.configService.get<string>(
      "EMAIL_FROM",
      "onboarding@resend.dev",
    );

    // Initialize Resend if API key is available
    const resendApiKey = this.configService.get<string>("RESEND_API_KEY");
    if (resendApiKey) {
      this.resend = new Resend(resendApiKey);
      this.logger.log("Resend email provider initialized");
    }

    // Initialize SMTP fallback if credentials are available
    const smtpHost = this.configService.get<string>("SMTP_HOST");
    const smtpPort = this.configService.get<number>("SMTP_PORT");
    const smtpUser = this.configService.get<string>("SMTP_USER");
    const smtpPass = this.configService.get<string>("SMTP_PASS");

    if (smtpHost && smtpUser && smtpPass) {
      this.smtpTransport = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort || 465,
        secure: (smtpPort || 465) === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });
      this.logger.log("SMTP fallback email provider initialized");
    }

    if (!this.resend && !this.smtpTransport) {
      this.logger.warn(
        "No email provider configured! Emails will be logged only.",
      );
    }
  }

  async sendEmail(to: string, subject: string, html: string): Promise<boolean> {
    // Try Resend first
    if (this.resend) {
      try {
        await this.resend.emails.send({
          from: this.fromEmail,
          to,
          subject,
          html,
        });
        this.logger.log(`Email sent via Resend to ${to}: ${subject}`);
        return true;
      } catch (error) {
        this.logger.error(`Resend failed for ${to}: ${error.message}`);
        // Fall through to SMTP
      }
    }

    // Fallback to SMTP
    if (this.smtpTransport) {
      try {
        await this.smtpTransport.sendMail({
          from: this.fromEmail,
          to,
          subject,
          html,
        });
        this.logger.log(`Email sent via SMTP to ${to}: ${subject}`);
        return true;
      } catch (error) {
        this.logger.error(`SMTP failed for ${to}: ${error.message}`);
      }
    }

    // No provider available — log the email for debugging
    this.logger.warn(`No email provider available. Email to ${to} not sent.`);
    this.logger.debug(`Subject: ${subject}`);
    this.logger.debug(`Body: ${html}`);
    return false;
  }
}
