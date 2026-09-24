# Module JobAgent

Recherche d'offres d'emploi sur plusieurs plateformes, pays et villes à la fois, puis
préparation des candidatures à partir du CV.

**Ce qu'il faut sur la machine**

- **Python 3.10 ou plus récent** : le moteur de recherche s'installe tout seul dans son
  propre environnement au premier usage (bouton « Installer » du module).
- **Antigravity (`agy`)**, facultatif : il rédige les lettres et les e-mails. Sans lui, la
  rédaction passe par le module Chat.
- **Un compte d'envoi SMTP**, facultatif : seulement pour l'envoi des candidatures par lot.

> Les annonces sont lues sur des sites tiers (JobSpy, sous licence MIT, plus HelloWork et
> Welcome to the Jungle). Leurs conditions d'utilisation s'appliquent : le module est un
> outil de recherche personnelle, pas un aspirateur de masse. La recherche de contacts lit
> `robots.txt` et se limite à quatre pages par entreprise.

## Ce qu'il fait

| | |
|---|---|
| **Cherche** | plusieurs métiers × pays × villes × types de contrat × plateformes, en parallèle |
| **Range** | dédoublonnage entre plateformes, filtre par niveau d'études, tri par date / entreprise / métier |
| **Passe en revue** | sections repliables, onglets exclusifs (À voir, Toutes, Favoris, Candidatures), sélection multiple, clavier ↑ ↓ / F / Suppr, annulation |
| **Situe** | carte du monde : un point par ville, la taille suit le nombre d'annonces |
| **Trouve à qui écrire** | option de recherche : une adresse de recrutement par entreprise, lue sur son site |
| **Prépare** | lettre de motivation, e-mail ou réponse de formulaire, à partir du CV français ou anglais |
| **Envoie** | par lot, après une confirmation unique qui montre destinataires, expéditeur et CV joint |

## Passer deux cents annonces en revue

Une recherche large en ramène facilement deux cents : la liste plate est inexploitable.

- **Sections** : les résultats sont regroupés (par métier au départ), chaque section se replie
  et affiche son compte. L'en-tête reste visible au défilement et porte deux actions
  discrètes : « Cocher la section » et « Tout vu ».
- **Un onglet par annonce** (`lib/triage.ts`) : chaque onglet est une pile qui se vide.
  Mise en favori, l'annonce quitte « Toutes » et « À voir » ; candidature envoyée, elle
  quitte les favoris et ne vit plus que dans « Candidatures ». Un brouillon ne déplace rien.
  Une candidature déposée sur le site se range avec « Marquer comme envoyée » (panneau de
  droite), puisque ARCHIMED ne peut pas la voir partir.
- **Onglet « À voir »** : les annonces déjà ouvertes en sortent — mais seulement au passage
  suivant sur l'onglet, pour que celle qu'on vient d'ouvrir ne s'évanouisse pas sous le
  curseur. Elle reste affichée, grisée.
- **Sélection multiple** : case à cocher sur chaque carte, `Ctrl` + clic pour cocher sans
  ouvrir, `Maj` + clic pour une plage, case d'en-tête pour tout cocher. La barre de
  sélection supprime ou met en favori tout le lot d'un coup ; dans « Favoris », elle
  retire des favoris et « Postuler » ne prend que la sélection.
- **Clavier** : `↑` `↓` enchaînent les annonces dans l'ordre affiché ; `F` met en favori,
  `Suppr` supprime — l'annonce, ou toute la sélection — et la suivante s'ouvre d'elle-même ;
  `X` coche, `Maj` + `↓` coche en avançant, `Ctrl` + `A` coche tout, `Échap` vide la
  sélection, `Ctrl` + `Z` annule la dernière suppression.
