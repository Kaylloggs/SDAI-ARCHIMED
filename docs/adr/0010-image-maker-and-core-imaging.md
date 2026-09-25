# ADR 0010 — Image Maker et fournisseurs d'images partagés dans le core

- **Date** : 2026-09-25
- **Statut** : accepté

## Contexte

La personne veut un studio d'images complet (créer, retoucher une zone, étendre, améliorer,
varier, détourer, exporter) branché sur plusieurs fournisseurs : Higgsfield, OpenRouter et
Google AI Studio, avec d'autres à venir. Exigences : ne pas coder en dur un fournisseur, ne pas
supposer une capacité, ne pas inventer de prix ni de point d'accès, réutiliser les clés déjà
données à un autre module sans les copier, ne jamais demander de mot de passe, dire avant
l'envoi quelle image part chez qui, et faire sur la machine tout ce qui peut l'être.

Mod Studio avait déjà ses propres clients OpenRouter et Gemini (ADR 0005, 0007). Un deuxième
module qui en a besoin rend le partage nécessaire ; un module n'importe jamais un autre module.

Vérifications faites (les sites de documentation n'étaient pas joignables depuis l'environnement
de développement ; les SDK officiels l'étaient) :
- **Higgsfield** (`higgsfield-js` v2, `higgsfield-client`) : `https://api.higgsfield.ai`, en-tête
  `Authorization: Key KEY_ID:KEY_SECRET`, `POST /{application}` puis
  `GET /requests/{id}/status` (queued, in_progress, completed, failed, nsfw, canceled),
  `POST /requests/{id}/cancel` tant que la demande attend, envoi d'image par
  `POST /files/generate-upload-url` puis `PUT`. Pas de liste de modèles ni de coût dans l'API.
- **OpenRouter** (`typescript-sdk`) : `POST /api/v1/images` (formats, résolution, nombre, graine,
  qualité, fond, images de référence), `GET /api/v1/images/models` (paramètres acceptés par
  modèle), `GET /api/v1/images/models/{auteur}/{modèle}/endpoints` (prix publiés),
  `usage.cost` dans la réponse, `/key` pour le crédit restant.
- **Gemini API** (`js-genai`) : `generateContent` des modèles d'image, `imageConfig.aspectRatio`
  (1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9, 21:9) et `imageSize` (1K, 2K, 4K). `editImage`,
  `upscaleImage` et la segmentation n'existent que sur Vertex AI, pas avec une clé AI Studio.

## Décision

1. **Couche fournisseurs dans le core** (`src-tauri/src/core/imaging/`), comme les adaptateurs de
   CLI : un trait `ImageProvider` (état, clé, modèles et capacités, prix, génération annulable,
   réécriture de consigne), un fichier par fournisseur, `Imaging::new(module, dossier)` pour un
   module. Le core ne nomme aucun module.
2. **Capacités déclarées, jamais supposées** : `ModelCapabilities` (texte vers image, image en
   entrée, nombre d'images, formats, résolutions, graine, consigne négative, fond transparent,
   qualités) et leur **source** (API, documentation, ajouté par la personne). Une option absente
   n'est ni proposée par l'interface ni envoyée. Gemini apprend les réglages refusés par un
   modèle (fichier local) et les retire.
3. **Clés** : un compte par module et par fournisseur (`image-maker-gemini`…), déclaré dans
   `module.toml`. `KeyRing` lit d'abord la clé du module, puis, en lecture seule, celle d'un autre
   module pour le même fournisseur (liste `all_credentials()` générée par `build.rs`) : relue sur
   place, jamais recopiée, et « Retirer » n'y touche pas. Une clé n'est rangée qu'après
   vérification par le fournisseur ; l'interface n'en voit que le début et la fin.
4. **Pas de masque natif** : aucune API branchée n'en offre. La zone et son contexte partent avec
   le masque en seconde image et une consigne ; le résultat est recollé à travers le masque
   adouci, limité au rectangle envoyé. Même principe pour l'extension de toile (original replacé
   au pixel près) et le détourage (fond uni demandé, rendu transparent localement) quand le
   modèle n'a pas de transparence.
5. **Versions non destructives** : un projet est un arbre de versions (`project.json`, fichiers
   jamais réécrits) ; supprimer passe par la Corbeille, les descendantes se rattachent au parent.
6. **File de tâches** : une tâche par demande (un résultat multiple est découpé selon ce que le
   modèle produit à la fois), limite de tâches simultanées par fournisseur, annulation (Higgsfield
   annule aussi chez lui), relance avec la même source et la même consigne, nature de l'échec
   (clé, crédit, modération, modèle, réseau) pour proposer la bonne correction.
7. **Mode compte sans automatisation de site** : ouvrir le site officiel, puis importer l'image
   téléchargée (dossier Téléchargements), glissée ou collée. Aucun identifiant de compte ne passe
   par l'application. Exception outillée par l'éditeur lui-même : **Higgsfield (compte)** passe
   par sa CLI officielle `@higgsfield/cli` (installée seulement après confirmation, par npm ; le
   paquet vérifie le SHA-256 du binaire `hf`). `auth login` fait l'OAuth dans le navigateur et la
   CLI garde la session : ARCHIMED ne voit ni mot de passe ni jeton. Les 21 modèles d'image
   viennent de la documentation de la CLI (`MODELS.md`), croisés avec `model list --image --json`.
   `ImageProvider` gagne `login()` et `ProviderStatus.access` (`key` ou `account`).
   Sites du mode compte : Gemini (gemini.google.com), ChatGPT (chatgpt.com), Higgsfield ; pas
   OpenRouter. Ils s'ouvrent aussi **dans le studio** : vue web enfant de la fenêtre (Tauri
   `unstable`, `Window::add_child`), posée sur une zone du DOM et cachée dès qu'une fenêtre
   modale ou un menu passe au-dessus (la vue native reste au premier plan). Tauri 2.11 refuse
   toute commande d'une origine distante sans capacité `remote` : la page n'a aucun accès à
   l'application. Aucun script injecté, aucun agent utilisateur maquillé ; si un site refuse la
   connexion dans une vue intégrée, il s'ouvre dans le navigateur. Les téléchargements restent
   dans le dossier Téléchargements et sont signalés au studio (`on_download`).
8. **Coûts** : seulement ce que le fournisseur publie ou renvoie ; sinon « Coût non communiqué ».
9. **Mode Auto** : choix déterministe par capacités, en gardant le modèle de la personne s'il
   convient, expliqué avant l'envoi. Aucun classement de qualité.
10. **Service `image.maker`** pour les autres modules (générer, modifier, détourer, agrandir,
    varier), résultats rangés dans un projet dédié.

## Conséquences

- Ajouter un fournisseur : un fichier dans `core/imaging/`, une variante `ProviderId`, une ligne
  dans `Imaging::new`, un compte dans le `module.toml` des modules qui l'utilisent.
- Mod Studio garde pour l'instant ses clients (ADR 0005, 0007) ; il pourra passer sur la couche
  du core sans changement pour la personne (mêmes comptes de clés).
- Les retouches par zone dépendent de la capacité du modèle à suivre une consigne avec un masque
  en image : le recollage garantit l'intégrité hors zone, pas la qualité dans la zone.
- Higgsfield : seuls les modèles des exemples officiels sont proposés d'office ; les autres
  s'ajoutent avec l'identifiant et les arguments de la documentation.
