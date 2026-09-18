#!/usr/bin/env node
/**
 * Vérifie les invariants de modularité (guidelines.md).
 * - chaque module frontend a module.config.ts + index.tsx + README.md
 * - aucun import croisé entre modules, ni du core vers un module
 * - chaque module backend (module.toml) expose bien un plugin
 * - chaque module public est documenté (README.md + architecture.md)
 *
 * Les modules privés (dossier ignoré par git) échappent au contrôle de documentation :
 * ils ne doivent laisser aucune trace dans les fichiers publiés.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

/** Un dossier ignoré par git appartient à un module personnel, non publié. */
function isPrivate(path) {
  const result = spawnSync("git", ["check-ignore", "-q", path], { cwd: root });
  return result.status === 0;
}

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

// Chaque module doit être documenté (guidelines.md, règle d'or n°4).
const readme = readFileSync(join(root, "README.md"), "utf8");
const architecture = readFileSync(join(root, "architecture.md"), "utf8");
for (const id of frontModules) {
  if (isPrivate(join("src", "modules", id))) continue;
  if (!readme.includes("`" + id + "`")) {
    errors.push(`README.md: module "${id}" absent du tableau « Shipped modules »`);
  }
  if (!architecture.includes(`${id}/`)) {
    errors.push(`architecture.md: module "${id}" absent de l'arborescence (§2)`);
  }
}

const backendDir = join(root, "src-tauri", "src", "modules");
if (existsSync(backendDir)) {
  for (const name of readdirSync(backendDir)) {
    const manifest = join(backendDir, name, "module.toml");
    if (!existsSync(manifest)) continue;
    // build.rs découvre les dossiers : il n'y a plus de registre à tenir à jour, mais
    // le plugin doit exister, sinon la compilation échouera.
    const plugin = join(backendDir, name, "mod.rs");
    if (!existsSync(plugin) || !readFileSync(plugin, "utf8").includes("pub fn plugin")) {
      errors.push(`src-tauri/src/modules/${name}: mod.rs doit exposer \`pub fn plugin()\``);
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
