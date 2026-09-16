import { lazy } from "react";
import { MessagesSquare } from "lucide-react";
import { defineModule } from "@/core/modules";

export default defineModule({
  id: "chat",
  name: "Chat",
  description: "Converser avec Claude, Antigravity et les autres CLI.",
  version: "0.1.0",
  icon: MessagesSquare,
  category: "ai",
  order: 10,
  enabledByDefault: true,
  page: lazy(() => import("./index")),
  launchpad: { size: "lg", accent: true },
  consumes: ["voice.transcribe", "code.project"],
  commands: [{ id: "chat.open", title: "Ouvrir le chat", run: "navigate" }],
});
