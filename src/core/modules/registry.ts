import { manifestSchema, type ManifestIssue } from "./manifest.schema";
import type { LoadedModule, ModuleCategory, ModuleManifest } from "./types";
import { MODULE_CATEGORIES } from "./types";

/**
 * Découverte automatique des modules : tout dossier `src/modules/<id>/module.config.ts`
 * est chargé au build. Les dossiers préfixés par `_` sont ignorés (brouillons, template).
 * Le core ne connaît aucun module par son nom (guidelines.md, règle d'or n°2).
 */
const found = import.meta.glob<{ default: ModuleManifest }>(
  ["../../modules/*/module.config.ts", "!../../modules/_*/**"],
  { eager: true },
);

const issues: ManifestIssue[] = [];
const modules: LoadedModule[] = [];

for (const [source, mod] of Object.entries(found)) {
  const manifest = mod?.default;
  if (!manifest) {
    issues.push({ source, message: "export default manquant (defineModule)" });
    continue;
  }
  const parsed = manifestSchema.safeParse(manifest);
  if (!parsed.success) {
    issues.push({ source, message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") });
    continue;
  }
  const folder = source.split("/").at(-2);
  if (folder !== manifest.id) {
    issues.push({ source, message: `id "${manifest.id}" != dossier "${folder}"` });
    continue;
  }
  if (modules.some((m) => m.id === manifest.id)) {
    issues.push({ source, message: `id dupliqué: ${manifest.id}` });
    continue;
  }
  modules.push({ ...manifest, path: `/m/${manifest.id}` });
}

if (issues.length > 0) {
  console.error("[modules] manifests invalides ignorés:", issues);
}

modules.sort((a, b) => {
  const byCategory =
    MODULE_CATEGORIES.indexOf(a.category) - MODULE_CATEGORIES.indexOf(b.category);
  return byCategory !== 0 ? byCategory : a.order - b.order || a.name.localeCompare(b.name);
});

export const allModules: readonly LoadedModule[] = modules;
export const manifestIssues: readonly ManifestIssue[] = issues;

export function modulesByCategory(
  list: readonly LoadedModule[] = allModules,
): Array<[ModuleCategory, LoadedModule[]]> {
  return MODULE_CATEGORIES.map(
    (category) => [category, list.filter((m) => m.category === category)] as const,
  ).filter(([, items]) => items.length > 0) as Array<[ModuleCategory, LoadedModule[]]>;
}

export function getModule(id: string): LoadedModule | undefined {
  return allModules.find((m) => m.id === id);
}
