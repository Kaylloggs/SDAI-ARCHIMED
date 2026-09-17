#!/usr/bin/env node
/**
 * Incrémente la version de l'application partout où elle est déclarée :
 * package.json, src-tauri/tauri.conf.json (lue par l'app : Réglages), src-tauri/Cargo.toml,
 * src-tauri/Cargo.lock, et date la section « Non publié » du CHANGELOG.
 *
 *   node scripts/bump-version.mjs patch|minor|major|<x.y.z> [--dry-run]
 *
 * Affiche la nouvelle version sur la dernière ligne de sortie (lue par build.ps1).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [kind = "patch", ...flags] = process.argv.slice(2);
const dryRun = flags.includes("--dry-run");

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function nextVersion(current, bump) {
  if (SEMVER.test(bump)) return bump;
  const match = SEMVER.exec(current);
  if (!match) throw new Error(`version actuelle invalide : ${current}`);
  const [major, minor, patch] = match.slice(1).map(Number);
  switch (bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`incrément inconnu : ${bump} (patch | minor | major | x.y.z)`);
  }
}

function update(relative, transform) {
  const path = join(root, relative);
  const before = readFileSync(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`${relative} : version introuvable`);
  if (!dryRun) writeFileSync(path, after);
}

const current = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8")).version;
const next = nextVersion(current, kind);
if (next === current) {
  console.log(next);
  process.exit(0);
}

const jsonVersion = (text) => text.replace(/("version"\s*:\s*")[^"]+(")/, `$1${next}$2`);
update("package.json", jsonVersion);
update("src-tauri/tauri.conf.json", jsonVersion);
update("src-tauri/Cargo.toml", (text) => text.replace(/(\[package\][^[]*?\nversion\s*=\s*")[^"]+(")/, `$1${next}$2`));
update("src-tauri/Cargo.lock", (text) =>
  text.replace(/(name = "sdai-archimed"\r?\nversion = ")[^"]+(")/, `$1${next}$2`),
);

// CHANGELOG : « Non publié » devient la version livrée, une section vide est rouverte.
const today = new Date().toISOString().slice(0, 10);
try {
  update("CHANGELOG.md", (text) =>
    text.replace(/## \[Non publié\]/, `## [Non publié]\n\n## [${next}] - ${today}`),
  );
} catch {
  // pas de section « Non publié » : rien à dater
}

console.log(`${dryRun ? "(simulation) " : ""}${current} -> ${next}`);
console.log(next);
