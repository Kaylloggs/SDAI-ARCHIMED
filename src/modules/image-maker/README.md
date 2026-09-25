# Module `image-maker`

Studio d'images assisté par IA : créer à partir d'un texte, retoucher une zone, étendre la toile, améliorer, varier, restyler, détourer, puis exporter. Chaque opération crée une **version** : l'original n'est jamais modifié.

- **Backend** : plugin `image-maker` (`src-tauri/src/modules/image_maker/`), fournisseurs d'images du core (`src-tauri/src/core/imaging/`, voir ADR 0010).
- **Catégorie** : Création, juste après Mod Studio.
- **Commandes** : connexions (`provider_statuses`, `set_provider_key`, `clear_provider_key`, `provider_login`, `higgsfield_cli_info`, `install_higgsfield_cli`, `provider_models`, `model_pricing`, `improve_prompt`), réglages (`get_maker_settings`, `save_maker_settings`), projets (`list_image_projects`, `create_image_project`, `get_image_project`, `rename_image_project`, `delete_image_project`, `set_current_node`, `set_favorite`, `rename_node`, `set_references`, `save_ai_settings`, `delete_node`, `integration_project`), images (`import_files`, `import_data`, `apply_local`, `apply_local_batch`, `save_paint`), file IA (`submit_operation`, `list_jobs`, `cancel_job`, `retry_job`, `clear_jobs`, `wait_jobs`), sorties (`export_images`, `recent_downloads`).
- **Événements** : `image-maker:job` (une tâche change d'état), `image-maker:project` (un projet reçoit une version).
- **Service fourni** : `image.maker` (voir plus bas).
- **Identifiants** : `image-maker-openrouter`, `image-maker-gemini`, `image-maker-higgsfield` (Gestionnaire d'identifiants). Une clé déjà rangée par un autre module pour le même fournisseur (ex. `mcstudio-openrouter`) est **relue sur place**, jamais copiée.
- **Stockage** : `%APPDATA%\com.sdai.archimed\modules\image-maker\` : `projects/<id>/` (`project.json`, `images/`, `thumbs/`, `masks/`), `settings.json`, `cache/` (dernières listes de modèles).
- **Tutoriel** : `tutorial.ts`.

## Fournisseurs

| Fournisseur | Mode API (dans l'application) | Mode compte |
|---|---|---|
| OpenRouter | Images API (`/api/v1/images`) : modèles, capacités (`supported_parameters`), prix publiés (`/endpoints`), coût réel (`usage.cost`), crédit de la clé (`/key`) | site officiel, puis import |
| Google AI Studio | `generateContent` des modèles d'image Gemini : format (`aspectRatio`), taille (`imageSize`) ; pas de coût dans la réponse | site officiel, puis import |
| Higgsfield | `POST /{application}` puis suivi de la demande ; pas de liste de modèles ni de coût dans l'API : trois modèles des SDK officiels, les autres s'ajoutent à la main (Connexions) | **dans l'application** par la CLI officielle (fournisseur « Higgsfield (compte) »), ou site officiel puis import |

**Mode compte** (bouton « Compte » en haut du studio, « Avec votre compte » sur la liste des projets) : aucun mot de passe n'est demandé ni stocké.

- **Higgsfield (compte)** : génère dans l'application avec l'abonnement et les crédits de la personne, par la CLI officielle [`@higgsfield/cli`](https://github.com/higgsfield-ai/cli). Installation une seule fois, après confirmation explicite (`npm install -g @higgsfield/cli` ; le paquet télécharge le binaire `hf` des versions GitHub de Higgsfield et vérifie son SHA-256). « Se connecter » lance `higgsfield auth login` : OAuth dans le navigateur, la session reste gérée par la CLI (jamais par ARCHIMED). Modèles : les 21 modèles d'image documentés par la CLI (`MODELS.md` : formats, résolutions, qualités, images d'entrée, fond transparent), croisés avec `model list --image --json` quand la session est ouverte. Crédits : `account status --json`. Génération : `generate create <modèle> … --wait --json`. « Se déconnecter » lance `auth logout`.
- **Sites officiels** (Google AI Studio, OpenRouter, Higgsfield) : rien n'automatise le site. Copier la demande (et l'image si besoin), ouvrir le site, créer avec son compte, télécharger : l'image apparaît dans la fenêtre (dossier Téléchargements, vérifié toutes les 5 s) et s'importe en un clic, en nouvelle version de l'image affichée ou en nouvelle image, avec le site d'origine dans son nom. Glisser-déposer et Ctrl+V marchent aussi.

**Capacités** : lues dans la liste du fournisseur, ou tirées de sa documentation / de son SDK officiel quand l'API ne les donne pas (indiqué dans le sélecteur). Une option que le modèle n'accepte pas n'est ni proposée ni envoyée. Aucun modèle n'est présenté comme « meilleur ».

**Mode Auto** : pour chaque demande, garde le modèle choisi s'il convient, sinon prend le premier modèle compatible (image en entrée, nombre d'images, format, transparence) parmi les fournisseurs connectés, dans l'ordre de leur liste. Le choix et sa raison s'affichent avant l'envoi.

## Retouches par zone, sans masque natif

Aucun modèle branché n'accepte de masque natif (Gemini ne l'offre que sur Vertex AI, OpenRouter ne l'expose pas). Pour une zone : la zone et son contexte sont envoyés avec le masque en seconde image, puis le résultat est **recollé ici** à travers le masque adouci. Hors de la zone, chaque pixel d'origine est gardé. L'extension de toile suit le même principe : l'original est replacé au pixel près. Le détourage passe par la transparence du modèle, sinon par un fond uni demandé au modèle et rendu transparent sur la machine.

## Traité sur la machine (rien n'est envoyé)

Recadrage (formats 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 21:9, libre, formats enregistrés), redimensionnement, agrandissement (Lanczos + renforcement), rotation, miroir, luminosité / contraste / teinte, flou (fond ou zone), déplacement d'une sélection, fond uni rendu transparent, retouche au pinceau, export PNG / JPEG / WebP / TIFF / GIF / BMP.

## Confidentialité

Avant chaque envoi, le panneau dit ce qui part et chez qui (« L'image sera envoyée à Google AI Studio pour traitement »). Une image n'est envoyée que pour l'opération demandée. Les clés ne s'affichent jamais en entier (début et fin seulement), ni dans l'interface ni dans les journaux.

## Coûts

Seulement ce que le fournisseur publie ou renvoie : prix des modèles OpenRouter, coût réel d'une demande OpenRouter, crédit restant de la clé. Sinon : « Coût non communiqué par le fournisseur ». Jamais d'estimation.

## Service `image.maker`

Pour les autres modules (couplage faible : gérer l'absence du service si Image Maker est désactivé ou supprimé).

```ts
type ImageOptions = { provider?: "openrouter" | "gemini" | "higgsfield" | "higgsfieldAccount"; model?: string; aspectRatio?: string; count?: number; references?: string[] };
type ImageResult = { files: string[]; projectId: string; provider: string | null; model: string | null; errors: string[] };

type ImageMakerService = {
  generateImage(prompt: string, options?: ImageOptions): Promise<ImageResult>;
  editImage(image: string, instruction: string, options?: ImageOptions): Promise<ImageResult>;
  removeBackground(image: string, options?: ImageOptions): Promise<ImageResult>;
  upscaleImage(image: string, options?: ImageOptions & { local?: boolean; factor?: number }): Promise<ImageResult>;
  createVariation(image: string, options?: ImageOptions & { keep?: string[]; change?: string }): Promise<ImageResult>;
};

const images = useService<ImageMakerService>("image.maker");
```

Les images arrivent dans le projet « Demandes des autres modules » (retouchables ensuite dans le studio). Sans fournisseur précisé, le choix suit le mode Auto.

## Ajouter un fournisseur

Une variante dans `ProviderId`, un fichier dans `src-tauri/src/core/imaging/` qui implémente `ImageProvider` (état, clé, modèles et capacités, génération, annulation), une ligne dans `Imaging::new`, un compte `image-maker-<fournisseur>` dans `module.toml`, et son nom et son site dans `lib/format.ts`.