- **Supprimer** ≠ masquer : l'annonce disparaît et ne revient **pas** aux recherches
  suivantes (`dismissed` dans l'état). Le bandeau d'annulation vaut aussi pour une
  suppression groupée, et chaque annonce retrouve sa place exacte.

## Plateformes

`hellowork` · `welcometothejungle` · `indeed` · `linkedin` · `glassdoor` · `zip_recruiter` ·
`google`

HelloWork ne couvre que la France, ZipRecruiter les États-Unis et le Canada : ces sources
sont ignorées d'office pour les autres pays. Welcome to the Jungle est la seule à publier le
niveau d'études demandé ; ailleurs, il est déduit du texte de l'annonce.

## Deux CV

Un CV par langue : `fr` et `en`. Le choix se fait sur le pays de l'annonce — français pour
la France, la Belgique, la Suisse, le Luxembourg et Monaco, anglais partout ailleurs — et
se force à la main dans le panneau de candidature. Sans CV dans la langue attendue, l'autre
est joint et l'interface le signale. Les textes extraits vivent dans `cv-fr.txt` et
`cv-en.txt`, lus aussi par le serveur MCP.

## Carte

Onglet **Carte** : les contours des pays (Natural Earth 1:110m, arrondis au dixième de
degré) et des pastilles d'annonces aux tokens du thème, sans aucune dépendance externe.

- **Regroupement dynamique (clustering)** : les lieux trop proches sont automatiquement fusionnés
  selon le niveau de zoom, éliminant tout chevauchement. Au zoom, les groupes s'ouvrent
  naturellement en villes individuelles.
- **Navigation fluide** : zoom progressif à la molette (centré sur la souris), par double-clic ou
  avec les contrôles `+` / `−` ; déplacement de la carte par glisser-déposer (pan).
- **Cadrage automatique** : la vue s'ajuste immédiatement sur l'étendue des résultats
  (France, Europe, etc.), avec un bouton de réinitialisation et un bouton pour afficher le monde entier.
- **Détails & sélection** : survol avec info-bulle, clic sur un lieu ouvrant le tiroir d'offres
  associé en bas d'écran.

Les coordonnées sont posées par le moteur (`geo.py`) à partir de deux tables embarquées :
15 000 villes de plus de 40 000 habitants, et un point par pays quand la ville n'est pas
reconnue (le point est alors dessiné plus pâle). Voir `engine/archimed_jobagent/data/NOTICE.md`
pour les sources et leurs licences.

## Contact direct

Beaucoup d'annonces ne donnent aucune adresse : on postule par un formulaire et le dossier
part dans un ATS. L'option **« Chercher une adresse chez l'entreprise »** (panneau de
recherche) ajoute un second temps à la recherche : pour chaque entreprise, le moteur va
chercher une adresse de recrutement sur son propre site (`engine/archimed_jobagent/recruiter.py`).

- **Le domaine** vient de l'annonce quand elle le donne, sinon d'une recherche web (Bing,
  puis la fiche « site officiel » de DuckDuckGo). Un domaine qui ne correspond pas au nom
  de l'entreprise — ni dans le domaine, ni sur sa page d'accueil — est rejeté : une
  candidature envoyée à des inconnus serait pire que pas de candidature du tout.
- **Les pages lues** : l'accueil, puis au plus trois pages de recrutement, contact ou
  mentions légales. `robots.txt` est lu et respecté ; un seul passage par entreprise, mis
  en cache pour toute la recherche. Compter une à deux secondes par entreprise.
- **Le tri des adresses** : recrutement d'abord (`rh@`, `recrutement@`, `jobs@`…), puis
  l'accueil, puis le reste. Sont écartées les boîtes sans interlocuteur (`no-reply@`), les
  adresses légales (`dpo@`, `informatique.libertes@`), les plateformes d'annonces, les
  adresses d'exemple, et l'agence qui a fait le site passe en dernier.
- **Rien ne part tout seul** : l'adresse s'affiche sur l'annonce, avec sa provenance
  (`dans l'annonce` ou `trouvé sur le site`).

Le message direct dit d'où il vient. Le prompt (`letters.rs`, `direct_contact`) impose
d'annoncer en une phrase que l'annonce a été vue, la candidature déposée, et que la
personne préfère aussi s'adresser directement à quelqu'un de l'entreprise. Quand la
candidature n'est pas encore partie, la phrase change plutôt que de prétendre le contraire
(`already_applied`).

## Envoi par lot

Les annonces retenues se candidatent d'un bloc : ARCHIMED rédige chaque e-mail (Antigravity),
y joint le CV de la bonne langue et l'expédie en SMTP, sans repasser par une validation
annonce par annonce.

- **Une seule confirmation**, qui affiche le nombre d'envois, l'adresse d'expédition et la
  langue des CV joints. Un envoi ne se rattrape pas : c'est le seul garde-fou, il est donc
  explicite.
- Les annonces **sans adresse de contact** sont écartées du lot (`à faire à la main`) : les
  formulaires des plateformes varient trop pour être remplis à l'aveugle. Le panneau de
  droite reste là pour les déposer une par une, ou les confier à l'assistant.
- Une annonce peut donner **deux messages** : la candidature à l'adresse de l'annonce, puis
  le mot au contact trouvé dans l'entreprise (`lib/batch.ts`). Le direct part après, et
  seulement si la candidature est bien partie — il y fait référence. Le contact n'est
  prévenu qu'une fois (`directSentAt`).
- Le **mot de passe d'application** est chiffré par Windows (DPAPI, `secrets.rs`) dès son
  enregistrement. Il ne remonte jamais à l'interface et n'est déchiffré qu'au moment d'un
  envoi, pour être passé au moteur par l'entrée standard.
- Le serveur d'envoi est deviné à partir de l'adresse (Gmail, Outlook, Orange, Free…).

## Moteur

Le travail de recherche est fait par un moteur Python, embarqué dans l'exécutable
(`src-tauri/src/modules/jobagent/engine/`) et déposé au premier usage dans
`%APPDATA%\com.sdai.archimed\modules\jobagent\engine\`, avec son propre environnement
virtuel. Rien n'est installé dans le Python du système.

```
engine/
├── jobspy/                 JobSpy (MIT) vendorisé et allégé — voir LICENSE.jobspy
│   ├── hellowork/          source ajoutée par ARCHIMED
│   ├── wttj/               source ajoutée par ARCHIMED
│   └── …                   linkedin, indeed, glassdoor, ziprecruiter, google
└── archimed_jobagent/
    ├── search.py           orchestration multi-domaines / pays / villes
    ├── filters.py          niveau d'études, dédoublonnage, tri
    ├── model.py            forme stable d'une offre
    ├── detail.py           texte complet d'une annonce
    ├── resume.py           lecture du CV (PDF, DOCX, texte)
    ├── geo.py              placement des annonces sur la carte, hors ligne
    ├── mailer.py           envoi SMTP des candidatures
    ├── data/               villes, pays (voir NOTICE.md)
    ├── cli.py              interface NDJSON utilisée par ARCHIMED
    └── server.py           serveur MCP (FastMCP) pour le CLI Claude
```

Différences avec JobSpy d'origine : `scrape_jobs()` et la dépendance à pandas/numpy sont
retirées (ARCHIMED orchestre lui-même), `JobPost.education_level` est ajouté, et deux
sources françaises complètent la liste.

### Régénérer le moteur embarqué

Après avoir **ajouté ou retiré** un fichier dans `engine/` :

```bash
python src-tauri/src/modules/jobagent/pack-engine.py
```

Le script réécrit `assets.rs` (table des fichiers embarqués). Une simple modification de
contenu n'exige rien : `include_str!` relit les fichiers à chaque compilation. À
l'ouverture suivante du module, `status()` compare l'empreinte (contenu haché) et
redépose le moteur si elle a changé : aucune réinstallation à demander, l'environnement
virtuel existant est conservé.

## MCP

Le moteur s'expose en serveur MCP pour que l'agent cherche lui-même :
`search_jobs`, `job_details`, `company_contacts`, `list_sources`, `read_profile`,
`shortlisted_offers`. `search_jobs` accepte `find_recruiter` pour chercher au passage une
adresse chez chaque entreprise.

L'interrupteur « Donner la recherche à l'assistant » (onglet Profil) écrit la déclaration
dans `<données>/mcp/jobagent.json`. Le moteur d'ARCHIMED fusionne les déclarations de tous
les modules et passe `--mcp-config` à chaque session Claude : **il n'y a aucune commande à
taper**, les outils sont là au prochain message. Le débrancher retire le fichier.

Pour un usage hors d'ARCHIMED, le bouton « Copier la commande pour un terminal » donne
l'équivalent manuel (`claude --mcp-config <fichier>`).

Le serveur ne dépose aucune candidature ; il lit et rend des données.

## Rédaction des candidatures

Les lettres passent par le CLI **Antigravity** (`agy`) plutôt que par une conversation :
un aller-retour unique, sans outils ni contexte de projet, donc bien moins cher. Le style
est tenu par le skill **humanizer** de Claude Code, dont les règles sont injectées dans le
prompt (`~/.claude/skills/humanizer/SKILL.md`) ; à défaut, un jeu de consignes équivalent
prend le relais.

## Commandes Rust

`status` · `install_engine` · `search` · `cancel_search` · `offer_detail` · `sources` ·
`load_state` · `save_state` · `load_profile` · `save_profile` · `import_cv` · `clear_cv` ·
`write_letter` · `save_text` · `set_mcp` · `mail_settings` · `save_mail_settings` ·
`smtp_hint` · `send_application`

Le moteur expose en plus la sous-commande `contacts --company … [--url …]`, utilisée par
l'outil MCP `company_contacts`.

Événements : `jobagent:install` (journal d'installation), `jobagent:progress` (avancement
d'une recherche).

## Services consommés

Aucun import d'un autre module. Pour confier une candidature à l'assistant, le module passe
par `openModule("chat", { prompt })` : le message arrive dans la zone de saisie du Chat, et
c'est la personne qui l'envoie.

## Données

`%APPDATA%\com.sdai.archimed\modules\jobagent\`

| Fichier | Contenu |
|---|---|
| `state.json` | offres trouvées, favoris, supprimées, déjà vues, candidatures, dernière recherche |
| `profile.json` | coordonnées, chemin du CV |
| `cv-fr.txt`, `cv-en.txt` | textes extraits des CV (lus par les IA) |
| `cv/fr/`, `cv/en/` | fichiers CV d'origine |
| `mail.json` | compte d'envoi ; le mot de passe y est chiffré par Windows |
| `../../mcp/jobagent.json` | déclaration du serveur MCP, quand il est branché |
| `engine/` | moteur Python et son environnement virtuel |
