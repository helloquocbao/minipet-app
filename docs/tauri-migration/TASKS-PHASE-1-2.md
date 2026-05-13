# Tasks — Phase 1: Project Setup

---

## TASK-01: Scaffold Tauri Project
**Status**: ⬜ TODO
**Phase**: 1
**Depends on**: nothing
**Blocks**: TASK-02

### Goal
Tạo project Tauri v2 mới song song với Electron project, copy toàn bộ frontend assets.

### Prerequisites
```bash
# Cài Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# Cài Tauri CLI
cargo install tauri-cli --version "^2"

# Verify
cargo tauri --version  # phải >= 2.0.0
```

### Steps
```bash
# 1. Tạo project mới
cd /Users/sdj/VICENT-Project/minipet
npm create tauri-app@latest minipet-tauri -- --template vanilla-ts --manager npm

# 2. Copy frontend source
cp -r minipet-app/src/renderer minipet-tauri/src/
cp -r minipet-app/src/shared minipet-tauri/src/
cp -r minipet-app/src/assets minipet-tauri/src/

# 3. Copy icons vào src-tauri
cp minipet-app/src/assets/icons/icon.icns minipet-tauri/src-tauri/icons/
cp minipet-app/src/assets/icons/icon.ico minipet-tauri/src-tauri/icons/
cp minipet-app/src/assets/icons/icon.png minipet-tauri/src-tauri/icons/
```

### Vite Config (`vite.config.ts`)
```typescript
import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        overlay: resolve(__dirname, 'src/renderer/overlay/index.html'),
        settings: resolve(__dirname, 'src/renderer/settings/index.html'),
      },
    },
  },
  clearScreen: false,
  server: { port: 5173, strictPort: true },
})
```

### package.json scripts
```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "tauri": "tauri"
  },
  "dependencies": {
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-dialog": "^2",
    "@tauri-apps/plugin-fs": "^2"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2",
    "typescript": "~5.0.0",
    "vite": "^5"
  }
}
```

### Done Criteria
- [ ] `cd minipet-tauri && cargo tauri dev` chạy không lỗi
- [ ] Blank window xuất hiện
- [ ] `cargo build` trong `src-tauri/` thành công

---

## TASK-02: Configure tauri.conf.json
**Status**: ⬜ TODO
**Phase**: 1
**Depends on**: TASK-01
**Blocks**: TASK-03

### Goal
Cấu hình app metadata, bundle settings, permissions cho MiniPet.

### File: `src-tauri/tauri.conf.json`
```json
{
  "productName": "MiniPet",
  "version": "1.0.0",
  "identifier": "com.minipet.app",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5173",
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build"
  },
  "app": {
    "windows": [],
    "macOS": {
      "minimumSystemVersion": "10.15",
      "activationPolicy": "accessory"
    },
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": ["dmg", "app"],
    "icon": [
      "icons/icon.icns",
      "icons/icon.ico",
      "icons/icon.png"
    ],
    "resources": {
      "src/assets/default-pets": "default-pets",
      "src/assets/icons": "icons"
    },
    "macOS": {
      "minimumSystemVersion": "10.15",
      "frameworks": []
    }
  }
}
```

### File: `src-tauri/capabilities/default.json`
```json
{
  "identifier": "default",
  "description": "Default capabilities",
  "windows": ["*"],
  "permissions": [
    "core:default",
    "core:window:allow-set-ignore-cursor-events",
    "core:window:allow-set-always-on-top",
    "core:window:allow-set-position",
    "core:window:allow-set-size",
    "core:window:allow-show",
    "core:window:allow-hide",
    "core:window:allow-close",
    "core:window:allow-is-visible",
    "core:window:allow-set-decorations",
    "dialog:allow-open",
    "fs:allow-read-file",
    "fs:allow-write-file",
    "fs:allow-read-dir",
    "fs:allow-create-dir",
    "fs:allow-remove",
    "fs:allow-copy-file",
    "fs:allow-rename"
  ]
}
```

