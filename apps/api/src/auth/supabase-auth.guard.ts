import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    // Dev bypass — hardcoded to the existing DB user
    request.supabaseUser = {
      id: '9acb7070-d837-4df0-a97e-d2162f357736',
      email: 'riteshshingre@gmail.com',
      role: 'authenticated',
    };
    return true;
  }
}
