import type { LoaderId } from "@/core/ipc/bindings/LoaderId";
import type { VersionCatalog } from "@/core/ipc/bindings/VersionCatalog";

export const LOADERS: LoaderId[] = ["fabric", "neoforge", "forge"];

export type Target = { minecraft: string; loader: LoaderId; profileId: string };

/**
 * Version de Minecraft et profil pour un nouveau projet demandé par un agent : la version
 * demandée si elle est prise en charge, sinon la plus récente que Mod Studio a déjà compilée avec
 * ce loader (à défaut, la plus récente prise en charge). Le catalogue va de la plus récente à la
 * plus ancienne.
 */
export function pickTarget(catalog: VersionCatalog, loader: LoaderId, minecraft: string | null): Target | string {
  const options = minecraft ? catalog.versions.filter((v) => v.minecraft === minecraft.trim()) : catalog.versions;
  if (minecraft && options.length === 0) return `Minecraft ${minecraft} est inconnu des loaders.`;
  const candidates: Target[] = options.flatMap((option) => {
    const support = option.loaders.find((l) => l.loader === loader && l.profileId);
    return support?.profileId ? [{ minecraft: option.minecraft, loader, profileId: support.profileId }] : [];
  });
  // Sans version demandée : la plus récente dont une vraie compilation a déjà réussi.
  const verified = new Set(catalog.profiles.filter((p) => p.verified).map((p) => p.id));
  const best = candidates.find((c) => verified.has(c.profileId)) ?? candidates[0];
  if (best) return best;
  if (minecraft) {
    const reason = options[0]?.loaders.find((l) => l.loader === loader)?.reason;
    return reason ?? `${loader} n'est pas pris en charge pour Minecraft ${minecraft}.`;
  }
  return `Aucune version de Minecraft prise en charge avec ${loader}.`;
}
