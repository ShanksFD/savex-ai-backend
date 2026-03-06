import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  Query,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { UsersService } from "./users.service";
import { UpdateUserDto } from "./dto/update-user.dto";
import { Roles } from "../common/decorators";
import { RolesGuard } from "../common/guards";
import { Role } from "@prisma/client";

@Controller("users")
@UseGuards(AuthGuard("jwt"), RolesGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get("admin-stats")
  @Roles(Role.ADMIN)
  getAdminStats() {
    return this.usersService.getAdminStats();
  }

  @Get()
  @Roles(Role.ADMIN)
  findAll(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("search") search?: string,
    @Query("investedFilter") investedFilter?: string,
    @Query("sortBy") sortBy?: string,
  ) {
    return this.usersService.findAll({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
      investedFilter,
      sortBy,
    });
  }

  @Get(":id")
  @Roles(Role.ADMIN)
  findOne(@Param("id") id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(":id")
  @Roles(Role.ADMIN)
  update(@Param("id") id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }
}
