#!/usr/bin/env node
/**
 * Scaffolding d'un module : pnpm new:module <id> [--category ai] [--backend]
 * Copie src/modules/_template, renomme les identifiants, et crée le plugin Rust
 * + son enregistrement si --backend.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const [, , rawId, ...rest] = process.argv;
if (!rawId || !/^[a-z][a-z0-9-]*$/.test(rawId)) {
  console.error("Usage: pnpm new:module <id-en-kebab-case> [--category ai] [--backend]");
  process.exit(1);
}

const category = valueOf("--category") ?? "ai";
const withBackend = rest.includes("--backend");
const id = rawId;
const snake = id.replaceAll("-", "_");
const pascal = id.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join("");
const root = process.cwd();
const target = join(root, "src", "modules", id);

if (existsSync(target)) {
  console.error(`Le module "${id}" existe déjà.`);
  process.exit(1);
}

cpSync(join(root, "src", "modules", "_template"), target, { recursive: true });

for (const file of walk(target)) {
  const content = readFileSync(file, "utf8")
    .replaceAll("__ID__", id)
    .replaceAll("__SNAKE__", snake)
    .replaceAll("__PASCAL__", pascal)
    .replaceAll("__CATEGORY__", category)
    .replaceAll("__BACKEND__", withBackend ? `\n  backend: { plugin: "${snake}" },` : "");
  writeFileSync(file, content);
}

console.log(`✓ src/modules/${id}`);

if (withBackend) {
  const backendDir = join(root, "src-tauri", "src", "modules", snake);
  mkdirSync(backendDir, { recursive: true });

  writeFileSync(join(backendDir, "module.toml"), `id = "${id}"\ncommands = ["ping"]\n`);
  writeFileSync(
    join(backendDir, "mod.rs"),
    `use tauri::plugin::{Builder, TauriPlugin};
use tauri::Runtime;

mod commands;

pub const ID: &str = "${id}";

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(ID)
        .invoke_handler(tauri::generate_handler![commands::ping])
        .build()
}
`,
  );
  writeFileSync(
    join(backendDir, "commands.rs"),
    `use crate::core::AppResult;

#[tauri::command]
pub async fn ping() -> AppResult<String> {
    Ok("pong".to_string())
}
`,
  );

  // Aucun registre à modifier : build.rs découvre les dossiers `module.toml` et génère
  // lui-même les déclarations et l'enregistrement des plugins.
  console.log(`✓ src-tauri/src/modules/${snake} (découvert automatiquement par build.rs)`);
}

console.log(`\nProchaine étape : compléter ${`src/modules/${id}/index.tsx`} puis lancer pnpm check.`);

function valueOf(flag) {
  const index = rest.indexOf(flag);
  return index === -1 ? undefined : rest[index + 1];
}

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
