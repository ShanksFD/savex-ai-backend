import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../common/guards';
import { Roles } from '../common/decorators';
import { Role } from '@prisma/client';
import { AdminPresaleService } from './admin-presale.service';
import { UpdatePresaleStageDto } from './dto/update-presale-stage.dto';

@Controller('admin/presale-stages')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(Role.ADMIN)
export class AdminPresaleController {
  constructor(private adminPresaleService: AdminPresaleService) {}

  @Get('stats')
  getStats() {
    return this.adminPresaleService.getStats();
  }

  @Get()
  findAll() {
    return this.adminPresaleService.findAll();
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePresaleStageDto,
  ) {
    return this.adminPresaleService.update(id, dto);
  }

  @Post(':id/activate')
  activate(@Param('id', ParseIntPipe) id: number) {
    return this.adminPresaleService.activate(id);
  }
}
