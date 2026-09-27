/** « Ctrl+Shift+Space » → correspondance avec un événement clavier. */
export type Shortcut = { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean; key: string };

export function parseShortcut(text: string): Shortcut | null {
  const parts = text
    .split("+")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const key = parts.at(-1)!;
  const mods = new Set(parts.slice(0, -1));
  return {
    ctrl: mods.has("ctrl") || mods.has("control"),
    shift: mods.has("shift") || mods.has("maj"),
    alt: mods.has("alt"),
    meta: mods.has("meta") || mods.has("cmd") || mods.has("win"),
    key: key === "space" || key === "espace" ? " " : key,
  };
}

export function matches(shortcut: Shortcut | null, event: Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">): boolean {
  if (!shortcut) return false;
  return (
    event.ctrlKey === shortcut.ctrl &&
    event.shiftKey === shortcut.shift &&
    event.altKey === shortcut.alt &&
    event.metaKey === shortcut.meta &&
    event.key.toLowerCase() === shortcut.key
  );
}

/** Pour l'affichage : « Ctrl Maj Espace ». */
export function shortcutLabel(text: string): string[] {
  return text.split("+").map((p) => {
    const k = p.trim();
    if (/^space$/i.test(k)) return "Espace";
    if (/^shift$/i.test(k)) return "Maj";
    return k;
  });
}
