//! Moteur Python du module, embarqué dans l'exécutable.
//!
//! GÉNÉRÉ par `pack-engine.py` (même dossier) — le relancer après avoir ajouté ou
//! retiré un fichier dans `engine/`. Le moteur est déposé dans le dossier de données
//! au premier usage, ce qui évite de livrer des fichiers à côté de l'exécutable.

/// Chemin relatif → contenu du fichier.
pub const FILES: &[(&str, &str)] = &[
    ("LICENSE.jobspy", include_str!("engine/LICENSE.jobspy")),
    ("archimed_jobagent/__init__.py", include_str!("engine/archimed_jobagent/__init__.py")),
    ("archimed_jobagent/cli.py", include_str!("engine/archimed_jobagent/cli.py")),
    ("archimed_jobagent/data/NOTICE.md", include_str!("engine/archimed_jobagent/data/NOTICE.md")),
    ("archimed_jobagent/data/cities.tsv", include_str!("engine/archimed_jobagent/data/cities.tsv")),
    ("archimed_jobagent/data/countries.tsv", include_str!("engine/archimed_jobagent/data/countries.tsv")),
    ("archimed_jobagent/detail.py", include_str!("engine/archimed_jobagent/detail.py")),
    ("archimed_jobagent/filters.py", include_str!("engine/archimed_jobagent/filters.py")),
    ("archimed_jobagent/geo.py", include_str!("engine/archimed_jobagent/geo.py")),
    ("archimed_jobagent/mailer.py", include_str!("engine/archimed_jobagent/mailer.py")),
    ("archimed_jobagent/model.py", include_str!("engine/archimed_jobagent/model.py")),
    ("archimed_jobagent/recruiter.py", include_str!("engine/archimed_jobagent/recruiter.py")),
    ("archimed_jobagent/resume.py", include_str!("engine/archimed_jobagent/resume.py")),
    ("archimed_jobagent/search.py", include_str!("engine/archimed_jobagent/search.py")),
    ("archimed_jobagent/selftest.py", include_str!("engine/archimed_jobagent/selftest.py")),
    ("archimed_jobagent/server.py", include_str!("engine/archimed_jobagent/server.py")),
    ("jobspy/__init__.py", include_str!("engine/jobspy/__init__.py")),
    ("jobspy/exception.py", include_str!("engine/jobspy/exception.py")),
    ("jobspy/glassdoor/__init__.py", include_str!("engine/jobspy/glassdoor/__init__.py")),
    ("jobspy/glassdoor/constant.py", include_str!("engine/jobspy/glassdoor/constant.py")),
    ("jobspy/glassdoor/util.py", include_str!("engine/jobspy/glassdoor/util.py")),
    ("jobspy/google/__init__.py", include_str!("engine/jobspy/google/__init__.py")),
    ("jobspy/google/constant.py", include_str!("engine/jobspy/google/constant.py")),
    ("jobspy/google/util.py", include_str!("engine/jobspy/google/util.py")),
    ("jobspy/hellowork/__init__.py", include_str!("engine/jobspy/hellowork/__init__.py")),
    ("jobspy/indeed/__init__.py", include_str!("engine/jobspy/indeed/__init__.py")),
    ("jobspy/indeed/constant.py", include_str!("engine/jobspy/indeed/constant.py")),
    ("jobspy/indeed/util.py", include_str!("engine/jobspy/indeed/util.py")),
    ("jobspy/linkedin/__init__.py", include_str!("engine/jobspy/linkedin/__init__.py")),
    ("jobspy/linkedin/constant.py", include_str!("engine/jobspy/linkedin/constant.py")),
    ("jobspy/linkedin/util.py", include_str!("engine/jobspy/linkedin/util.py")),
    ("jobspy/model.py", include_str!("engine/jobspy/model.py")),
    ("jobspy/util.py", include_str!("engine/jobspy/util.py")),
    ("jobspy/wttj/__init__.py", include_str!("engine/jobspy/wttj/__init__.py")),
    ("jobspy/ziprecruiter/__init__.py", include_str!("engine/jobspy/ziprecruiter/__init__.py")),
    ("jobspy/ziprecruiter/constant.py", include_str!("engine/jobspy/ziprecruiter/constant.py")),
    ("jobspy/ziprecruiter/util.py", include_str!("engine/jobspy/ziprecruiter/util.py")),
    ("requirements.txt", include_str!("engine/requirements.txt")),
];

/// Empreinte du moteur : change dès qu'un fichier change, déclenche le redéploiement.
///
/// Le contenu entier est haché, pas seulement sa taille : une correction qui ne change
/// pas le nombre d'octets doit, elle aussi, arriver chez la personne qui met à jour.
pub fn fingerprint() -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    for (path, body) in FILES {
        path.hash(&mut hasher);
        body.hash(&mut hasher);
    }
    hasher.finish()
}
