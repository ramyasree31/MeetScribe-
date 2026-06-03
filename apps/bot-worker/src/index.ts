// apps/bot-worker/src/index.ts
import { runZoomBot }  from './zoom-bot';
import { runTeamsBot } from './teams-bot';
import { runWebexBot } from './webex-bot';

const platform = (process.env.PLATFORM || 'MEET').toUpperCase();

console.log(`[bot-worker] Platform: ${platform}`);

switch (platform) {
  case 'ZOOM':
    runZoomBot().catch((err) => {
      console.error('[bot-worker] Zoom bot fatal error:', err);
      process.exit(1);
    });
    break;

  case 'TEAMS':
  case 'MICROSOFT_TEAMS':
    runTeamsBot().catch((err) => {
      console.error('[bot-worker] Teams bot fatal error:', err);
      process.exit(1);
    });
    break;

  case 'WEBEX':
  case 'CISCO_WEBEX':
    runWebexBot().catch((err) => {
      console.error('[bot-worker] Webex bot fatal error:', err);
      process.exit(1);
    });
    break;

  case 'MEET':
  case 'GOOGLE_MEET':
  default:
    // meet-bot.ts calls main() on import
    require('./meet-bot');
    break;
}
