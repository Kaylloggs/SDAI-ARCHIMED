#!/usr/bin/env node
/**
 * Génère src-tauri/installer/LICENSE.rtf à partir de LICENSE, pour la page de licence des
 * installeurs Windows (NSIS et MSI, `bundle.licenseFile` dans tauri.conf.json).
 *
 *   node scripts/license-rtf.mjs           écrit le fichier
 *   node scripts/license-rtf.mjs --check   échoue s'il n'est plus à jour (lancé par `pnpm check`)
 *
 * Pourquoi un RTF fait ici : Tauri convertit un .txt en RTF sans échapper les accents pour le
 * MSI (« é » y deviendrait « Ã© »). Ce RTF est en ASCII pur, chaque caractère accentué écrit
 * `\uN?`, et il est lu tel quel par les deux installeurs. Les paragraphes du texte (coupés à
 * 80 colonnes) sont recollés pour s'adapter à la largeur de la fenêtre.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(root, "LICENSE");
const TARGET = join(root, "src-tauri", "installer", "LICENSE.rtf");

/** Texte → RTF : caractères réservés échappés, tout ce qui sort de l'ASCII en `\uN?`. */
export function escapeRtf(text) {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0);
    if (char === "\\" || char === "{" || char === "}") out += `\\${char}`;
    else if (code < 0x80) out += char;
    else if (code <= 0xffff) out += `\\u${code > 0x7fff ? code - 0x10000 : code}?`;
    else {
      // Hors du plan de base : deux demi-codets UTF-16.
      const high = Math.floor((code - 0x10000) / 0x400) + 0xd800;
      const low = ((code - 0x10000) % 0x400) + 0xdc00;
      out += `\\u${high - 0x10000}?\\u${low - 0x10000}?`;
    }
  }
  return out;
}

const SEPARATOR = /^=+$/;
const ITEM = /^[a-z]\)\s/;
const HEADING = /^(Article|Section) \d+ — |^(En bref|In short) \(/;

/** Blocs séparés par une ligne vide → paragraphes RTF. */
export function licenseToRtf(text) {
  const blocks = text.replace(/\r\n/g, "\n").trim().split(/\n\s*\n/);
  const paragraphs = [];
  const para = (body, { bold = false, center = false, indent = 0, before = 0, after = 120 } = {}) =>
    paragraphs.push(
      `\\pard${center ? "\\qc" : ""}\\li${indent}\\sb${before}\\sa${after} ${bold ? "\\b " : ""}${body}${bold ? "\\b0" : ""}\\par`,
    );

  blocks.forEach((block, index) => {
    const lines = block.split("\n");
    const indented = /^\s/.test(lines[0]);
    // Bandeau « ===== / VERSION FRANÇAISE / ===== » : un titre centré.
    if (lines.some((line) => SEPARATOR.test(line.trim()))) {
      const title = lines.filter((line) => !SEPARATOR.test(line.trim())).map((line) => escapeRtf(line.trim()));
      para(title.join("\\line "), { bold: true, center: true, before: 360, after: 240 });
      return;
    }
    // Lignes non indentées (titre, copyright, intertitres) : gardées ligne à ligne.
    if (!indented) {
      const heading = index === 0 || HEADING.test(lines[0]);
      para(lines.map((line) => escapeRtf(line.trim())).join("\\line "), {
        bold: heading,
        before: HEADING.test(lines[0]) ? 240 : 0,
      });
      return;
    }
    // Paragraphe indenté : lignes recollées, chaque « a) … » ouvrant son propre paragraphe.
    const pieces = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (pieces.length === 0 || ITEM.test(trimmed)) pieces.push({ item: ITEM.test(trimmed), words: [trimmed] });
      else pieces[pieces.length - 1].words.push(trimmed);
    }
    for (const piece of pieces) {
      para(escapeRtf(piece.words.join(" ")), { indent: piece.item ? 540 : 240, after: piece.item ? 60 : 120 });
    }
  });

  return [
    "{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1",
    "{\\fonttbl{\\f0\\fswiss\\fcharset0 Segoe UI;}}",
    "\\viewkind4\\f0\\fs17",
    ...paragraphs,
    "}",
    "",
  ].join("\n");
}

const expected = licenseToRtf(readFileSync(SOURCE, "utf8"));

if (process.argv.includes("--check")) {
  let current = null;
  try {
    current = readFileSync(TARGET, "utf8");
  } catch {
    // Absent : signalé plus bas.
  }
  // Fins de ligne ignorées : Git peut les convertir à l'extraction (CRLF sous Windows).
  if (current?.replace(/\r\n/g, "\n") !== expected) {
    console.error("[license-rtf] src-tauri/installer/LICENSE.rtf n'est plus à jour : lancez `node scripts/license-rtf.mjs`.");
    process.exit(1);
  }
  console.log("[license-rtf] LICENSE.rtf à jour.");
} else {
  mkdirSync(dirname(TARGET), { recursive: true });
  writeFileSync(TARGET, expected);
  console.log(`[license-rtf] ${TARGET}`);
}
