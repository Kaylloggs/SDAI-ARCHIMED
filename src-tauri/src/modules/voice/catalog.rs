//! Catalogue des modèles vocaux locaux : outils (whisper.cpp, Piper), modèles de
//! reconnaissance (Whisper), voix (Piper) et petits modèles de langage (via Ollama).
//!
//! Intégrité : l'empreinte SHA-256 des outils publiés sur GitHub est **épinglée ici**
//! (calculée à la publication). Celle des modèles hébergés sur Hugging Face est lue au moment
//! du téléchargement dans les métadonnées LFS du dépôt (`lfs.oid`), puis comparée au fichier
//! reçu. Les modèles Ollama sont vérifiés par Ollama lui-même (empreinte de chaque couche).

use super::types::{HardwareInfo, HardwareTier, ModelFit, ModelKind};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Archive {
    Zip,
    TarGz,
}

#[derive(Clone, Copy, Debug)]
pub enum Source {
    /// Fichier publié sur GitHub, empreinte épinglée.
    Github { url: &'static str, sha256: &'static str, size: u64, archive: Option<Archive> },
    /// Fichier d'un dépôt Hugging Face ; empreinte lue dans ses métadonnées.
    HuggingFace { repo: &'static str, revision: &'static str, path: &'static str },
    /// Modèle téléchargé et vérifié par Ollama (`ollama pull`).
    Ollama { tag: &'static str },
}

/// Fichiers d'un modèle pour un système donné (`None` : tous les systèmes).
#[derive(Clone, Copy, Debug)]
pub struct PlatformFiles {
    pub os: Option<&'static str>,
    pub arch: Option<&'static str>,
    pub sources: &'static [Source],
    /// Fichier principal, relatif au dossier du modèle (exécutable ou poids).
    pub entry: &'static str,
}

#[derive(Clone, Copy, Debug)]
pub struct CatalogItem {
    pub id: &'static str,
    pub kind: ModelKind,
    pub name: &'static str,
    pub description: &'static str,
    pub engine: &'static str,
    pub version: &'static str,
    pub size_mb: u64,
    pub ram_mb: u64,
    pub vram_mb: Option<u64>,
    pub speed: u8,
    pub quality: u8,
    pub languages: &'static [&'static str],
    pub capabilities: &'static [&'static str],
    pub license: &'static str,
    pub requires: Option<&'static str>,
    pub recommended: &'static [HardwareTier],
    pub optional: &'static [HardwareTier],
    pub files: &'static [PlatformFiles],
}

use HardwareTier::{High, Low, Mid};

const WHISPER_REPO: &str = "ggerganov/whisper.cpp";
const PIPER_REPO: &str = "rhasspy/piper-voices";
const PIPER_REVISION: &str = "v1.0.0";

macro_rules! hf {
    ($repo:expr, $rev:expr, $path:expr) => {
        Source::HuggingFace { repo: $repo, revision: $rev, path: $path }
    };
}

/// Voix Piper : poids `.onnx` (LFS, SHA-256) et configuration `.onnx.json`.
macro_rules! piper_voice {
    ($id:expr, $name:expr, $desc:expr, $lang:expr, $dir:expr, $file:expr, $size:expr, $license:expr) => {
        CatalogItem {
            id: $id,
            kind: ModelKind::Tts,
            name: $name,
            description: $desc,
            engine: "piper",
            version: "1.0.0",
            size_mb: $size,
            ram_mb: 250,
            vram_mb: None,
            speed: 5,
            quality: 3,
            languages: &[$lang],
            capabilities: &["tts", "offline", "speed"],
            license: $license,
            requires: Some("runtime-piper"),
            recommended: &[Low, Mid, High],
            optional: &[],
            files: &[PlatformFiles {
                os: None,
                arch: None,
                sources: &[
                    hf!(PIPER_REPO, PIPER_REVISION, concat!($dir, "/", $file, ".onnx")),
                    hf!(PIPER_REPO, PIPER_REVISION, concat!($dir, "/", $file, ".onnx.json")),
                ],
                entry: concat!($file, ".onnx"),
            }],
        }
    };
}

