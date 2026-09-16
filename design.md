# SDAI ARCHIMED — Design System

> Règles visuelles et d'interaction **strictes**. Source de vérité du code : `src/design-system/tokens.css` et `src/design-system/motion.ts`, qui doivent refléter ce document à l'identique.

---

## 0. Skills de design à utiliser (obligatoire)

Toute IA qui conçoit ou modifie de l'UI **charge ces skills avant d'écrire du code** :

| Skill | Quand | Rôle |
|---|---|---|
| `ui-ux-pro-max` | création d'écran, choix de pattern, composants shadcn/Tailwind | intelligence UI/UX : patterns, états, accessibilité, stack React/Tailwind/shadcn |
| `impeccable` | toute passe de finition, critique, audit, polish, motion, états vides/erreur | exigence de détail, anti-patterns, hiérarchie, micro-interactions |
| `apple-design` | layout, typographie, profondeur, matériaux (glass), animations | clarté, déférence au contenu, profondeur, mouvement physique |

Ordre recommandé : **`ui-ux-pro-max`** (concevoir) → **`apple-design`** (affiner matière et mouvement) → **`impeccable`** (auditer et polir). Skills complémentaires utiles : `dark-mode-design`, `motion-system`, `loading-states`, `error-handling-ux`, `navigation-patterns`.

---

## 1. Principes

1. **Déférence au contenu.** La conversation est la vedette ; le chrome (barres, bordures) s'efface.
2. **Une messagerie, pas un terminal.** Le texte brut de terminal n'apparaît que dans des cartes de code ou le tiroir debug.
3. **Clarté des décisions.** Toute question d'une IA devient une carte avec une action primaire évidente et un niveau de risque lisible.
4. **Calme par défaut, expressif au bon moment.** Un seul accent de couleur ; le mouvement signale un changement d'état, jamais décoratif en boucle.
5. **Cohérence modulaire.** Un module ajouté hérite automatiquement du look : il n'utilise que tokens et primitives.
6. **Clavier d'abord.** Tout est faisable sans souris (`Ctrl+K`, raccourcis de cartes).

---

## 2. Matériaux et profondeur

| Couche | Usage | Traitement |
|---|---|---|
| L0 — Fond | fenêtre | `--bg` opaque (option Mica Windows 11 : fond de fenêtre translucide, voir §8) |
| L1 — Structure | sidebar, zones de page | `--bg-subtle`, sans ombre, séparées par `--border` |
| L2 — Contenu | cartes, bulles, blocs du launchpad | `--surface-1`, bordure `--border`, rayon `lg` |
| L3 — Flottant | composer, palette, popovers, menus, toasts | **glass** : `--glass-bg` + `backdrop-filter: blur(24px) saturate(140%)` + `--border-strong` + `--shadow-float` |
| L4 — Modal | dialogues | `--surface-3` opaque + voile `--scrim` |

**Le glassmorphism est réservé à L3.** Jamais de glass sur une carte de contenu ni sur un fond qui contient du texte dense. Fallback sans `backdrop-filter` : `--surface-3` opaque.

---

## 3. Couleurs

Espace **OKLCH**. Thème **sombre par défaut** ; le thème clair existe mais est secondaire.

### 3.1 Neutres (sombre)
| Token | Valeur | Usage |
|---|---|---|
| `--bg` | `oklch(0.155 0.006 265)` | fond d'application |
| `--bg-subtle` | `oklch(0.175 0.006 265)` | sidebar, titlebar |
| `--surface-1` | `oklch(0.205 0.007 265)` | cartes, bulles IA |
| `--surface-2` | `oklch(0.235 0.008 265)` | survol, bulle utilisateur |
| `--surface-3` | `oklch(0.270 0.009 265)` | popovers opaques, modales |
| `--border` | `oklch(1 0 0 / 0.07)` | séparateurs, contours de cartes |
| `--border-strong` | `oklch(1 0 0 / 0.13)` | couches flottantes, focus doux |
| `--text` | `oklch(0.96 0.003 265)` | texte principal |
| `--text-muted` | `oklch(0.74 0.010 265)` | texte secondaire |
| `--text-subtle` | `oklch(0.58 0.010 265)` | métadonnées, placeholders |
| `--glass-bg` | `oklch(0.22 0.008 265 / 0.62)` | couches L3 |
| `--scrim` | `oklch(0.08 0 0 / 0.55)` | voile de modale |

