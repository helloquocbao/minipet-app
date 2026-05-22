# MiniPet Desktop Client (Tauri v2) 💻🐾
The official desktop client for **MiniPet**, built with **Tauri v2**, **Rust**, and **Vite 6** / **TypeScript**. It brings animated pixel pets to life right on your screen.

---

## 🚀 Key Features

1. **Interactive Overlay**: Pets walk and run along the taskbar boundaries of your screen. Supports physics-based drag-and-drop actions.
2. **File Eating Action**: Drag any unwanted file onto your pet. The pet plays an animation and moves the file to your system's Recycle Bin / Trash.
3. **Local AI Chat Assistant**:
   - Integrates an offline AI chat bubble.
   - Powered by a local **`llama-server` sidecar** executing a GGUF language model (such as Llama-3 or Qwen-2) completely locally. No API key or internet required.
4. **Pomodoro Focus Timer**: Synchronized cycles. Your pet works, sleeps, and alerts you according to your Pomodoro configuration.
5. **Decentralized Sync**: Syncs with SUI testnet to fetch owned Pet NFTs and apply them as desktop skins.

---

## 🛠️ Tauri Architecture & Sidecar Setup

The Tauri app embeds Rust commands for file system interactions and executing llama-server:
- **Rust backend**: Handles custom boundary detection, starting sidecar processes, and native window behaviors (transparent, click-through, ignore cursor).
- **llama-server Sidecar**:
  - Requires placing a compatible sidecar binary inside `src-tauri/bin/` named `llama-server-<target-triple>`.
  - For macOS Apple Silicon (M1/M2/M3), it uses `llama-server-aarch64-apple-darwin`.

---

## 📦 Run & Build Instructions

### 1. Install System Requirements
Ensure you have the Rust compiler and Node.js setup:
- [Rust & Cargo](https://www.rust-lang.org/tools/install)
- [Tauri Prerequisites](https://tauri.app/v2/guides/start/prerequisites)

### 2. Configure Environment
Install npm dependencies (uses Vite 6 and esbuild overrides to prevent dev server vulnerabilities):
```bash
npm install
```

### 3. Run Development Dev Server
```bash
# Starts both Vite dev server and Tauri app window
npm run dev
# Or using the tauri CLI directly
npm run tauri dev
```

### 4. Build Bundled Installers
Creates production-ready installers (dmg, msi, deb, etc.):
```bash
npm run tauri build
```
The output installers will be saved in `src-tauri/target/release/bundle/`.
