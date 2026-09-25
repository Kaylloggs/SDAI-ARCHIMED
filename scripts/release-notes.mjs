#!/usr/bin/env node
/**
 * Notes d'une release GitHub : fichiers à télécharger, prérequis, puis la section de la version
 * dans le CHANGELOG. Utilisé par build.ps1 -Publish et par le workflow « Release notes ».
 *
 *   node scripts/release-notes.mjs <x.y.z> [fichier]
 *
 * Toujours lu et écrit en UTF-8 (sans BOM) : Windows PowerShell 5.1 lisait le CHANGELOG en ANSI,
 * et les accents des notes de la 0.2.2 et de la 0.3.0 étaient cassés (« AjoutÃ© »).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "https://github.com/Kaylloggs/SDAI-ARCHIMED";
const SEMVER = /^\d+\.\d+\.\d+$/;

const [version, out] = process.argv.slice(2);
if (!version || !SEMVER.test(version)) {
  console.error("usage : node scripts/release-notes.mjs <x.y.z> [fichier]");
  process.exit(1);
}

// Fins de ligne normalisées : le CHANGELOG sort en CRLF d'un checkout Windows.
const lines = readFileSync(join(root, "CHANGELOG.md"), "utf8").replace(/\r\n?/g, "\n").split("\n");
const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
const end = lines.findIndex((line, i) => i > start && line.startsWith("## ["));
const section = start < 0 ? "" : lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
if (!section) console.error(`[!] CHANGELOG : aucune section pour ${version}`);

const notes = [
  "## Installation",
  "",
  `- **Installeur** : SDAI.Archimed_${version}_x64-setup.exe`,
  "- **Portable** : SDAI-Archimed.exe (aucune installation)",
  "",
  "Prérequis : Windows 10/11 et au moins une CLI d'IA installée et connectée (Claude Code, " +
    `Antigravity ou Codex). Le [guide d'installation](${REPO}/blob/main/README.fr.md#-installation-en-5-minutes) ` +
    "donne une commande qui installe tout le reste.",
  "",
  "---",
  "",
  section || `Version ${version}`,
  "",
].join("\n");

if (out) writeFileSync(out, notes, "utf8");
else process.stdout.write(notes);
