import { Download, FileCode2, FlaskConical, GraduationCap, LayoutTemplate, Package, Wand2 } from "lucide-react";
import { defineTutorial } from "@/core/modules";

/** Ajouter un module à partir du code source, puis compiler sa propre version. */
export default defineTutorial({
  summary:
    "Un module s'ajoute au code source : vous créez son dossier, puis vous compilez votre version de l'application avec le module en plus.",
  steps: [
    {
      icon: Download,
      title: "Récupérer le code source",
      text: "Il faut les sources du projet, ainsi que Node.js, pnpm et Rust pour recompiler (voir le README, section développeurs).",
      code: "git clone https://github.com/Kaylloggs/SDAI-ARCHIMED.git\ncd SDAI-ARCHIMED\npnpm install",
    },
    {
      icon: Wand2,
      title: "Créer le squelette",
      text: "Une commande copie le modèle dans src/modules. Ajoutez --backend si le module a besoin de code Rust.",
      code: "pnpm new:module meteo --category productivity",
    },
    {
      icon: FileCode2,
      title: "Décrire le module",
      text: "module.config.ts donne son nom, son icône et sa catégorie. L'application le trouve seule : aucune liste à tenir à jour.",
      code: 'export default defineModule({\n  id: "meteo",\n  name: "Météo",\n  icon: CloudSun,\n  category: "productivity",\n  page: lazy(() => import("./index")),\n  tutorial,\n});',
    },
    {
      icon: LayoutTemplate,
      title: "Dessiner sa page",
      text: "index.tsx est la page du module. Les composants et les couleurs du design system le font suivre le thème choisi.",
      code: 'export default function MeteoModule() {\n  return <SectionHeader title="Météo" />;\n}',
    },
    {
      icon: GraduationCap,
      title: "Écrire son tutoriel",
      text: "tutorial.ts décrit chaque étape : un titre, une phrase, la zone de l'écran. Il apparaît ici, dans la liste des modules.",
      code: 'steps: [\n  {\n    icon: MapPin,\n    title: "Choisir une ville",\n    text: "Tapez le nom de la ville.",\n    area: "top",\n  },\n]',
    },
    {
      icon: FlaskConical,
      title: "Essayer et vérifier",
      text: "Lancez l'application en développement. Les vérifications refusent un module sans tutoriel ou sans documentation.",
      code: "pnpm tauri dev\npnpm check\npnpm test",
    },
    {
      icon: Package,
      title: "Compiler votre version",
      text: "build.ps1 compile l'application avec votre module. L'installeur et l'exe portable arrivent dans le dossier release.",
      code: ".\\build.ps1",
    },
  ],
  tips: [
    "L'IA peut le faire pour vous : ouvrez le dossier du projet dans Code et demandez « crée un module météo en suivant guidelines.md ».",
    "Supprimer le dossier d'un module suffit à le retirer : le reste de l'application continue de fonctionner.",
  ],
});
