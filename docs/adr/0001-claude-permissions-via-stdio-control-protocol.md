# ADR 0001 — Permissions Claude via le protocole de contrôle stdio

- **Date** : 2026-09-16
- **Statut** : accepté
- **Contexte testé** : claude 2.1.271 sur Windows 11

## Contexte

ARCHIMED doit transformer les demandes de permission des CLI en cartes cliquables. L'hypothèse initiale était un sidecar MCP (`archimed-bridge`) exposant un outil `approval_prompt`, relié à l'app par un socket local.

## Décision

Utiliser le protocole de contrôle déjà présent sur le flux stdio :

- lancement avec `--input-format stream-json --output-format stream-json --permission-prompt-tool stdio` ;
- Claude émet `{"type":"control_request","request":{"subtype":"can_use_tool",…}}` ;
- ARCHIMED répond sur stdin `{"type":"control_response","response":{"subtype":"success","request_id":…,"response":{"behavior":"allow","updatedInput":…}}}`.

Vérifié expérimentalement : la réponse `allow` débloque l'outil et l'agent poursuit son tour.

## Conséquences

- **Positif** : aucun sidecar à compiler/signer/bundler, aucun port réseau ouvert, moins de surface d'attaque, build plus simple.
- **Positif** : `updatedInput` permet de modifier une commande avant autorisation.
- **Négatif** : dépendance à un protocole non documenté publiquement → chaque adaptateur note la version testée et les tests de décodage utilisent des flux enregistrés.
- **Alternative conservée** : le sidecar MCP reste possible si le protocole change.
