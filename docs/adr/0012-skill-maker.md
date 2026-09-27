# ADR 0012 — Atelier de création de skills (Skill Maker)

- **Date** : 2026-09-27
- **Statut** : accepté

## Contexte

Le module Skills savait importer et activer des skills, pas en créer. La personne veut un
« skill maker complet et intelligent » : décrire un besoin (ou montrer une conversation réussie)
et obtenir un skill au bon format, qui se déclenche quand il faut, vérifié et essayé avant
d'entrer dans la bibliothèque — sans éditer de YAML à la main.

## Décisions

1. **L'IA écrit, ARCHIMED contrôle.** Le skill est rédigé par une CLI installée (Claude Code,
   Antigravity, Codex) dans une conversation du module (`origin: "skills"`), avec des consignes
   système (`lib/maker.ts`) qui reprennent les bonnes pratiques du format : `name` en minuscules
   et tirets (64 caractères), `description` qui dit quoi et quand (1024 caractères, un peu
   insistante car les IA consultent trop peu les skills), corps de moins de 500 lignes, détail dans
   `references/`, scripts pour ce qui doit être exact, pas de secret ni de contenu trompeur. Aucune
   clé d'API nouvelle : l'atelier réutilise les CLI et leurs abonnements.
2. **Un brouillon hors de la bibliothèque** (`<données>/modules/skills/drafts/<id>/`), sur le
   modèle de la copie de travail de Mod Studio (ADR 0006) : `skill/` (seul contenu livré),
   `tests.json`, `source/` (matière fournie : exemples, `conversation.md`), `runs/<n>/` (essais).
   Le brouillon est le dossier de travail de la conversation : la policy « smart » y laisse écrire
   l'IA sans demander, et rien n'atteint `~/.claude/skills` avant l'enregistrement. Les commandes
   de lecture et d'écriture refusent tout chemin hors de `skill/`, `tests.json` et `source/`.
3. **Vérification déterministe en Rust** (`check.rs`), relancée à chaque fin de tour de l'IA :
   erreurs (SKILL.md absent, en-tête, `name` ou `description` manquants ou invalides,
   description de plus de 1024 caractères, corps vide, fichier cité introuvable, secret détecté),
   avertissements (description courte, sans « quand » ou avec des balises, corps de plus de
   500 lignes, fichier de plus de 5 Mo, commande risquée) et informations (fichier jamais cité,
   référence longue sans sommaire, scripts présents). Une erreur bloque l'enregistrement ; le reste guide. Le parseur d'en-tête
   (`frontmatter.rs`) est partagé avec la lecture de la bibliothèque (blocs `>` et `|` compris).
4. **Essais comme dans skill-creator, sans le banc de mesure.** Chaque demande de test part dans
   une conversation neuve, ouverte dans `runs/<n>/`, qui reçoit le chemin du `SKILL.md` en consigne
   (on n'installe pas un brouillon dans les dossiers des CLI). La personne juge (« Réussi »,
   « À revoir », remarque) ; « Avis à l'atelier » dépose un résumé dans la saisie. Pas de
   comparaison automatique avec/sans skill ni de notation par une IA : coûteux, et le jugement de
   la personne est ce qui compte ici. Les avis sont gardés dans `tests.json` quand l'IA le réécrit.
5. **Améliorer un skill existant** = brouillon `edit` copié de la bibliothèque ; l'onglet
   Modifications compare avec la version d'origine (diff du core).
6. **Enregistrer** copie `skill/` vers la bibliothèque et peut l'activer. Un skill du même nom est
   d'abord sauvegardé dans `modules/skills/backups/<nom>-<date>/`, puis son dossier est **vidé**
   (pas supprimé) : les jonctions NTFS des CLI qui le visent restent valides. Remplacer le skill
   d'un autre brouillon demande un second clic ; mettre à jour le skill amélioré ou déjà
   enregistré par ce brouillon, non.
7. **Suppression** d'un brouillon : Corbeille (`trash`), après un second clic ; ses conversations
   (atelier et essais) sont retirées.

## Conséquences

- Nouvelles commandes `draft_*` du plugin `skills` ; aucune dépendance nouvelle (`regex`,
  `trash`, `chrono` déjà présents).
- « Depuis une conversation » transforme une conversation de Chat ou Code en Markdown
  (`transcriptMarkdown`, 150 000 caractères au plus : début et fin gardés).
- Une conversation de l'atelier rouverte depuis l'accueil rouvre son brouillon.
- Pas encore d'optimisation automatique de la description (boucle de déclenchement) ni
  d'import `.skill`/`.zip` : à ajouter si le besoin apparaît.
