// apps/bot-worker/src/index.ts
import { runZoomBot } from './zoom-bot';
import { runTeamsBot } from './teams-bot';
import { runWebexBot } from './webex-bot';
import { runHealthCheck } from './health-check';
const isHealthCheck = process.env.HEALTH_CHECK === 'true' || process.env.PLATFORM === 'HEALTH_CHECK';
if (isHealthCheck) {
    console.log('[bot-worker] Running in HEALTH_CHECK mode');
    runHealthCheck().catch((err) => {
        console.error('[bot-worker] Health check fatal error:', err);
        process.exit(1);
    });
}
else {
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
}
