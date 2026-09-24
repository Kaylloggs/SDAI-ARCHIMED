import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * `tailwind-merge` ne connaît pas les tailles de texte du design system (`text-caption`,
 * `text-footnote`…) : sans cette déclaration, il les prend pour des couleurs et les retire dès
 * qu'une couleur (`text-danger`) les suit.
 */
const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["caption", "footnote", "body-sm", "body", "message", "title-3", "title-2", "title-1", "display"] },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