### 3.1.bis Presets de thème
`design-system/themes.ts` + blocs `:root[data-theme="<id>"]` de `tokens.css`. Un preset **ne redéfinit que les couleurs** ; typographie, espacements, rayons et motion restent communs.

| Preset | Id | Mode | Accent |
|---|---|---|---|
| Archimède (défaut) | `archimed` | sombre | laiton `oklch(0.80 0.115 80)` |
| Papier | `light` | clair | ocre `oklch(0.62 0.12 75)` |
| Tokyo Néon | `tokyo-neon` | sombre indigo | magenta `oklch(0.74 0.19 330)` |
| Nord | `nord` | sombre froid | glacier `oklch(0.78 0.09 220)` |
| Terra | `solar-terra` | sombre chaud | terracotta `oklch(0.72 0.14 40)` |
| Encre | `monochrome` | sombre neutre | blanc `oklch(0.92 0 0)` |

Ajouter un preset = une entrée dans `THEMES` + un bloc CSS redéfinissant **tous** les tokens de couleur utilisés (neutres, accent, sémantiques). Vérifier le contraste AA dans le preset avant de le proposer.

### 3.2 Accent — « Laiton d'Archimède »
| Token | Valeur | Usage |
|---|---|---|
| `--accent` | `oklch(0.80 0.115 80)` | action primaire, sélection, focus ring |
| `--accent-hover` | `oklch(0.84 0.115 80)` | survol |
| `--accent-fg` | `oklch(0.20 0.030 80)` | texte sur accent |
| `--accent-soft` | `oklch(0.80 0.115 80 / 0.14)` | fond d'item actif, chips |

Règle : **l'accent couvre < 5 % de la surface d'un écran.** Un seul bouton primaire visible par zone.

### 3.3 Sémantiques
| Token | Valeur | Usage |
|---|---|---|
| `--success` | `oklch(0.76 0.130 155)` | action réussie, risque Low |
| `--info` | `oklch(0.74 0.100 240)` | information, risque Medium |
| `--warning` | `oklch(0.76 0.150 55)` | risque High |
| `--danger` | `oklch(0.66 0.200 27)` | erreur, action destructive, risque Critical |
Chaque sémantique a une variante `-soft` à `/ 0.14`. **Jamais de couleur seule pour porter un sens** : toujours icône + libellé.

### 3.4 Identité des agents
| Agent | Token | Valeur |
|---|---|---|
| Claude | `--agent-claude` | `oklch(0.70 0.130 42)` |
| Antigravity | `--agent-antigravity` | `oklch(0.72 0.120 255)` |
| Générique / autres | `--agent-neutral` | `oklch(0.72 0.010 265)` |
Usage limité : pastille d'avatar, liseré 2 px du sélecteur d'agent. Jamais en fond de bulle.

### 3.5 Contraste
Texte courant ≥ 4.5:1, gros texte et icônes ≥ 3:1 (WCAG AA). `--text-subtle` uniquement pour de la méta non essentielle.

---

## 4. Typographie

- **UI** : `Geist Variable` · **Code/terminal** : `Geist Mono Variable`. Polices **embarquées** (`@fontsource-variable/geist`, `@fontsource-variable/geist-mono`), jamais de CDN.
- Fallback : `"Segoe UI Variable", system-ui, sans-serif` / `"Cascadia Code", ui-monospace, monospace`.
- Graisses autorisées : 400, 500, 600. Chiffres : `font-variant-numeric: tabular-nums` dans les compteurs et tableaux.

