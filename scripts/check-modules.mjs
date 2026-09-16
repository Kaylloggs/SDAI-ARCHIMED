#!/usr/bin/env node
/**
 * Vérifie les invariants de modularité (guidelines.md).
 * - chaque module frontend a module.config.ts + index.tsx + README.md
 * - aucun import croisé entre modules, ni du core vers un module
 * - chaque module backend (module.toml) est enregistré dans src/modules/mod.rs
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const errors = [];
const warn = [];

const modulesDir = join(root, "src", "modules");
const frontModules = readdirSync(modulesDir).filter(
  (name) => !name.startsWith("_") && statSync(join(modulesDir, name)).isDirectory(),
);

for (const id of frontModules) {
  const dir = join(modulesDir, id);
  for (const required of ["module.config.ts", "index.tsx", "README.md"]) {
    if (!existsSync(join(dir, required))) {
      errors.push(`modules/${id}: fichier obligatoire manquant → ${required}`);
    }
  }
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    errors.push(`modules/${id}: nom de dossier attendu en kebab-case`);
  }

  const config = readFileSync(join(dir, "module.config.ts"), "utf8");
  const declaredId = config.match(/id:\s*"([^"]+)"/)?.[1];
  if (declaredId !== id) {
    errors.push(`modules/${id}: id du manifest ("${declaredId}") différent du dossier`);
  }

  for (const file of walk(dir)) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const source = readFileSync(file, "utf8");
    const crossImport = source.match(/from\s+"@\/modules\/([a-z0-9-]+)/);
    if (crossImport && crossImport[1] !== id) {
      errors.push(
        `${rel(file)}: import direct du module "${crossImport[1]}" — utiliser un service, un slot ou le bus`,
      );
    }
  }
}

for (const file of walk(join(root, "src", "core")).concat(walk(join(root, "src", "design-system")))) {
  if (!/\.(ts|tsx)$/.test(file)) continue;
  const source = readFileSync(file, "utf8");
  if (/from\s+"@\/modules\//.test(source)) {
    errors.push(`${rel(file)}: le core ne doit jamais importer un module`);
  }
}

const backendDir = join(root, "src-tauri", "src", "modules");
if (existsSync(backendDir)) {
  const registry = readFileSync(join(backendDir, "mod.rs"), "utf8");
  for (const name of readdirSync(backendDir)) {
    const manifest = join(backendDir, name, "module.toml");
    if (!existsSync(manifest)) continue;
    if (!registry.includes(`pub mod ${name};`) || !registry.includes(`register!(builder, ${name});`)) {
      errors.push(`src-tauri/src/modules/${name}: non enregistré dans mod.rs`);
    }
    const frontId = name.replace(/_/g, "-");
    if (!frontModules.includes(frontId)) {
      warn.push(`backend "${name}" sans module frontend correspondant ("${frontId}")`);
    }
  }
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function rel(path) {
  return path.slice(root.length + 1).replaceAll("\\", "/");
}

for (const message of warn) console.warn(`[check-modules] avertissement: ${message}`);

if (errors.length > 0) {
  console.error(`\n[check-modules] ${errors.length} problème(s) :`);
  for (const message of errors) console.error(` - ${message}`);
  process.exit(1);
}

console.log(`[check-modules] ${frontModules.length} modules valides.`);
