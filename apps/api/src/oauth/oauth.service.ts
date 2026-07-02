import { Injectable, BadRequestException } from '@nestjs/common';
import { storeGoogleToken, createCalendarWatch } from '@meetscribe/google-client';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Injectable()
export class OauthService {
  getGoogleAuthUrl(supabaseId: string): string {
    const rootUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
    const redirectUri = `${process.env.PUBLIC_API_URL || 'http://localhost:3000'}/api/oauth/google/callback`;
    const options = {
      redirect_uri: redirectUri,
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      access_type: 'offline',
      prompt: 'consent',
      response_type: 'code',
      state: supabaseId,
      scope: [
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/calendar.readonly'
      ].join(' '),
    };

    const qs = new URLSearchParams(options);
    return `${rootUrl}?${qs.toString()}`;
  }

  async handleGoogleCallback(code: string, supabaseId: string) {
    const user = await prisma.user.findUnique({ where: { supabaseId } });
    if (!user) {
      throw new BadRequestException('User not found in database. Please register first.');
    }

    const tokenUrl = 'https://oauth2.googleapis.com/token';
    const redirectUri = `${process.env.PUBLIC_API_URL || 'http://localhost:3000'}/api/oauth/google/callback`;

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.access_token) {
      throw new BadRequestException(
        `Google OAuth exchange failed: ${data.error_description || data.error || 'unknown'}`
      );
    }

    // Save tokens in database (encrypted via storeGoogleToken)
    await storeGoogleToken(
      user.id,
      data.access_token,
      data.refresh_token || '',
      data.expires_in || 3600,
      data.scope?.split(' ') || ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/calendar.readonly'],
    );

    // Set up calendar push subscription
    try {
      await createCalendarWatch(user.id);
    } catch (watchErr) {
      console.error(`[OAuth] Failed to set up Calendar Watch for user ${user.id}:`, watchErr);
    }

    return { success: true };
  }
}