| Token | Taille / interligne | Graisse | Interlettrage | Usage |
|---|---|---|---|---|
| `text-caption` | 11 / 16 | 500 | +0.01em | badges, raccourcis |
| `text-footnote` | 12 / 16 | 400 | 0 | métadonnées, statusbar |
| `text-body-sm` | 13 / 20 | 400 | 0 | sidebar, contrôles |
| `text-body` | 14 / 22 | 400 | 0 | texte d'interface par défaut |
| `text-message` | 15 / 24 | 400 | 0 | contenu des messages du chat |
| `text-title-3` | 17 / 24 | 600 | -0.005em | titres de cartes |
| `text-title-2` | 20 / 28 | 600 | -0.01em | titres de section |
| `text-title-1` | 24 / 32 | 600 | -0.015em | titres de page |
| `text-display` | 32 / 40 | 600 | -0.02em | accueil uniquement |

Longueur de ligne des messages : **max 72ch** (colonne de conversation 760 px).

---

## 5. Espacements, grille, rayons

**Base 4 px.** Échelle autorisée : `0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64`. Aucune autre valeur.

| Zone | Mesure |
|---|---|
| Titlebar | hauteur 40 px (zone de glissement `data-tauri-drag-region`) |
| Sidebar | 248 px déployée · 56 px en rail · padding horizontal 12 |
| Statusbar | 28 px |
| Colonne de conversation | max 760 px, centrée, padding latéral 24 |
| Composer | flottant, marge basse 16, rayon `xl`, hauteur min 56, max 40 % de la fenêtre |
| Écart entre messages | 24 (même auteur consécutif : 8) |
| Padding de carte | 16 (compacte : 12) |
| Launchpad | grille 12 colonnes, gouttière 16, blocs `sm`=3 col, `md`=4 col, `lg`=6 col |
| Fenêtre min | 960 × 640 |

| Rayon | Valeur | Usage |
|---|---|---|
| `--radius-xs` | 4 | badges, kbd |
| `--radius-sm` | 6 | petits contrôles, items de sidebar |
| `--radius-md` | 10 | boutons, champs |
| `--radius-lg` | 14 | cartes, bulles, blocs |
| `--radius-xl` | 20 | composer, palette, modales |
| `--radius-full` | 9999 | avatars, pastilles |

Règle de concentricité : rayon intérieur = rayon extérieur − padding (min 4).

### Ombres (sombre)
- `--shadow-float` : `0 8px 32px oklch(0 0 0 / 0.45), 0 1px 0 oklch(1 0 0 / 0.04) inset`
- `--shadow-modal` : `0 24px 64px oklch(0 0 0 / 0.55)`
Pas d'ombre sur L1/L2 : la profondeur vient des surfaces et bordures.

---

## 6. Mouvement

Presets **uniquement** depuis `design-system/motion.ts`.

| Token | Valeur | Usage |
|---|---|---|
| `duration.instant` | 80 ms | survol, pression |
| `duration.fast` | 140 ms | toggles, tooltips |
| `duration.base` | 220 ms | entrée de cartes, popovers |
| `duration.slow` | 360 ms | changement de page, panneaux |
| `ease.standard` | `cubic-bezier(0.2, 0, 0, 1)` | défaut |
| `ease.emphasized` | `cubic-bezier(0.32, 0.72, 0, 1)` | entrées, panneaux (sensation Apple) |
| `ease.exit` | `cubic-bezier(0.4, 0, 1, 1)` | sorties (plus courtes de 30 %) |
| `spring.snappy` | `{ type: "spring", stiffness: 500, damping: 38 }` | boutons, toggles, sélecteurs |
| `spring.gentle` | `{ type: "spring", stiffness: 260, damping: 30 }` | cartes, sidebar, layout |

