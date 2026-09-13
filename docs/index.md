---
layout: home

hero:
  name: opencode-workflow
  text: Module-development orchestrator on opencode
  tagline: Bun + TypeScript 7 state machine that develops modules through spec → planning → tests → implementation → verification, delegating phases to dedicated opencode agents.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Architecture
      link: /platform/architecture
    - theme: alt
      text: GitHub
      link: https://github.com/letnull19A/opencode-workflow

features:
  - icon: 🧩
    title: Strategy-based module development
    details: Four action strategies — add, update, delete, decompose — each with its own phase map and retry loop.
  - icon: 🔄
    title: Swappable platform nodes
    details: Contracts in src/core, implementations in src/impl. Task sources, event bus, worker registry, state store and agents can all be swapped.
  - icon: 🤖
    title: Proxy agents from the pack
    details: Phases are delegated to specialised opencode agents — unit-test for tests, refactor for updates and deletions.
  - icon: 🐳
    title: Containerised
    details: Multi-stage Docker image bundles Bun, the opencode CLI and the .opencode pack; runs the webhook out of the box.
---