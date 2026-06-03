"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// apps/bot-worker/src/index.ts
const zoom_bot_1 = require("./zoom-bot");
const platform = process.env.PLATFORM || 'MEET';
if (platform === 'ZOOM') {
    (0, zoom_bot_1.runZoomBot)().catch((err) => {
        console.error('Zoom bot execution failed:', err);
        process.exit(1);
    });
}
else {
    // If we exported main() in meet-bot.ts, we could require it properly, 
    // but since meet-bot.ts executes on import, requiring it runs it.
    require('./meet-bot');
}
