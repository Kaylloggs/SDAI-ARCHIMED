# ADR 0008 — Mod Studio : atelier des textures (faces, raccord, retouche, interface)

- **Date** : 2026-09-24
- **Statut** : accepté (complète les ADR 0005 et 0007)

## Contexte

Les premières textures générées étaient utilisables mais pas « prêtes pour le jeu » :

- un bloc n'avait qu'une texture pour ses six faces (pas de bûche, d'herbe, de four) ;
- « seamless » dans le texte ne suffit pas : les modèles d'image dessinent souvent un cadre, une
  vignette, ou un motif qui ne se raccorde pas une fois répété ;
- le texte envoyé au modèle n'était pas modifiable, et rien ne permettait de corriger un pixel ;
- les éléments d'interface (écrans, boutons) n'étaient pas couverts.

## Décision

1. **Les faces suivent le modèle du bloc.** `TextureTarget::Block` porte une face facultative ; la
   répartition se lit dans le parent du modèle (`cube_all`, `cube_column`, `cube_bottom_top`,
   `cube`) et le chemin de chaque face dans ses `textures` (convention `<bloc>_<face>.png` à
   défaut). Changer de répartition réécrit le modèle (autres clés gardées, point de restauration
   `texture` avant), crée les faces manquantes à partir de la texture actuelle ; un modèle fait
   main (dalle, escalier…) n'est remplacé que sur confirmation. Seules les références de l'espace
   de noms du mod sont suivies : une texture du jeu n'est jamais écrite.
2. **Le raccord est calculé, pas demandé.** `Tiling` (`none`, `horizontal`, `both`) : retrait du
   cadre uni (lignes unies qui tranchent avec l'intérieur, 15 % au plus, jamais un dégradé), puis
   fondu des bords avec la copie décalée d'une demi-case (deux passes : largeur, puis hauteur), avant
   la réduction en pixel-art. La qualité du raccord est mesurée sur la texture finale (écart entre
   bords opposés comparé à l'écart entre voisins). Par défaut : `both` pour une matière, `horizontal`
   pour les côtés d'un bloc à dessus distinct, `none` pour une face unique.
3. **Le texte est à la personne.** `PromptSettings` (style, consignes, référence) construit le texte
   par cible et par face ; `custom_prompt` le remplace mot pour mot (4 000 caractères au plus). Une
   texture du projet peut partir en **référence** (agrandie pixel par pixel à 512 px) vers les
   modèles qui lisent les images (`image_input`, lu dans la liste des modèles). Le format demandé
   suit les proportions de la cible (`aspect_ratio`).
4. **Retouche au pixel dans l'application.** Les pixels d'un brouillon passent en RVBA base64
   (`draft_pixels` / `save_draft_pixels`, taille imposée) : pas d'image lue depuis le protocole
   d'asset dans un canevas (évite le canevas « contaminé »). L'éditeur (canevas maison, clavier
   complet) enregistre au fil de l'eau ; une reconversion qui effacerait des retouches est confirmée.
   `edit_texture` ouvre la texture actuelle telle quelle.
5. **Interface sans IA d'abord.** `create_gui_texture` dessine les éléments de base aux couleurs
   des écrans du jeu (fond #C6C6C6 biseauté, cases 18 × 18 aux positions de l'inventaire du joueur,
   écrans sur une toile 256 × 256) ; l'IA peut ensuite les redessiner à leur taille (1 à 256 px,
   toile 256 × 256 facultative). Aucun fichier existant n'est écrasé à la création.

6. **Cadrage et historique** (ajout du même jour). La zone de l'image reçue qui devient la texture
   fait partie des réglages (`PixelOptions.crop`, pixels de l'image d'origine, ramenée dans ses
   limites) : recadrer reconvertit sans réseau. Les brouillons forment l'historique de chaque
   texture (20 par texture, 150 en tout dans le cache) : fermer une proposition ne la perd plus.
7. **Disposition en atelier** (remplace la scène + inspecteur, jugée trop chargée) : le canevas au
   centre (ajusté à la fenêtre, 320 px au plus), la barre d'outils de retouche au-dessus (Grille et
   Cadrer nommés, côte à côte), les
   aperçus à droite, la bande des versions dessous et une barre de création en bas, sur le modèle
   du composeur du chat. Les réglages rares (service, modèle, style, texte envoyé) s'ouvrent dans
   des panneaux flottants depuis cette barre.
8. **Seuls les vrais blocs sont listés** : ceux des traductions et ceux qui ont un état de bloc
   (`blockstates/`). Les modèles de variantes (`_top`, `_double`…) ne sont pas des blocs ; les
   textures qu'ils utilisent ne sont pas des « orphelines ».
9. **Conversion sans réglages** : taille, palette et raccord ne se choisissent plus (taille de la
   texture en place, 16 px sinon ; palette selon la taille ; raccord selon la face). Seul « Retirer
   le fond » reste. Pour qu'il marche, le texte envoyé demande un fond uni magenta pur (vert si
   l'objet est rose ou violet), et le retrait part des couleurs dominantes du bord (fond uni,
   dégradé, damier), retire la couleur-clé avec une tolérance large, les zones enfermées, le liseré
   et les poussières.
10. **Textures non utilisées** : un PNG qu'aucun modèle ne référence et qui n'est pas un bloc (face
   laissée par un changement de répartition) est listé à part, et peut partir à la Corbeille
   (`delete_textures`, chemins limités à `textures/` et à l'icône du mod).

## Conséquences

- **Positif** : des blocs à plusieurs faces, des textures qui se répètent proprement, un contrôle
  total du texte envoyé et de chaque pixel, des écrans d'interface cohérents avec le jeu.
- **Négatif** : le fondu des bords peut adoucir un motif très régulier (briques) ; l'éditeur
  permet de reprendre les joints (décalage d'une demi-case).
- **Négatif** : sans réglage de taille, une texture change de taille en modifiant le fichier en
  place (ou dans le code du mod), pas dans l'atelier.
- **Négatif** : la référence ajoute une image à la demande (coût un peu plus élevé chez les
  services payants).
- **Aucune dépendance ajoutée.**
