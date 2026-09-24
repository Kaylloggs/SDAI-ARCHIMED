# ADR 0005 — Mod Studio : textures générées par OpenRouter

- **Date** : 2026-09-24
- **Statut** : accepté

## Contexte

Un mod a besoin de textures : 16 × 16 pixels pour un objet ou un bloc, une icône pour le mod. Les
générateurs déterministes du module produisent des textures provisoires (gemme, tuile). La
personne veut des textures dessinées par un modèle d'image, avec sa propre clé OpenRouter, en
privilégiant les modèles gratuits. Les modèles d'image rendent des images de 1024 px, sur fond,
sans grille de pixels : inutilisables telles quelles dans Minecraft.

## Décision

1. **OpenRouter, avec la clé de la personne** : `POST /chat/completions` avec
   `modalities: ["image", …]`, image lue dans `choices[0].message.images`. La source est
   remplaçable (`env.json`, HTTPS uniquement). Pas de fournisseur imposé par ARCHIMED.
2. **La clé ne quitte jamais le backend** : vérifiée par `GET /key` avant d'être gardée, rangée dans
   le Gestionnaire d'identifiants de Windows (`keyring`), jamais écrite dans un fichier, un journal
   ou une réponse IPC (l'interface ne reçoit qu'un statut).
3. **Gratuit par défaut, payant sur accord** : la liste des modèles est lue en direct (`/models`,
   sortie « image ») ; un modèle est gratuit si tous ses prix sont nuls ou si son identifiant finit
   par `:free`. Le backend refuse un modèle payant sans `allowPaid`, quelle que soit l'interface.
4. **Conversion déterministe, hors IA** (`pixelart.rs`) : retrait du fond par remplissage depuis
   les bords, cadrage, réduction par couleur franche (la plus rare de l'image quand elle couvre
   12 % d'une zone), palette par coupe médiane. Décodage borné (4096 px, 32 Mo) contre les images
   piégées.
5. **Brouillon, puis geste explicite** : l'image reçue et sa conversion restent dans le cache du
   module ; « Appliquer » écrit la texture (atomique) après avoir copié l'ancienne dans
   `.mcstudio/history/textures/`. Générations, applications et changements de clé sont audités.

## Conséquences

- **Positif** : des textures au format du jeu en une minute, sans outil externe ; l'import
  d'image offre le même pipeline sans clé.
- **Positif** : aucun coût caché : un modèle payant exige un accord explicite, vérifié côté Rust.
- **Négatif** : les modèles gratuits d'OpenRouter changent et sont limités (quotas par minute et
  par jour) ; la liste est lue en direct et l'erreur 429 expliquée, mais aucun modèle gratuit
  n'est garanti.
- **Négatif** : la description part chez OpenRouter et chez le fournisseur du modèle ; l'interface
  montre le texte exact envoyé.
- **Dépendances** : `image` (PNG, JPEG, WebP, sans les autres formats), `base64`, `keyring`
  (magasin natif Windows ; magasin en mémoire ailleurs, non persistant).
