import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateWorkspaceDto {
  @IsString()
  @Matches(/^[a-z0-9-]{2,40}$/, { message: 'รหัส Workspace ใช้ a-z 0-9 - ยาว 2–40 ตัว' })
  id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;
}

export class UpdateWorkspaceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

export class SetActiveWorkspaceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  id!: string;
}

export class SetWorkspaceMembersDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  userIds!: string[];
}
