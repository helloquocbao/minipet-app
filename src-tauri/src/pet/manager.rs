use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

use super::loader::{self, LoadedPet};

// Safe spawn position — center-ish of a typical 1920x1080 screen
const DEFAULT_X: f64 = 1400.0;
const DEFAULT_Y: f64 = 700.0;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PetInstance {
    pub id: String,
    pub slug: String,
    pub x: f64,
    pub y: f64,
    pub scale: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ZkLoginSession {
    pub jwt: String,
    #[serde(rename = "ephemeralPrivateKey")]
    pub ephemeral_private_key: String,
    pub randomness: String,
    #[serde(rename = "maxEpoch")]
    pub max_epoch: String,
    pub salt: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UserSettings {
    #[serde(rename = "activePets", default)]
    pub active_pets: Vec<PetInstance>,
    #[serde(rename = "activePetSlug")]
    pub active_pet_slug: Option<String>,
    #[serde(default = "default_position")]
    pub position: String,
    #[serde(default = "default_scale")]
    pub scale: f64,
    #[serde(rename = "enableWalking", default = "default_true")]
    pub enable_walking: bool,
    #[serde(rename = "autoStart", default)]
    pub auto_start: bool,
    #[serde(rename = "enableNotifications", default = "default_true")]
    pub enable_notifications: bool,
    #[serde(rename = "launchAtStartup", default)]
    pub launch_at_startup: bool,
    #[serde(rename = "lastX")]
    pub last_x: Option<f64>,
    #[serde(rename = "lastY")]
    pub last_y: Option<f64>,
    #[serde(default = "default_lang")]
    pub language: String,
    #[serde(rename = "suiAddress", default)]
    pub sui_address: String,
    #[serde(rename = "suiRpcUrl", default = "default_sui_rpc")]
    pub sui_rpc_url: String,
    #[serde(rename = "suiEnabled", default = "default_true")]
    pub sui_enabled: bool,
    #[serde(rename = "geminiApiKey", default)]
    pub gemini_api_key: String,
    #[serde(rename = "aiEnabled", default = "default_true")]
    pub ai_enabled: bool,
    #[serde(rename = "agentSecretKey", default)]
    pub agent_secret_key: String,
    #[serde(rename = "agentAddress", default)]
    pub agent_address: String,
    #[serde(rename = "walletMode", default = "default_wallet_mode")]
    pub wallet_mode: String,
    #[serde(rename = "zkLoginSession")]
    pub zklogin_session: Option<ZkLoginSession>,
    #[serde(rename = "fastTransferWallets", default, deserialize_with = "deserialize_fast_transfer_wallets")]
    pub fast_transfer_wallets: Vec<WhitelistWallet>,
    #[serde(default = "default_happiness")]
    pub happiness: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WhitelistWallet {
    pub alias: String,
    pub address: String,
}

fn deserialize_fast_transfer_wallets<'de, D>(deserializer: D) -> Result<Vec<WhitelistWallet>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum RawWallet {
        String(String),
        Struct(WhitelistWallet),
    }

    let raw_list: Vec<RawWallet> = Vec::deserialize(deserializer)?;
    let clean_list = raw_list
        .into_iter()
        .map(|item| match item {
            RawWallet::String(address) => WhitelistWallet {
                alias: "".to_string(),
                address,
            },
            RawWallet::Struct(w) => w,
        })
        .collect();
    Ok(clean_list)
}

fn default_happiness() -> u64 {
    100
}

fn default_wallet_mode() -> String {
    "agent".to_string()
}

fn default_position() -> String {
    "bottom-right".to_string()
}
fn default_scale() -> f64 {
    1.0
}
fn default_true() -> bool {
    true
}
fn default_lang() -> String {
    "en".to_string()
}
fn default_sui_rpc() -> String {
    "https://fullnode.mainnet.sui.io:443".to_string()
}

impl Default for UserSettings {
    fn default() -> Self {
        Self {
            active_pets: vec![],
            active_pet_slug: None,
            position: "bottom-right".to_string(),
            scale: 1.0,
            enable_walking: true,
            auto_start: false,
            enable_notifications: true,
            launch_at_startup: false,
            last_x: None,
            last_y: None,
            language: "en".to_string(),
            sui_address: "".to_string(),
            sui_rpc_url: "https://fullnode.mainnet.sui.io:443".to_string(),
            sui_enabled: true,
            gemini_api_key: "".to_string(),
            ai_enabled: true,
            agent_secret_key: "".to_string(),
            agent_address: "".to_string(),
            fast_transfer_wallets: vec![],
            happiness: 100,
            wallet_mode: "agent".to_string(),
            zklogin_session: None,
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
    pub pets: Vec<LoadedPet>,
    pub settings: UserSettings,
    pub pets_dir: PathBuf,
    pub settings_path: PathBuf,
    pub default_pet_slugs: Vec<String>,
    pub master_instance_id: Option<String>,
    pub is_dirty: bool,
    pub last_save_time: std::time::Instant,
    pub default_x: f64,
    pub default_y: f64,
}

impl PetManager {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            pets: vec![],
            settings: UserSettings::default(),
            pets_dir: app_data_dir.join("pets"),
            settings_path: app_data_dir.join("settings.json"),
            default_pet_slugs: vec![],
            master_instance_id: None,
            is_dirty: false,
            last_save_time: std::time::Instant::now(),
            default_x: DEFAULT_X,
            default_y: DEFAULT_Y,
        }
    }

    pub async fn init(
        &mut self,
        resource_dir: &std::path::Path,
        default_x: f64,
        default_y: f64,
    ) -> Result<(), String> {
        self.default_x = default_x;
        self.default_y = default_y;

        tokio::fs::create_dir_all(&self.pets_dir)
            .await
            .map_err(|e| e.to_string())?;

        self.load_settings().await;
        self.copy_default_pets(resource_dir).await;
        self.pets = loader::scan_directory(&self.pets_dir).await;

        // Retain only active pets that are either NFT pets or installed local pets
        let installed_slugs: std::collections::HashSet<String> = self.pets
            .iter()
            .filter_map(|p| p.manifest.slug.clone())
            .collect();
        self.settings.active_pets.retain(|inst| {
            inst.slug.starts_with("nft-") || installed_slugs.contains(&inst.slug)
        });

        // Sanitize saved positions — reset if outside visible screen area
        for inst in &mut self.settings.active_pets {
            // Use actual screen dimensions from default_x/default_y hints
            let max_x = (self.default_x * 2.0 + 320.0).min(3840.0); // Support up to 4K
            let max_y = (self.default_y * 2.0 + 320.0).min(2160.0);
            if inst.x < 0.0 || inst.x > max_x || inst.y < 0.0 || inst.y > max_y {
                inst.x = self.default_x;
                inst.y = self.default_y;
            }
        }

        // Ensure at least one active pet (prioritize 'lyra' as default)
        if !self.pets.is_empty() && self.settings.active_pets.is_empty() {
            let slug = self.pets
                .iter()
                .find(|p| p.manifest.slug.as_deref() == Some("lyra"))
                .or_else(|| self.pets.first())
                .and_then(|p| p.manifest.slug.clone())
                .unwrap_or_else(|| "unknown".to_string());
            self.settings.active_pets.push(PetInstance {
                id: Uuid::new_v4().to_string(),
                slug: slug.clone(),
                x: self.default_x,
                y: self.default_y,
                scale: self.settings.scale,
            });
            self.settings.active_pet_slug = Some(slug);
            self.save_settings().await;
        }

        // Elect Master: The first instance in active_pets
        self.enforce_wallet_restrictions();
        if let Some(first) = self.settings.active_pets.first() {
            self.master_instance_id = Some(first.id.clone());
        }

        Ok(())
    }

    fn enforce_wallet_restrictions(&mut self) {
        if self.settings.sui_address.is_empty() || !self.settings.sui_enabled {
            // Disconnected: Only Lyra is allowed
            self.settings.active_pets.retain(|p| p.slug == "lyra");
            if self.settings.active_pets.is_empty() {
                self.settings.active_pets.push(PetInstance {
                    id: uuid::Uuid::new_v4().to_string(),
                    slug: "lyra".to_string(),
                    x: self.default_x,
                    y: self.default_y,
                    scale: self.settings.scale,
                });
            }
            self.settings.active_pet_slug = Some("lyra".to_string());
        } else {
            // Connected: Both Lyra and NFT pets are allowed
            self.settings.active_pets.retain(|p| p.slug == "lyra" || p.slug.starts_with("nft-"));
            if self.settings.active_pets.is_empty() {
                self.settings.active_pets.push(PetInstance {
                    id: uuid::Uuid::new_v4().to_string(),
                    slug: "lyra".to_string(),
                    x: self.default_x,
                    y: self.default_y,
                    scale: self.settings.scale,
                });
                self.settings.active_pet_slug = Some("lyra".to_string());
            } else {
                self.settings.active_pet_slug = self.settings.active_pets.first().map(|p| p.slug.clone());
            }
        }
    }

    pub fn get_installed_pets(&self) -> Vec<PetListItem> {
        self.pets
            .iter()
            .map(|p| {
                let slug = p.manifest.slug.clone().unwrap_or_default();
                PetListItem {
                    slug: slug.clone(),
                    display_name: p.manifest.display_name.clone(),
                    description: p.manifest.description.clone(),
                    thumbnail_path: p.spritesheet_path.to_string_lossy().to_string(),
                    is_active: self.settings.active_pets.iter().any(|i| i.slug == slug),
                    is_default: self.default_pet_slugs.contains(&slug),
                }
            })
            .collect()
    }

    pub async fn fetch_nft_details(&self, object_id: &str) -> Result<serde_json::Value, String> {
        let client = reqwest::Client::new();
        let rpc_url = "https://fullnode.testnet.sui.io:443";
        let payload = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "sui_getObject",
            "params": [
                object_id,
                {
                    "showType": true,
                    "showContent": true,
                    "showDisplay": true
                }
            ]
        });

        let res = client
            .post(rpc_url)
            .json(&payload)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        
        if let Some(err) = json.get("error") {
            return Err(err.get("message").and_then(|m| m.as_str()).unwrap_or("RPC error").to_string());
        }

        Ok(json)
    }

    pub async fn get_pet_instance_config(&self, instance_id: &str) -> Option<serde_json::Value> {
        let instance = self
            .settings
            .active_pets
            .iter()
            .find(|i| i.id == instance_id)?;

        if instance.slug.starts_with("nft-") {
            let object_id = instance.slug.strip_prefix("nft-")?;
            let nft_details = self.fetch_nft_details(object_id).await.ok()?;
            let data = nft_details.get("result")?.get("data")?;
            let content = data.get("content")?;
            let fields = content.get("fields")?;

            let name = fields
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Unnamed NFT");
            let sprite_url = fields
                .get("sprite_url")
                .and_then(|v| v.as_str())
                .or_else(|| fields.get("image_url").and_then(|v| v.as_str()))
                .unwrap_or("");
            let level = fields
                .get("level")
                .map(|v| match v {
                    serde_json::Value::Number(n) => n.to_string(),
                    serde_json::Value::String(s) => s.clone(),
                    _ => "1".to_string(),
                })
                .unwrap_or_else(|| "1".to_string());
            let experience = fields
                .get("experience")
                .map(|v| match v {
                    serde_json::Value::Number(n) => n.to_string(),
                    serde_json::Value::String(s) => s.clone(),
                    _ => "0".to_string(),
                })
                .unwrap_or_else(|| "0".to_string());
            let perfection = fields
                .get("perfection_score")
                .map(|v| match v {
                    serde_json::Value::Number(n) => n.to_string(),
                    serde_json::Value::String(s) => s.clone(),
                    _ => "0".to_string(),
                })
                .unwrap_or_else(|| "0".to_string());
            let perfection_val = perfection.parse::<f64>().unwrap_or(0.0) / 100.0;
            let level_num = level.parse::<i32>().unwrap_or(1);
            let next_level_exp = level_num * 100;

            let manifest = serde_json::json!({
                "displayName": name,
                "description": format!("Level: {} (Exp: {}/{}) | Perfection: {:.2}%", level, experience, next_level_exp, perfection_val),
                "slug": instance.slug,
                "spritesheetPath": sprite_url,
                "frameSize": {
                    "width": 192,
                    "height": 208
                },
                "columns": 8,
                "rows": 9,
                "scale": instance.scale,
                "instanceId": instance.id
            });
            return Some(manifest);
        }

        let pet = self
            .pets
            .iter()
            .find(|p| p.manifest.slug.as_deref() == Some(&instance.slug))?;

        let mut config = serde_json::to_value(&pet.manifest).ok()?;
        let obj = config.as_object_mut()?;
        obj.insert("instanceId".to_string(), serde_json::json!(instance.id));
        obj.insert("slug".to_string(), serde_json::json!(instance.slug));
        obj.insert(
            "spritesheetPath".to_string(),
            serde_json::json!(pet.spritesheet_path.to_string_lossy().to_string()),
        );
        obj.insert("scale".to_string(), serde_json::json!(instance.scale));
        Some(config)
    }

    pub async fn spawn_pet(&mut self, slug: &str) -> Result<PetInstance, String> {
        // Clear existing pets since we only allow 1 active pet now
        self.settings.active_pets.clear();

        if !slug.starts_with("nft-") && !self
            .pets
            .iter()
            .any(|p| p.manifest.slug.as_deref() == Some(slug))
        {
            return Err("Pet not found".to_string());
        }

        let instance = PetInstance {
            id: Uuid::new_v4().to_string(),
            slug: slug.to_string(),
            x: self.default_x + rand::random::<f64>() * 200.0,
            y: self.default_y + rand::random::<f64>() * 200.0,
            scale: self.settings.scale,
        };

        self.settings.active_pets.push(instance.clone());
        self.settings.active_pet_slug = Some(slug.to_string());
        self.save_settings().await;
        Ok(instance)
    }

    pub async fn remove_pet(&mut self, instance_id: &str) -> Result<(), String> {
        if self.settings.active_pets.len() <= 1 {
            return Err("Cannot remove the last active pet".to_string());
        }
        self.settings.active_pets.retain(|i| i.id != instance_id);
        self.save_settings().await;
        Ok(())
    }

    pub fn get_spritesheet_url(&self, slug: &str) -> Option<String> {
        self.pets
            .iter()
            .find(|p| p.manifest.slug.as_deref() == Some(slug))
            .map(|p| p.spritesheet_path.to_string_lossy().to_string())
    }

    pub fn get_spritesheet_path(&self, slug: &str) -> Option<std::path::PathBuf> {
        self.pets
            .iter()
            .find(|p| p.manifest.slug.as_deref() == Some(slug))
            .map(|p| p.spritesheet_path.clone())
    }

    pub fn get_settings(&self) -> UserSettings {
        self.settings.clone()
    }

    pub async fn update_settings(&mut self, patch: serde_json::Value) {
        if let Some(obj) = patch.as_object() {
            if let Some(v) = obj.get("scale") {
                if let Some(s) = v.as_f64() {
                    self.settings.scale = s;
                    for p in &mut self.settings.active_pets {
                        p.scale = s;
                    }
                }
            }
            if let Some(v) = obj.get("enableWalking") {
                if let Some(b) = v.as_bool() {
                    self.settings.enable_walking = b;
                }
            }
            if let Some(v) = obj.get("enableNotifications") {
                if let Some(b) = v.as_bool() {
                    self.settings.enable_notifications = b;
                }
            }
            if let Some(v) = obj.get("launchAtStartup") {
                if let Some(b) = v.as_bool() {
                    self.settings.launch_at_startup = b;
                }
            }
            if let Some(v) = obj.get("language") {
                if let Some(s) = v.as_str() {
                    self.settings.language = s.to_string();
                }
            }
            if let Some(v) = obj.get("position") {
                if let Some(s) = v.as_str() {
                    self.settings.position = s.to_string();
                }
            }
            if let Some(v) = obj.get("suiEnabled") {
                if let Some(b) = v.as_bool() {
                    self.settings.sui_enabled = b;
                }
            }
            if let Some(v) = obj.get("suiAddress") {
                if let Some(s) = v.as_str() {
                    self.settings.sui_address = s.to_string();
                }
            }
            if let Some(v) = obj.get("suiRpcUrl") {
                if let Some(s) = v.as_str() {
                    self.settings.sui_rpc_url = s.to_string();
                }
            }
            if let Some(v) = obj.get("geminiApiKey") {
                if let Some(s) = v.as_str() {
                    self.settings.gemini_api_key = s.to_string();
                }
            }
            if let Some(v) = obj.get("aiEnabled") {
                if let Some(b) = v.as_bool() {
                    self.settings.ai_enabled = b;
                }
            }
            if let Some(v) = obj.get("agentSecretKey") {
                if let Some(s) = v.as_str() {
                    self.settings.agent_secret_key = s.to_string();
                }
            }
            if let Some(v) = obj.get("agentAddress") {
                if let Some(s) = v.as_str() {
                    self.settings.agent_address = s.to_string();
                }
            }
            if let Some(v) = obj.get("walletMode") {
                if let Some(s) = v.as_str() {
                    self.settings.wallet_mode = s.to_string();
                }
            }
            if let Some(v) = obj.get("zkLoginSession") {
                if v.is_null() {
                    self.settings.zklogin_session = None;
                } else {
                    if let Ok(session) = serde_json::from_value::<ZkLoginSession>(v.clone()) {
                        self.settings.zklogin_session = Some(session);
                    }
                }
            }
            if let Some(v) = obj.get("fastTransferWallets") {
                if let Ok(wallets) = serde_json::from_value::<Vec<WhitelistWallet>>(v.clone()) {
                    self.settings.fast_transfer_wallets = wallets;
                }
            }
        }
        self.enforce_wallet_restrictions();
        self.save_settings().await;
    }

    pub async fn update_instance_position(&mut self, id: &str, x: f64, y: f64) {
        if let Some(inst) = self.settings.active_pets.iter_mut().find(|i| i.id == id) {
            inst.x = x;
            inst.y = y;
            self.is_dirty = true;
        }

        // Debounce: Only save to disk if it's been > 5 seconds OR if specifically requested
        if self.is_dirty && self.last_save_time.elapsed() > std::time::Duration::from_secs(5) {
            self.save_settings().await;
        }
    }

    pub fn get_positions(&self) -> Vec<serde_json::Value> {
        self.settings
            .active_pets
            .iter()
            .map(|p| serde_json::json!({"id": p.id, "x": p.x, "y": p.y}))
            .collect()
    }

    pub async fn import_pet(&mut self, source_path: &str) -> Result<Vec<PetListItem>, String> {
        let mut source = PathBuf::from(source_path);

        // 1. Smart Detection: If a file is selected (and it's not a zip), try its parent folder
        let is_zip = source.extension().map(|e| e == "zip").unwrap_or(false);
        if source.is_file() && !is_zip {
            if let Some(parent) = source.parent() {
                source = parent.to_path_buf();
            }
        }

        let extract_path = if is_zip {
            let temp_dir =
                std::env::temp_dir().join(format!("minipet-import-{}", uuid::Uuid::new_v4()));
            tokio::fs::create_dir_all(&temp_dir)
                .await
                .map_err(|e| e.to_string())?;

            let file = std::fs::File::open(&source).map_err(|e| e.to_string())?;
            let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
            archive.extract(&temp_dir).map_err(|e| e.to_string())?;

            // Find pet.json recursively in ZIP
            find_pet_json_dir(&temp_dir)
                .await
                .ok_or("pet.json not found in ZIP")?
        } else {
            // Folder import validation: Must have exactly 2 files (pet.json + spritesheet)
            if !source.is_dir() {
                return Err("Selected path is not a valid directory or pet file".to_string());
            }

            let mut entries = tokio::fs::read_dir(&source)
                .await
                .map_err(|e| e.to_string())?;
            let mut file_count = 0;
            let mut has_json = false;
            let mut has_sprite = false;

            while let Ok(Some(entry)) = entries.next_entry().await {
                let ft = entry.file_type().await.map_err(|e| e.to_string())?;
                if ft.is_file() {
                    file_count += 1;
                    let name = entry.file_name().to_string_lossy().to_lowercase();
                    if name == "pet.json" {
                        has_json = true;
                    } else if name.ends_with(".png")
                        || name.ends_with(".webp")
                        || name.contains("spritesheet")
                    {
                        has_sprite = true;
                    }
                }
            }

            if !has_json {
                return Err("Thiếu file pet.json trong thư mục!".to_string());
            }
            if !has_sprite {
                return Err("Thiếu file hình ảnh (spritesheet.png/webp) trong thư mục!".to_string());
            }
            if file_count > 2 {
                return Err(format!("Thư mục dư file! Yêu cầu duy nhất 2 file (pet.json và hình ảnh), nhưng tìm thấy {} file.", file_count));
            }
            if file_count < 2 {
                return Err(
                    "Thư mục thiếu file! Yêu cầu đủ 2 file: pet.json và hình ảnh.".to_string(),
                );
            }

            source.clone()
        };

        // Validate pet.json exists in the final extract/source path
        let manifest_path = extract_path.join("pet.json");
        if !manifest_path.exists() {
            return Err("Không tìm thấy pet.json".to_string());
        }

        let data = tokio::fs::read_to_string(&manifest_path)
            .await
            .map_err(|e| e.to_string())?;
        let manifest: serde_json::Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;

        let mut slug = manifest
            .get("slug")
            .and_then(|v| v.as_str())
            .unwrap_or_else(|| {
                extract_path
                    .file_name()
                    .unwrap_or_default()
                    .to_str()
                    .unwrap_or("pet")
            })
            .to_string();

        // Prevent path traversal in slug
        slug = slug.replace("/", "").replace("\\", "").replace("..", "");

        // Ensure uniqueness - check both memory and filesystem
        let original_slug = slug.clone();
        let mut counter = 1;
        while self
            .pets
            .iter()
            .any(|p| p.manifest.slug.as_deref() == Some(&slug))
            || self.pets_dir.join(&slug).exists()
        {
            slug = format!("{}-{}", original_slug, counter);
            counter += 1;
        }

        let target = self.pets_dir.join(&slug);
        copy_dir_recursive(&extract_path, &target).await?;

        self.pets = loader::scan_directory(&self.pets_dir).await;
        Ok(self.get_installed_pets())
    }


    pub async fn eat_files(&self, paths: Vec<String>) -> Result<(), String> {
        for p in paths {
            trash::delete(&p).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    async fn copy_default_pets(&mut self, resource_dir: &std::path::Path) {
        // In dev mode, resource_dir points to target/debug/ which has no default-pets.
        // Try resource_dir first, then fall back to the source assets path.
        let source = {
            let r = resource_dir.join("default-pets");
            if r.exists() {
                r
            } else {
                // Walk up from resource_dir to find the workspace root
                let mut dir = resource_dir.to_path_buf();
                loop {
                    let candidate = dir.join("src").join("assets").join("default-pets");
                    if candidate.exists() {
                        break candidate;
                    }
                    if !dir.pop() {
                        return; // Not found
                    }
                }
            }
        };

        let mut entries = match tokio::fs::read_dir(&source).await {
            Ok(e) => e,
            Err(_) => return,
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            if entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
                let name = entry.file_name().to_string_lossy().to_string();
                self.default_pet_slugs.push(name.clone());
                let target = self.pets_dir.join(&name);
                if !target.exists() {
                    let _ = copy_dir_recursive(&entry.path(), &target).await;
                }
            }
        }
    }

    pub async fn load_settings(&mut self) {
        if let Ok(data) = tokio::fs::read_to_string(&self.settings_path).await {
            if let Ok(parsed) = serde_json::from_str::<UserSettings>(&data) {
                self.settings = parsed;
                return;
            }
        }
        self.settings = UserSettings::default();
        self.save_settings().await;
    }

    pub async fn save_settings(&mut self) {
        if let Ok(json) = serde_json::to_string_pretty(&self.settings) {
            if tokio::fs::write(&self.settings_path, json).await.is_ok() {
                self.is_dirty = false;
                self.last_save_time = std::time::Instant::now();
            }
        }
    }
}

async fn find_pet_json_dir(dir: &PathBuf) -> Option<PathBuf> {
    let mut entries = tokio::fs::read_dir(dir).await.ok()?;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if path.is_file() && path.file_name().map(|n| n == "pet.json").unwrap_or(false) {
            return Some(dir.clone());
        }
    }
    // Recurse into subdirectories
    let mut entries = tokio::fs::read_dir(dir).await.ok()?;
    while let Ok(Some(entry)) = entries.next_entry().await {
        if entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
            if let Some(found) = Box::pin(find_pet_json_dir(&entry.path())).await {
                return Some(found);
            }
        }
    }
    None
}

async fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> Result<(), String> {
    tokio::fs::create_dir_all(dst)
        .await
        .map_err(|e| e.to_string())?;
    let mut entries = tokio::fs::read_dir(src).await.map_err(|e| e.to_string())?;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
            Box::pin(copy_dir_recursive(&src_path, &dst_path)).await?;
        } else {
            tokio::fs::copy(&src_path, &dst_path)
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
