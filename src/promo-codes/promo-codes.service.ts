import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreatePromoCodeDto } from "./dto/create-promo-code.dto";

@Injectable()
export class PromoCodesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreatePromoCodeDto) {
    const existing = await this.prisma.promoCode.findUnique({
      where: { code: dto.code.toUpperCase() },
    });

    if (existing) {
      throw new BadRequestException("Promo code already exists");
    }

    return this.prisma.promoCode.create({
      data: {
        code: dto.code.toUpperCase(),
        value: dto.value,
        maxUses: dto.maxUses,
        isActive: dto.isActive ?? true,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });
  }

  async findAll() {
    return this.prisma.promoCode.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { transactions: true } } },
    });
  }

  async validate(code: string) {
    const promo = await this.prisma.promoCode.findUnique({
      where: { code: code.toUpperCase() },
    });

    if (!promo) {
      throw new NotFoundException("Invalid promo code");
    }

    if (!promo.isActive) {
      throw new BadRequestException("Promo code is no longer active");
    }

    if (promo.expiresAt && promo.expiresAt < new Date()) {
      throw new BadRequestException("Promo code has expired");
    }

    if (promo.maxUses && promo.usedCount >= promo.maxUses) {
      throw new BadRequestException("Promo code usage limit reached");
    }

    return { code: promo.code, value: promo.value };
  }

  async deactivate(id: string) {
    const promo = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!promo) {
      throw new NotFoundException("Promo code not found");
    }

    return this.prisma.promoCode.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async incrementUsage(code: string) {
    await this.prisma.promoCode.update({
      where: { code: code.toUpperCase() },
      data: { usedCount: { increment: 1 } },
    });
  }
}
