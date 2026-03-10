import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../common/guards';
import { Roles } from '../common/decorators';
import { Role, SessionStatus } from '@prisma/client';
import { AdminPaymentSessionsService } from './admin-payment-sessions.service';
import { UpdateSessionDto } from './dto/update-session.dto';

@Controller('admin/payment-sessions')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(Role.ADMIN)
export class AdminPaymentSessionsController {
  constructor(
    private adminPaymentSessionsService: AdminPaymentSessionsService,
  ) {}

  @Get('stats')
  getStats() {
    return this.adminPaymentSessionsService.getStats();
  }

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: SessionStatus,
    @Query('search') search?: string,
  ) {
    return this.adminPaymentSessionsService.findAll({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      status,
      search,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.adminPaymentSessionsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSessionDto) {
    return this.adminPaymentSessionsService.update(id, dto);
  }
}
