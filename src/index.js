require('dotenv').config();
const app = require('./app');
const { connectDB } = require('./config/db');
const { reportJwtSecretAtBoot } = require('./utils/jwtSecret');

reportJwtSecretAtBoot();

// Connect to MongoDB
connectDB().catch(() => {});

// Notifications report on boot
try {
  const { channelHealth } = require('./services/notify');
  const h = channelHealth();
  console.log(`🔔 Notifications — website: on | whatsapp: ${h.whatsapp.configured ? `on (${h.whatsapp.from})` : `OFF (${h.whatsapp.reason})`} | email: ${h.email.configured ? `on (${h.email.from})` : `OFF (${h.email.reason})`}`);
} catch (e) {
  // Safe notification report
}

// Start cron jobs
if (process.env.VERCEL !== '1') {
  try {
    require('./jobs/feeReminder');
  } catch (e) {
    // Background cron start
  }
}

// Start Server locally if not in Vercel serverless
if (!process.env.VERCEL) {
  const PORT = Number(process.env.PORT) || 5000;
  const server = app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

  server.on('error', err => {
    if (err.code !== 'EADDRINUSE') throw err;

    let holder = '';
    try {
      const { execSync } = require('child_process');
      const sh = c => execSync(c, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (process.platform !== 'win32') {
        const pid = sh(`lsof -tiTCP:${PORT} -sTCP:LISTEN`).split('\n')[0];
        if (pid) {
          const cmd = sh(`ps -o command= -p ${pid}`).slice(0, 60);
          let dir = '';
          try { dir = sh(`lsof -a -p ${pid} -d cwd -Fn`).split('\n').find(l => l[0] === 'n').slice(1); } catch { /* not available */ }
          holder = `\n  Held by pid ${pid}: ${cmd}${dir ? `\n  Running in: ${dir}` : ''}`;
        }
      }
    } catch { /* lsof missing */ }

    console.error(
      `\n❌ Port ${PORT} is already in use, so this server did not start.${holder}\n\n` +
      `  If that is an old copy of THIS server, stop it and try again:\n` +
      `      npm run dev            (frees the port first, then starts)\n\n` +
      `  If it belongs to a different project, leave it alone and use another port:\n` +
      `      PORT=5001 npm start\n` +
      `  — then set REACT_APP_API_URL=http://localhost:5001/api in the frontend's\n` +
      `    .env.development.local, or the site will talk to the wrong backend.\n`,
    );
    process.exit(1);
  });
}

module.exports = app;
