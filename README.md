# SDAI-ARCHIMED
An evolutive, modular desktop app uniting Claude Code, Antigravity, and Codex with their full agentic capabilities   │ in a single interface. Features a VS Code-like editor, a modern chat, and skill management. Built with a plug-and-   │ play architecture where you can enable, disable, or create new modules on the fly. Powered by Tauri 2 &amp; Rust.

## 🌟 What is SDAI ARCHIMED?

  Think of it as the **Claude Code desktop app — but supercharged to run Claude, Antigravity, and Codex
  simultaneously under one unified roof**.

  Rather than being locked into a single CLI or wrestling with raw terminal windows, **SDAI ARCHIMED** wraps top-
  tier AI coding agents in a reactive desktop environment. Terminal outputs, permissions, and tool executions are
  automatically converted into interactive GUI cards with automated risk policies.

  ---

## 🚀 Key Features

### 🤖 Multi-Agent Orchestration (Claude + Antigravity + Codex)
  - Run **Claude Code**, **Antigravity CLI (`agy`)**, and **Codex** side-by-side in the same application.
  - Full access to their **agentic capabilities**: file generation, command execution, automated refactoring, and
  headless tool invocation.
    - Switch agents, change models, and customize working directories on a per-conversation basis.

### 💻 VS Code-like Workspace (`code` module)
  - Dedicated multi-column developer interface: responsive directory tree, file tabs, and syntax-highlighted editor
  powered by **CodeMirror 6** (~35 languages supported).
  - **Drag & Drop Workflow**: Drag files straight from the tree into the conversation to target specific files for
  the agent to modify.
  - Integrated collapsible chat assistant running the same multi-agent engine right beside your code.

### 💬 Conversational Messaging (`chat` module)
  - Clean, distraction-free messaging interface designed around human-agent collaboration.
  - **Intelligent Parsing**: Prompts, confirmation prompts (`[Y/n]`), and diff previews become interactive,
  clickable cards.
  - **Autonomous Auto Mode**: Smart risk evaluation (`Low` → `Critical`) lets agents work smoothly without constant
  interruptions, while critical system actions remain safeguarded.
  - Attach files, folders, and documentation directly into the prompt.

### 🧠 Centralized Skills Management (`skills` module)
  - Import, create, and organize specialized skills in a visual catalog.
  - Automatically synchronizes active skills across your installed CLIs.

  ---

## 🧩 100% Modular "Lego" Architecture

  ARCHIMED is built from the ground up to be **infinitely evolutive**:

  - **Plug-and-Play Discovery**: Each module is self-contained (`src/modules/<id>/`). Modules are discovered
  automatically at build/run time without any hardcoded imports in the core.
  - **Toggle Anytime**: Enable or disable any module directly in the settings with zero side effects. Removing or
  turning off a module simply unmounts it from the UI.
  - **Add New Modules On Demand**: Scaffold and add new modules whenever you need with a single command (`pnpm
  new:module <id>`).
  - **Roadmap**: Currently shipping with **3 core feature modules** (`chat`, `code`, `skills`), with more base
  modules planned (e.g. system file manager, voice dictation, local image generation, agentic workflow automations).

  ---
