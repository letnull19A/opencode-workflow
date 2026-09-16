/** PM2 ecosystem — dev-подъём приложения: webhook + web-dashboard + opencode server. */
const path = require("node:path");

const webCwd = path.resolve(__dirname, "..", "web");

module.exports = {
  apps: [
    {
      // Headless opencode server для демо (только локально; в проде сервер
      // удалённый, платформа цепляется по OPENCODE_SERVER_URL). Рабочая
      // директория — песочница opencode-workspace, чтобы не засорять репо.
      name: "opencode",
      cwd: path.resolve(__dirname, "opencode-workspace"),
      script: "../scripts/opencode-server/server.sh",
      interpreter: "bash",
      args: [],
      exec_mode: "fork",
      watch: false,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        OPENCODE_PORT: "4096",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS",
    },
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
        OPENCODE_SERVER_URL: "http://127.0.0.1:4096",
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