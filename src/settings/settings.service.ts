import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULTS = { minPayment: 100, maxPayment: 50000 };

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async getPaymentLimits(): Promise<{ minPayment: number; maxPayment: number }> {
    const rows = await this.prisma.appSetting.findMany({
      where: { key: { in: ['minPayment', 'maxPayment'] } },
    });

    const map = Object.fromEntries(rows.map((r) => [r.key, Number(r.value)]));
    return {
      minPayment: map['minPayment'] ?? DEFAULTS.minPayment,
      maxPayment: map['maxPayment'] ?? DEFAULTS.maxPayment,
    };
  }

  async updatePaymentLimits(minPayment: number, maxPayment: number) {
    await this.prisma.$transaction([
      this.prisma.appSetting.upsert({
        where: { key: 'minPayment' },
        update: { value: String(minPayment) },
        create: { key: 'minPayment', value: String(minPayment) },
      }),
      this.prisma.appSetting.upsert({
        where: { key: 'maxPayment' },
        update: { value: String(maxPayment) },
        create: { key: 'maxPayment', value: String(maxPayment) },
      }),
    ]);
    return { minPayment, maxPayment };
  }
}
