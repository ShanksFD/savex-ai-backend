import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../common/guards';
import { Roles } from '../common/decorators';
import { Role, SweepStatus } from '@prisma/client';
import { AdminSweepsService } from './admin-sweeps.service';

@Controller('admin/sweeps')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(Role.ADMIN)
export class AdminSweepsController {
  constructor(private adminSweepsService: AdminSweepsService) {}

  @Get('stats')
  getStats() {
    return this.adminSweepsService.getStats();
  }

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: SweepStatus,
  ) {
    return this.adminSweepsService.findAll({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      status,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.adminSweepsService.findOne(id);
  }

  @Post(':id/retry')
  retry(@Param('id') id: string) {
    return this.adminSweepsService.retry(id);
  }
}
