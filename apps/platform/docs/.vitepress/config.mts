import { defineConfig } from "vitepress";

export default defineConfig({
  lang: "en-US",
  title: "opencode-workflow",
  description: "Module-development orchestrator built on top of opencode (Bun + TypeScript 7)",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Platform", link: "/platform/architecture" },
      { text: "Reference", link: "/reference/env" },
    ],
    sidebar: {
      "/guide/": [
        { text: "Guide", items: [
          { text: "Overview", link: "/guide/overview" },
          { text: "Getting Started", link: "/guide/getting-started" },
          { text: "End-to-End (E2E)", link: "/guide/e2e" },
        ]},
      ],
      "/platform/": [
        { text: "Platform", items: [
          { text: "Architecture", link: "/platform/architecture" },
          { text: "Module Pipeline", link: "/platform/pipeline" },
          { text: "Custom Workflows", link: "/platform/workflows" },
          { text: "Workers", link: "/platform/workers" },
          { text: "Agent Executor", link: "/platform/executor" },
          { text: "Task Sources & Events", link: "/platform/tasks" },
          { text: "Module Matcher", link: "/platform/matcher" },
        ]},
      ],
      "/reference/": [
        { text: "Reference", items: [
          { text: "CLI Commands", link: "/reference/cli" },
          { text: "HTTP API", link: "/reference/api" },
          { text: "API Contracts", link: "/reference/contracts" },
          { text: "Web Dashboard", link: "/reference/web" },
          { text: "Environment Variables", link: "/reference/env" },
          { text: "Docker", link: "/reference/docker" },
          { text: "The .opencode Pack", link: "/reference/pack" },
          { text: "Conventions", link: "/reference/conventions" },
        ]},
      ],
    },
    outline: { level: [2, 3] },
    search: {
      provider: "local",
    },
    socialLinks: [{ icon: "github", link: "https://github.com/letnull19A/opencode-workflow" }],
  },
});