import { Crop, Expand, ImagePlus, Lasso, Layers, PlugZap, Wand2 } from "lucide-react";
import { defineTutorial } from "@/core/modules";

export default defineTutorial({
  summary: "Créer et retoucher des images avec l'IA (OpenRouter, Google AI Studio, Higgsfield), sans jamais perdre l'original.",
  steps: [
    {
      icon: PlugZap,
      title: "Connecter un fournisseur",
      text: "« Connexions » : collez une clé d'API, vérifiée puis rangée dans Windows (une clé déjà donnée à Mod Studio est reprise sans copie). Sans clé : « Compte », pour Higgsfield avec votre abonnement ou un site officiel.",
      area: "top",
    },
    {
      icon: ImagePlus,
      title: "Créer ou importer",
      text: "Décrivez l'image dans « Créer », ou glissez une photo depuis l'Explorateur, ou collez-la avec Ctrl+V.",
      area: "right",
    },
    {
      icon: Lasso,
      title: "Sélectionner une zone",
      text: "Rectangle, ellipse, lasso ou pinceau à gauche. Maj ajoute, Alt retire.",
      area: "left",
      keys: ["L"],
    },
    {
      icon: Wand2,
      title: "Retoucher la zone",
      text: "« Retoucher › Zone » : remplacez, effacez ou ajoutez. Hors de la sélection, chaque pixel reste celui d'origine.",
      area: "right",
    },
    {
      icon: Expand,
      title: "Étendre, améliorer, varier",
      text: "Élargissez en 16:9, affinez la définition ou demandez quatre variantes, en disant ce qu'il faut garder.",
      area: "right",
    },
    {
      icon: Layers,
      title: "Revenir en arrière",
      text: "Chaque opération crée une version dans l'historique en bas. Comparez avant et après avec K.",
      area: "bottom",
      keys: ["Ctrl", "Z"],
    },
    {
      icon: Crop,
      title: "Recadrer et exporter",
      text: "Outil Recadrer, formats de réseaux sociaux, puis « Exporter » en PNG, JPEG, WebP, TIFF, GIF ou BMP.",
      area: "top",
    },
  ],
  tips: [
    "Mode Auto : choisit un modèle de vos connexions qui sait faire l'opération, et dit pourquoi.",
    "« Image » traite tout sur votre ordinateur (recadrage, taille, rotation, réglages, fond uni) : rien n'est envoyé.",
    "Sans clé, bouton « Compte » : Higgsfield génère ici avec vos crédits (connexion dans le navigateur, aucun mot de passe), ou créez sur un site officiel et importez l'image en un clic.",
    "Ctrl+V dans la consigne : l'image copiée (Explorateur, capture, site) s'ajoute aux images de référence.",
  ],
});
