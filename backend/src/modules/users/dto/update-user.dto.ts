import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  // Only on update: an admin uses it to approve or deactivate an account.
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
