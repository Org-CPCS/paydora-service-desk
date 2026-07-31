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
      // Leak backstop, not a working limit. Measured baseline is ~95MB RSS on
      // a fresh start; the old build drifted to 420-470MB over ~10 days and
      // was OOM-killed by the kernel every time. On the 2GB box this ceiling
      // is far above any legitimate steady state, so hitting it means
      // something is leaking again — and PM2 recycles cleanly instead of the
      // kernel taking the process out from under us.
      max_memory_restart: "600M",
      // src/index.js stops every bot and closes Mongo on SIGINT; PM2's 1.6s
      // default cuts that short and leaves polling sessions half-open.
      kill_timeout: 10000,
      // App output was written with no timestamps at all, which is why the
      // logs could not be correlated against restarts.
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
