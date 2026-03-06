import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreatePromoCodeDto } from "./dto/create-promo-code.dto";
import { UpdatePromoCodeDto } from "./dto/update-promo-code.dto";

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

  async findAll(
    params: {
      page?: number;
      limit?: number;
      search?: string;
      isActive?: boolean;
    } = {},
  ) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 10));
    const skip = (page - 1) * limit;

    const where: any = {};

    if (params.isActive !== undefined) {
      where.isActive = params.isActive;
    }

    if (params.search) {
      where.code = { contains: params.search, mode: "insensitive" };
    }

    const [data, total] = await Promise.all([
      this.prisma.promoCode.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { transactions: true } } },
        skip,
        take: limit,
      }),
      this.prisma.promoCode.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getStats() {
    const totalPromoCodes = await this.prisma.promoCode.count();
    const activePromoCodes = await this.prisma.promoCode.count({
      where: { isActive: true },
    });
    const aggregates = await this.prisma.promoCode.aggregate({
      _sum: { usedCount: true, maxUses: true },
    });

    return {
      totalPromoCodes,
      activePromoCodes,
      totalUses: aggregates._sum.usedCount || 0,
      totalMaxUses: aggregates._sum.maxUses || 0,
    };
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

  async update(id: string, dto: UpdatePromoCodeDto) {
    const promo = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!promo) {
      throw new NotFoundException("Promo code not found");
    }

    if (dto.code && dto.code.toUpperCase() !== promo.code) {
      const existing = await this.prisma.promoCode.findUnique({
        where: { code: dto.code.toUpperCase() },
      });
      if (existing) {
        throw new BadRequestException("Promo code already exists");
      }
    }

    return this.prisma.promoCode.update({
      where: { id },
      data: {
        ...(dto.code && { code: dto.code.toUpperCase() }),
        ...(dto.value !== undefined && { value: dto.value }),
        ...(dto.maxUses !== undefined && { maxUses: dto.maxUses }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.expiresAt !== undefined && {
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        }),
      },
      include: { _count: { select: { transactions: true } } },
    });
  }

  async incrementUsage(code: string) {
    await this.prisma.promoCode.update({
      where: { code: code.toUpperCase() },
      data: { usedCount: { increment: 1 } },
    });
  }
}
