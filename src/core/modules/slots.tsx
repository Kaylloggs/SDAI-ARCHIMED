import { Suspense, createElement, type ReactNode } from "react";
import { useEnabledModules } from "./useModules";

/**
 * Points d'extension UI officiels. Ajouter un slot ici ET dans architecture.md §5.3.
 * Un module contribue via `slots: { "chat.composer.actions": lazy(...) }`.
 */
export const SLOT_NAMES = [
  "chat.composer.actions",
  "chat.message.actions",
  "chat.header.right",
  "launchpad.widgets",
  "code.editor.footer",
  "statusbar.items",
] as const;

export type SlotName = (typeof SLOT_NAMES)[number];

type SlotProps = {
  name: SlotName;
  /** Rendu si aucun module ne contribue (optionnel). */
  fallback?: ReactNode;
};

/** Rend toutes les contributions des modules actifs pour ce slot. */
export function Slot({ name, fallback = null }: SlotProps) {
  const modules = useEnabledModules();
  const contributions = modules.flatMap((m) => {
    const component = m.slots?.[name];
    return component ? [{ key: `${m.id}:${name}`, component }] : [];
  });

  if (contributions.length === 0) return <>{fallback}</>;

  return (
    <>
      {contributions.map(({ key, component }) => (
        <Suspense key={key} fallback={null}>
          {createElement(component)}
        </Suspense>
      ))}
    </>
  );
}
