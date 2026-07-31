module.exports = {
  apps: [
    {
      name: "paydora-support-bot",
      script: "src/index.js",
      env: {
        NODE_ENV: "production",
      },
      restart_delay: 5000,
      max_restarts: 10,
      // max_restarts only counts restarts that happen within min_uptime, so
      // without it a crash loop restarts forever. With it, ten crashes inside
      // a minute stop the app instead of grinding on (see 2026-04-16, when it
      // exited with code 1 thirty times in a row).
      min_uptime: "60s",
      // Backstop for a slow leak: restart before the kernel OOM-killer does,
      // which is what has been SIGKILLing this process every ~10 days.
      // Tune against actual RSS (`pm2 describe`, `free -h`) on the box.
      max_memory_restart: "500M",
      // src/index.js stops every bot and closes Mongo on SIGINT; PM2's 1.6s
      // default cuts that short and leaves polling sessions half-open.
      kill_timeout: 10000,
      // App output was written with no timestamps at all, which is why the
      // logs could not be correlated against restarts.
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
