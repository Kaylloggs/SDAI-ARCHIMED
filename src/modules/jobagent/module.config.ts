import { lazy } from "react";
import { BriefcaseBusiness } from "lucide-react";
import { defineModule } from "@/core/modules";

export default defineModule({
  id: "jobagent",
  name: "JobAgent",
  description:
    "Cherche des offres sur plusieurs plateformes, pays et villes à la fois, puis prépare les candidatures.",
  version: "0.1.0",
  icon: BriefcaseBusiness,
  category: "automation",
  order: 20,
  enabledByDefault: true,
  page: lazy(() => import("./index")),
  launchpad: { size: "md" },
  backend: { plugin: "jobagent" },
  commands: [{ id: "jobagent.open", title: "Ouvrir JobAgent", run: "navigate" }],
});
