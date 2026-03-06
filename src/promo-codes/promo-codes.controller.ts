import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { PromoCodesService } from "./promo-codes.service";
import { CreatePromoCodeDto } from "./dto/create-promo-code.dto";
import { UpdatePromoCodeDto } from "./dto/update-promo-code.dto";
import { ValidatePromoCodeDto } from "./dto/validate-promo-code.dto";
import { Roles } from "../common/decorators";
import { RolesGuard } from "../common/guards";
import { Role } from "@prisma/client";

@Controller("promo-codes")
export class PromoCodesController {
  constructor(private promoCodesService: PromoCodesService) {}

  @Post()
  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles(Role.ADMIN)
  create(@Body() dto: CreatePromoCodeDto) {
    return this.promoCodesService.create(dto);
  }

  @Get("stats")
  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles(Role.ADMIN)
  getStats() {
    return this.promoCodesService.getStats();
  }

  @Get()
  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles(Role.ADMIN)
  findAll(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("search") search?: string,
    @Query("isActive") isActive?: string,
  ) {
    return this.promoCodesService.findAll({
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
      search,
      isActive: isActive !== undefined ? isActive === "true" : undefined,
    });
  }

  @Post("validate")
  @UseGuards(AuthGuard("jwt"))
  validate(@Body() dto: ValidatePromoCodeDto) {
    return this.promoCodesService.validate(dto.code);
  }

  @Patch(":id")
  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles(Role.ADMIN)
  update(@Param("id") id: string, @Body() dto: UpdatePromoCodeDto) {
    return this.promoCodesService.update(id, dto);
  }

  @Delete(":id")
  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles(Role.ADMIN)
  deactivate(@Param("id") id: string) {
    return this.promoCodesService.deactivate(id);
  }
}
