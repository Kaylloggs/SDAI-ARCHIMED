import { Bot, Box, FileArchive, Hammer, Palette, Plus } from "lucide-react";
import { defineTutorial } from "@/core/modules";

export default defineTutorial({
  summary: "Créer de vrais mods Minecraft (Fabric, Forge, NeoForge), les tester en jeu et les partager.",
  steps: [
    {
      icon: Plus,
      title: "Créer un projet",
      text: "« Nouveau projet » : nom, version de Minecraft, loader et contenu. Si Java manque, il s'installe depuis l'application.",
      area: "center",
    },
    {
      icon: Palette,
      title: "Faire les textures",
      text: "Onglet Textures : générez une texture par IA, importez une image ou retouchez-la au pixel.",
      area: "top",
    },
    {
      icon: Box,
      title: "Modeler en 3D",
      text: "Onglet Modèles 3D : blocs, objets, entités et armures, avec formes et textures, comme dans Blockbench.",
      area: "center",
    },
    {
      icon: Bot,
      title: "Demander à l'assistant IA",
      text: "Il travaille sur une copie du projet : vous relisez chaque fichier modifié avant de l'appliquer.",
      area: "top",
    },
    {
      icon: Hammer,
      title: "Compiler et tester",
      text: "Onglet Build : compilez le mod, puis « Tester en jeu » lance Minecraft avec votre mod.",
      area: "top",
    },
    {
      icon: FileArchive,
      title: "Récupérer le mod",
      text: "Le fichier .jar compilé arrive dans le dossier dist du projet, prêt à partager.",
      area: "center",
    },
  ],
  tips: [
    "Un point de restauration est créé avant chaque changement important : rien ne se perd.",
    "Le serveur de test tourne pendant que le jeu est ouvert : rejoignez localhost en multijoueur.",
  ],
});
