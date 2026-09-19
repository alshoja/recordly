import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { SignInDto } from './dto/signin.dto';
import * as bcrypt from 'bcryptjs';
import type {
  AuthJwtPayload,
  AuthResponse,
  SignUpResponse,
} from './types/express';
import { SignUpDto } from './dto/signup.dto';
import { CreateUserDto } from '../users/dto/create-user.dto';
import type { User } from '../users/entities/user.entity';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async signIn({ email, password }: SignInDto): Promise<AuthResponse> {
    const user = await this.usersService.findOneByEmail(email);

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Checked after the password, so only the account's owner learns it is pending.
    if (!user.isActive) {
      throw new ForbiddenException(
        'Your account is waiting for administrator approval.',
      );
    }

    return this.buildAuthResponse(user);
  }

  async signUp(signUpDto: SignUpDto): Promise<SignUpResponse> {
    const existingUser = await this.usersService.findOneByEmail(signUpDto.email);
    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const createUserDto: CreateUserDto = {
      firstName: signUpDto.firstName,
      lastName: signUpDto.lastName,
      username: signUpDto.email,
      password: signUpDto.password,
    };
    await this.usersService.create(createUserDto);

    // New accounts are inactive until an administrator approves them, so no
    // token is issued: every request made with it would be rejected.
    return {
      message:
        'Your account was created. An administrator must approve it before you can sign in.',
    };
  }

  private async buildAuthResponse(user: User): Promise<AuthResponse> {
    const payload: AuthJwtPayload = {
      sub: user.id,
      email: user.username,
      role: user.role,
    };
    return {
      access_token: await this.jwtService.signAsync(payload),
      user: {
        id: user.id,
        email: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    };
  }
}
