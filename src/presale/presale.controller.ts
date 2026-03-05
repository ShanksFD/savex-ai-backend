import { Controller, Get } from '@nestjs/common';
import { PresaleService } from './presale.service';

@Controller('presale')
export class PresaleController {
  constructor(private presaleService: PresaleService) {}

  @Get('current-stage')
  getCurrentStage() {
    return this.presaleService.getCurrentStage();
  }

  @Get('stages')
  getAllStages() {
    return this.presaleService.getAllStages();
  }
}
