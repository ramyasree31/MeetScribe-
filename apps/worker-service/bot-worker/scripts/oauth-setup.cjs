/**
 * oauth-setup.cjs
 *
 * One-time OAuth2 setup for the bot Google account.
 * Starts a local web server, opens Google consent screen in the user's
 * own browser, saves the refresh token to Docker volume.
 *
 * Usage:
 *   docker compose run --rm --service-ports bot-setup
 *   Then open: http://localhost:3003
 */

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PORT          = parseInt(process.env.OAUTH_PORT || '3003', 10);
const REDIRECT_URI  = `http://localhost:${PORT}/callback`;
const TOKEN_FILE    = process.env.TOKENS_FILE || '/app/profiles/oauth-tokens.json';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\n❌  GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set.');
  console.error('    Add them to your .env file. See README for setup steps.\n');
  process.exit(1);
}

// Scopes required for OAuthLogin session injection
const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id:     CLIENT_ID,
  redirect_uri:  REDIRECT_URI,
  response_type: 'code',
  scope:         SCOPES,
  access_type:   'offline',
  prompt:        'consent',   // Always ask so we always get a refresh_token
}).toString();

const SUCCESS_HTML = `<!DOCTYPE html><html>
<head><style>
  body{font-family:-apple-system,sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#1a1a1a}
  h1{color:#1a5c3a;font-size:2rem;margin-bottom:.5rem}
  p{color:#666;line-height:1.6}
</style></head>
<body>
  <h1>✅ Setup complete!</h1>
  <p>MeetScribe is now authorised to join meetings as the bot account.</p>
  <p>The session refreshes automatically every 10 hours.<br>You can close this tab.</p>
</body></html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Root → redirect to Google consent
  if (url.pathname === '/') {
    res.writeHead(302, { Location: authUrl });
    return res.end();
  }

  // Callback from Google
  if (url.pathname === '/callback') {
    const code  = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      return res.end(`<h2>❌ Auth cancelled: ${error}</h2>`);
    }

    try {
      // Exchange auth code for access + refresh tokens
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    new URLSearchParams({
          code,
          client_id:     CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri:  REDIRECT_URI,
          grant_type:    'authorization_code',
        }),
      });

      const tokens = await tokenRes.json();
      if (tokens.error) throw new Error(tokens.error_description || tokens.error);

      tokens.created_at = Date.now();

      fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
      fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(SUCCESS_HTML);

      console.log('\n✅  Refresh token saved →', TOKEN_FILE);
      console.log('    Session keeper will auto-refresh cookies every 10 hours.');
      console.log('    Start the full stack: docker compose up -d\n');

      setTimeout(() => server.close(() => process.exit(0)), 1200);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(`<h2>❌ Error: ${err.message}</h2>`);
      console.error('Token exchange failed:', err.message);
    }
    return;
  }

  res.writeHead(404); res.end();
});

server.listen(PORT, () => {
  console.log('\n🔑  MeetScribe OAuth Setup');
  console.log('──────────────────────────────────────────────');
  console.log(`  Open this URL in your browser (on the host):`);
  console.log(`\n    http://localhost:${PORT}\n`);
  console.log('  You\'ll see Google\'s consent screen.');
  console.log('  After approving, this container exits automatically.');
  console.log('──────────────────────────────────────────────\n');
});