pub const CATALOG: &[CatalogItem] = &[
    // ── Outils ────────────────────────────────────────────────────────────────────────
    CatalogItem {
        id: "runtime-whisper",
        kind: ModelKind::Runtime,
        name: "whisper.cpp",
        description: "Moteur de reconnaissance vocale local (serveur whisper.cpp, processeur).",
        engine: "whisper.cpp",
        version: "1.9.2",
        size_mb: 8,
        ram_mb: 50,
        vram_mb: None,
        speed: 4,
        quality: 4,
        languages: &[],
        capabilities: &["stt", "offline"],
        license: "MIT",
        requires: None,
        recommended: &[Low, Mid, High],
        optional: &[],
        files: &[
            PlatformFiles {
                os: Some("windows"),
                arch: Some("x86_64"),
                sources: &[Source::Github {
                    url: "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip",
                    sha256: "49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a",
                    size: 8_194_445,
                    archive: Some(Archive::Zip),
                }],
                entry: "Release/whisper-server.exe",
            },
            PlatformFiles {
                os: Some("linux"),
                arch: Some("x86_64"),
                sources: &[Source::Github {
                    url: "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-ubuntu-x64.tar.gz",
                    sha256: "46811a3ecf584307480a220b9ef5ff81b7b22dc41577cbc274ce3afc61f753b1",
                    size: 9_497_583,
                    archive: Some(Archive::TarGz),
                }],
                entry: "whisper-bin-ubuntu-x64/whisper-server",
            },
        ],
    },
    CatalogItem {
        id: "runtime-piper",
        kind: ModelKind::Runtime,
        name: "Piper",
        description: "Synthèse vocale locale rapide (voix neuronales, processeur).",
        engine: "piper",
        version: "2023.11.14-2",
        size_mb: 22,
        ram_mb: 100,
        vram_mb: None,
        speed: 5,
        quality: 3,
        languages: &[],
        capabilities: &["tts", "offline"],
        license: "MIT",
        requires: None,
        recommended: &[Low, Mid, High],
        optional: &[],
        files: &[
            PlatformFiles {
                os: Some("windows"),
                arch: Some("x86_64"),
                sources: &[Source::Github {
                    url: "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip",
                    sha256: "f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea",
                    size: 22_477_236,
                    archive: Some(Archive::Zip),
                }],
                entry: "piper/piper.exe",
            },
            PlatformFiles {
                os: Some("linux"),
                arch: Some("x86_64"),
                sources: &[Source::Github {
                    url: "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz",
                    sha256: "a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992",
                    size: 26_460_462,
                    archive: Some(Archive::TarGz),
                }],
                entry: "piper/piper",
            },
            PlatformFiles {
                os: Some("macos"),
                arch: Some("aarch64"),
                sources: &[Source::Github {
                    url: "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_macos_aarch64.tar.gz",
                    sha256: "6b1eb03b3735946cb35216e063e7eebcc33a6bbf5dd96ec0217959bf1cdcb0cc",
                    size: 19_146_957,
                    archive: Some(Archive::TarGz),
                }],
                entry: "piper/piper",
            },
            PlatformFiles {
                os: Some("macos"),
                arch: Some("x86_64"),
                sources: &[Source::Github {
                    url: "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_macos_x64.tar.gz",
                    sha256: "ced85c0a3df13945b1e623b878a48fdc2854d5c485b4b67f62857cf551deaf8b",
                    size: 19_146_927,
                    archive: Some(Archive::TarGz),
                }],
                entry: "piper/piper",
            },
        ],
    },
    // ── Reconnaissance vocale (Whisper) ──────────────────────────────────────────────
    CatalogItem {
        id: "stt-whisper-base",
        kind: ModelKind::Stt,
        name: "Whisper Base",
        description: "Petit et rapide : bon compromis pour les commandes vocales.",
        engine: "whisper.cpp",
        version: "1",
        size_mb: 148,
        ram_mb: 500,
        vram_mb: None,
        speed: 4,
        quality: 3,
        languages: &["multi"],
        capabilities: &["stt", "offline", "multilingual"],
        license: "MIT",
        requires: Some("runtime-whisper"),
        recommended: &[Low],
        optional: &[Mid, High],
        files: &[PlatformFiles { os: None, arch: None, sources: &[hf!(WHISPER_REPO, "main", "ggml-base.bin")], entry: "ggml-base.bin" }],
    },
    CatalogItem {
        id: "stt-whisper-small",
        kind: ModelKind::Stt,
        name: "Whisper Small",
        description: "Plus précis, surtout en français ; encore rapide sur un processeur récent.",
        engine: "whisper.cpp",
        version: "1",
        size_mb: 488,
        ram_mb: 1000,
        vram_mb: None,
        speed: 3,
        quality: 4,
        languages: &["multi"],
        capabilities: &["stt", "offline", "multilingual"],
        license: "MIT",
        requires: Some("runtime-whisper"),
        recommended: &[Mid],
        optional: &[High],
        files: &[PlatformFiles { os: None, arch: None, sources: &[hf!(WHISPER_REPO, "main", "ggml-small.bin")], entry: "ggml-small.bin" }],
    },
    CatalogItem {
        id: "stt-whisper-turbo",
        kind: ModelKind::Stt,
        name: "Whisper Large v3 Turbo",
        description: "La meilleure précision locale (compressé q5) ; demande une machine puissante.",
        engine: "whisper.cpp",
        version: "1",
        size_mb: 574,
        ram_mb: 1800,
        vram_mb: None,
        speed: 2,
        quality: 5,
        languages: &["multi"],
        capabilities: &["stt", "offline", "multilingual"],
        license: "MIT",
        requires: Some("runtime-whisper"),
        recommended: &[High],
        optional: &[Mid],
        files: &[PlatformFiles {
            os: None,
            arch: None,
            sources: &[hf!(WHISPER_REPO, "main", "ggml-large-v3-turbo-q5_0.bin")],
            entry: "ggml-large-v3-turbo-q5_0.bin",
        }],
    },
    CatalogItem {
        id: "stt-whisper-tiny",
        kind: ModelKind::Stt,
        name: "Whisper Tiny",
        description: "Minuscule : pour les machines modestes, précision limitée.",
        engine: "whisper.cpp",
        version: "1",
        size_mb: 78,
        ram_mb: 390,
        vram_mb: None,
        speed: 5,
        quality: 2,
        languages: &["multi"],
        capabilities: &["stt", "offline", "multilingual"],
        license: "MIT",
        requires: Some("runtime-whisper"),
        recommended: &[],
        optional: &[Low],
        files: &[PlatformFiles { os: None, arch: None, sources: &[hf!(WHISPER_REPO, "main", "ggml-tiny.bin")], entry: "ggml-tiny.bin" }],
    },
    // ── Voix (Piper) ─────────────────────────────────────────────────────────────────
    piper_voice!(
        "tts-piper-fr-siwis",
        "Siwis (français)",
        "Voix féminine claire, rapide sur toute machine.",
        "fr-FR",
        "fr/fr_FR/siwis/medium",
        "fr_FR-siwis-medium",
        63,
        "CC BY 4.0"
    ),
    piper_voice!(
        "tts-piper-fr-tom",
        "Tom (français)",
        "Voix masculine posée.",
        "fr-FR",
        "fr/fr_FR/tom/medium",
        "fr_FR-tom-medium",
        63,
        "CC BY 4.0"
    ),
    piper_voice!(
        "tts-piper-fr-upmc",
        "UPMC (français, 2 voix)",
        "Jessica et Pierre, deux voix dans un seul modèle.",
        "fr-FR",
        "fr/fr_FR/upmc/medium",
        "fr_FR-upmc-medium",
        74,
        "CC BY 4.0"
    ),
    piper_voice!(
        "tts-piper-en-lessac",
        "Lessac (English)",
        "Natural US English voice.",
        "en-US",
        "en/en_US/lessac/medium",
        "en_US-lessac-medium",
        63,
        "Blizzard license"
    ),
    // ── Petits modèles de langage (Ollama) ───────────────────────────────────────────
    CatalogItem {
        id: "llm-qwen2.5-1.5b",
        kind: ModelKind::Llm,
        name: "Qwen 2.5 1.5B",
        description: "Assistant local rapide : répond aux questions simples et aiguille les demandes.",
        engine: "ollama",
        version: "qwen2.5:1.5b",
        size_mb: 986,
        ram_mb: 2000,
        vram_mb: Some(1500),
        speed: 5,
        quality: 2,
        languages: &["multi"],
        capabilities: &["llm", "offline", "router"],
        license: "Apache-2.0",
        requires: Some("ollama"),
        recommended: &[Low],
        optional: &[Mid, High],
        files: &[PlatformFiles { os: None, arch: None, sources: &[Source::Ollama { tag: "qwen2.5:1.5b" }], entry: "" }],
    },
    CatalogItem {
        id: "llm-qwen2.5-3b",
        kind: ModelKind::Llm,
        name: "Qwen 2.5 3B",
        description: "Meilleures réponses locales, toujours rapide avec 16 Go de mémoire.",
        engine: "ollama",
        version: "qwen2.5:3b",
        size_mb: 1900,
        ram_mb: 4000,
        vram_mb: Some(3000),
        speed: 4,
        quality: 3,
        languages: &["multi"],
        capabilities: &["llm", "offline", "router"],
        license: "Qwen Research",
        requires: Some("ollama"),
        recommended: &[Mid],
        optional: &[High],
        files: &[PlatformFiles { os: None, arch: None, sources: &[Source::Ollama { tag: "qwen2.5:3b" }], entry: "" }],
    },
    CatalogItem {
        id: "llm-qwen2.5-7b",
        kind: ModelKind::Llm,
        name: "Qwen 2.5 7B",
        description: "Conversation locale de bonne qualité ; carte graphique conseillée.",
        engine: "ollama",
        version: "qwen2.5:7b",
        size_mb: 4700,
        ram_mb: 8000,
        vram_mb: Some(6000),
        speed: 3,
        quality: 4,
        languages: &["multi"],
        capabilities: &["llm", "offline"],
        license: "Apache-2.0",
        requires: Some("ollama"),
        recommended: &[High],
        optional: &[],
        files: &[PlatformFiles { os: None, arch: None, sources: &[Source::Ollama { tag: "qwen2.5:7b" }], entry: "" }],
    },
];

