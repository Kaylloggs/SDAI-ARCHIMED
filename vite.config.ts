import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

/**
 * Déclare chaque dossier de `src/modules` comme source Tailwind.
 *
 * Tailwind ne parcourt pas ce que git ignore. Un module peut l'être — un module local
 * qu'on ne publie pas — et ses écrans perdent alors, sans le moindre avertissement,
 * les classes qu'ils sont seuls à utiliser : les espacements retombent à zéro et
 * l'interface paraît tassée. La liste est donc écrite à chaud, avant toute compilation
 * du CSS, ce qui évite aussi d'inscrire le nom d'un module privé dans un fichier suivi.
 */
function moduleSources(): Plugin {
  const root = path.resolve(import.meta.dirname, "src");
  const generated = path.join(root, "design-system", "modules.generated.css");

  const write = () => {
    const modules = path.join(root, "modules");
    if (!fs.existsSync(modules)) return;
    const lines = fs
      .readdirSync(modules, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `@source "../modules/${entry.name}";`);
    const content = `/* GÉNÉRÉ par vite.config.ts — ne pas modifier à la main. */\n${lines.join("\n")}\n`;
    if (!fs.existsSync(generated) || fs.readFileSync(generated, "utf8") !== content) {
      fs.writeFileSync(generated, content, "utf8");
    }
  };

  return {
    name: "archimed:tailwind-module-sources",
    enforce: "pre",
    configResolved: write,
    buildStart: write,
  };
}

export default defineConfig(() => ({
  plugins: [moduleSources(), react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
