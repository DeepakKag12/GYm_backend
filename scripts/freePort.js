#!/usr/bin/env node
/**
 * Free the dev port before nodemon starts.
 *
 * Only ever stops a process belonging to THIS project. The previous version
 * killed whatever held the port, which one day turned out to be an unrelated
 * project's API server — it died silently, and because the frontend points at
 * localhost:5000 the site then talked to that other backend, so admin login
 * failed against a perfectly good account. A dev convenience should not be
 * able to take down someone's other work.
 *
 * So: identify the holder, compare its working directory with this one, and
 * either stop it (ours, safe) or explain and step aside (not ours).
 */
const { execSync } = require('child_process');
const path = require('path');

const port = Number(process.env.PORT) || 5000;
const projectDir = path.resolve(__dirname, '..');

const sh = cmd => execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();

/** Working directory of a running process, or '' if it cannot be read. */
function cwdOf(pid) {
  try {
    const line = sh(`lsof -a -p ${pid} -d cwd -Fn`).split('\n').find(l => l.startsWith('n'));
    return line ? line.slice(1) : '';
  } catch { return ''; }
}

function describe(pid) {
  try { return sh(`ps -o command= -p ${pid}`).slice(0, 70); } catch { return 'unknown process'; }
}

try {
  if (process.platform === 'win32') {
    // Windows has no cheap equivalent of lsof -d cwd, so report rather than kill.
    const line = sh('netstat -ano').split('\n')
      .find(l => l.includes(`:${port}`) && l.includes('LISTENING'));
    if (line) {
      const pid = line.trim().split(/\s+/).pop();
      console.error(`\nPort ${port} is in use by pid ${pid}.`);
      console.error(`Stop it, or start on another port:  set PORT=5001 && npm start\n`);
      process.exit(1);
    }
  } else {
    const pids = sh(`lsof -tiTCP:${port} -sTCP:LISTEN`).split('\n').filter(Boolean);
    for (const pid of pids) {
      const dir = cwdOf(pid);
      const mine = dir && (dir === projectDir || dir.startsWith(projectDir + path.sep));

      if (mine) {
        process.kill(Number(pid), 'SIGTERM');
        console.log(`Freed port ${port} — stopped our own server (pid ${pid})`);
      } else {
        console.error(
          `\n❌ Port ${port} is held by a different project, so nothing was stopped.\n` +
          `  pid ${pid}: ${describe(pid)}\n` +
          (dir ? `  running in: ${dir}\n` : '  (its directory could not be read)\n') +
          `\n  Start this API somewhere else instead:\n` +
          `      PORT=5001 npm run dev\n` +
          `  and point the frontend at it in gym_web/frontend/.env.development.local:\n` +
          `      REACT_APP_API_URL=http://localhost:5001/api\n` +
          `  Otherwise the site keeps talking to that other backend and logins fail.\n`,
        );
        process.exit(1);
      }
    }
  }
} catch (err) {
  // lsof missing, or nothing is listening. Either way there is nothing to free,
  // and the server's own EADDRINUSE handler will explain if the port is busy.
}
