use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

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

pub async fn load_pet(folder: &Path) -> Option<LoadedPet> {
    let manifest_path = folder.join("pet.json");
    let data = tokio::fs::read_to_string(&manifest_path).await.ok()?;
    let mut manifest: PetManifest = serde_json::from_str(&data).ok()?;

    // Resolve spritesheet: try specified path, then .webp, then .png
    let spritesheet_name = manifest
        .spritesheet_path
        .clone()
        .unwrap_or_else(|| "spritesheet.webp".to_string());
    let mut spritesheet_path = folder.join(&spritesheet_name);

    if !spritesheet_path.exists() {
        spritesheet_path = folder.join("spritesheet.webp");
    }
    if !spritesheet_path.exists() {
        spritesheet_path = folder.join("spritesheet.png");
    }
    if !spritesheet_path.exists() {
        return None;
    }

    // Fill defaults
    if manifest.frame_size.is_none() {
        manifest.frame_size = Some(FrameSize {
            width: 192,
            height: 208,
        });
    }
    if manifest.columns.is_none() {
        manifest.columns = Some(8);
    }
    if manifest.rows.is_none() {
        manifest.rows = Some(9);
    }
    if manifest.slug.is_none() {
        manifest.slug = folder
            .file_name()
            .and_then(|n| n.to_str())
            .map(|s| s.to_string());
    }

    Some(LoadedPet {
        manifest,
        base_path: folder.to_path_buf(),
        spritesheet_path,
    })
}

pub async fn scan_directory(dir: &Path) -> Vec<LoadedPet> {
    let mut pets = vec![];
    let mut entries = match tokio::fs::read_dir(dir).await {
        Ok(e) => e,
        Err(_) => return pets,
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        if entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
            if let Some(pet) = load_pet(&entry.path()).await {
                pets.push(pet);
            }
        }
    }
    pets
}
