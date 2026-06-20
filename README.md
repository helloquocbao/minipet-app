# MiniPet Desktop Client (Tauri v2) 💻🐾

The official desktop client for **MiniPet**, built with **Tauri v2**, **Rust**, and **Vite 6** / **TypeScript**. It brings animated pixel pets to life right on your screen with full AI agentic capabilities.

---

## 🚀 Key Features

### 🎮 Interactive Desktop Companion
- Pets walk and run along the taskbar/screen boundaries with physics-based gravity
- Drag-and-drop interactions, click to interact
- Multiple animation states: idle, run, greet, sleep, dizzy, hammer, and more (9 actions × 8 frames)

### 🧠 Local AI Chat (Offline LLM)
- **llama-server** engine auto-downloaded from HuggingFace on first use
- Fine-tuned **Qwen 2.5 0.5B** model trained on SUI documentation & smart contract data
- Fully offline — no API keys, no internet required after initial download
- Pet speaks via interactive chat bubbles

### 🛡️ Security Agent (On-chain Token Analyzer)
- **Event-driven clipboard monitoring**: Automatically detects when user copies a SUI address
- **Token safety analysis**: Checks TreasuryCap lock status (mint authority), UpgradeCap, supply data
- **Real-time verdict**: Pet warns about scam tokens/honeypots or confirms token safety
- **Account detection**: Distinguishes between token objects vs personal wallet addresses
- Randomized Vietnamese/English response pool for natural interaction

### 📊 Blockchain Monitor (Multi-Agent System)
Five concurrent monitoring agents with staggered polling intervals:

| Agent | Interval | Function |
|-------|----------|----------|
| **Balance & Gas Guardian** | Every tick | Tracks SUI balance, notifies on incoming/outgoing tx |
| **Phishing NFT Guardian** | Every 3 ticks | Scans owned objects for spam/scam NFTs with keyword detection |
| **DeFi & Gas Guardian** | Every 12 ticks | Warns when SUI < 0.75 (low gas risk) |
| **Idle Reminder** | Every 8 ticks | Engagement prompts based on inactivity |
| **Event Cursor Tracker** | Continuous | Maintains on-chain event pagination |

### 💹 Agent Trade Engine (Autonomous On-chain Trading)
- **Dedicated agent wallet**: Generates Ed25519 keypair for autonomous signing
- **EMA crossover strategy**: Monitors SUI/USD price from CoinGecko, calculates short/long EMA
- **Real on-chain execution**: Signs and submits transactions via SUI testnet RPC
- **Trade logging**: Records BUY/SELL/HOLD signals with tx digests
- **Dual wallet support**: Configure strategy independently for pet wallet vs agent wallet
- **Simulated mode**: Paper-trading simulation runs alongside real execution
- **Configurable**: Budget (SUI), cooldown (ms), slippage (%), strategy per wallet

### 🗂️ File Eating (Desktop Utility)
- Drag any file onto your pet → animated eating action → file moved to OS Trash
- Integrates with native macOS recycle bin via Rust commands

### ⏱️ Pomodoro Focus Timer
- Synchronized work/break cycles with pet animations
- Pet works (hammer animation) during focus, sleeps during break
- Audio/visual alerts on transitions
- Configurable session lengths (work/break minutes)

### 🔗 Blockchain Sync
- Syncs with SUI testnet to fetch owned Pet NFTs
- Applies NFT sprites as desktop skins
- Wallet connection via deep-link (`minipet://`) from web app

---

## 🏗️ Architecture

```
src/
├── renderer/
│   ├── overlay/          # Main pet overlay window (physics, animations, drag)
│   ├── blockchain/
│   │   ├── agent.ts      # SecurityAgent — clipboard monitor + token analyzer
│   │   ├── agent-trade.ts # AgentTradeEngine — real on-chain autonomous trading
│   │   ├── auto-trade.ts  # AutoTradeSimulator — paper trading simulation
│   │   └── monitor.ts     # SuiMonitor — multi-agent staggered polling system
│   ├── settings/         # Settings UI (pet config, pomodoro, trade config)
│   └── speech/           # Chat bubble system
├── shared/
│   ├── constants.ts      # SUI config, AI config, animation config
│   ├── i18n/             # Multi-language translations (EN, VI, FR, IT, KO)
│   └── types/            # TypeScript interfaces
├── lib/
│   └── tauri-api.ts      # Rust ↔ TypeScript IPC bridge
src-tauri/
├── src/
│   ├── commands.rs       # Rust commands (AI server, file eating, keypair gen)
│   ├── lib.rs            # Tauri plugin registration
│   └── window/           # Window management (overlay, settings)
```

---

## 📦 Run & Build

### Prerequisites
- [Rust & Cargo](https://www.rust-lang.org/tools/install)
- [Node.js 20+](https://nodejs.org/)
- [Tauri v2 Prerequisites](https://tauri.app/start/prerequisites/)

### Development
```bash
npm install
npm run tauri dev
```

### Production Build
```bash
npm run tauri build
```
Output: `src-tauri/target/release/bundle/` (.dmg for macOS)

### Release (GitHub Actions)
```bash
git tag v1.0.0
git push origin v1.0.0
```
Automatically builds and creates a GitHub Release draft.

---

## 🧠 AI Model & Engine (Auto-download)

Both the AI engine and model are downloaded on first use — no need to bundle manually:

| Component | Source | Size |
|-----------|--------|------|
| llama-server | [HuggingFace](https://huggingface.co/iamquocbao/minipet-qwen-model-SUI) | ~5.7 MB |
| Qwen 2.5 0.5B (GGUF) | [HuggingFace](https://huggingface.co/iamquocbao/minipet-qwen-model-SUI) | ~400 MB |

Stored in: `AppData/minipet/` (auto-created)

---

MIT © [QBao](mailto:lehoquocbao9@gmail.com)