### Done Criteria
- [ ] `cargo tauri build --debug` không lỗi config
- [ ] App bundle có đúng tên "MiniPet"
- [ ] Dock icon ẩn trên macOS (activationPolicy: accessory)

---

## TASK-03: Setup Cargo.toml Dependencies
**Status**: ⬜ TODO
**Phase**: 1
**Depends on**: TASK-02
**Blocks**: TASK-04, TASK-05, TASK-06

### Goal
Khai báo đủ Rust dependencies cho toàn bộ project.

### File: `src-tauri/Cargo.toml`
```toml
[package]
name = "minipet"
version = "1.0.0"
edition = "2021"

[lib]
name = "minipet_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[dependencies]
tauri = { version = "2", features = ["tray-icon", "image-png", "macos-private-api"] }
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
tauri-plugin-autostart = "2"
tauri-plugin-single-instance = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
zip = "2"
trash = "5"
rand = "0.8"
uuid = { version = "1", features = ["v4"] }

[build-dependencies]
tauri-build = { version = "2", features = [] }

[profile.release]
opt-level = "z"      # Optimize for size
lto = true           # Link-time optimization
codegen-units = 1    # Better optimization
strip = true         # Strip debug symbols
panic = "abort"      # Smaller binary
```

### Done Criteria
- [ ] `cargo build` thành công
- [ ] Không có dependency conflict
- [ ] `cargo build --release` tạo binary nhỏ hơn debug

---

# Tasks — Phase 2: Core Backend

---

## TASK-04: Implement PetManager in Rust
**Status**: ⬜ TODO
**Phase**: 2
**Depends on**: TASK-03
**Blocks**: TASK-10

### Goal
Port `src/main/pet/pet-manager.ts` sang Rust. Đây là core module quản lý tất cả pet instances và settings.

### File: `src-tauri/src/pet/manager.rs`

### Structs (serde-compatible với frontend TypeScript types)
```rust
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PetInstance {
    pub id: String,
    pub slug: String,
    pub x: f64,
    pub y: f64,
    pub scale: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UserSettings {
    #[serde(rename = "activePets")]
    pub active_pets: Vec<PetInstance>,
    #[serde(rename = "activePetSlug")]
    pub active_pet_slug: Option<String>,
    pub scale: f64,
    #[serde(rename = "enableWalking")]
    pub enable_walking: bool,
    #[serde(rename = "enableNotifications")]
    pub enable_notifications: bool,
    #[serde(rename = "launchAtStartup")]
    pub launch_at_startup: bool,
    pub language: String,
    #[serde(rename = "lastX")]
    pub last_x: Option<f64>,
    #[serde(rename = "lastY")]
    pub last_y: Option<f64>,
}

impl Default for UserSettings {
    fn default() -> Self {
        Self {
            active_pets: vec![],
            active_pet_slug: None,
            scale: 1.0,
            enable_walking: true,
            enable_notifications: true,
            launch_at_startup: false,
            language: "en".to_string(),
            last_x: None,
            last_y: None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PetListItem {
    pub slug: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub description: String,
    #[serde(rename = "thumbnailPath")]
    pub thumbnail_path: String,
    #[serde(rename = "isActive")]
    pub is_active: bool,
    #[serde(rename = "isDefault")]
    pub is_default: bool,
}

pub struct PetManager {
    pub pets: Vec<super::loader::LoadedPet>,
    pub settings: UserSettings,
    pub pets_dir: PathBuf,
    pub settings_path: PathBuf,
    pub default_pet_slugs: Vec<String>,
}
```

