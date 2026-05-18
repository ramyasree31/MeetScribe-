// apps/bot-worker/src/index.ts
// Router script to run either the Meet or Zoom bot

const platform = process.env.PLATFORM || 'MEET';

if (platform === 'ZOOM') {
  require('./zoom-bot');
} else {
  // If we exported main() in meet-bot.ts, we could require it properly, 
  // but since meet-bot.ts executes on import, requiring it runs it.
  require('./meet-bot');
}
