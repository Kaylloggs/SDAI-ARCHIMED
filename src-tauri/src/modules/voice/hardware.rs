//! Détection du matériel (processeur, mémoire, cartes graphiques) pour proposer des modèles
//! locaux adaptés. Lecture seule, sans dépendance : API du système sous Windows (DXGI,
//! registre), `/proc` et `/sys` sous Linux, `sysctl` sous macOS.

use super::types::{GpuInfo, HardwareInfo, HardwareTier};

/// Mo au-delà desquels une carte compte comme « dédiée » (les puces intégrées réservent peu).
const DEDICATED_MIN_MB: u64 = 1024;

pub fn detect() -> HardwareInfo {
    let os = std::env::consts::OS.to_string();
    let arch = std::env::consts::ARCH.to_string();
    let cores = std::thread::available_parallelism().map(|n| n.get() as u32).unwrap_or(1);
    let ram_mb = platform::ram_mb().unwrap_or(0);
    let cpu = platform::cpu_name().unwrap_or_else(|| "Processeur inconnu".to_string());
    let mut gpus = platform::gpus();
    let apple_silicon = os == "macos" && arch == "aarch64";
    if apple_silicon && gpus.is_empty() {
        gpus.push(GpuInfo {
            name: "GPU Apple (mémoire unifiée)".to_string(),
            vendor: "apple".to_string(),
            vram_mb: None,
            dedicated: false,
        });
    }
    let (tier, reasons) = tier(ram_mb, cores, &gpus, apple_silicon);
    HardwareInfo { os, arch, cpu, cores, ram_mb, gpus, tier, reasons }
}

/// Gamme de la machine. Les moteurs locaux (whisper.cpp, Piper) tournent sur le processeur :
/// la mémoire et le nombre de cœurs comptent autant que la carte graphique.
pub fn tier(ram_mb: u64, cores: u32, gpus: &[GpuInfo], apple_silicon: bool) -> (HardwareTier, Vec<String>) {
    let vram = gpus.iter().filter(|g| g.dedicated).filter_map(|g| g.vram_mb).max().unwrap_or(0);
    let ram_gb = ram_mb / 1024;
    let mut reasons = vec![format!("{ram_gb} Go de mémoire, {cores} cœurs")];
    if vram > 0 {
        reasons.push(format!("carte graphique dédiée : {} Go", vram / 1024));
    }
    let tier = if vram >= 8 * 1024 || (apple_silicon && ram_mb >= 16 * 1024) || (ram_mb >= 32 * 1024 && cores >= 12) {
        HardwareTier::High
    } else if vram >= 4 * 1024 || (ram_mb >= 15 * 1024 && cores >= 6) || (ram_mb >= 12 * 1024 && cores >= 8) {
        HardwareTier::Mid
    } else {
        HardwareTier::Low
    };
    reasons.push(
        match tier {
            HardwareTier::High => "modèles précis possibles, réponse rapide",
            HardwareTier::Mid => "modèles moyens conseillés",
            HardwareTier::Low => "petits modèles conseillés pour garder la réactivité",
        }
        .to_string(),
    );
    (tier, reasons)
}

fn vendor_of(name: &str) -> String {
    let lower = name.to_lowercase();
    if lower.contains("nvidia") || lower.contains("geforce") || lower.contains("rtx") || lower.contains("quadro") {
        "nvidia"
    } else if lower.contains("amd") || lower.contains("radeon") {
        "amd"
    } else if lower.contains("intel") {
        "intel"
    } else if lower.contains("apple") {
        "apple"
    } else {
        "other"
    }
    .to_string()
}

#[cfg(windows)]
mod platform {
    use super::{vendor_of, GpuInfo, DEDICATED_MIN_MB};

    pub fn ram_mb() -> Option<u64> {
        use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
        let mut status = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
        unsafe { GlobalMemoryStatusEx(&mut status) }.ok()?;
        Some(status.ullTotalPhys / (1024 * 1024))
    }