pub fn find(id: &str) -> Option<&'static CatalogItem> {
    CATALOG.iter().find(|item| item.id == id)
}

/// Fichiers de ce modèle pour le système courant.
pub fn files_for(item: &CatalogItem, os: &str, arch: &str) -> Option<&'static PlatformFiles> {
    let files: &'static [PlatformFiles] = item.files;
    files.iter().find(|f| f.os.is_none_or(|o| o == os) && f.arch.is_none_or(|a| a == arch))
}

/// Convenance d'un modèle pour la machine : gamme, mémoire, système.
pub fn fit(item: &CatalogItem, hw: &HardwareInfo) -> ModelFit {
    if files_for(item, &hw.os, &hw.arch).is_none() {
        return ModelFit::Unsupported;
    }
    // Plus de 60 % de la mémoire : la machine souffrirait.
    if hw.ram_mb > 0 && item.ram_mb * 10 > hw.ram_mb * 6 {
        return ModelFit::NotRecommended;
    }
    if item.recommended.contains(&hw.tier) {
        ModelFit::Recommended
    } else if item.optional.contains(&hw.tier) {
        ModelFit::Optional
    } else {
        ModelFit::NotRecommended
    }
}

/// Adresse de téléchargement d'un fichier Hugging Face.
pub fn hf_url(repo: &str, revision: &str, path: &str) -> String {
    format!("https://huggingface.co/{repo}/resolve/{revision}/{path}")
}

