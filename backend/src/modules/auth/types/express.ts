import { Request } from 'express';
import { UserRole } from 'src/modules/users/enums/user-role.enum';

export interface AuthJwtPayload {
  sub: number;
  email: string;
  role: UserRole;
}

export interface AuthenticatedUser {
  id: number;
  email: string;
  firstName?: string;
  lastName?: string;
  role: UserRole;
}

export interface AuthResponse {
  access_token: string;
  user: AuthenticatedUser;
}

export interface SignUpResponse {
  message: string;
}

export interface AuthenticatedRequest extends Request {
  user: AuthJwtPayload;
}
