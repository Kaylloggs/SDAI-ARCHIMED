#!/usr/bin/env node
/**
 * Règle les conflits « mécaniques » d'une fusion de la version officielle dans une copie
 * personnelle d'ARCHIMED (scripts/update-from-source.ps1, ADR 0013), sans jamais toucher au
 * code de la personne :
 * - numéros de version (package.json, tauri.conf.json, Cargo.toml) : la version officielle ;
 * - CHANGELOG.md : le journal officiel ;
 * - fichiers de verrouillage (pnpm-lock.yaml, Cargo.lock) : la version officielle, que
 *   `pnpm install` et la compilation complètent avec les dépendances ajoutées par la personne.
 * Tout autre conflit reste à régler : le script le signale (code de sortie 1).
 *
 *   node scripts/merge-conflicts.mjs          (pendant une fusion en conflit)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const VERSION_FILES = new Set(["package.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml"]);
const THEIRS_FILES = new Set(["CHANGELOG.md", "pnpm-lock.yaml", "src-tauri/Cargo.lock"]);

const VERSION_LINE = [/^\s*"version"\s*:\s*"[^"]*",?\s*$/, /^\s*version\s*=\s*"[^"]*"\s*$/];
const isVersionOnly = (lines) =>
  lines.some((line) => line.trim() !== "") && lines.every((line) => line.trim() === "" || VERSION_LINE.some((re) => re.test(line)));

/**
 * Remplace chaque bloc en conflit par la version officielle (« theirs ») quand `accept(ours,
 * theirs)` l'autorise. Gère le style diff3 (section de base `|||||||`).
 * @returns {{ text: string, unresolved: number }}
 */
export function resolveConflicts(text, accept) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const out = [];
  let unresolved = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith("<<<<<<< ")) {
      out.push(lines[i]);
      continue;
    }
    const start = i;
    const ours = [];
    const theirs = [];
    let section = "ours";
    let closed = false;
    for (i += 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (section === "ours" && line.startsWith("||||||| ")) section = "base";
      else if (section !== "theirs" && line === "=======") section = "theirs";
      else if (section === "theirs" && line.startsWith(">>>>>>> ")) {
        closed = true;
        break;
      } else if (section === "ours") ours.push(line);
      else if (section === "theirs") theirs.push(line);
    }
    if (closed && accept(ours, theirs)) {
      out.push(...theirs);
    } else {
      unresolved += 1;
      out.push(...lines.slice(start, i + 1));
    }
  }
  return { text: out.join(eol), unresolved };
}

/** Règle de résolution d'un fichier ; `null` : conflit laissé à la personne. */
export function ruleFor(file) {
  const path = file.replace(/\\/g, "/");
  if (THEIRS_FILES.has(path)) return () => true;
  if (VERSION_FILES.has(path)) return (ours, theirs) => isVersionOnly(ours) && isVersionOnly(theirs);
  return null;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function main() {
  const conflicted = git("diff", "--name-only", "--diff-filter=U").split(/\r?\n/).filter(Boolean);
  const left = [];
  for (const file of conflicted) {
    const rule = ruleFor(file);
    if (!rule) {
      left.push(file);
      continue;
    }
    if (file.endsWith(".lock") || file.endsWith("lock.yaml")) {
      // Régénérés ensuite (pnpm install, cargo) : on part de la version officielle entière.
      git("checkout", "--theirs", "--", file);
    } else {
      const { text, unresolved } = resolveConflicts(readFileSync(file, "utf8"), rule);
      if (unresolved > 0) {
        left.push(file);
        continue;
      }
      writeFileSync(file, text);
    }
    git("add", "--", file);
    console.log(`  [ok] ${file}`);
  }
  if (left.length > 0) {
    console.log("Conflits a regler a la main :");
    for (const file of left) console.log(`  - ${file}`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