Chorégraphies :
- **Nouveau message** : opacity 0→1, y 8→0, `duration.base`, `ease.emphasized`. Le texte en streaming n'est **pas** animé caractère par caractère ; curseur de frappe clignotant discret.
- **Carte de question** : opacity + y 8→0 + scale 0.98→1 (`spring.gentle`), puis **un seul** halo `--accent-soft` de 600 ms. Pas de pulsation en boucle.
- **Résolution de carte** : les boutons se replient en chip « Autorisé · par vous » / « Auto-validé » (`layout` animation, `spring.snappy`).
- **Sidebar rail ↔ déployée** : largeur via `spring.gentle`, libellés en fondu décalé de 40 ms.
- **Changement de module** : fondu croisé 140 ms + y 4→0 du contenu entrant. Pas de slide horizontal.
- **Palette Ctrl+K** : scale 0.96→1 + opacity, `duration.fast`.

Règles : animer seulement `transform`, `opacity` (et `filter` léger). Interactions < 100 ms de latence perçue. `prefers-reduced-motion: reduce` → fondus d'opacité uniquement, springs désactivés.

---

## 7. Composants et patterns

### 7.1 Navigation
- **Sidebar** par catégories (libellé `text-caption` en `--text-subtle`, majuscules interdites → casse de phrase). Item : icône 16 px + libellé `text-body-sm`, hauteur 32, rayon `sm`. Actif : fond `--accent-soft`, icône `--accent`. Section « Sessions récentes » repliable sous le module Chat. Réglages épinglé en bas.
- **Launchpad** : blocs L2 en grille bento, icône 20 px, titre `text-title-3`, description `text-footnote` sur 2 lignes max, statut éventuel (ex : « 3 skills actifs »). Survol : `--surface-2` + bordure `--border-strong`, `duration.instant`.

### 7.2 Chat
- **Liste des conversations** (rail 256 px à gauche du chat) : titre dérivé du premier message, puis date, modèle et dossier en `text-caption`. Suppression : icône au survol, **second clic** pour confirmer.
- **Bulle utilisateur** : alignée à droite, `--surface-2`, rayon `lg`, max 80 % de la colonne.
- **Message IA** : **sans bulle**, pleine largeur de colonne, avatar d'agent 20 px + nom + modèle en `text-footnote`. Markdown rendu, code en blocs `Geist Mono` 13/20 sur `--surface-1` avec bouton copier.
- **Composer** (L3 glass) : champ multi-ligne, à gauche AgentPicker + ModelPicker, **sélecteur de dossier de travail** et **bouton pièces jointes**, slot `chat.composer.actions`, à droite toggle **Mode Auto** puis bouton envoyer (accent). `Entrée` envoie, `Maj+Entrée` nouvelle ligne.
- **Pièces jointes** : chips au-dessus du champ (icône trombone + nom de fichier tronqué + croix). Les chemins complets sont transmis à l'agent, qui ouvre les fichiers avec son propre outil de lecture.
- **Toggle Mode Auto** : 3 états `Désactivé / Intelligent / Complet`. En `Complet`, un liseré `--warning` de 1 px sur le composer et une chip dans la statusbar rappellent l'état en permanence.
- **Terminal brut** : tiroir bas, fermé par défaut, ouvrable via `Ctrl+J` ou « Voir la sortie brute » dans une carte.

