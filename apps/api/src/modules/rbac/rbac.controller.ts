import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { RbacService } from './rbac.service';
import { UseGuards } from '@nestjs/common';
import { Permissions } from './permissions.decorator';
import { PermissionsGuard } from './permissions.guard';

@Controller('rbac')
@UseGuards(PermissionsGuard)
export class RbacController {
  constructor(private readonly service: RbacService) {}

  @Get('roles')
  @Permissions('role.read')
  listRoles() {
    return this.service.getRoles();
  }

  @Get('roles/:id')
  @Permissions('role.read')
  getRole(@Param('id') id: string) {
    return this.service.getRole(id);
  }

  @Post('roles')
  @Permissions('role.manage')
  createRole(@Body() body: any) {
    return this.service.createRole(body);
  }

  @Put('roles/:id')
  @Permissions('role.manage')
  updateRole(@Param('id') id: string, @Body() body: any) {
    return this.service.updateRole(id, body);
  }

  @Delete('roles/:id')
  @Permissions('role.manage')
  deleteRole(@Param('id') id: string) {
    return this.service.deleteRole(id);
  }

  @Get('permissions')
  @Permissions('role.read')
  listPermissions() {
    return this.service.getPermissions();
  }
}