### Implementation
```rust
impl PetManager {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            pets: vec![],
            settings: UserSettings::default(),
            pets_dir: app_data_dir.join("pets"),
            settings_path: app_data_dir.join("settings.json"),
            default_pet_slugs: vec![],
        }
    }

    pub async fn init(&mut self, resource_dir: &PathBuf) -> Result<(), String> {
        tokio::fs::create_dir_all(&self.pets_dir).await.map_err(|e| e.to_string())?;
        self.load_settings().await;
        self.copy_default_pets(resource_dir).await;
        self.pets = super::loader::PetLoader::scan_directory(&self.pets_dir).await;

        // Ensure at least one active pet
        if self.pets.len() > 0 && self.settings.active_pets.is_empty() {
            let slug = self.pets[0].manifest.slug.clone()
                .unwrap_or_else(|| "unknown".to_string());
            self.settings.active_pets.push(PetInstance {
                id: Uuid::new_v4().to_string(),
                slug: slug.clone(),
                x: 200.0 + rand::random::<f64>() * 200.0,
                y: 200.0 + rand::random::<f64>() * 200.0,
                scale: self.settings.scale,
            });
            self.settings.active_pet_slug = Some(slug);
            self.save_settings().await;
        }
        Ok(())
    }

    pub fn get_installed_pets(&self) -> Vec<PetListItem> { /* ... */ }
    pub fn get_pet_instance_config(&self, id: &str) -> Option<serde_json::Value> { /* ... */ }
    pub async fn spawn_pet(&mut self, slug: &str) -> Option<PetInstance> { /* ... */ }
    pub async fn remove_pet(&mut self, id: &str) { /* ... */ }
    pub fn get_spritesheet_url(&self, slug: &str) -> Option<String> { /* ... */ }
    pub fn get_settings(&self) -> UserSettings { self.settings.clone() }
    pub async fn update_settings(&mut self, patch: serde_json::Value) { /* ... */ }
    pub async fn update_instance_position(&mut self, id: &str, x: f64, y: f64) { /* ... */ }
    pub async fn import_pet(&mut self, source_path: &str) -> Result<Vec<PetListItem>, String> { /* ... */ }
    pub async fn delete_pet(&mut self, slug: &str) -> Result<Vec<PetListItem>, String> { /* ... */ }
    pub async fn eat_files(&self, paths: Vec<String>) -> Result<(), String> { /* ... */ }

    async fn copy_default_pets(&mut self, resource_dir: &PathBuf) { /* ... */ }
    async fn load_settings(&mut self) { /* ... */ }
    async fn save_settings(&self) { /* ... */ }
}
```

### State Registration (`lib.rs`)
```rust
use std::sync::Mutex;
pub struct AppState {
    pub pet_manager: Mutex<PetManager>,
    pub pomodoro: Mutex<PomodoroManager>,
}
```

### Done Criteria
- [ ] `cargo build` không lỗi
- [ ] `init()` load được 6 default pets
- [ ] `get_installed_pets()` trả về đúng danh sách
- [ ] `save_settings()` / `load_settings()` persist đúng JSON format

---

## TASK-05: Implement PetLoader in Rust
**Status**: ⬜ TODO
**Phase**: 2
**Depends on**: TASK-03
**Blocks**: TASK-04

### Goal
Port `src/main/pet/pet-loader.ts` sang Rust.

### File: `src-tauri/src/pet/loader.rs`

