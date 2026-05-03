import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../common/guards';
import { Roles } from '../common/decorators';
import { Role } from '@prisma/client';
import { SettingsService } from './settings.service';
import { UpdatePaymentLimitsDto } from './dto/update-payment-limits.dto';

@Controller('settings')
export class SettingsController {
  constructor(private settingsService: SettingsService) {}

  @Get('payment-limits')
  getPaymentLimits() {
    return this.settingsService.getPaymentLimits();
  }

  @Patch('payment-limits')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(Role.ADMIN)
  updatePaymentLimits(@Body() dto: UpdatePaymentLimitsDto) {
    return this.settingsService.updatePaymentLimits(dto.minPayment, dto.maxPayment);
  }
}
