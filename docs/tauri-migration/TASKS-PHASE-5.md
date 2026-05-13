# Tasks — Phase 5: Polish & Ship

---

## TASK-15: File Eating (Trash) Feature
**Status**: ⬜ TODO
**Phase**: 5
**Depends on**: TASK-13
**Blocks**: TASK-17

### Goal
Drag & drop file vào pet → move to Trash. Port từ `shell.trashItem()` Electron sang `trash` crate Rust.

### Rust: `eat_files` trong `manager.rs`
```rust
pub async fn eat_files(&self, paths: Vec<String>) -> Result<(), String> {
    for path in &paths {
        trash::delete(path).map_err(|e| format!("Failed to trash {}: {}", path, e))?;
    }
    Ok(())
}
```

### Tauri Capability cần thêm
Trong `src-tauri/capabilities/default.json`:
```json
"fs:allow-remove",
"fs:scope-app-data"
```

### Frontend: `overlay.ts` drop handler
Phần này giữ nguyên logic, chỉ đổi API call:
```typescript
// TRƯỚC
const result = await window.electronAPI.eatFile(allPaths)

// SAU
await tauriAPI.eatFile(allPaths)
```

### Lấy file path từ drop event trong Tauri
Tauri WebView trên macOS nhận drop event khác Electron:
```typescript
// Trong handleDrop:
const allPaths: string[] = []
for (let i = 0; i < files.length; i++) {
  const file = files[i]
  // Tauri: file.path có sẵn từ drop event
  const filePath = (file as any).path
  if (filePath) allPaths.push(filePath)
}
```

### Done Criteria
- [ ] Drag file từ Finder vào pet → file vào Trash
- [ ] Drag folder vào pet → folder vào Trash
- [ ] Drag nhiều file cùng lúc → tất cả vào Trash
- [ ] Pet play eat animation khi drop
- [ ] Speech bubble hiện eating text
- [ ] Click-through restore đúng sau khi drop

---

## TASK-16: Pet Import (ZIP/Folder) Feature
**Status**: ⬜ TODO
**Phase**: 5
**Depends on**: TASK-13, TASK-14
**Blocks**: TASK-17

### Goal
Import pet từ ZIP file hoặc folder. Port từ `importPet()` trong `pet-manager.ts`.

### Rust: `import_pet` command trong `commands.rs`
```rust
#[tauri::command]
pub async fn import_pet(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<crate::pet::manager::PetListItem>, String> {
    use tauri_plugin_dialog::DialogExt;

    // 1. Show file dialog
    let file_path = app.dialog()
        .file()
        .add_filter("MiniPet Files", &["zip", "json"])
        .add_filter("All Files", &["*"])
        .blocking_pick_file();

    let source_path = match file_path {
        Some(p) => p.to_string(),
        None => return Ok(state.pet_manager.lock().unwrap().get_installed_pets()),
    };

    // 2. Delegate to PetManager
    state.pet_manager.lock().unwrap()
        .import_pet(&source_path).await
}
```

### Rust: `import_pet` trong `manager.rs`
```rust
pub async fn import_pet(&mut self, source_path: &str) -> Result<Vec<PetListItem>, String> {
    let path = std::path::Path::new(source_path);
    let is_zip = source_path.to_lowercase().ends_with(".zip");

    let extract_path = if is_zip {
        // Extract ZIP to temp dir
        let temp_dir = std::env::temp_dir()
            .join(format!("minipet-import-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&temp_dir).await
            .map_err(|e| e.to_string())?;

        let zip_data = std::fs::read(source_path).map_err(|e| e.to_string())?;
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(zip_data))
            .map_err(|e| e.to_string())?;
        archive.extract(&temp_dir).map_err(|e| e.to_string())?;

        // Find pet.json inside extracted content
        find_pet_json_dir(&temp_dir).await
            .ok_or("pet.json not found in ZIP")?
    } else if source_path.to_lowercase().ends_with(".json") {
        // If pet.json selected, use parent dir
        path.parent().unwrap_or(path).to_path_buf()
    } else {
        path.to_path_buf()
    };

    // Validate pet.json exists
    let manifest_path = extract_path.join("pet.json");
    if !manifest_path.exists() {
        return Err("pet.json not found".to_string());
    }

    // Read slug from manifest
    let manifest_data = tokio::fs::read_to_string(&manifest_path).await
        .map_err(|e| e.to_string())?;
    let manifest: serde_json::Value = serde_json::from_str(&manifest_data)
        .map_err(|e| e.to_string())?;

    let mut slug = manifest.get("slug")
        .or(manifest.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or_else(|| extract_path.file_name()
            .and_then(|n| n.to_str()).unwrap_or("unknown"))
        .to_string();

    // Ensure unique slug
    let original_slug = slug.clone();
    let mut counter = 1;
    while self.pets.iter().any(|p| p.manifest.slug.as_deref() == Some(&slug)) {
        slug = format!("{}-{}", original_slug, counter);
        counter += 1;
    }

    // Copy to pets dir
    let target = self.pets_dir.join(&slug);
    copy_dir_recursive(&extract_path, &target).await
        .map_err(|e| e.to_string())?;

    // Rescan
    self.pets = super::loader::PetLoader::scan_directory(&self.pets_dir).await;
    Ok(self.get_installed_pets())
}

async fn find_pet_json_dir(dir: &std::path::Path) -> Option<std::path::PathBuf> {
    let mut entries = tokio::fs::read_dir(dir).await.ok()?;
    while let Ok(Some(entry)) = entries.next_entry().await {
        if entry.file_name() == "pet.json" {
            return Some(dir.to_path_buf());
        }
        if entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
            if let Some(found) = find_pet_json_dir(&entry.path()).await {
                return Some(found);
            }
        }
    }
    None
}

async fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    tokio::fs::create_dir_all(dst).await?;
    let mut entries = tokio::fs::read_dir(src).await?;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let dst_path = dst.join(entry.file_name());
        if entry.file_type().await?.is_dir() {
            Box::pin(copy_dir_recursive(&entry.path(), &dst_path)).await?;
        } else {
            tokio::fs::copy(entry.path(), dst_path).await?;
        }
    }
    Ok(())
}
```

