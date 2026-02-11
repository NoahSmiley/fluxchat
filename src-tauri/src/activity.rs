use serde::Serialize;
use sysinfo::System;

#[derive(Serialize, Clone)]
pub struct DetectedActivity {
    pub name: String,
    #[serde(rename = "activityType")]
    pub activity_type: String,
}

/// (executable name lowercase, display name, activity type)
static KNOWN_APPS: &[(&str, &str, &str)] = &[
    // FPS
    ("valorant.exe", "Valorant", "playing"),
    ("valorant-win64-shipping.exe", "Valorant", "playing"),
    ("cs2.exe", "Counter-Strike 2", "playing"),
    ("overwatch.exe", "Overwatch 2", "playing"),
    ("r5apex.exe", "Apex Legends", "playing"),
    ("destiny2.exe", "Destiny 2", "playing"),
    ("escapefromtarkov.exe", "Escape From Tarkov", "playing"),
    ("helldivers2.exe", "Helldivers 2", "playing"),
    ("pubg-win64-shipping.exe", "PUBG", "playing"),
    ("cod.exe", "Call of Duty", "playing"),
    // Battle Royale / Survival
    ("fortnitectlient-win64-shipping.exe", "Fortnite", "playing"),
    ("rustclient.exe", "Rust", "playing"),
    // MOBA / Strategy
    ("leagueoflegends.exe", "League of Legends", "playing"),
    ("dota2.exe", "Dota 2", "playing"),
    // Sandbox / Adventure
    ("minecraft.exe", "Minecraft", "playing"),
    ("terraria.exe", "Terraria", "playing"),
    ("starfield.exe", "Starfield", "playing"),
    ("eldenring.exe", "Elden Ring", "playing"),
    ("cyberpunk2077.exe", "Cyberpunk 2077", "playing"),
    ("baldur.exe", "Baldur's Gate 3", "playing"),
    ("bg3.exe", "Baldur's Gate 3", "playing"),
    ("bg3_dx11.exe", "Baldur's Gate 3", "playing"),
    ("palworld-win64-shipping.exe", "Palworld", "playing"),
    // Sports / Racing
    ("rocketleague.exe", "Rocket League", "playing"),
    ("forzahorizon5.exe", "Forza Horizon 5", "playing"),
    // GTA
    ("gta5.exe", "Grand Theft Auto V", "playing"),
    ("gta6.exe", "Grand Theft Auto VI", "playing"),
    // Roblox
    ("robloxplayerbeta.exe", "Roblox", "playing"),
    // Fighting
    ("tekken 8.exe", "Tekken 8", "playing"),
    // Simulation
    ("startupsimulator.exe", "Startup Simulator", "playing"),
    // Music
    ("spotify.exe", "Spotify", "listening"),
];

pub fn detect_activity() -> Option<DetectedActivity> {
    let mut sys = System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    for process in sys.processes().values() {
        let exe_name = process.name().to_string_lossy().to_lowercase();
        for &(known_exe, display_name, activity_type) in KNOWN_APPS {
            if exe_name == known_exe {
                return Some(DetectedActivity {
                    name: display_name.to_string(),
                    activity_type: activity_type.to_string(),
                });
            }
        }
    }

    None
}