    pub fn cpu_name() -> Option<String> {
        use windows::core::w;
        use windows::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
        let mut buffer = [0u16; 256];
        let mut size = (buffer.len() * 2) as u32;
        let status = unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                w!("HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0"),
                w!("ProcessorNameString"),
                RRF_RT_REG_SZ,
                None,
                Some(buffer.as_mut_ptr().cast()),
                Some(&mut size),
            )
        };
        if status.is_err() {
            return None;
        }
        let len = (size as usize / 2).min(buffer.len());
        let name = String::from_utf16_lossy(&buffer[..len]).trim_end_matches('\0').trim().to_string();
        (!name.is_empty()).then_some(name)
    }

    pub fn gpus() -> Vec<GpuInfo> {
        use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE};
        let Ok(factory) = (unsafe { CreateDXGIFactory1::<IDXGIFactory1>() }) else {
            return Vec::new();
        };
        let mut found = Vec::new();
        let mut index = 0;
        while let Ok(adapter) = unsafe { factory.EnumAdapters1(index) } {
            index += 1;
            let Ok(desc) = (unsafe { adapter.GetDesc1() }) else {
                continue;
            };
            // Rendu logiciel de Microsoft (« Basic Render Driver ») : pas une carte.
            if desc.Flags & (DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32) != 0 || desc.VendorId == 0x1414 {
                continue;
            }
            let end = desc.Description.iter().position(|c| *c == 0).unwrap_or(desc.Description.len());
            let name = String::from_utf16_lossy(&desc.Description[..end]).trim().to_string();
            let vram = desc.DedicatedVideoMemory as u64 / (1024 * 1024);
            let vendor = match desc.VendorId {
                0x10DE => "nvidia".to_string(),
                0x1002 | 0x1022 => "amd".to_string(),
                0x8086 => "intel".to_string(),
                _ => vendor_of(&name),
            };
            found.push(GpuInfo { name, vendor, vram_mb: Some(vram), dedicated: vram >= DEDICATED_MIN_MB });
        }
        found
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::{vendor_of, GpuInfo, DEDICATED_MIN_MB};

    pub fn ram_mb() -> Option<u64> {
        let text = std::fs::read_to_string("/proc/meminfo").ok()?;
        let line = text.lines().find(|l| l.starts_with("MemTotal:"))?;
        let kb: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
        Some(kb / 1024)
    }

    pub fn cpu_name() -> Option<String> {
        let text = std::fs::read_to_string("/proc/cpuinfo").ok()?;
        text.lines()
            .find(|l| l.starts_with("model name"))
            .and_then(|l| l.split_once(':'))
            .map(|(_, v)| v.trim().to_string())
    }

    pub fn gpus() -> Vec<GpuInfo> {
        let mut found = Vec::new();
        // Cartes NVIDIA : `nvidia-smi` donne le nom et la mémoire.
        if let Ok(output) = crate::core::process::command("nvidia-smi")
            .args(["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"])
            .output()
        {
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                if let Some((name, mem)) = line.rsplit_once(',') {
                    let vram = mem.trim().parse::<u64>().ok();
                    found.push(GpuInfo {
                        name: name.trim().to_string(),
                        vendor: "nvidia".to_string(),
                        vram_mb: vram,
                        dedicated: vram.unwrap_or(0) >= DEDICATED_MIN_MB,
                    });
                }
            }
        }
        // Cartes AMD : mémoire vidéo exposée par le pilote amdgpu.
        if let Ok(entries) = std::fs::read_dir("/sys/class/drm") {
            for entry in entries.flatten() {
                let device = entry.path().join("device");
                let Ok(total) = std::fs::read_to_string(device.join("mem_info_vram_total")) else {
                    continue;
                };
                let vram = total.trim().parse::<u64>().ok().map(|bytes| bytes / (1024 * 1024));
                let name = std::fs::read_to_string(device.join("product_name"))
                    .map(|n| n.trim().to_string())
                    .unwrap_or_else(|_| "Carte AMD".to_string());
                if found.iter().any(|g: &GpuInfo| g.name == name) {
                    continue;
                }
                found.push(GpuInfo {
                    vendor: vendor_of(&format!("amd {name}")),
                    name,
                    vram_mb: vram,
                    dedicated: vram.unwrap_or(0) >= DEDICATED_MIN_MB,
                });
            }
        }
        found
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::GpuInfo;

    fn sysctl(key: &str) -> Option<String> {
        let output = crate::core::process::command("sysctl").args(["-n", key]).output().ok()?;
        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        (!text.is_empty()).then_some(text)
    }

    pub fn ram_mb() -> Option<u64> {
        sysctl("hw.memsize")?.parse::<u64>().ok().map(|bytes| bytes / (1024 * 1024))
    }

    pub fn cpu_name() -> Option<String> {
        sysctl("machdep.cpu.brand_string")
    }

    pub fn gpus() -> Vec<GpuInfo> {
        Vec::new()
    }
}

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
mod platform {
    use super::GpuInfo;
    pub fn ram_mb() -> Option<u64> {
        None
    }
    pub fn cpu_name() -> Option<String> {
        None
    }
    pub fn gpus() -> Vec<GpuInfo> {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gpu(vram: u64) -> GpuInfo {
        GpuInfo { name: "GeForce RTX".into(), vendor: "nvidia".into(), vram_mb: Some(vram), dedicated: vram >= DEDICATED_MIN_MB }
    }

    #[test]
    fn tiers_follow_memory_cores_and_vram() {
        assert_eq!(tier(8 * 1024, 4, &[], false).0, HardwareTier::Low);
        assert_eq!(tier(16 * 1024, 8, &[], false).0, HardwareTier::Mid);
        assert_eq!(tier(8 * 1024, 4, &[gpu(6 * 1024)], false).0, HardwareTier::Mid);
        assert_eq!(tier(16 * 1024, 8, &[gpu(12 * 1024)], false).0, HardwareTier::High);
        assert_eq!(tier(16 * 1024, 8, &[], true).0, HardwareTier::High);
        assert_eq!(tier(64 * 1024, 16, &[], false).0, HardwareTier::High);
        // Puce intégrée : sa mémoire ne compte pas.
        let igpu = GpuInfo { name: "Intel UHD".into(), vendor: "intel".into(), vram_mb: Some(128), dedicated: false };
        assert_eq!(tier(8 * 1024, 4, &[igpu], false).0, HardwareTier::Low);
    }

    #[test]
    fn detection_runs_on_this_machine() {
        let info = detect();
        assert!(info.cores >= 1);
        assert!(!info.os.is_empty());
        assert!(!info.reasons.is_empty());
    }

    #[test]
    fn vendors_are_recognised_by_name() {
        assert_eq!(vendor_of("NVIDIA GeForce RTX 4070"), "nvidia");
        assert_eq!(vendor_of("AMD Radeon RX 7800 XT"), "amd");
        assert_eq!(vendor_of("Intel(R) Arc(TM) A770"), "intel");
    }
}