/// Métadonnées d'un dossier Hugging Face (tailles et empreintes LFS).
pub fn hf_tree_url(repo: &str, revision: &str, path: &str) -> String {
    let dir = path.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
    if dir.is_empty() {
        format!("https://huggingface.co/api/models/{repo}/tree/{revision}")
    } else {
        format!("https://huggingface.co/api/models/{repo}/tree/{revision}/{dir}")
    }
}

/// Nom du fichier local d'une source (dernier segment du chemin ou de l'adresse).
pub fn file_name(source: &Source) -> &'static str {
    match source {
        Source::Github { url, .. } => url.rsplit('/').next().unwrap_or("download"),
        Source::HuggingFace { path, .. } => path.rsplit('/').next().unwrap_or(path),
        Source::Ollama { tag } => tag,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::voice::types::GpuInfo;

    fn machine(os: &str, arch: &str, ram: u64, tier: HardwareTier) -> HardwareInfo {
        HardwareInfo {
            os: os.into(),
            arch: arch.into(),
            cpu: "cpu".into(),
            cores: 8,
            ram_mb: ram,
            gpus: Vec::<GpuInfo>::new(),
            tier,
            reasons: vec![],
        }
    }

    #[test]
    fn ids_are_unique_and_requirements_exist() {
        let mut ids: Vec<&str> = CATALOG.iter().map(|i| i.id).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), CATALOG.len());
        for item in CATALOG {
            if let Some(req) = item.requires {
                assert!(req == "ollama" || find(req).is_some(), "{} requiert {req}", item.id);
            }
        }
    }

    #[test]
    fn github_files_have_pinned_sha256() {
        for item in CATALOG {
            for files in item.files {
                for source in files.sources {
                    if let Source::Github { sha256, url, .. } = source {
                        assert_eq!(sha256.len(), 64, "{url}");
                        assert!(sha256.chars().all(|c| c.is_ascii_hexdigit()));
                        assert!(url.starts_with("https://github.com/"));
                    }
                }
            }
        }
    }

    #[test]
    fn runtimes_cover_windows_and_piper_covers_every_desktop() {
        let whisper = find("runtime-whisper").unwrap();
        assert!(files_for(whisper, "windows", "x86_64").is_some());
        assert!(files_for(whisper, "macos", "aarch64").is_none());
        let piper = find("runtime-piper").unwrap();
        for (os, arch) in [("windows", "x86_64"), ("linux", "x86_64"), ("macos", "aarch64"), ("macos", "x86_64")] {
            assert!(files_for(piper, os, arch).is_some(), "{os} {arch}");
        }
    }

    #[test]
    fn fit_follows_tier_memory_and_platform() {
        let turbo = find("stt-whisper-turbo").unwrap();
        assert_eq!(fit(turbo, &machine("windows", "x86_64", 32_000, HardwareTier::High)), ModelFit::Recommended);
        assert_eq!(fit(turbo, &machine("windows", "x86_64", 16_000, HardwareTier::Mid)), ModelFit::Optional);
        assert_eq!(fit(turbo, &machine("windows", "x86_64", 2_000, HardwareTier::Low)), ModelFit::NotRecommended);
        let runtime = find("runtime-whisper").unwrap();
        assert_eq!(fit(runtime, &machine("macos", "aarch64", 16_000, HardwareTier::High)), ModelFit::Unsupported);
    }

    #[test]
    fn hugging_face_urls() {
        assert_eq!(
            hf_url(PIPER_REPO, PIPER_REVISION, "fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx"),
            "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx"
        );
        assert_eq!(
            hf_tree_url(PIPER_REPO, PIPER_REVISION, "fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx"),
            "https://huggingface.co/api/models/rhasspy/piper-voices/tree/v1.0.0/fr/fr_FR/siwis/medium"
        );
        assert_eq!(hf_tree_url(WHISPER_REPO, "main", "ggml-base.bin"), "https://huggingface.co/api/models/ggerganov/whisper.cpp/tree/main");
    }
}
