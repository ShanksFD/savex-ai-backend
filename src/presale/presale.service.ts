import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PresaleService {
  constructor(private prisma: PrismaService) {}

  async getCurrentStage() {
    const stage = await this.prisma.presaleStage.findFirst({
      where: { isActive: true },
    });

    if (!stage) {
      throw new NotFoundException('No active presale stage found');
    }

    return stage;
  }

  async getAllStages() {
    return this.prisma.presaleStage.findMany({
      orderBy: { stage: 'asc' },
    });
  }
}
