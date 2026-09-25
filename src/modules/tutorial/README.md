# Module `tutorial` (Tutoriel)

Apprendre à se servir d'ARCHIMED : la visite de l'application (« Premiers pas »), le tutoriel de
chaque module, et la création d'un module à partir du code source. Module **requis** : épinglé en
bas du menu, juste au-dessus de Réglages ; il n'apparaît ni dans Réglages › Modules ni dans le
tableau des modules du README.

- **Backend** : aucun.
- **Données** : aucune côté disque. Progression (tutoriel ouvert, étape de chacun, tutoriels
  terminés) dans `localStorage` sous `archimed.tutorial` : confort local.
- **Service fourni** : `tutorial.open` (`services/open.ts`) : `open(moduleId)` ouvre le tutoriel du
  module, ou « Premiers pas » s'il n'en a pas. Consommé par le bouton « ? » de la barre de titre
  (`core/shell/TitleBar`), qui disparaît si ce module manque.
- **Commandes `Ctrl+K`** : « Tutoriel : premiers pas », « Tutoriel : créer un module ».

## D'où viennent les tutoriels

Le module ne connaît aucun autre module : il lit `manifest.tutorial` dans le registre
(`allModules`). Tout module non requis doit en déclarer un (`tutorial.ts` + `defineTutorial`),
sinon `pnpm check` échoue ; un test vérifie aussi qu'aucun tutoriel n'est écarté par le registre.
Format et règles d'écriture : guidelines.md §4.3, architecture.md §5.5. Les deux tutoriels propres
au module sont dans `content/` (`start.ts`, `create-module.ts`).

Groupes de la liste (`lib/topics.ts`) : « Bien démarrer » (la visite, puis les modules requis qui
ont un tutoriel, comme Réglages), « Modules » (chaque module installé, désactivé compris, avec la
mention « désactivé » ; « à venir » s'il n'a pas de tutoriel), « Aller plus loin » (créer un module).
Les modules supprimés n'apparaissent pas. La recherche porte sur les titres, résumés, étapes et
astuces, sans tenir compte des accents.

## Interface

- **Liste** (`components/TopicList.tsx`) : progression, recherche (`Entrée` ouvre le premier
  résultat, `Échap` efface), groupes ; `↑` `↓` changent de tutoriel.
- **Scène** (`components/Stage.tsx`) : en-tête avec « Ouvrir le module » (ou « Activer dans
  Réglages »), étape en cours, pastilles d'étapes cliquables, « Précédent », « Suivant » puis
  « Terminer », écran de fin avec les astuces et le tutoriel suivant. `←` `→` changent d'étape.
- **Illustration** (`components/Miniature.tsx`) : la fenêtre d'ARCHIMED en réduction ; la zone de
  l'étape (`area`) s'allume et le voile glisse d'une zone à l'autre. Une étape avec `code` montre
  un extrait à copier (`components/CodeSample.tsx`).
