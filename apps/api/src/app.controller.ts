import { Controller, Get, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';

@Controller()
export class AppController {
  @Get()
  redirectRoot(@Res() res: Response) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4000';
    return res.redirect(302, frontendUrl);
  }

  @Get('auth/callback')
  redirectCallback(@Req() req: Request, @Res() res: Response) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4000';
    const queryStr = req.url.split('?')[1] || '';
    const redirectUrl = queryStr ? `${frontendUrl}/auth/callback?${queryStr}` : `${frontendUrl}/auth/callback`;
    return res.redirect(302, redirectUrl);
  }
}