### 7.3 Cartes interactives
Structure commune : en-tête (icône d'outil + titre `text-title-3` + badge de risque) · corps (diff, commande, texte) · pied (actions alignées à droite, primaire en dernier).
| Carte | Corps | Actions |
|---|---|---|
| `PermissionCard` / `DiffCard` | diff unifié, lignes +/− teintées `--success-soft` / `--danger-soft`, repliable au-delà de 20 lignes | Refuser · Modifier · **Autoriser** (+ « Toujours pour ce dossier ») |
| `CommandCard` | commande éditable en mono, `cwd` en footnote | Refuser · **Exécuter** |
| `PromptCard` (choix) | question + options en boutons (≤ 4) ou liste (> 4) | options, raccourci `1…9` affiché en `Kbd` |
| `PromptCard` (texte) | champ intégré | **Envoyer** |
| `ErrorCard` | message humain + code + « Détails techniques » repliés | Réessayer / Ouvrir le terminal |

Badge de risque : Low `--success` · Medium `--info` · High `--warning` · Critical `--danger` + icône bouclier. Une action **Critical** a un bouton `Danger` et exige un second clic de confirmation (le libellé devient « Confirmer la suppression »).

### 7.3.bis Module Code
Trois colonnes élastiques : arborescence `clamp(180px, 18%, 264px)` · éditeur `min-width 280px` · assistant `clamp(300px, 30%, 440px)`, repliable. Onglets de fichiers en `text-footnote`, hauteur 28. L'éditeur (CodeMirror 6) n'a **pas** de thème propre : ses couleurs sont mappées sur les tokens (`--color-text`, `--color-accent`, `--font-mono`), donc il suit automatiquement le preset choisi.
Un fichier glissé de l'arborescence vers le composer devient une **cible** (chip accent) ; un fichier glissé depuis Windows devient une **pièce jointe** (chip neutre). Pendant un survol de dépôt, le composer prend un anneau `--accent` et affiche l'action attendue.

### 7.4 Contrôles
Boutons : hauteurs 28 (sm) / 32 (md) / 40 (lg). Variantes `primary` (accent), `secondary` (`--surface-2`), `ghost`, `danger`. Focus ring : 2 px `--accent` + offset 2 px `--bg`, toujours visible au clavier (`:focus-visible`).
Icônes : `lucide-react`, trait 1.75, tailles 14 / 16 / 20 uniquement.
**Menus déroulants** : toujours la primitive `Select` (`design-system/primitives/Select.tsx`), jamais un `<select>` natif — ses options sont dessinées par le système et ignorent le thème. La liste est rendue dans un portail, en couche L3 (glass), navigable au clavier (`↑` `↓` `Entrée` `Échap`).

---

## 8. Fenêtre (Tauri)
- `decorations: false` + titlebar maison (boutons fenêtre Windows à droite, dimensions natives 46×40).
- Option **Mica** (Windows 11) via `windowEffects` : fond `--bg` passe à `oklch(0.155 0.006 265 / 0.72)`. Désactivable dans Réglages > Apparence ; désactivée automatiquement sur Windows 10.
- Démarrage : fenêtre cachée jusqu'au premier rendu (`visible: false` puis `show()`) pour éviter le flash blanc ; fond HTML `--bg` dès `index.html`.

---

## 9. États obligatoires
Tout écran/module conçoit les 5 états : **vide** (illustration sobre + une action), **chargement** (skeletons aux dimensions finales, pas de spinner plein écran au-delà de 300 ms), **partiel**, **erreur** (message humain + action de récupération), **succès**.
Textes UI : français, phrases courtes, verbes d'action (« Autoriser », pas « OK »), pas de jargon technique en premier niveau.

---

## 10. Anti-patterns interdits
- Dégradés violets/bleus « IA générique », néons, glow permanents.
- Glass sur des cartes de contenu, blur empilés.
- Plus d'un bouton primaire par zone ; couleur d'accent en fond de grandes surfaces.
- Afficher `[Y/n]`, codes ANSI ou JSON brut dans la conversation.
- Spinners infinis sans texte après 2 s ; animations en boucle.
- Valeurs en dur (`#hex`, `px` hors échelle, durées arbitraires).
- `<select>`, `alert()`, `confirm()` ou `prompt()` natifs : ils cassent le thème.
- Modales pour des confirmations qui peuvent vivre dans une carte.

---

## 11. Checklist de revue UI
- [ ] Skills `ui-ux-pro-max`, `apple-design`, `impeccable` appliqués.
- [ ] Uniquement des tokens (couleur, espace, rayon, typo, motion).
- [ ] Hiérarchie claire : un point d'entrée visuel, une action primaire.
- [ ] 5 états conçus, textes en français clair.
- [ ] Navigation clavier complète, focus visible, labels ARIA.
- [ ] Contraste AA vérifié en sombre **et** clair.
- [ ] `prefers-reduced-motion` respecté.
- [ ] Rendu vérifié à 960×640 et en plein écran 2560×1440.
