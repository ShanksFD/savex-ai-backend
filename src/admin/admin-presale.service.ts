import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdatePresaleStageDto } from './dto/update-presale-stage.dto';

@Injectable()
export class AdminPresaleService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.presaleStage.findMany({
      orderBy: { stage: 'asc' },
    });
  }

  async getStats() {
    const stages = await this.prisma.presaleStage.findMany();
    const activeStage = stages.find((s) => s.isActive) ?? null;
    const totalTarget = stages.reduce((sum, s) => sum + s.target, 0);
    const averagePrice =
      stages.length > 0
        ? stages.reduce((sum, s) => sum + s.price, 0) / stages.length
        : 0;

    return {
      totalStages: stages.length,
      activeStage,
      totalTarget,
      averagePrice: Math.round(averagePrice * 10000) / 10000,
    };
  }

  async update(id: number, dto: UpdatePresaleStageDto) {
    const stage = await this.prisma.presaleStage.findUnique({
      where: { id },
    });

    if (!stage) {
      throw new NotFoundException(`Presale stage with id ${id} not found`);
    }

    const data: any = {};
    if (dto.price !== undefined) data.price = dto.price;
    if (dto.bonus !== undefined) data.bonus = dto.bonus;
    if (dto.target !== undefined) data.target = dto.target;

    return this.prisma.presaleStage.update({ where: { id }, data });
  }

  async activate(id: number) {
    const stage = await this.prisma.presaleStage.findUnique({
      where: { id },
    });

    if (!stage) {
      throw new NotFoundException(`Presale stage with id ${id} not found`);
    }

    return this.prisma.$transaction([
      this.prisma.presaleStage.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      }),
      this.prisma.presaleStage.update({
        where: { id },
        data: { isActive: true },
      }),
    ]);
  }
}
