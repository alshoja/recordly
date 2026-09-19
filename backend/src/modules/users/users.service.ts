import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';
import { UserRole } from './enums/user-role.enum';
import * as bcrypt from 'bcryptjs';

const PASSWORD_SALT_ROUNDS = 10;

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    await this.ensureDefaultAdminUser();
  }

  async create(createUserDto: CreateUserDto): Promise<User> {
    const user = this.userRepository.create(createUserDto);
    return this.userRepository.save(user);
  }

  async findAll(): Promise<User[]> {
    return this.userRepository.find();
  }

  async findOne(id: number): Promise<User> {
    return this.userRepository.findOne({ where: { id } });
  }

  async findOneByEmail(email: string): Promise<User | undefined> {
    return this.userRepository.findOne({
      where: { username: email },
    });
  }

  async update(id: number, updateUserDto: UpdateUserDto): Promise<User> {
    const { password, ...fields } = updateUserDto;
    const changes: Partial<User> = { ...fields };
    // repository.update() skips the entity's @BeforeUpdate hook, so a new
    // password has to be hashed here or it would be stored as plain text.
    if (password) {
      changes.password = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
    }

    await this.userRepository.update(id, changes);
    return this.findOne(id);
  }

  async remove(id: number): Promise<void> {
    await this.userRepository.delete(id);
  }

  private async ensureDefaultAdminUser(): Promise<void> {
    const adminEmail =
      this.configService.get<string>('DEFAULT_ADMIN_EMAIL') ??
      'admin@gmail.com';
    const adminPassword =
      this.configService.get<string>('DEFAULT_ADMIN_PASSWORD') ?? 'test@12345';

    const existingAdmin = await this.userRepository.findOne({
      where: { username: adminEmail },
    });

    if (!existingAdmin) {
      const adminUser = this.userRepository.create({
        username: adminEmail,
        password: adminPassword,
        firstName: 'System',
        lastName: 'Admin',
        isActive: true,
        role: UserRole.ADMIN,
      });
      await this.userRepository.save(adminUser);
      return;
    }

    const passwordMatches = await bcrypt.compare(
      adminPassword,
      existingAdmin.password,
    );

    if (
      existingAdmin.role !== UserRole.ADMIN ||
      !existingAdmin.isActive ||
      !passwordMatches
    ) {
      await this.userRepository.update(existingAdmin.id, {
        role: UserRole.ADMIN,
        isActive: true,
        password: passwordMatches
          ? existingAdmin.password
          : await bcrypt.hash(adminPassword, PASSWORD_SALT_ROUNDS),
      });
    }
  }
}
