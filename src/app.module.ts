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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    PresaleModule,
    PromoCodesModule,
    TransactionsModule,
    PaymentSessionsModule,
  ],
})
export class AppModule {}
