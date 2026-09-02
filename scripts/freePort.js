#!/usr/bin/env node
/**
 * Free the dev port before nodemon starts.
 *
 * The previous version of `npm run dev` inlined `netstat -ano` + `taskkill`,
 * which only exist on Windows — on macOS/Linux it printed
 * "netstat: illegal option -- o" on every start. This does the same job with
 * the right tool for the platform, and stays silent when the port is free.
 */
const { execSync } = require('child_process');

const port = process.env.PORT || 5000;

function run(cmd) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
}

try {
  if (process.platform === 'win32') {
    const line = run('netstat -ano')
      .split('\n')
      .find(l => l.includes(`:${port}`) && l.includes('LISTENING'));
    if (line) {
      const pid = line.trim().split(/\s+/).pop();
      run(`taskkill /PID ${pid} /F`);
      console.log(`Freed port ${port} (pid ${pid})`);
    }
  } else {
    // -t = pids only, -i = internet sockets, -sTCP:LISTEN = listeners only
    const pids = run(`lsof -tiTCP:${port} -sTCP:LISTEN`).split('\n').filter(Boolean);
    for (const pid of pids) {
      process.kill(Number(pid), 'SIGTERM');
      console.log(`Freed port ${port} (pid ${pid})`);
    }
  }
} catch {
  // Nothing listening, or the tool is unavailable — either way, carry on.
}
