import React from "react";
import ReactDOM from "react-dom/client";
import { AppShell } from "@/core/shell/AppShell";
import { useThemeStore } from "@/core/stores/theme.store";
import { applyTheme } from "@/design-system/themes";
import "@/design-system/globals.css";

applyTheme(useThemeStore.getState().theme);

const root = document.getElementById("root");
if (!root) throw new Error("#root introuvable");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <AppShell />
  </React.StrictMode>,
);
