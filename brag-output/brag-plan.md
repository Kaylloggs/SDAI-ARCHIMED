# /brag — ARCHIMED

## Réponses

- **C'est quoi ?** Une application Windows gratuite qui donne une vraie maison aux assistants IA
  (Claude Code, Codex, Antigravity) : des modules (Chat, Code, Planner, Mod Studio, Image Maker,
  JobAgent…) et une voix qui fait le travail dedans.
- **Pour qui, et qu'est-ce que ça change ?** Celles et ceux qui utilisent déjà une IA en ligne de
  commande : on parle, et l'application agit (cartes du Planner, mod compilé, image retouchée), au
  lieu de tout faire dans un terminal.
- **Ce qui la distingue.** Tout ce qu'on fait à la main dans un module, la voix sait le faire
  (base de commandes par module, plus de 170 commandes), avec l'agent de son choix, sur sa machine.
- **La phrase qui marque.** « Votre assistant IA, enfin chez lui sur votre ordinateur. »
  (README) — et la démonstration : une phrase dite, quatre cartes apparaissent.
- **Accroche visuelle.** La lueur laiton de la voix sur fond noir, et la vraie pastille vocale.
- **UI réelle montrée.** Le Planner capturé dans l'app (Vite + IPC simulé) : avant (« Je vous
  entends », sous-titre de la phrase), après (« Réponse », sous-titre « C'est fait… », 4 cartes).
  Captures réelles de Mod Studio, Image Maker et Chat (docs/images). Logo spirale réel (SVG).
- **Ton.** `polished` avec du rythme — direction : « film produit premium, laiton sur noir, la
  voix clique à votre place ».
- **Légende.** « Dites-le, ARCHIMED le fait. »

## Angle

Le crochet est la phrase elle-même : trois touches (Ctrl Maj Espace), une lueur laiton, et la
demande apparaît mot à mot. Coupe franche : la même phrase devient le sous-titre de la vraie
application, puis la réponse arrive et quatre cartes tombent dans « À faire ». Ensuite on dit ce
que c'est, on montre que ça vaut pour tous les modules, avec quel agent, et où le télécharger.

## Identité visuelle

- Fond `oklch(0.155 0.006 265)`, surfaces `oklch(0.205 0.007 265)`, texte `oklch(0.96 0.003 265)`,
  texte discret `oklch(0.74 0.01 265)`, accent laiton `oklch(0.8 0.115 80)` (dégradé du logo
  #F2D58E → #D9A94F → #A9772E).
- Geist Variable (titres et texte), Geist Mono (touches), comme l'application.

## Storyboard (22,8 s, 1920×1080, 30 i/s, tempo 100 BPM : 1 temps = 0,6 s)

| # | Temps | Durée | Scène | Texte | Transition / son |
|---|---|---|---|---|---|
| 1 | 0,0 – 3,6 | 3,6 s | **Crochet.** Noir, lueur laiton qui monte du bas. Touches Ctrl, Maj, Espace s'enfoncent (0,15 / 0,45 / 0,75). Bouton micro rond laiton, barres de la vague. La demande s'écrit mot à mot (1,2 → 2,2) puis reste. | « Ajoute les quatre étapes du lancement à ma roadmap. » | 3 frappes douces, petit carillon micro (1,05), pad qui enfle, montée vers 3,6. |
| 2 | 3,6 – 7,2 | 3,6 s | **Ça se passe.** La phrase rétrécit et file vers le sous-titre de la vraie app (Planner avant, pastille « Je vous entends »). 4,2 : l'app répond (pastille « Réponse », sous-titre « C'est fait… »). 4,5 / 4,8 / 5,1 / 5,4 : les quatre cartes tombent dans « À faire », le compteur passe à 4. Léger travelling avant vers la colonne. | (UI réelle) | Premier temps fort à 3,6 (kick doux + basse). 4 notes pincées montantes (ré, fa#, la, ré) calées sur les cartes. |
| 3 | 7,2 – 10,8 | 3,6 s | **Ce que c'est.** L'app recule et se floute. Le logo spirale se dessine, « ARCHIMED », puis la promesse. | « Votre assistant IA, enfin chez lui sur votre ordinateur. » | Coup de gong doux sur le logo, accord plein. |
| 4 | 10,8 – 16,2 | 5,4 s | **Partout.** Titre en haut, fixe. Trois vraies captures glissent l'une après l'autre (1,8 s chacune), chacune avec la phrase dite dans une pastille. | « Tout ce que vous faites, la voix le fait. » — Mod Studio : « Compile mon mod. » · Image Maker : « Ajoute un dragon sur la ville. » · Chat : « Mode sombre, et lance les tests. » | Souffles filtrés à chaque glissement (10,8 / 12,6 / 14,4), groove complet. |
| 5 | 16,2 – 19,2 | 3,0 s | **Avec qui.** Trois pastilles d'agents apparaissent (16,5 / 16,8 / 17,1), puis la ligne vie privée. | « Avec l'agent de votre choix » / « Votre compte. Votre ordinateur. Aucun serveur. » | Batterie allégée (respiration), notes pincées sur les pastilles. |
| 6 | 19,2 – 22,8 | 3,6 s | **Fin.** Logo, ARCHIMED, « Gratuit pour Windows 10 et 11 », adresse GitHub ; en bas les touches du début + « et parlez. » | « ARCHIMED » · « Gratuit pour Windows 10 et 11 » · « github.com/Kaylloggs/SDAI-ARCHIMED » · « Ctrl Maj Espace, et parlez. » | Accord final sur 19,2, queue de réverbération, fondu du son sur la dernière demi-seconde. |

Durées : 3,6 + 3,6 + 3,6 + 5,4 + 3,0 + 3,6 = 22,8 s.

## Son

Une seule pièce en ré majeur à 100 BPM, synthétisée : pad chaud (ré maj9, si m7, sol maj7, la6),
basse ronde, kick et claquement doux, charleston discret ; les effets (frappes, carillon, notes
des cartes, souffles, gong) dans la même tonalité et la même réverbération, mixés sous la
musique. Fin sur un accord tenu.

## Données

Aucune donnée personnelle : tableau et cartes fictifs (« Lancement de l'application »),
captures Mod Studio / Image Maker / Chat déjà publiées dans le README.
