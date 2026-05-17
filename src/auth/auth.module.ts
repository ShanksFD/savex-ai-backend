import { Module, forwardRef } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { EmailModule } from "../email/email.module";
import { UsersModule } from "../users/users.module";
import { ZohoModule } from "../zoho/zoho.module";
import { PaymentSessionsModule } from "../payment-sessions/payment-sessions.module";

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule,
    EmailModule,
    UsersModule,
    ZohoModule,
    forwardRef(() => PaymentSessionsModule),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
