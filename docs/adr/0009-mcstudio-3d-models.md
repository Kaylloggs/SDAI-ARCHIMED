# ADR 0009 — Mod Studio : atelier 3D (modèles de blocs, d'objets, d'entités et armures)

- **Date** : 2026-09-24
- **Statut** : accepté

## Contexte

Les mods plus complexes demandent des formes qui ne sont pas des cubes pleins : blocs et objets
en 3D (lampe, outil), entités (créatures) et armures. Il fallait les voir en 3D, les modifier et
peindre leurs textures directement sur le modèle, comme dans Blockbench, sans quitter ARCHIMED.

## Décision

1. **three.js pour le rendu** (nouvelle dépendance, `three` + `@types/three`, MIT). C'est aussi le
   moteur de Blockbench. Il fournit le tampon de profondeur, le lancer de rayon avec l'UV du point
   touché (peinture sur le modèle), le filtrage « au plus proche » (pixels nets), `OrbitControls`
   et `TransformControls` (poignée de déplacement). Alternative écartée : un rendu en CSS 3D, sans
   dépendance mais fragile pour l'ordre des faces, la peinture et la sélection. Chargé seulement
   par l'onglet Modèles du module.
2. **La géométrie reproduit le jeu, en code pur testé** (`lib/models/geometry.ts`) : UV par défaut
   et rotation des UV des faces de bloc, rotation d'un cube (axe, ±22,5°/45°, remise à l'échelle),
   UV « en boîte » des cubes d'entité (sommets et ordre de `ModelPart.Cuboid`, gonflement,
   miroir), matrices des os (pivot puis rotation Z, Y, X), objet à plat en relief. Le rendu
   imite l'ombrage du jeu (faces plus ou moins sombres selon leur orientation), sans lumière.
3. **Blocs et objets : les vrais fichiers.** Le JSON `models/{block,item}` est modifié tel quel
   (clés inconnues gardées). Les parents du mod sont lus dans le projet ; ceux du jeu viennent d'une
   petite table (cubes, colonnes, dalles, croix, tapis, objets à plat). Un modèle qui hérite sa forme
   se convertit en cubes d'un clic.
4. **Entités : une source et du code généré.** La source vit dans `.mcstudio/models/<nom>.json`,
   dans l'espace des modèles du jeu (pixels, Y vers le bas, pivots comme dans le code), pour que le
   code soit exact. L'enregistrement génère `client/model/<Nom>ModelData.java` : Yarn
   (`TexturedModelData`) ou Mojmap (`LayerDefinition`) selon le profil, Minecraft 1.17 et plus
   (1.14–1.16 : source et texture seulement, avec une note). La géométrie est générée, le reste de
   l'entité (type, rendu, apparition) reste au code du mod ou à l'assistant IA.
5. **Armures : le modèle du jeu.** Couches `models/armor/<nom>_layer_{1,2}` (jusqu'à 1.21.1) ou
   `entity/equipment/humanoid{,_leggings}/<nom>` (1.21.2+), montrées sur le modèle d'armure du jeu
   (gonflé de 1 ou 0,5 px) autour d'un mannequin.
6. **Sécurité et traçabilité** : chemins limités aux modèles et textures du mod, tailles bornées
   (modèle 512 Ko, texture 1024 px, 256 os, 2048 cubes), nombres finis, noms d'os valides en Java,
   hiérarchie sans boucle. Point de restauration `model` avant toute écriture de modèle ou de code,
   ancienne texture copiée dans `.mcstudio/history/textures/`, journal d'audit.

## Conséquences

- **Positif** : blocs, objets, entités et armures se voient, se modifient et se peignent au même
  endroit ; les textures d'entité suivent exactement la disposition du jeu.
- **Négatif** : environ 600 Ko de JavaScript en plus (three.js), chargés avec le module.
- **Négatif** : les parents du jeu non reproduits (escaliers, clôtures…) s'affichent comme
  « forme du jeu » ; les textures du jeu apparaissent en damier (leurs fichiers ne sont pas là).
- **Limite** : pas encore d'import/export `.bbmodel` (Blockbench) ni d'animations.
