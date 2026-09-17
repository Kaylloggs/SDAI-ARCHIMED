import { Fragment } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Titre de carte écrit en Markdown, rendu sur une seule ligne :
 * `**gras**`, `*italique*`, `` `code` ``, `~~barré~~`, `[texte](url)`.
 * Les blocs (titres, listes, images) sont aplatis — un titre reste un titre.
 */
const INLINE: Components = {
  p: ({ children }) => <>{children}</>,
  h1: ({ children }) => <>{children}</>,
  h2: ({ children }) => <>{children}</>,
  h3: ({ children }) => <>{children}</>,
  ul: ({ children }) => <>{children}</>,
  ol: ({ children }) => <>{children}</>,
  li: ({ children }) => <>{children} </>,
  blockquote: ({ children }) => <>{children}</>,
  img: () => <Fragment />,
  // Un lien dans un titre ne doit pas capter le clic : la carte s'ouvre.
  a: ({ children }) => <span className="text-accent underline underline-offset-2">{children}</span>,
  code: ({ children }) => (
    <code className="rounded-xs bg-surface-2 px-1 font-mono text-[0.92em]">{children}</code>
  ),
};

export function InlineMarkdown({ children }: { children: string }) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={INLINE} disallowedElements={["pre", "hr", "table"]} unwrapDisallowed>
      {children}
    </Markdown>
  );
}

/** Texte sans balisage : export .ics, lien Google Agenda, étiquette de glisser. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
