import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { JWT_SECRET_ENV_KEY } from './constants';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { AuthenticatedRequest } from './types/express';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
    private configService: ConfigService,
    private usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractTokenFromHeader(request);
    if (!token) {
      throw new UnauthorizedException();
    }
    const secret = this.configService.getOrThrow<string>(JWT_SECRET_ENV_KEY);

    // Only an invalid or expired token is the caller's fault (401). A failure in
    // the lookup below, such as the database being down, must surface as a 500.
    let payload: AuthenticatedRequest['user'];
    try {
      payload = await this.jwtService.verifyAsync<AuthenticatedRequest['user']>(
        token,
        { secret },
      );
    } catch {
      throw new UnauthorizedException();
    }

    const user = await this.usersService.findOne(payload.sub);
    if (!user?.isActive) {
      throw new UnauthorizedException();
    }

    request.user = {
      ...payload,
      email: user.username,
      role: user.role,
    };
    return true;
  }

  private extractTokenFromHeader(
    request: AuthenticatedRequest,
  ): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
