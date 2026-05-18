import { Controller, Post, Body, Req, UnauthorizedException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Controller('users')
export class UsersController {
  @Post('sync')
  async syncUser(@Req() request: any, @Body() body: { email: string; supabaseId: string }) {
    // In a real app, verify the Supabase JWT from the Authorization header here
    const authHeader = request.headers['authorization'];
    if (!authHeader) throw new UnauthorizedException('Missing token');

    const user = await prisma.user.upsert({
      where: { supabaseId: body.supabaseId },
      update: { email: body.email },
      create: {
        email: body.email,
        supabaseId: body.supabaseId,
      },
    });

    return { success: true, user };
  }
}
