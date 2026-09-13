/** PM2 ecosystem — dev-подъём всего приложения: webhook + web-dashboard. */
const path = require("node:path");

module.exports = {
  apps: [
    {
      name: "webhook",
      cwd: __dirname,
      script: "src/http/main.ts",
      interpreter: "bun",
      args: [],
      exec_mode: "fork",
      watch: ["src"],
      ignore_watch: ["web", "docs", "node_modules", ".git", ".opencode"],
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: "development",
        HOME: process.env.HOME,
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS",
    },
    {
      name: "web",
      cwd: path.join(__dirname, "web"),
      script: "node_modules/vite/bin/vite.js",
      interpreter: "bun",
      args: [],
      exec_mode: "fork",
      watch: false,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: "development",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS",
    },
  ],
};