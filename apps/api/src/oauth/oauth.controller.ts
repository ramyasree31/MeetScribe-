import { Controller, Get, Query, Res, BadRequestException } from '@nestjs/common';
import { Response } from 'express';
import { OauthService } from './oauth.service';

@Controller('oauth')
export class OauthController {
  constructor(private readonly oauthService: OauthService) {}

  @Get('google/start')
  startGoogleAuth(@Query('supabaseId') supabaseId: string, @Res() res: Response) {
    if (!supabaseId) {
      throw new BadRequestException('Missing supabaseId query parameter');
    }
    const url = this.oauthService.getGoogleAuthUrl(supabaseId);
    return res.redirect(url);
  }

  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string,
    @Query('state') supabaseId: string,
    @Res() res: Response
  ) {
    if (!code || !supabaseId) {
      throw new BadRequestException('Missing code or state (supabaseId) parameters');
    }

    try {
      await this.oauthService.handleGoogleCallback(code, supabaseId);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4000';
      return res.redirect(`${frontendUrl}/dashboard?oauth=success`);
    } catch (err: any) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4000';
      return res.redirect(`${frontendUrl}/dashboard?oauth=error&error=${encodeURIComponent(err.message)}`);
    }
  }
}
