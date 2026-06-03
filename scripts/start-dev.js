process.env.NODE_OPTIONS = '--max-old-space-size=4096';
const { spawn } = require('child_process');
const path = require('path');

const services = [
  {
    name: 'Web Frontend',
    command: 'npx',
    args: ['next', 'dev', '-p', '4000'],
    cwd: path.resolve(__dirname, '../apps/web'),
    color: '\x1b[36m' // Cyan
  },
  {
    name: 'API Gateway',
    command: 'node',
    args: ['dist/main.js'],
    cwd: path.resolve(__dirname, '../apps/api'),
    color: '\x1b[34m' // Blue
  },
  {
    name: 'Bot Orchestrator',
    command: 'node',
    args: ['dist/main.js'],
    cwd: path.resolve(__dirname, '../apps/bot-orchestrator'),
    color: '\x1b[33m' // Yellow
  },
  {
    name: 'WebSocket Server',
    command: 'npx',
    args: ['ts-node', '--transpile-only', 'server.ts'],
    cwd: path.resolve(__dirname, '../apps/websocket-server'),
    color: '\x1b[36m' // Cyan
  },
  {
    name: 'Audio Processor',
    command: 'python',
    args: ['-m', 'uvicorn', 'main:app', '--host', '0.0.0.0', '--port', '8001'],
    cwd: path.resolve(__dirname, '../apps/audio-processor'),
    color: '\x1b[32m' // Green
  },
  {
    name: 'AI Summarizer',
    command: 'python',
    args: ['-u', 'main.py'],
    cwd: path.resolve(__dirname, '../apps/ai-summarizer'),
    color: '\x1b[35m' // Magenta
  }
];

console.log('\x1b[1mStarting all MeetScribe development services concurrently...\x1b[0m\n');

const processes = [];

services.forEach(service => {
  const isWindows = process.platform === 'win32';
  const cmd = isWindows && service.command === 'pnpm' ? 'pnpm.cmd' : service.command;

  const child = spawn(cmd, service.args, {
    cwd: service.cwd,
    shell: isWindows
  });

  processes.push(child);

  child.stdout.on('data', data => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        console.log(`${service.color}[${service.name}]\x1b[0m ${line}`);
      }
    });
  });

  child.stderr.on('data', data => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        console.error(`${service.color}[${service.name} ERR]\x1b[31m ${line}\x1b[0m`);
      }
    });
  });

  child.on('close', code => {
    console.log(`\x1b[1m[${service.name}] process exited with code ${code}\x1b[0m`);
  });
});

// Graceful shutdown of all child processes when the main script is terminated
process.on('SIGINT', () => {
  console.log('\n\x1b[1mShutting down all services...\x1b[0m');
  processes.forEach(proc => {
    try {
      proc.kill('SIGINT');
    } catch (_) {}
  });
  process.exit(0);
});
