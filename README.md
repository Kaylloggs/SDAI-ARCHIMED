# SDAI ARCHIMED

An evolutive, modular desktop app uniting **Claude Code**, **Antigravity** and **Codex** with their full agentic capabilities in a single interface. It features a VS Code-like editor, a modern chat, skills management, a task planner and an AI memory. Its plug-and-play architecture lets you enable, disable or create modules on the fly. Powered by **Tauri 2 & Rust**.

> Windows 10/11 desktop app · free and open source (MIT) · made by **SearaDesign**

---

## 🌟 What is ARCHIMED?

Think of it as the **Claude Code desktop app, supercharged to run Claude, Antigravity and Codex under one roof**.

Instead of being locked into a single CLI or wrestling with raw terminal windows, **SDAI ARCHIMED** wraps top-tier AI coding agents in a reactive desktop environment. Terminal output, permission requests and tool executions become interactive cards, governed by an automatic risk policy.

ARCHIMED does not replace the CLIs: it drives the ones installed on your machine, with your own subscriptions and logins.

---

## 🚀 Key features

### 🤖 Multi-agent orchestration (Claude + Antigravity + Codex)
- Run **Claude Code**, **Antigravity CLI (`agy`)** and **Codex** in the same application.
- Full access to their agentic capabilities: file creation, command execution, refactoring, tool calls.
- Pick the agent, the model and the working folder for each conversation.
- Live activity ("Thinking…", "Creating main.rs…", "2 files created · 1 command run"), plus duration and tokens under every answer.
- File paths mentioned by the AI are clickable: open in the editor, reveal in Explorer, copy the path.

