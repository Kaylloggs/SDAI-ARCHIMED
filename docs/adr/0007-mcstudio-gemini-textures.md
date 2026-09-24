# ADR 0007 — Mod Studio : textures par l'API Gemini de Google (Nano Banana)

- **Date** : 2026-09-24
- **Statut** : accepté (complète l'ADR 0005)

## Contexte

OpenRouter ne propose plus de modèle d'image gratuit : sans crédit acheté, l'onglet Textures ne
peut plus rien générer. La personne a un abonnement Gemini (Google AI Pro) et veut utiliser les
modèles d'image de Google (« Nano Banana », dont Nano Banana 2 = Gemini 3.1 Flash Image).

Point à ne pas masquer : l'abonnement Google AI Pro s'applique à l'application Gemini et à
Google AI Studio (web), pas à l'API. Un programme tiers ne peut pas « se connecter au compte
Gemini » pour consommer l'abonnement : il faut une clé API Google AI Studio, et l'usage de l'API
est facturé sur le projet Google de la clé. Google AI Pro inclut des crédits Google Cloud
mensuels, utilisables pour cette facturation.

## Décision

1. **Deuxième service d'image, au choix** : `ImageProvider` (`openRouter` | `gemini`) dans la
   demande de texture ; la conversion pixel-art, les brouillons et l'application restent communs.
   Le choix est mémorisé sur le poste (préférence d'interface uniquement).
2. **Clé Google AI Studio, gardée comme celle d'OpenRouter** : vérifiée par `GET /models` avant
   d'être rangée dans le Gestionnaire d'identifiants (`mcstudio-gemini.com.sdai.archimed`, code
   commun dans `secrets.rs`), envoyée seulement dans l'en-tête `x-goog-api-key` (jamais dans
   l'adresse, donc jamais dans un journal de proxy), jamais renvoyée à l'interface.
3. **Modèles lus en direct** : `GET /models`, gardés s'ils contiennent « image » et acceptent
   `generateContent` (les Imagen, en `predict`, sont écartés). Noms commerciaux ajoutés
   (Nano Banana, Nano Banana 2, Nano Banana Pro). Liste en cache pour le hors-ligne, effacée
   avec la clé.
4. **Toujours facturé, donc toujours sur accord** : chaque modèle Gemini est marqué payant ; le
   backend refuse la génération sans `allowPaid`, et l'interface demande « Accepter la
   facturation Google » séparément de l'accord donné à OpenRouter.
5. **Appel** : `POST /models/{id}:generateContent`, `responseModalities: ["TEXT","IMAGE"]`,
   `imageConfig.aspectRatio: "1:1"` (redemandé sans ce réglage si un modèle le refuse), image lue
   dans `candidates[0].content.parts[*].inlineData`. Blocages de sécurité, quota (429), clé
   refusée, API non ouverte (pays, facturation) : expliqués en français.
6. **Source remplaçable** : `{"geminiApi": "https://…"}` dans `env.json`, HTTPS uniquement.

## Conséquences

- **Positif** : des textures de qualité avec le compte Google existant, sans intermédiaire.
- **Négatif** : pas de gratuité : quelques centimes par image, facturés par Google (crédits
  Google Cloud de l'abonnement compris). L'interface le dit avant la première génération.
- **Négatif** : la description part chez Google ; l'interface montre le texte exact envoyé.
- **Aucune dépendance ajoutée** (`reqwest`, `base64`, `keyring` déjà présents).
