/** Chemins relatifs au projet, toujours avec des `/`. */

export function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** `path` est `base` ou se trouve dessous. */
export function isUnder(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}

/** Nouveau chemin d'un fichier après le renommage de `from` (fichier ou dossier) en `to`. */
export function renamed(path: string, from: string, to: string): string {
  return isUnder(path, from) ? to + path.slice(from.length) : path;
}

/** Scripts exécutés par Gradle : les modifier change ce que fait la compilation. */
export function isBuildScript(path: string): boolean {
  return (
    /^(build|settings)\.gradle(\.kts)?$/.test(path) ||
    path === "gradle.properties" ||
    path === "gradlew" ||
    path === "gradlew.bat" ||
    path.startsWith("gradle/")
  );
}

/** Refus immédiat d'un nom de fichier saisi (le backend refait les contrôles). */
export function newPathProblem(path: string): string | null {
  const clean = path.trim();
  if (!clean) return "Indiquez un nom.";
  if (clean.includes("\\") || clean.includes(":")) return "Utilisez des / et pas de :.";
  if (clean.startsWith("/") || clean.split("/").some((part) => part === ".." || part === "")) {
    return "Chemin relatif au projet, sans .. ni / en trop.";
  }
  if (/^\.(mcstudio|git)(\/|$)/.test(clean)) return "Dossier géré par Mod Studio ou Git.";
  return null;
}