### 💬 Conversational messaging (`chat` module)
- Multiple conversations with history, date, model and folder.
- **Intelligent parsing**: permission requests, `[Y/n]` questions and menus become clickable cards.
- **Auto mode**: a risk policy (`Low` → `Critical`) lets agents work without constant interruptions; critical actions are always confirmed.
- Attach files, pick a skill, choose the working folder right from the input bar.
- Stop the agent at any time; answers cut short are resumed automatically.
- **Token saver**: a built-in mode powered by the [Caveman](https://github.com/JuliusBrussee/caveman) skill (Settings) makes every answer terse while keeping code and technical terms exact.

### 💻 VS Code-like workspace (`code` module)
- File tree, tabs, syntax-highlighted editor powered by **CodeMirror 6** (~35 languages), `Ctrl+P` file palette, `Ctrl+S` save.
- **Drag & drop**: drag files from the tree into the chat to target them for modification; drop files from Windows Explorer to attach them.
- An AI assistant panel next to your code, with its own conversations per project.
- **Live preview**: when the agent starts a dev server (`pnpm dev`, `python -m http.server`…) or writes an HTML page, preview it right in the app.
- Resizable panels, and a file tree that updates by itself when the AI creates files.

### 🧠 Skills management (`skills` module)
- Import and organize skills in a visual library.
- Sync active skills to your installed CLIs, and pick one from the chat input bar.

### 📆 Task planner & calendar (`planner` module)
- Trello-like boards with columns, cards, due dates, labels and subtasks, plus a monthly calendar view.
- Link a `roadmap.md`: its sections and checkboxes become columns and cards, synced both ways (when the AI ticks a task, the board updates).
- Add due dates to Google Calendar or export an `.ics` file.

### 🗂️ AI memory (`memory` module)
- Write what the AIs should know about you and your projects: preferences, conventions, context.
- Each entry applies everywhere or to one project, and can be switched on or off.
- Import a `.txt`, `.md` or `.json` file to add many entries at once.
- Active entries are sent at the start of each new conversation, with an exact preview.

### 📊 Credits (`usage` module)
- Remaining subscription limits reported by Claude (5-hour and 7-day windows).
- Tokens, estimated cost and time spent per CLI and per day.

---

## 🧩 100% modular "Lego" architecture

ARCHIMED is built to be **infinitely evolutive**:

- **Plug-and-play discovery**: each module is self-contained (`src/modules/<id>/`, plus `src-tauri/src/modules/<id>/` for its Rust side) and discovered automatically. The core never imports a module, and modules never import each other.
- **Toggle anytime**: enable or disable any module in Settings, with no side effects.
- **Add modules on demand**: scaffold one with `pnpm new:module <id>`.
- **Extension points**: slots (UI contributions), services and events let modules cooperate without depending on each other.

### Shipped modules

| Module | Role |
|---|---|
| `home` | Launchpad: recent conversations and one tile per active module |
| `chat` | Multi-CLI conversations, permission cards, auto mode, attachments |
| `code` | VS Code-like editor with an AI assistant panel |
| `skills` | Skills library, activation and sync to the CLIs |
| `planner` | Task boards, calendar view, `roadmap.md` sync, Google Calendar / `.ics` |
| `memory` | Information you give the AIs, per project or global, importable from a file |
| `usage` | Subscription limits and token usage per CLI |
| `settings` | Themes, CLI detection, modules, data |

Planned: system file manager, voice dictation, local image generation, agent workflow automations.

---

## 📥 Download and run

### 1. Install the prerequisites (Windows 10/11)

| Tool | Version | How to install | Check |
|---|---|---|---|
| **Git** | any | [git-scm.com](https://git-scm.com/download/win) | `git --version` |
| **Node.js** | 20 or newer | [nodejs.org](https://nodejs.org) (LTS) | `node -v` |
| **pnpm** | 9 or newer | `npm install -g pnpm` | `pnpm -v` |
| **Rust** (MSVC toolchain) | stable, 1.85 or newer | [rustup.rs](https://rustup.rs) | `rustc -V` |
| **Visual Studio Build Tools** | 2022 | [Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/), select **"Desktop development with C++"** | — |
| **WebView2** | — | built into Windows 11 ([installer](https://developer.microsoft.com/microsoft-edge/webview2/) for Windows 10) | — |

### 2. Install at least one AI CLI

ARCHIMED drives the CLIs installed on your machine. Install and **log in** to the ones you want:

| CLI | Install | Log in / check |
|---|---|---|
| **Claude Code** | [Install Claude CLI](https://docs.claude.com/en/docs/claude-code) | run `claude` once and log in |
| **Google Antigravity CLI** (`agy`) | [Install Antigravity CLI](https://antigravity.google/download#antigravity-cli) | run `agy` once and log in |
| **Codex** (experimental) | `npm install -g @openai/codex` | run `codex` once and log in |

CLIs are detected automatically. If one is installed outside your `PATH`, set its location in **Settings → Engine**.

### 3. Get the code

```bash
git clone https://github.com/Kaylloggs/SDAI-ARCHIMED.git
cd SDAI-ARCHIMED
pnpm install
```

> With pnpm 10 or newer, if install stops on `ERR_PNPM_IGNORED_BUILDS`, run `pnpm approve-builds` and allow `esbuild`.

### 4. Run it

```bash
pnpm tauri dev
```

The first launch compiles the Rust side, which takes a few minutes. Later launches are much faster.

### 5. Build the `.exe` (optional)

Double-click **`build.bat`**, or run:

```bash
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

Options: `-Bundles nsis|msi|all|none` · `-DebugBuild` · `-SkipInstall` · `-SkipChecks` · `-Clean` · `-Bump patch|minor|major|none` · `-Publish`.
Output goes to `release/<version>/`: a portable `SDAI-Archimed.exe` plus installers.

**Versioning**: every release build bumps the version automatically (`patch` by default, e.g. 0.2.0 → 0.2.1; `-Bump minor` or `-Bump major` for bigger steps, `-Bump none` to rebuild). The version is updated in `package.json`, `tauri.conf.json`, `Cargo.toml` and `CHANGELOG.md`, and shown in **Settings**. `-Publish` also commits the version, tags `vX.Y.Z`, pushes and creates the GitHub release with the installers (requires the [GitHub CLI](https://cli.github.com)).

---

## 🛠️ Developer commands

| Command | Purpose |
|---|---|
| `pnpm tauri dev` | run the app in development mode |
| `pnpm check` | TypeScript types and module rules (every module must be documented) |
| `pnpm test` | frontend tests (Vitest) |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Rust tests |
| `pnpm new:module <id>` | scaffold a new module |
| `pnpm version:bump patch\|minor\|major` | bump the version without building |

**Stack**: Tauri 2 · Rust (tokio, portable-pty, vt100) · React 19 · TypeScript · Vite · Tailwind CSS v4 · zustand · motion · CodeMirror 6.

## 📚 Documentation

| File | Content |
|---|---|
| [`guidelines.md`](guidelines.md) | rules and conventions: creating a module, a CLI adapter, a detection rule |
| [`architecture.md`](architecture.md) | folder tree, IPC, CLI engine, intelligent parsing, risk policy |
| [`design.md`](design.md) | design system: tokens, typography, motion, components |
| [`CHANGELOG.md`](CHANGELOG.md) | what changed, version by version |
| `CLAUDE.md` / `AGENTS.md` | entry points for AI agents working on this repo |
| `docs/adr/` | architecture decision records |

Internal docs (guidelines, architecture, design, changelog) are written in French.

## 🔒 Privacy and safety

- Everything stays on your machine: conversations, memory, boards and settings live in `%APPDATA%\com.sdai.archimed\`.
- ARCHIMED never launches a CLI with `--dangerously-skip-permissions`. Permissions go through its own risk policy, and every decision is written to a local audit log.
- Programs (`.exe`, `.bat`, `.ps1`…) are never launched from a link in the chat.

## 🤝 Contributing

Issues and pull requests are welcome. Read [`guidelines.md`](guidelines.md) first: one feature is one module, and `pnpm check`, `pnpm test` and `cargo clippy` must pass.

## 📄 License

[MIT](LICENSE) © 2026 SearaDesign. Free to use, modify and share, as long as the copyright notice is kept.

The token saver bundles the Caveman skill by Julius Brussee (MIT, see `src/core/engine/prompts/caveman.LICENSE`); ARCHIMED is not affiliated with Caveman.

Claude, Antigravity and Codex are trademarks of their respective owners. ARCHIMED is an independent project, not affiliated with Anthropic, Google or OpenAI.
