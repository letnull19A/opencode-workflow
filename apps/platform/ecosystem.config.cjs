/** PM2 ecosystem — dev-подъём приложения: webhook + web-dashboard. */
const path = require("node:path");

const webCwd = path.resolve(__dirname, "..", "web");

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
      ignore_watch: ["web", "docs", "node_modules", ".git", ".opencode", "workflows"],
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: "development",
        HOME: process.env.HOME,
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS",
    },
    {
      // Туннелем владеет pm2 (одна живая копия ngrok :8787 → public URL).
      // Никто больше ngrok не поднимает — register.sh берёт publicUrl из API :4040.
      name: "tunnel",
      cwd: __dirname,
      script: "scripts/trello-webhook/tunnel.sh",
      interpreter: "bash",
      args: [],
      exec_mode: "fork",
      watch: false,
      max_restarts: 10,
      restart_delay: 3000,
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS",
    },
    {
      name: "web",
      cwd: webCwd,
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