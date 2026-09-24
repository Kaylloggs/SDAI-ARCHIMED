# SDAI ARCHIMED

A modular desktop app that runs **Claude Code**, **Antigravity** and **Codex** with their full agentic capabilities in one interface: chat, code editor, skills, planner, AI memory, job search and a Minecraft mod studio. Built with **Tauri 2 & Rust**.

> Windows 10/11 · free and open source (MIT) · made by **SearaDesign**

ARCHIMED drives the CLIs installed on your machine, with your own subscriptions. Terminal output, permission requests and tool calls become interactive cards, governed by a risk policy.

## Modules

Each feature is a self-contained module. In **Settings → Modules** you can enable, disable or **delete** any of them (its data goes to the Recycle Bin, and you can bring it back later).

| Module | What it does |
|---|---|
| `chat` | Multi-CLI conversations, permission cards, auto mode, attachments, local dictation, token saver |
| `code` | VS Code-like editor (CodeMirror 6) with an AI panel, drag & drop, live preview |
| `skills` | Skills library, synced to your CLIs |
| `planner` | Task boards, calendar, two-way `roadmap.md` sync, Google Calendar / `.ics` |
| `memory` | What the AIs should know about you, global or per project |
| `jobagent` | Job search on 7 boards, triage, cover letters, batch applications after confirmation |
| `mcstudio` | Real Minecraft mods (Fabric, Forge, NeoForge, 1.14 → 1.21.x): Gradle builds, JDK install, AI textures, in-game testing |
| `usage` | Subscription limits and token usage per CLI |
| `home` · `settings` | Launchpad and settings (required) |

Details in each module's `README.md` under `src/modules/<id>/`.

## Install and run

**Prerequisites** (Windows 10/11): [Git](https://git-scm.com/download/win), [Node.js](https://nodejs.org) 20+, pnpm 9+ (`npm install -g pnpm`), [Rust](https://rustup.rs) 1.85+ (MSVC), [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with "Desktop development with C++", and WebView2 (built into Windows 11). Optional: a JDK for `mcstudio` (it can install one for you), Python 3.10+ for `jobagent`.

**At least one AI CLI**, installed and logged in: [Claude Code](https://docs.claude.com/en/docs/claude-code), [Antigravity CLI](https://antigravity.google/download#antigravity-cli) (`agy`), or Codex (`npm install -g @openai/codex`, experimental). They are detected automatically; set a custom path in **Settings → Engine** if needed.

```bash
git clone https://github.com/Kaylloggs/SDAI-ARCHIMED.git
cd SDAI-ARCHIMED
pnpm install        # pnpm 10+: if ERR_PNPM_IGNORED_BUILDS, run `pnpm approve-builds` and allow esbuild
pnpm tauri dev      # the first launch compiles Rust and takes a few minutes
```

**Build the `.exe`**: double-click `build.bat`, or `powershell -ExecutionPolicy Bypass -File .\build.ps1` (options: `-Bundles nsis|msi|all|none`, `-Bump patch|minor|major|none`, `-Publish`, `-Clean`…). Output: `release/<version>/`. Each release build bumps the version (`patch` by default).

## Developers

| Command | Purpose |
|---|---|
| `pnpm check` | TypeScript types and module rules |
| `pnpm test` | frontend tests (Vitest) |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Rust tests |
| `pnpm new:module <id>` | scaffold a new module |

Stack: Tauri 2 · Rust · React 19 · TypeScript · Vite · Tailwind CSS v4 · zustand · motion · CodeMirror 6.

Read [`guidelines.md`](guidelines.md) (rules: one feature = one module), [`architecture.md`](architecture.md) (IPC, CLI engine, parsing, risk policy) and [`design.md`](design.md) (design system). Decisions live in `docs/adr/`, changes in [`CHANGELOG.md`](CHANGELOG.md). Internal docs are in French.

## Privacy and safety

- Everything stays on your machine, in `%APPDATA%\com.sdai.archimed\`.
- CLIs never run with `--dangerously-skip-permissions`: every permission goes through ARCHIMED's risk policy, and decisions are logged locally.
- Software installs and job applications always ask first: JDKs are checked with SHA-256, applications list every recipient.
- API keys and passwords live in the Windows Credential Manager or are encrypted with DPAPI.

## License

[MIT](LICENSE) © 2026 SearaDesign.

Third-party: the token saver bundles the [Caveman](https://github.com/JuliusBrussee/caveman) skill (MIT); `jobagent` vendors [JobSpy](https://github.com/speedyapply/JobSpy) (MIT) with [GeoNames](https://www.geonames.org/) (CC BY 4.0) and [Natural Earth](https://www.naturalearthdata.com/) data; `mcstudio` templates ship the Gradle Wrapper (Apache 2.0). Minecraft is a trademark of Mojang/Microsoft; mods you build are subject to the Minecraft EULA. Claude, Antigravity and Codex belong to their owners; ARCHIMED is not affiliated with Anthropic, Google or OpenAI.
