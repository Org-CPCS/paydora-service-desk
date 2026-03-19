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
    },
  ],
};
