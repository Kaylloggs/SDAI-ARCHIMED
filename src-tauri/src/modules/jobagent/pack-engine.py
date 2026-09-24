# -*- coding: utf-8 -*-
"""Génère `assets.rs`, la table des fichiers du moteur Python embarqués dans l'exécutable.

À relancer après avoir ajouté ou retiré un fichier dans `engine/` :

    python src-tauri/src/modules/jobagent/pack-engine.py

Une simple modification de contenu n'exige rien : `include_str!` relit les fichiers à
chaque compilation, et l'empreinte change avec eux.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.join(HERE, 'engine')

files = []
for folder, _, names in os.walk(ENGINE):
    if '__pycache__' in folder:
        continue
    for name in sorted(names):
        if name.endswith('.pyc'):
            continue
        rel = os.path.relpath(os.path.join(folder, name), ENGINE).replace('\\', '/')
        files.append(rel)
files.sort()

lines = [
    '//! Moteur Python du module, embarqué dans l\'exécutable.',
    '//!',
    '//! GÉNÉRÉ par `pack-engine.py` (même dossier) — le relancer après avoir ajouté ou',
    '//! retiré un fichier dans `engine/`. Le moteur est déposé dans le dossier de données',
    '//! au premier usage, ce qui évite de livrer des fichiers à côté de l\'exécutable.',
    '',
    '/// Chemin relatif → contenu du fichier.',
    'pub const FILES: &[(&str, &str)] = &[',
]
for rel in files:
    lines.append(f'    ("{rel}", include_str!("engine/{rel}")),')
lines += [
    '];',
    '',
    '/// Empreinte du moteur : change dès qu\'un fichier change, déclenche le redéploiement.',
    '///',
    '/// Le contenu entier est haché, pas seulement sa taille : une correction qui ne change',
    '/// pas le nombre d\'octets doit, elle aussi, arriver chez la personne qui met à jour.',
    'pub fn fingerprint() -> u64 {',
    '    use std::hash::{Hash, Hasher};',
    '    let mut hasher = std::collections::hash_map::DefaultHasher::new();',
    '    for (path, body) in FILES {',
    '        path.hash(&mut hasher);',
    '        body.hash(&mut hasher);',
    '    }',
    '    hasher.finish()',
    '}',
    '',
]
with open(os.path.join(HERE, 'assets.rs'), 'w', encoding='utf8', newline='\n') as handle:
    handle.write('\n'.join(lines))
print(f'{len(files)} fichiers embarqués')