### Done Criteria
- [ ] Import từ ZIP file hoạt động
- [ ] Import từ folder hoạt động
- [ ] Import từ pet.json file (dùng parent dir) hoạt động
- [ ] Slug unique khi import trùng tên
- [ ] Pet xuất hiện trong gallery sau import
- [ ] Delete imported pet hoạt động (default pets không xóa được)

---

## TASK-17: End-to-End Testing
**Status**: ⬜ TODO
**Phase**: 5
**Depends on**: TASK-15, TASK-16
**Blocks**: TASK-18

### Manual Test Checklist

#### Startup
- [ ] App khởi động, pet xuất hiện đúng vị trí cũ
- [ ] Dock icon ẩn trên macOS
- [ ] System tray icon hiện
- [ ] Không có console error

#### Pet Animation
- [ ] idle animation chạy loop
- [ ] walk animation + window di chuyển
- [ ] sleep animation sau 20-40 giây idle
- [ ] Transition idle → walk → idle đúng

#### Mouse Interaction
- [ ] Click 1 lần → happy animation + speech bubble
- [ ] Click 2 lần → jump animation
- [ ] Click 3 lần → run animation + window di chuyển nhanh
- [ ] Right-click → Settings window mở
- [ ] Hover → click-through tắt (có thể click pet)
- [ ] Mouse leave → click-through bật (click xuyên qua)

#### Drag & Drop
- [ ] Drag pet → window di chuyển theo chuột
- [ ] Drop pet → vị trí lưu vào settings
- [ ] Drag file từ Finder vào pet → eat animation + file vào Trash
- [ ] Drag folder vào pet → folder vào Trash
- [ ] Drag nhiều file → tất cả vào Trash

#### Settings Window
- [ ] Pet gallery hiện đủ 6 default pets
- [ ] Click pet card → spawn pet mới
- [ ] Tối đa 5 pets, alert khi vượt
- [ ] Remove pet button → pet biến mất (giữ ít nhất 1)
- [ ] Scale slider 0.5x → 2.0x → pet resize realtime
- [ ] Walking toggle OFF → pet dừng di chuyển
- [ ] Walking toggle ON → pet đi lại
- [ ] Language select → tất cả text đổi ngôn ngữ
- [ ] Import pet (ZIP) → pet xuất hiện trong gallery
- [ ] Import pet (folder) → pet xuất hiện trong gallery
- [ ] Delete imported pet → biến mất khỏi gallery
- [ ] Delete default pet → không cho phép (hoặc ẩn nút)
- [ ] Ping Pet button → tất cả pets happy + speech

#### Pomodoro
- [ ] Start 25/5 → timer đếm ngược
- [ ] Pause → timer dừng
- [ ] Reset → về 25:00
- [ ] Standard button → reset về 25/5
- [ ] Hết focus session → alarm animation + speech "Time for a break!"
- [ ] Hết break session → alarm animation + speech "Back to work!"
- [ ] Click pet khi alarm → alarm dừng

#### System Tray
- [ ] Right-click tray → menu hiện
- [ ] "Show/Hide Pet" → toggle tất cả overlay windows
- [ ] "Settings..." → mở settings window
- [ ] "Quit MiniPet" → app thoát hoàn toàn

#### Persistence
- [ ] Đổi scale → restart app → scale giữ nguyên
- [ ] Di chuyển pet → restart app → pet ở đúng vị trí
- [ ] Đổi language → restart app → language giữ nguyên
- [ ] Spawn thêm pet → restart app → đủ số pets

#### Intelligence (macOS only)
- [ ] Mở VS Code → pet comment về coding sau 30-60s
- [ ] Mở YouTube → pet comment về video
- [ ] 12 giờ trưa → pet comment về lunch (10% chance)

#### Multi-Pet
- [ ] Spawn 2 pets → cả 2 animate độc lập
- [ ] Spawn 5 pets → tối đa, không spawn thêm
- [ ] Remove 1 pet → còn 4
- [ ] Pomodoro alarm → tất cả pets alarm cùng lúc
- [ ] Ping → tất cả pets happy cùng lúc

---

## TASK-18: Build & Package Optimization
**Status**: ⬜ TODO
**Phase**: 5
**Depends on**: TASK-17
**Blocks**: nothing (final task)

### Goal
Build DMG tối ưu, verify size < 15MB, test install trên máy sạch.

### Build Command
```bash
cd minipet-tauri
cargo tauri build
```

### Cargo.toml Release Profile (đã có từ TASK-03)
```toml
[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
strip = true
panic = "abort"
```

### Verify Build Size
```bash
du -sh src-tauri/target/release/bundle/dmg/*.dmg
# Target: < 15MB
```

### macOS Distribution Note
Nếu không có Apple Developer cert, user cần chạy:
```bash
sudo xattr -cr /Applications/MiniPet.app
```
Thêm vào README.

### Final Checklist
- [ ] `cargo tauri build` thành công không lỗi
- [ ] DMG size < 15MB
- [ ] Install DMG trên máy sạch → app chạy
- [ ] Tất cả features trong TASK-17 checklist pass
- [ ] README cập nhật hướng dẫn install Tauri version
- [ ] Electron source giữ nguyên trong `minipet-app/` (không xóa)
