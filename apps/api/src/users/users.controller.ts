import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';

const prisma = new PrismaClient();

@Controller('users')
@UseGuards(SupabaseAuthGuard)
export class UsersController {
  /**
   * POST /users/sync
   * Called once after the user first authenticates so we have a local record
   * linked to their Supabase identity.
   */
  @Post('sync')
  async syncUser(
    @Req() req: any,
    @Body() body: { name?: string; avatarUrl?: string },
  ) {
    const supabaseUser = req.supabaseUser; // set by guard

    const user = await prisma.user.upsert({
      where: { supabaseId: supabaseUser.id },
      update: {
        email: supabaseUser.email,
        name: body.name,
        avatarUrl: body.avatarUrl,
      },
      create: {
        supabaseId: supabaseUser.id,
        email: supabaseUser.email,
        name: body.name,
        avatarUrl: body.avatarUrl,
      },
    });

    return { success: true, user };
  }
}

