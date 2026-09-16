import React from "react";
import ReactDOM from "react-dom/client";
import { AppShell } from "@/core/shell/AppShell";
import "@/design-system/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root introuvable");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <AppShell />
  </React.StrictMode>,
);