```rust
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FrameSize {
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AnimationConfig {
    pub row: u32,
    #[serde(rename = "frameCount")]
    pub frame_count: u32,
    pub fps: u32,
    pub r#loop: bool,
    #[serde(rename = "nextState")]
    pub next_state: Option<String>,
    #[serde(rename = "canMove")]
    pub can_move: Option<bool>,
    pub speed: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PetManifest {
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub description: String,
    pub slug: Option<String>,
    #[serde(rename = "spritesheetPath")]
    pub spritesheet_path: Option<String>,
    #[serde(rename = "frameSize")]
    pub frame_size: Option<FrameSize>,
    pub columns: Option<u32>,
    pub rows: Option<u32>,
    pub animations: Option<HashMap<String, AnimationConfig>>,
    pub author: Option<String>,
}

#[derive(Clone, Debug)]
pub struct LoadedPet {
    pub manifest: PetManifest,
    pub base_path: PathBuf,
    pub spritesheet_path: PathBuf,
}

pub struct PetLoader;

impl PetLoader {
    pub async fn load_pet(folder: &Path) -> Option<LoadedPet> {
        let manifest_path = folder.join("pet.json");
        let data = tokio::fs::read_to_string(&manifest_path).await.ok()?;
        let mut manifest: PetManifest = serde_json::from_str(&data).ok()?;

        // Resolve spritesheet: try .webp first, fallback .png
        let spritesheet_name = manifest.spritesheet_path
            .clone()
            .unwrap_or_else(|| "spritesheet.webp".to_string());
        let mut spritesheet_path = folder.join(&spritesheet_name);

        if !spritesheet_path.exists() {
            spritesheet_path = folder.join("spritesheet.png");
            if !spritesheet_path.exists() {
                return None;
            }
        }

        // Fill defaults
        if manifest.frame_size.is_none() {
            manifest.frame_size = Some(FrameSize { width: 192, height: 208 });
        }
        if manifest.columns.is_none() { manifest.columns = Some(8); }
        if manifest.rows.is_none() { manifest.rows = Some(9); }
        if manifest.slug.is_none() {
            manifest.slug = folder.file_name()
                .and_then(|n| n.to_str())
                .map(|s| s.to_string());
        }

        Some(LoadedPet { manifest, base_path: folder.to_path_buf(), spritesheet_path })
    }

    pub async fn scan_directory(dir: &Path) -> Vec<LoadedPet> {
        let mut pets = vec![];
        let mut entries = match tokio::fs::read_dir(dir).await {
            Ok(e) => e,
            Err(_) => return pets,
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            if entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
                if let Some(pet) = Self::load_pet(&entry.path()).await {
                    pets.push(pet);
                }
            }
        }
        pets
    }
}
```

### Done Criteria
- [ ] `scan_directory()` trả về 6 pets từ default-pets folder
- [ ] Fallback `.png` hoạt động khi không có `.webp`
- [ ] Default values được fill đúng

---

## TASK-06: Implement Settings Persistence
**Status**: ⬜ TODO
**Phase**: 2
**Depends on**: TASK-03
**Blocks**: TASK-04

### Goal
Implement load/save settings.json, đảm bảo tương thích với format Electron cũ.

### Logic trong `manager.rs`

```rust
async fn load_settings(&mut self) {
    match tokio::fs::read_to_string(&self.settings_path).await {
        Ok(data) => {
            if let Ok(parsed) = serde_json::from_str::<UserSettings>(&data) {
                self.settings = parsed;
                // Ensure active_pets is always a Vec
                return;
            }
        }
        Err(_) => {}
    }
    // Fallback to defaults
    self.settings = UserSettings::default();
    self.save_settings().await;
}

async fn save_settings(&self) {
    if let Ok(json) = serde_json::to_string_pretty(&self.settings) {
        let _ = tokio::fs::write(&self.settings_path, json).await;
    }
}
```

### JSON Format (phải match Electron format)
```json
{
  "activePets": [
    { "id": "abc123", "slug": "nukey", "x": 1200.0, "y": 800.0, "scale": 1.0 }
  ],
  "activePetSlug": "nukey",
  "scale": 1.0,
  "enableWalking": true,
  "enableNotifications": true,
  "launchAtStartup": false,
  "language": "en",
  "lastX": null,
  "lastY": null
}
```

### Done Criteria
- [ ] Settings load từ file JSON đúng
- [ ] Settings save ra file JSON đúng format
- [ ] Tương thích với settings.json từ Electron app cũ
- [ ] Fallback về default khi file không tồn tại hoặc corrupt
