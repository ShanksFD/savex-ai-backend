import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { PresaleModule } from "./presale/presale.module";
import { PromoCodesModule } from "./promo-codes/promo-codes.module";
import { TransactionsModule } from "./transactions/transactions.module";
import { PaymentSessionsModule } from "./payment-sessions/payment-sessions.module";
import { EmailModule } from "./email/email.module";
import { AdminModule } from "./admin/admin.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    EmailModule,
    AuthModule,
    UsersModule,
    PresaleModule,
    PromoCodesModule,
    TransactionsModule,
    PaymentSessionsModule,
    AdminModule,
  ],
})
export class AppModule {}
