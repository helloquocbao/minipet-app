import { SpriteRenderer } from "./engine/sprite-renderer";
import { AnimationController } from "./engine/animation-controller";
import { PetStateMachine } from "./engine/pet-state-machine";
import { PETDEX_SPRITE, INTERACTION } from "../../shared/constants";
import { translations, Language } from "../../shared/i18n/translations";
import { SuiMonitor } from "../blockchain/monitor";
import {
  getAllWebviewWindows,
  getCurrentWebviewWindow,
} from "@tauri-apps/api/webviewWindow";
import { SecurityAgent } from "../blockchain/agent";
import { AutoTradeSimulator } from "../blockchain/auto-trade";
import { AgentTradeEngine } from "../blockchain/agent-trade";
import {
  DesiredTradeExecutor,
  type DesiredTradeConfig,
} from "../blockchain/desired-trade";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";

let statusAlarming = false;
let currentScale = 1.0;
let isSpeechVisible = false;
let speechTimeout: NodeJS.Timeout | null = null;
let currentLanguage: Language = "en";
let instanceId: string | null = null;
let lastGlobalSpeechTime = 0;
let controller: AnimationController;
let stateMachine: PetStateMachine;

/** Get a translated string with EN fallback. Supports {placeholder} replacement. */
function tt(key: string, replacements?: Record<string, string>): string {
  const t = translations[currentLanguage] || translations["en"];
  let text = t[key] || (translations["en"] as any)[key] || key;
  if (replacements) {
    for (const [k, v] of Object.entries(replacements)) {
      text = text.replace(`{${k}}`, v);
    }
  }
  return text;
}
let currentSpeechText = "";
let suiMonitor: SuiMonitor | null = null;
let securityAgent: SecurityAgent | null = null;
let autoTradeSimulator: AutoTradeSimulator | null = null;
let agentTradeEngine: AgentTradeEngine | null = null;
let desiredTradeExecutor: DesiredTradeExecutor | null = null;
let isMasterInstance = false;
let currentActivePets: any[] = [];
let speechWindowRef: any = null;
let lastContextKey = "";
let lastCommentTime = 0;
let activePetConfig: any = null;
let isChatActive = false;
let isAnyChatActive = false;
let pendingWalletSyncAddress = "";
let isSuggestingWalletSync = false;
let pendingSyncUrl = "";

/** Strict Sui address check: 0x + exactly 64 hex chars. */
function isValidSuiAddress(addr: unknown): addr is string {
  return typeof addr === "string" && /^0x[0-9a-fA-F]{64}$/.test(addr);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
let cachedSettings: any = null;

async function executeTransactionWithWallet(
  client: any,
  transaction: any,
  savedSettings: any,
): Promise<any> {
  // Determine which wallet to use from user's dropdown (persisted in localStorage)
  let walletChoice = localStorage.getItem('minipet-trade-wallet') || 'agent';
  const zkLoginSession = savedSettings.zkLoginSession;

  // Auto-fallback: if agent selected but no key, use zklogin if available
  if (walletChoice === 'agent' && !savedSettings.agentSecretKey && zkLoginSession) {
    walletChoice = 'zklogin';
  }

  // SECURITY: never log the zkLogin session — it contains the ephemeral
  // private key and JWT. Log only a non-sensitive presence flag.
  console.warn("[SignTx] walletChoice:", walletChoice, "zkSession:", !!zkLoginSession);

  if (walletChoice === 'zklogin') {
    if (!zkLoginSession) {
      throw new Error("zkLogin wallet selected but signing session is missing. Please switch to Agent Wallet in Settings, or re-sync via Google login.");
    }
    if (!zkLoginSession.ephemeralPrivateKey || !zkLoginSession.jwt || !zkLoginSession.randomness || !zkLoginSession.maxEpoch) {
      throw new Error(`zkLogin session incomplete. Missing fields. Please re-sync via Google login. Got: ${JSON.stringify(Object.keys(zkLoginSession))}`);
    }
    if (!savedSettings.suiAddress) {
      throw new Error("SUI address not found in settings. Please re-sync wallet.");
    }
    {
      const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519");
      const { getExtendedEphemeralPublicKey, getZkLoginSignature } = await import("@mysten/sui/zklogin");
      const ephemeralKeypair = Ed25519Keypair.fromSecretKey(zkLoginSession.ephemeralPrivateKey);
      const epk = getExtendedEphemeralPublicKey(ephemeralKeypair.getPublicKey());
      const proverResponse = await fetch("https://api.enoki.mystenlabs.com/v1/zklogin/zkp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer enoki_public_b1c00104f51636649e30132176038cd8",
          "zklogin-jwt": zkLoginSession.jwt,
        },
        body: JSON.stringify({
          network: "testnet",
          ephemeralPublicKey: epk,
          maxEpoch: parseInt(zkLoginSession.maxEpoch),
          randomness: zkLoginSession.randomness,
        }),
      });
      if (!proverResponse.ok) throw new Error(`Enoki ZKP failed: ${await proverResponse.text()}`);
      const enokiResp = await proverResponse.json();
      const zkProof = enokiResp.data || enokiResp;

      transaction.setSender(savedSettings.suiAddress);
      const txBytes = await transaction.build({ client });
      const { signature: ephSig } = await ephemeralKeypair.signTransaction(txBytes);
      const zkSig = getZkLoginSignature({ inputs: zkProof, maxEpoch: parseInt(zkLoginSession.maxEpoch), userSignature: ephSig });
      return await client.executeTransactionBlock({ transactionBlock: txBytes, signature: zkSig, options: { showEffects: true, showEvents: true } });
    }
  }

  // Agent wallet (or fallback from zkLogin)
  if (!savedSettings.agentSecretKey) {
    throw new Error("No wallet available to sign. Generate an Agent wallet in Settings or sync zkLogin via Google.");
  }
  const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519");
  const secretBytes = Uint8Array.from(atob(savedSettings.agentSecretKey), (c) => c.charCodeAt(0));
  const agentKeypair = Ed25519Keypair.fromSecretKey(secretBytes);
  const agentAddress = agentKeypair.getPublicKey().toSuiAddress();
  const bal: any = await client.getBalance({ owner: agentAddress, coinType: "0x2::sui::SUI" });
  const balSui = Number(BigInt(bal.totalBalance || "0")) / 1_000_000_000;
  if (balSui < 0.01) {
    if (walletChoice === 'zklogin') {
      throw new Error(`zkLogin session not available. Fell back to Agent wallet but it has no SUI (${balSui.toFixed(4)}). Either sync Google zkLogin properly or fund Agent wallet.`);
    }
    throw new Error(`Agent wallet has insufficient SUI (${balSui.toFixed(4)}). Fund it with testnet SUI first.`);
  }
  transaction.setSender(agentAddress);
  const txBytes = await transaction.build({ client });
  const { signature } = await agentKeypair.signTransaction(txBytes);
  return await client.executeTransactionBlock({ transactionBlock: txBytes, signature, options: { showEffects: true, showEvents: true } });
}

async function getOrCreateSpeechWindow() {
  if (speechWindowRef) return speechWindowRef;
  const label = `speech-${instanceId}`;

  const allWindows = await getAllWebviewWindows();
  let win = allWindows.find((w) => w.label === label);

  if (!win) {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    win = new WebviewWindow(label, {
      url: `renderer/speech/index.html?id=${instanceId}`,
      transparent: true,
      decorations: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      width: 260,
      height: 160,
      shadow: false,
    });
  }
  // Only set if not already set by a concurrent call
  if (!speechWindowRef) {
    speechWindowRef = win;
  }
  return speechWindowRef;
}

async function syncSpeechWindowPosition() {
  if (!speechWindowRef || !isSpeechVisible) return;
  const pos = window.electronAPI.getLogicalPosition();
  if (pos.x === null || pos.y === null) return;

  const safeScale = Number(currentScale) || 1.0;
  const petWidth = Math.ceil(PETDEX_SPRITE.FRAME_WIDTH * safeScale);

  const speechW = 260;
  const speechH = 160;
  const newX = pos.x + petWidth / 2 - speechW / 2;
  const newY = pos.y - speechH + 20;

  const { LogicalPosition } = await import("@tauri-apps/api/window");
  await speechWindowRef.setPosition(new LogicalPosition(newX, newY));
}

function isChosenToSpeak(seedStr: string): boolean {
  if (!currentActivePets || currentActivePets.length === 0) return true;
  const sortedIds = currentActivePets.map((p) => p.id).sort();
  const myIndex = sortedIds.indexOf(instanceId ?? "");
  if (myIndex === -1) return true;

  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = (hash << 5) - hash + seedStr.charCodeAt(i);
    hash |= 0;
  }
  const targetIndex = Math.abs(hash) % sortedIds.length;
  return myIndex === targetIndex;
}

/**
 * Helper to pick a random item from an array using cryptographically strong random values
 * to ensure independence across multiple WebView instances.
 */
function pickUniqueRandom(opt: string | string[]): string {
  if (!Array.isArray(opt)) return opt;
  if (opt.length === 0) return "";

  const array = new Uint32Array(1);
  window.crypto.getRandomValues(array);
  const randomIndex = array[0] % opt.length;

  return opt[randomIndex];
}

async function confirmSync(url: string) {
  try {
    const parsed = new URL(url);
    const address = parsed.searchParams.get("address");
    if (!address) return;
    const api = (window as any).electronAPI;
    if (!api) return;

    const zkloginPayloadBase64 = parsed.searchParams.get("zkloginPayload");
    let zkLoginSession = null;
    if (zkloginPayloadBase64) {
      try {
        const decoded = atob(zkloginPayloadBase64);
        zkLoginSession = JSON.parse(decoded);
      } catch (err) {
        console.error("Failed to parse zkloginPayload:", err);
      }
    }

    const updateObj: any = {
      suiAddress: address,
      suiEnabled: true,
      walletMode: zkLoginSession ? "zklogin" : "extension",
    };
    if (zkLoginSession) {
      updateObj.zkLoginSession = zkLoginSession;
    }
    await api.updateSettings(updateObj);

    if (zkLoginSession) {
      showSpeech("Wallet synced with full signing session! Ready for transactions.", 5000, true, "System");
    } else {
      showSpeech("Wallet address synced (view-only). For transactions, sync via Google login.", 6000, true, "System");
    }
    setTimeout(() => window.location.reload(), 2500);
  } catch (err) {
    console.error("[Overlay] confirmSync failed:", err);
    showSpeech("Wallet sync failed.", 4000, true, "System");
  }
}

async function handleDeepLinkUrl(url: string) {
  console.warn("[DeepLink] Received URL:", url);
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "minipet:" && parsed.host === "sync") {
      const address = parsed.searchParams.get("address");
      if (address && address.startsWith("0x")) {
        const api = (window as any).electronAPI;
        if (api) {
          // Skip if same address AND already has zkLoginSession (prevent reload loop)
          const settings = await api.getSettings();
          const incomingHasSession = !!parsed.searchParams.get("zkloginPayload");
          if (
            settings &&
            settings.suiAddress === address &&
            settings.suiEnabled &&
            settings.zkLoginSession &&
            !incomingHasSession
          ) {
            return;
          }

          // Store pending sync and ask user to confirm by clicking pet
          pendingSyncUrl = url;
          const shortAddr = address.slice(0, 6) + "..." + address.slice(-4);
          showSpeech(`Sync wallet ${shortAddr}? Click me to confirm!`, 15000, true, "System");
        }
      }
    }
  } catch (err) {
    console.error("[Overlay] Failed to parse deep link URL:", err);
    showSpeech("Wallet sync failed. Please try again from browser.", 5000, true, "System");
  }
}

/**
 * Initializes the overlay pet instance.
 */
async function init(): Promise<void> {
  // Setup Tauri API shim before any window.electronAPI calls
  const { setupElectronShim } = await import("../../lib/electron-shim");
  setupElectronShim();

  // Initialize Deep Link Listener
  try {
    void getCurrent()
      .then((urls) => {
        if (urls && urls.length > 0) {
          void handleDeepLinkUrl(urls[0]);
        }
      })
      .catch(console.error);

    void onOpenUrl((urls) => {
      if (urls && urls.length > 0) {
        void handleDeepLinkUrl(urls[0]);
      }
    }).catch(console.error);

    // Lắng nghe deep link từ single-instance (khi app đang chạy)
    const api = (window as any).electronAPI;
    if (api && api.onCustomEvent) {
      api.onCustomEvent("single-instance://deep-link", (url: string) => {
        void handleDeepLinkUrl(url);
      });
    }

    // Lắng nghe gợi ý đồng bộ ví từ clipboard (do SecurityAgent gửi qua)
    if (api && api.onCustomEvent) {
      api.onCustomEvent("wallet:suggest-sync", (data: any) => {
        if (data && data.address) {
          pendingWalletSyncAddress = data.address;
          isSuggestingWalletSync = true;
          // Tự động clear sau 20 giây nếu người dùng không click Pet
          setTimeout(() => {
            if (pendingWalletSyncAddress === data.address) {
              pendingWalletSyncAddress = "";
              isSuggestingWalletSync = false;
            }
          }, 20000);
        }
      });
    }

    // Owner activates a configured trade from Settings — only the master pet runs it.
    if (api && api.onCustomEvent) {
      api.onCustomEvent("trade:execute-desired", (data: any) => {
        if (!isMasterInstance) return;
        void activateDesiredTrade(data || {}).catch((err) =>
          console.error("[Overlay] activateDesiredTrade failed:", err),
        );
      });
      api.onCustomEvent("trade:stop-desired", () => {
        if (!isMasterInstance) return;
        stopDesiredTrade();
      });
    }
  } catch (deepLinkErr) {
    console.warn("[Overlay] Deep Link plugin not available:", deepLinkErr);
  }

  const params = new URLSearchParams(window.location.search);
  instanceId = params.get("id");

  if (!instanceId) {
    console.error("[Overlay] No instanceId provided.");
    return;
  }

  const canvas = document.getElementById("pet-canvas") as HTMLCanvasElement;

  // 1. Fetch pet instance configuration
  let petData: any;
  try {
    petData = await window.electronAPI.getInstanceConfig(instanceId);
    activePetConfig = petData;
  } catch (e) {
    console.error("[Overlay] getInstanceConfig failed:", e);
    return;
  }
  if (!petData) {
    console.error("[Overlay] petData is null");
    return;
  }

  // 2. Initialize the sprite renderer
  const renderer = new SpriteRenderer(
    canvas,
    PETDEX_SPRITE.FRAME_WIDTH,
    PETDEX_SPRITE.FRAME_HEIGHT,
  );

  // 3. Load the pet spritesheet
  if (petData?.spritesheetPath) {
    try {
      let finalPath = petData.spritesheetPath;
      // Only add cache buster for local files, not remote URLs
      // (cache busting remote URLs forces re-download and causes blank frames during load)
      if (
        !finalPath.startsWith("asset://") &&
        !finalPath.startsWith("data:") &&
        !finalPath.startsWith("http")
      ) {
        const cacheBuster = `?t=${Date.now()}`;
        finalPath += cacheBuster;
      }
      await renderer.loadSpritesheet(finalPath);
    } catch (err) {
      console.error("[Overlay] Failed to load spritesheet:", err);
    }
  }

  // 4. Initialize animation controllers and state machine
  const savedSettings: any = await window.electronAPI.getSettings();
  cachedSettings = savedSettings;
  currentActivePets = savedSettings?.activePets || [];
  const initialScale = Number(petData.scale || savedSettings?.scale) || 1.0;
  const isWalkingEnabled = savedSettings?.enableWalking !== false;
  currentLanguage = savedSettings?.language || "en";

  controller = new AnimationController(renderer, instanceId ?? "");
  stateMachine = new PetStateMachine(
    controller,
    initialScale,
    isWalkingEnabled,
  );
  if (petData?.animations) {
    stateMachine.updateAnimations(petData.animations);
  }
  controller.setWalkingEnabled(isWalkingEnabled);
  stateMachine.start();

  currentScale = initialScale;

  // Force window to be interactive at startup
  window.electronAPI.setIgnoreMouseEvents(false);
  window.electronAPI.focus();

  // Sync window dimensions with pet scale
  void syncWindowSize();

  // --- Multi-Pet: Chasing Logic ---
  window.electronAPI.onPositionsUpdate((data: any) => {
    const { positions } = data;
    // Identify other pet instances
    const otherPets = positions.filter((p: any) => p.id !== instanceId);
    if (otherPets.length > 0) {
      // Small chance (5%) for a pet to "chase" another when walking
      if (Math.random() < 0.05 && stateMachine.getState() === "walk") {
        const target = otherPets[Math.floor(Math.random() * otherPets.length)];
        controller.setTarget(target.x, target.y);
      }
    }
  });

  // --- Global IPC Events ---
  window.electronAPI.onPing(() => {
    stateMachine.notify();
    // Use crypto for unique delays across windows
    const randomBuffer = new Uint32Array(1);
    window.crypto.getRandomValues(randomBuffer);
    const delay = randomBuffer[0] % 1800; // 0 to 1.8s

    setTimeout(() => {
      showSpeech(
        getRandomPingSpeech(),
        INTERACTION.SPEECH_DURATION_DEFAULT,
        false,
        "Ping",
      );
    }, delay);
  });

  window.electronAPI.onStartAlarm(() => {
    statusAlarming = true;
    stateMachine.startAlarm();
  });

  window.electronAPI.onStopAlarm(() => {
    statusAlarming = false;
    stateMachine.stopAlarm();
  });

  window.electronAPI.onPomoTick((_state: any) => {
    // Regular tick updates (currently handled by settings window)
  });

  (window.electronAPI as any).onPomoFinished((sessionType: string) => {
    if (!isChosenToSpeak(`pomo_${sessionType}`)) return;
    const t = translations[currentLanguage];
    const randomBuffer = new Uint32Array(1);
    window.crypto.getRandomValues(randomBuffer);
    const delay = randomBuffer[0] % 2500;

    setTimeout(() => {
      const choices =
        sessionType === "focus" ? t.pomoFinishedWork : t.pomoFinishedBreak;
      const msg = pickUniqueRandom(choices);
      if (msg) showSpeech(msg, INTERACTION.SPEECH_DURATION_LONG, false, "Pomo");
    }, delay);
  });

  setupRandomSpeech(stateMachine);
  setupContextMonitoring();

  // --- Settings Update Handling ---
  window.electronAPI.onSettingsUpdate((data: any) => {
    void (async () => {
      const { settings } = data;
      cachedSettings = settings;
      currentActivePets = settings.activePets || [];
      currentLanguage = settings.language || "en";

      // Find this instance's specific configuration
      const myInstance = settings.activePets.find(
        (p: any) => p.id === instanceId,
      );
      if (myInstance) {
        currentScale = myInstance.scale || settings.scale;
        stateMachine.setScale(currentScale);
        stateMachine.setWalkingEnabled(settings.enableWalking);
        controller.setWalkingEnabled(settings.enableWalking);
        void syncWindowSize();
      } else if (settings.activePets.length > 0) {
        // This window's instanceId is no longer in activePets — a new pet was spawned.
        // Navigate to the new instance's URL so the overlay re-inits with the new pet.
        const newInstance = settings.activePets[0];
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set("id", newInstance.id);
        window.location.href = newUrl.toString();
      }
    })();
  });

  // --- Intelligence & Sync ---
  window.electronAPI.onPetSay(
    (payload: string | { text: string; priority?: boolean }) => {
      let text: string;
      let priority = false;
      if (typeof payload === "object" && payload !== null) {
        text = payload.text;
        priority = !!payload.priority;
      } else {
        text = payload;
      }

      if (!isChosenToSpeak(text)) return;

      if (!priority) {
        const timeSinceLastSpeech = Date.now() - lastGlobalSpeechTime;
        if (timeSinceLastSpeech < INTERACTION.SPEECH_SYNC_COOLDOWN) return;
      }

      const t = translations[currentLanguage];
      let speechToSay = text;

      if (text in t && Array.isArray(t[text])) {
        speechToSay = pickUniqueRandom(t[text]);
      } else {
        const categories = [
          "intelWebYoutube",
          "intelWebSocial",
          "intelWebDev",
          "intelWebAI",
          "intelWebDesign",
          "intelAppCode",
          "intelAppWeb",
          "intelAppMusic",
          "intelAppChat",
          "intelAppTerminal",
          "intelAppDesign",
          "intelAppMeeting",
          "intelAppProductivity",
          "intelAppFinder",
          "intelAppDefault",
          "intelTimeLate",
          "intelTimeLunch",
        ];

        for (const cat of categories) {
          const variants = t[cat];
          if (Array.isArray(variants) && variants.includes(text)) {
            speechToSay = pickUniqueRandom(variants);
            break;
          }
        }
      }

      showSpeech(
        speechToSay,
        INTERACTION.SPEECH_DURATION_DEFAULT,
        priority,
        "Intel",
      );
    },
  );

  window.electronAPI.onSomeoneSpeaking(() => {
    lastGlobalSpeechTime = Date.now();
  });

  setupMouseInteraction(canvas, stateMachine);

  // --- Master Election for Blockchain Monitor ---
  void setupMasterElection();

  // --- Blockchain Events ---
  window.electronAPI.onBlockchainEvent((event: any) => {
    if (!isChosenToSpeak(JSON.stringify(event))) return;

    const lang =
      currentLanguage && translations[currentLanguage] ? currentLanguage : "en";
    const t = translations[lang];
    const amountStr = (event.amount / 1000000000).toFixed(3);

    if (event.event_type === "message") {
      stateMachine.forceState("greet");
      let msg = t.blockchainMessage || "{pet}: {message} (+{amount} {coin})";
      msg = msg
        .replace("{pet}", event.pet_slug || "Someone")
        .replace("{message}", event.message || "")
        .replace("{amount}", amountStr)
        .replace("{coin}", event.coin_type || "SUI");
      showSpeech(msg, 7000, true, "Blockchain:Message");
    } else if (event.event_type === "bonk") {
      stateMachine.forceState("bonk");
      let msg = t.blockchainBonk || "{pet} bonked me! (-{amount} {coin})";
      msg = msg
        .replace("{pet}", event.pet_slug || "Someone")
        .replace("{amount}", amountStr)
        .replace("{coin}", event.coin_type || "SUI");
      showSpeech(msg, 5000, true, "Blockchain:Bonk");
    } else if (event.event_type === "receive_coin") {
      // If we just showed a message or bonk in this SAME tick, receive_coin should win
      stateMachine.forceState("greet");

      const variations = t.blockchainReceiveCoin || [
        `Wow! Just received {amount} {coin}! 🚀`,
      ];

      let randomMsg = variations[Math.floor(Math.random() * variations.length)];
      randomMsg = randomMsg
        .replace("{amount}", amountStr)
        .replace("{coin}", event.coin_type || "SUI");

      showSpeech(randomMsg, 8000, true, "Blockchain:Receive");
    } else if (event.event_type === "send_coin") {
      stateMachine.forceState("sad"); // Gửi tiền đi = buồn nhẹ

      const variations = t.blockchainSendCoin || [`Sent {amount} {coin}. 👋`];

      let randomMsg = variations[Math.floor(Math.random() * variations.length)];
      randomMsg = randomMsg
        .replace("{amount}", amountStr)
        .replace("{coin}", event.coin_type || "SUI");

      showSpeech(randomMsg, 6000, true, "Blockchain:Send");
    }
  });

  // --- Real-time Speech Sync (Event Driven) ---
  window.electronAPI.onWindowMoved((_x: number, _y: number) => {
    if (isSpeechVisible && currentSpeechText) {
      void syncSpeechWindowPosition();
    }
  });

  // --- AI Chat Events ---
  (window.electronAPI as any).onCustomEvent(
    `chat-mode-toggle-${instanceId}`,
    (payload: any) => {
      if (payload && payload.active === false) {
        toggleChatMode(false);
      }
    },
  );

  (window.electronAPI as any).onCustomEvent(
    `user-chat-submit-${instanceId}`,
    (payload: any) => {
      if (payload && payload.text) {
        if (pendingConfirmTransfer) {
          void handleConfirmTransfer(payload.text);
        } else if (pendingTransfer) {
          void handlePendingTransferClarification(payload.text);
        } else {
          void handleLocalChat(payload.text);
        }
      }
    },
  );

  (window.electronAPI as any).onCustomEvent(
    "global:chat-active",
    (payload: any) => {
      if (payload) {
        isAnyChatActive = !!payload.active;
      }
    },
  );

  // --- Local AI Bootup Logic ---
  const aiEnabled = savedSettings?.aiEnabled !== false;

  if (aiEnabled) {
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");

    try {
      const hasModel = await invoke("check_model_exists");
      if (!hasModel) {
        // Wait for pet window position to settle before showing bubble
        await new Promise<void>((r) => {
          setTimeout(r, 1500);
        });

        // Ask user permission to download brain
        const isVi = currentLanguage === "vi";
        const askText = isVi
          ? "Sen ơi, tui chưa có bộ não! Cho tui tải về không? (~1GB, chạy offline 100%) 🧠"
          : "Hey! I don't have a brain yet! Can I download it? (~1GB, runs 100% offline) 🧠";

        void updateSpeechOverlay(askText, true, [
          {
            label: isVi ? "Tải về" : "Download",
            action: "download-brain",
            style: "primary",
          },
          {
            label: isVi ? "Để sau" : "Later",
            action: "skip-brain",
            style: "secondary",
          },
        ]);
        void syncWindowSize();

        // Wait for user response
        const userChoice = await new Promise<string>((resolve) => {
          void listen(`speech-button-${instanceId}`, (event: any) => {
            resolve(event.payload.action);
          });
        });

        if (userChoice !== "download-brain") {
          hideSpeech();
          // Skip AI for this session
        } else {
          // Proceed with download
          const lang =
            currentLanguage && translations[currentLanguage]
              ? currentLanguage
              : "en";
          const t = translations[lang];

          let initialMsg = t.modelDownloading || "Downloading brain...";
          initialMsg = initialMsg
            .replace("{percent}", "0.0")
            .replace("{downloaded}", "0.0")
            .replace("{total}", "1000");
          showSpeech(initialMsg, 999999, true, "System");

          let lastPercentInt = -1;
          const unlisten = await listen(
            "model-download-progress",
            (event: any) => {
              const payload = event.payload as any;
              const percentNum = payload.progress;
              const percentInt = Math.floor(percentNum);

              if (percentInt !== lastPercentInt) {
                lastPercentInt = percentInt;
                const percentStr = percentNum.toFixed(1);
                const downloadedMB = (payload.downloaded / 1048576).toFixed(1);
                const totalMB = (payload.total / 1048576).toFixed(1);

                const currentLang =
                  currentLanguage && translations[currentLanguage]
                    ? currentLanguage
                    : "en";
                const currentT = translations[currentLang];

                let progressMsg =
                  currentT.modelDownloading || "Downloading brain...";
                progressMsg = progressMsg
                  .replace("{percent}", percentStr)
                  .replace("{downloaded}", downloadedMB)
                  .replace("{total}", totalMB);

                showSpeech(progressMsg, 999999, true, "System");
              }
            },
          );

          await invoke("download_model");
          unlisten();

          const postLang =
            currentLanguage && translations[currentLanguage]
              ? currentLanguage
              : "en";
          const postT = translations[postLang];
          showSpeech(
            postT.modelDownloadComplete ||
              "Download complete! Starting brain...",
            4000,
            true,
            "System",
          );

          await invoke("start_ai_server");
        }
      } else {
        await invoke("start_ai_server");
      }
    } catch (err) {
      console.error("[Local AI] Boot failed:", err);
    }
  }

  // Greeting on startup
  setTimeout(() => {
    const t = translations[currentLanguage];
    stateMachine.forceState("greet");
    showSpeech(pickUniqueRandom(t.hello), 4000, true, "Startup");
  }, 1000);
}

/**
 * Activates the owner-configured "desired trade" on the master pet.
 * Reads the saved config from settings, allows per-call overrides, persists it,
 * then runs DesiredTradeExecutor (real on-chain execution). Returns a status line.
 */
async function activateDesiredTrade(
  override?: Partial<DesiredTradeConfig> & { wallet?: "pet" | "agent" },
): Promise<string> {
  const settings: any = await window.electronAPI.getSettings();
  const wallet = override?.wallet === "pet" ? "pet" : "agent";
  const cfg: any = settings?.autoTrade?.[wallet] || {};

  const action: "buy" | "sell" =
    override?.action ?? (cfg.action === "sell" ? "sell" : "buy");
  const token = override?.token ?? (cfg.token || "SUI");
  const amount =
    override?.amount ?? (typeof cfg.amount === "number" ? cfg.amount : 1);
  const env: "testnet" | "mainnet" =
    override?.env ?? (cfg.env === "mainnet" ? "mainnet" : "testnet");
  const mode: "once" | "recurring" =
    override?.mode ?? (cfg.mode === "recurring" ? "recurring" : "once");
  const intervalMinutes =
    override?.intervalMinutes ?? (cfg.interval_minutes ?? 60);

  const agentSecretKey = settings?.agentSecretKey || "";
  if (!agentSecretKey) {
    return "❌ No agent wallet found. Generate one in Settings first.";
  }

  // Persist the latest desired config (and mark enabled).
  const autoTrade: Record<string, any> = { ...(settings?.autoTrade || {}) };
  autoTrade[wallet] = {
    ...(autoTrade[wallet] || {}),
    enabled: true,
    action,
    token,
    amount,
    env,
    mode,
    interval_minutes: intervalMinutes,
  };
  await window.electronAPI.updateSettings({ autoTrade });

  if (desiredTradeExecutor) desiredTradeExecutor.stop();
  desiredTradeExecutor = new DesiredTradeExecutor(
    { action, token, amount, env, mode, intervalMinutes, slippagePct: 1, agentSecretKey },
    (log) => {
      if (
        log.action === "ERROR" ||
        log.action === "BUY" ||
        log.action === "SELL" ||
        log.action === "SIGNAL"
      ) {
        showSpeech(`💹 ${log.message}`, 6000, false, "desired-trade");
      }
    },
  );
  void desiredTradeExecutor.activate();

  const verb = action === "sell" ? "Sell" : "Buy";
  const tail = mode === "recurring" ? `, every ${intervalMinutes}m` : "";
  return `✅ Pet activated: ${verb} ${amount} ${token} on ${env} (${mode}${tail}).`;
}

/** Stops any running desired-trade loop on this instance. */
function stopDesiredTrade(): string {
  if (desiredTradeExecutor) {
    desiredTradeExecutor.stop();
    desiredTradeExecutor = null;
  }
  return "🛑 Pet stopped the configured trade.";
}

/**
 * Ensures only one pet window runs the SuiMonitor to stay within RPC rate limits.
 * The window with the alphabetically lowest label is elected as Master.
 */
async function setupMasterElection() {
  const checkMaster = async () => {
    try {
      const allWindows = await getAllWebviewWindows();
      const overlayWindows = allWindows.filter((w) =>
        w.label.startsWith("overlay-"),
      );
      const sortedLabels = overlayWindows.map((w) => w.label).sort();
      const currentWin = getCurrentWebviewWindow();
      const myLabel = currentWin.label;

      if (myLabel === sortedLabels[0]) {
        isMasterInstance = true;
        if (!suiMonitor) {
          suiMonitor = new SuiMonitor();
        }
        if (!securityAgent) {
          securityAgent = new SecurityAgent();
          void securityAgent.start();
        }
        if (!autoTradeSimulator) {
          autoTradeSimulator = new AutoTradeSimulator((text: string) =>
            showSpeech(text, 6000, false, "auto-trade"),
          );
          autoTradeSimulator.start();
        }
      } else {
        isMasterInstance = false;
        if (suiMonitor) {
          // destroy() removes the settings listener too (stopPolling alone leaks it).
          (suiMonitor as any).destroy?.();
          suiMonitor = null;
        }
        if (securityAgent) {
          securityAgent.stop();
          securityAgent = null;
        }
        if (autoTradeSimulator) {
          autoTradeSimulator.stop();
          autoTradeSimulator = null;
        }
        if (desiredTradeExecutor) {
          desiredTradeExecutor.stop();
          desiredTradeExecutor = null;
        }
      }
    } catch (err) {
      console.error("[Overlay] Master election failed:", err);
    }
  };

  // Initial check
  await checkMaster();

  // Re-elect every 10 seconds in case windows are closed/opened
  setInterval(() => {
    void checkMaster();
  }, 10000);
}

/**
 * Sets up mouse and drag-and-drop interactions.
 */
function setupMouseInteraction(
  canvas: HTMLCanvasElement,
  stateMachine: PetStateMachine,
): void {
  let isDragging = false;
  let wasDragged = false;
  let startX = 0;
  let startY = 0;

  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 0) {
      e.preventDefault();

      // 1. Instant response: focus and pause autonomous movement
      window.electronAPI.focus();
      controller.pauseMovement(true);

      isDragging = true;
      wasDragged = false;
      startX = e.screenX;
      startY = e.screenY;

      // 2. UI state
      stateMachine.forceState("dazed");
      window.electronAPI.setIgnoreMouseEvents(false);
    }
  });

  window.addEventListener("mousemove", (e) => {
    if (isDragging) {
      const dx = e.screenX - startX;
      const dy = e.screenY - startY;

      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        wasDragged = true;
        window.electronAPI.moveWindow(dx, dy);
        startX = e.screenX;
        startY = e.screenY;
      }
    }
  });

  const stopDragging = () => {
    if (isDragging) {
      isDragging = false;
      stateMachine.transitionTo("idle");
      controller.resetPosition();
      controller.pauseMovement(false);

      if (instanceId) {
        window.electronAPI.savePosition(instanceId);
      }
    }
  };

  window.addEventListener("mouseup", stopDragging);
  window.addEventListener("blur", stopDragging);

  let clickCount = 0;
  let clickTimer: NodeJS.Timeout | null = null;

  canvas.addEventListener("click", () => {
    if (statusAlarming) {
      window.electronAPI.stopAlarm();
      hideSpeech();
      return;
    }

    if (wasDragged) return;

    // Confirm sync from deep-link
    if (pendingSyncUrl) {
      const url = pendingSyncUrl;
      pendingSyncUrl = "";
      void confirmSync(url);
      return;
    }

    // Gợi ý đồng bộ ví từ clipboard
    if (isSuggestingWalletSync && pendingWalletSyncAddress) {
      const addr = pendingWalletSyncAddress;
      pendingWalletSyncAddress = "";
      isSuggestingWalletSync = false;

      const api = (window as any).electronAPI;
      if (api) {
        void api
          .updateSettings({ suiAddress: addr, suiEnabled: true })
          .then(() => {
            showSpeech("Wallet synced! Reloading...", 5000, true, "System");
            setTimeout(() => window.location.reload(), 2000);
          })
          .catch((err: any) => {
            console.error("[Overlay] Failed to save sync address:", err);
            showSpeech(tt("walletSaveError"), 4000, true, "System");
          });
      }
      return;
    }

    clickCount++;
    if (clickTimer) clearTimeout(clickTimer);

    const t = translations[currentLanguage];

    if (clickCount === 1) {
      if (isChatActive) {
        toggleChatMode(false);
      } else {
        stateMachine.forceState("greet");
        showSpeech(pickUniqueRandom(t.hello));
      }
    } else if (clickCount === 2) {
      localChatHistory.splice(1);
      toggleChatMode(true);
    } else if (clickCount >= 3) {
      if (stateMachine.getWalkingEnabled()) {
        stateMachine.forceState("run");
        showSpeech(pickUniqueRandom(t.run));
      } else {
        stateMachine.forceState("greet");
        showSpeech(t.movingDisabled);
      }
    }

    clickTimer = setTimeout(() => {
      clickCount = 0;
      clickTimer = null;
    }, 600);
  });

  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    window.electronAPI.openSettings();
  });

  // --- Click-through management removed for reliability ---
  // Since the window is now tightly fitted to the pet size,
  // we no longer need complex ignore logic which was causing focus issues.

  /**
   * Drag-and-drop file eating handlers using native Tauri events.
   */
  window.electronAPI.onDragDrop((type: string, paths: string[]) => {
    void (async () => {
      if (type === "enter") {
        stateMachine.forceState("dazed");
      } else if (type === "leave") {
        stateMachine.transitionTo("idle");
      } else if (type === "drop") {
        if (!paths || paths.length === 0) {
          stateMachine.transitionTo("idle");
          return;
        }

        const t = translations[currentLanguage];
        stateMachine.forceState("eat");
        showSpeech(
          pickUniqueRandom(t.eating),
          INTERACTION.SPEECH_DURATION_DEFAULT,
          false,
          "Eat",
        );

        try {
          const result: any = await window.electronAPI.eatFile(paths);
          if (result && !result.success) {
            showSpeech(
              pickUniqueRandom(t.hello),
              INTERACTION.SPEECH_DURATION_DEFAULT,
              false,
              "EatError",
            );
          }
        } catch (err) {
          console.error("Overlay: Failed to eat file:", err);
        } finally {
          setTimeout(() => {
            stateMachine.transitionTo("idle");
          }, 1000);
        }
      }
    })();
  });
}

/**
 * Updates the internal speech bubble text and visibility.
 */
async function updateSpeechOverlay(
  text: string,
  visible: boolean,
  buttons?: { label: string; action: string; style?: string }[],
) {
  try {
    const win = await getOrCreateSpeechWindow();
    if (visible) {
      isSpeechVisible = true;
      await win.show();
      await syncSpeechWindowPosition();
      // Small delay to ensure speech webview has loaded and is listening for events
      await new Promise<void>((r) => {
        setTimeout(r, 200);
      });
    }
    // Gửi event sang speech window
    void window.electronAPI.broadcastPetEvent(`update-speech-${instanceId}`, {
      text,
      visible,
      buttons: buttons || null,
    });

    if (!visible) {
      setTimeout(() => win.hide(), 350);
    }
  } catch (err) {
    console.error("Failed to update speech window:", err);
  }
}

async function syncWindowSize(): Promise<void> {
  const safeScale = Number(currentScale) || 1.0;
  const petWidth = Math.ceil(PETDEX_SPRITE.FRAME_WIDTH * safeScale);
  const petHeight = Math.ceil(PETDEX_SPRITE.FRAME_HEIGHT * safeScale);

  const canvas = document.getElementById("pet-canvas") as HTMLCanvasElement;
  if (canvas) {
    canvas.style.width = `${petWidth}px`;
    canvas.style.height = `${petHeight}px`;
  }

  // Khung xanh bây giờ chỉ bao bọc đúng con Pet (khung đỏ)
  const winWidth = petWidth;
  const winHeight = petHeight;

  try {
    window.electronAPI.resizeKeepBottom(winWidth, winHeight);
  } catch (err) {
    console.error("Failed to resize window:", err);
  }

  if (isSpeechVisible) {
    void syncSpeechWindowPosition();
  }
}

/**
 * Displays a speech bubble with the given text for a specific duration.
 */
function showSpeech(
  text: string,
  duration: number = INTERACTION.SPEECH_DURATION_DEFAULT,
  priority: boolean = false,
  _source: string = "unknown",
): void {
  if (isChatActive || isAnyChatActive) {
    return;
  }
  if (speechTimeout) clearTimeout(speechTimeout);
  if (!priority && isSpeechVisible) {
    if ((window as any).isCurrentSpeechPriority) {
      return;
    }
  }

  isSpeechVisible = true;
  currentSpeechText = text;
  (window as any).isCurrentSpeechPriority = priority;

  // Use separate speech window
  void updateSpeechOverlay(text, true);
  void syncWindowSize(); // Phình to cửa sổ ra để chứa chữ

  // Notify other pets to stay silent
  window.electronAPI.notifySpeaking();

  if (!isChatActive) {
    speechTimeout = setTimeout(hideSpeech, duration);
  }
}

function toggleChatMode(active: boolean) {
  isChatActive = active;
  const t = translations[currentLanguage] || translations["en"];
  const welcomeText = t.askMeAnything || "Ask me anything! 🧠";

  if (active) {
    // Clear any pending speech timeout so it doesn't fire hideSpeech during chat
    if (speechTimeout) {
      clearTimeout(speechTimeout);
      speechTimeout = null;
    }
    void updateSpeechOverlay(welcomeText, true);
  } else {
    closeChatAndHideSpeech();
  }

  (window.electronAPI as any).broadcastPetEvent(`chat-mode-${instanceId}`, {
    active,
    welcomeText,
  });
  (window.electronAPI as any).broadcastPetEvent("global:chat-active", {
    active,
  });
}

/**
 * Hides regular speech bubbles. Does NOT touch chat state.
 * Called by speechTimeout or when a speech naturally expires.
 */
function hideSpeech(): void {
  // If chat is active, do NOT reset it — just ignore the timeout
  if (isChatActive) {
    if (speechTimeout) {
      clearTimeout(speechTimeout);
      speechTimeout = null;
    }
    return;
  }

  isSpeechVisible = false;
  currentSpeechText = "";
  (window as any).isCurrentSpeechPriority = false;
  void updateSpeechOverlay("", false);
  void syncWindowSize();

  if (speechTimeout) {
    clearTimeout(speechTimeout);
    speechTimeout = null;
  }
}

/**
 * Fully closes chat mode and hides the speech bubble.
 * Only called when the user explicitly exits chat.
 */
function closeChatAndHideSpeech(): void {
  isChatActive = false;
  isSpeechVisible = false;
  currentSpeechText = "";
  (window as any).isCurrentSpeechPriority = false;
  void updateSpeechOverlay("", false);
  void syncWindowSize();

  if (speechTimeout) {
    clearTimeout(speechTimeout);
    speechTimeout = null;
  }

  (window.electronAPI as any).broadcastPetEvent(`chat-mode-${instanceId}`, {
    active: false,
  });
  (window.electronAPI as any).broadcastPetEvent("global:chat-active", {
    active: false,
  });
}

/**
 * Returns a random speech text for ping responses.
 */
function getRandomPingSpeech(): string {
  const lang =
    currentLanguage && translations[currentLanguage] ? currentLanguage : "en";
  const t = translations[lang];
  const choices = Array.isArray(t.pingResponses)
    ? t.pingResponses
    : Array.isArray(t.hello)
      ? t.hello
      : ["🐾", "❤️", "✨"];
  return pickUniqueRandom(choices);
}

/**
 * Sets up a background interval for occasional random speech.
 */
function setupRandomSpeech(stateMachine: PetStateMachine): void {
  setInterval(() => {
    // Only speak randomly if no one has spoken recently across all instances
    const timeSinceLastSpeech = Date.now() - lastGlobalSpeechTime;

    if (
      !isSpeechVisible &&
      !statusAlarming &&
      timeSinceLastSpeech > INTERACTION.SPEECH_SYNC_COOLDOWN &&
      Math.random() < INTERACTION.RANDOM_SPEECH_CHANCE
    ) {
      const state = stateMachine.getState();
      const t = translations[currentLanguage];

      if (state === "sleep") {
        showSpeech("Zzz...");
      } else {
        const choices = t.randomSpeeches || ["🐾", "❤️", "✨"];
        showSpeech(
          pickUniqueRandom(choices),
          INTERACTION.SPEECH_DURATION_DEFAULT,
          false,
          "Random",
        );
      }
    }
  }, INTERACTION.RANDOM_SPEECH_INTERVAL);
}

function getSpeechCategory(appName: string, tabTitle: string | null): string {
  const appLower = appName.toLowerCase();

  // 1. If it's a browser, check the tab title first
  if (
    appLower.includes("chrome") ||
    appLower.includes("safari") ||
    appLower.includes("arc") ||
    appLower.includes("firefox") ||
    appLower.includes("brave") ||
    appLower.includes("browser")
  ) {
    if (tabTitle) {
      const tabLower = tabTitle.toLowerCase();
      if (tabLower.includes("youtube")) return "intelWebYoutube";
      if (
        tabLower.includes("facebook") ||
        tabLower.includes("twitter") ||
        tabLower.includes("x.com") ||
        tabLower.includes("reddit") ||
        tabLower.includes("instagram") ||
        tabLower.includes("linkedin") ||
        tabLower.includes("tiktok")
      ) {
        return "intelWebSocial";
      }
      if (
        tabLower.includes("github") ||
        tabLower.includes("stack overflow") ||
        tabLower.includes("stackoverflow") ||
        tabLower.includes("npm") ||
        tabLower.includes("localhost") ||
        tabLower.includes("docs") ||
        tabLower.includes("documentation") ||
        tabLower.includes("sui")
      ) {
        return "intelWebDev";
      }
      if (
        tabLower.includes("chatgpt") ||
        tabLower.includes("claude") ||
        tabLower.includes("gemini") ||
        tabLower.includes("openai") ||
        tabLower.includes("v0.dev")
      ) {
        return "intelWebAI";
      }
      if (
        tabLower.includes("figma") ||
        tabLower.includes("canva") ||
        tabLower.includes("dribbble") ||
        tabLower.includes("behance")
      ) {
        return "intelWebDesign";
      }
    }
    return "intelAppWeb";
  }

  // 2. Otherwise, check the app name
  if (
    appLower.includes("visual studio code") ||
    appLower.includes("vscode") ||
    appLower.includes("code") ||
    appLower.includes("xcode") ||
    appLower.includes("cursor") ||
    appLower.includes("intellij") ||
    appLower.includes("android studio") ||
    appLower.includes("sublime")
  ) {
    return "intelAppCode";
  }
  if (
    appLower.includes("spotify") ||
    appLower.includes("music") ||
    appLower.includes("podcast")
  ) {
    return "intelAppMusic";
  }
  if (
    appLower.includes("slack") ||
    appLower.includes("discord") ||
    appLower.includes("telegram") ||
    appLower.includes("whatsapp") ||
    appLower.includes("messages") ||
    appLower.includes("signal")
  ) {
    return "intelAppChat";
  }
  if (
    appLower.includes("terminal") ||
    appLower.includes("iterm") ||
    appLower.includes("warp") ||
    appLower.includes("alacritty") ||
    appLower.includes("console")
  ) {
    return "intelAppTerminal";
  }
  if (
    appLower.includes("figma") ||
    appLower.includes("photoshop") ||
    appLower.includes("illustrator") ||
    appLower.includes("sketch") ||
    appLower.includes("design")
  ) {
    return "intelAppDesign";
  }
  if (
    appLower.includes("zoom") ||
    appLower.includes("teams") ||
    appLower.includes("meet") ||
    appLower.includes("webex")
  ) {
    return "intelAppMeeting";
  }
  if (
    appLower.includes("notion") ||
    appLower.includes("obsidian") ||
    appLower.includes("notes") ||
    appLower.includes("calendar") ||
    appLower.includes("word") ||
    appLower.includes("excel") ||
    appLower.includes("powerpoint")
  ) {
    return "intelAppProductivity";
  }
  if (appLower.includes("finder") || appLower.includes("files")) {
    return "intelAppFinder";
  }

  return "intelAppDefault";
}

const PHISHING_BLACKLIST = [
  "sui-reward",
  "sui-claim",
  "cetus-airdrop",
  "cetus-claim",
  "sui-airdrop",
  "suigiveaway",
  "scam-cetus",
  "sui-rewards",
  "cetus-rewards",
  "scam",
  "phishing",
];

function setupContextMonitoring(): void {
  setInterval(() => {
    void (async () => {
      // Only the elected Master window should poll the active app
      if (!suiMonitor) {
        return;
      }

      try {
        const activeApp = await window.electronAPI.getActiveApp();
        if (!activeApp) return;

        let browserTab: string | null = null;
        let browserUrl: string | null = null;
        const appLower = activeApp.toLowerCase();
        if (
          appLower.includes("chrome") ||
          appLower.includes("safari") ||
          appLower.includes("arc") ||
          appLower.includes("firefox") ||
          appLower.includes("brave") ||
          appLower.includes("browser")
        ) {
          browserTab = await window.electronAPI.getBrowserTab(activeApp);
          browserUrl = await window.electronAPI.getBrowserUrl(activeApp);
        }

        // Check if URL or Tab title matches phishing blacklist
        if (browserUrl || browserTab) {
          const urlLower = (browserUrl || "").toLowerCase();
          const tabLower = (browserTab || "").toLowerCase();
          const isBlacklisted = PHISHING_BLACKLIST.some(
            (keyword) =>
              urlLower.includes(keyword) || tabLower.includes(keyword),
          );
          if (isBlacklisted) {
            const displayUrl = browserUrl || browserTab;
            void window.electronAPI.broadcastPetEvent("pet:say", {
              text: `🚨 DANGER! Potential phishing site detected:\n${displayUrl}\nClose this tab immediately!`,
              priority: true,
            });
            void window.electronAPI.broadcastPetEvent("blockchain:event", {
              event_type: "bonk",
              pet_slug: "Agent",
            });
            return;
          }
        }

        // Check for time-based contexts first (lunch or late night)
        const now = new Date();
        const hour = now.getHours();
        const min = now.getMinutes();
        let category = "";

        if (hour >= 23 || hour < 5) {
          category = "intelTimeLate";
        } else if (
          (hour === 11 && min >= 30) ||
          hour === 12 ||
          (hour === 13 && min === 0)
        ) {
          category = "intelTimeLunch";
        } else {
          category = getSpeechCategory(activeApp, browserTab);
        }

        const contextKey = `${category}_${activeApp}_${browserTab || ""}`;
        const nowTime = Date.now();

        // Comment if:
        // 1. Context changed and last comment was > 60s ago
        // 2. Same context and last comment was > 900s ago (15 minutes)
        if (
          (contextKey !== lastContextKey &&
            nowTime - lastCommentTime > 60000) ||
          (contextKey === lastContextKey && nowTime - lastCommentTime > 900000)
        ) {
          lastContextKey = contextKey;
          lastCommentTime = nowTime;

          // Broadcast the category key to all pet windows
          void window.electronAPI.broadcastPetEvent("pet:say", {
            text: category,
            priority: false,
          });
        }
      } catch (err) {
        console.error("[ContextMonitor] Error polling active app:", err);
      }
    })();
  }, 5000);
}

/** Placeholder for optional level-up transaction append — no-op until contract supports it */
function maybeAppendLevelUp(_tx: unknown): void {
  /* reserved */
}

/** Map language code → full language name for AI system prompt */
const LANG_NAME_MAP: Record<string, string> = {
  vi: "Vietnamese",
  en: "English",
  fr: "French",
  zh: "Chinese (Simplified)",
  it: "Italian",
  ko: "Korean",
};

function buildSystemPrompt(
  langCode: string,
  timeStr?: string,
  dateStr?: string,
): string {
  const langName = LANG_NAME_MAP[langCode] || "English";
  let prompt = `You are MiniPet, a cute virtual desktop pet assistant on macOS. Keep answers short (1-2 sentences max). You MUST use the provided tools when the user asks to: transfer SUI, check balance, swap tokens, set timer, bonk a pet (bonk_pet), send a gift (send_pet_gift), rename your pet (rename_pet), or check your pet's stats (check_pet_stats). The recipient for transfer_sui, send_pet_gift and bonk_pet may be a raw 0x address OR a saved contact alias. You can also use 'add_fast_transfer_wallet' or 'remove_fast_transfer_wallet' to manage the user's fast transfer whitelist if they explicitly ask to add or remove an address starting with 0x. For transfers: if the recipient is a saved contact alias, pass that alias as recipient_address with confirmed=false (it is whitelisted, send immediately); if the recipient is a raw 0x address that is NOT whitelisted, first call transfer_sui with confirmed=false, and only set confirmed=true AFTER the user explicitly confirms. For automated trading use 'start_auto_trade', 'stop_auto_trade', 'configure_auto_trade' or 'get_auto_trade_status' with wallet set to 'pet' or 'agent' (this is a simulated feature configured in Settings). When the user asks you to execute or run the trade they already configured (e.g. 'thực hiện trade đã cấu hình', 'execute my configured trade'), use 'execute_desired_trade'; to halt it use 'stop_desired_trade'. These run the EXACT configured trade on-chain. NEVER initiate transactions, hallucinate wallet addresses, or call tools unless the user explicitly requests it. You MUST answer ONLY in ${langName}. Do NOT mix languages.`;
  if (timeStr && dateStr) {
    prompt += ` Current time: ${timeStr}, Date: ${dateStr}.`;
  }
  return prompt;
}

const localChatHistory: any[] = [
  { role: "system", content: buildSystemPrompt(currentLanguage || "en") },
];

interface PendingTransfer {
  recipientAlias: string;
  amount: number;
  candidates: { alias: string; address: string }[];
}
interface PendingConfirmTransfer {
  recipient: string;
  amount: number;
}
let pendingTransfer: PendingTransfer | null = null;
let pendingConfirmTransfer: PendingConfirmTransfer | null = null;

async function handlePendingTransferClarification(userText: string) {
  const text = userText.trim().toLowerCase();

  if (!pendingTransfer) return;

  if (text === "hủy" || text === "cancel") {
    pendingTransfer = null;
    (window.electronAPI as any).broadcastPetEvent(`chat-reply-${instanceId}`, {
      text: tt("transferCancelled"),
    });
    return;
  }

  let selectedAddress = "";

  const idx = parseInt(text) - 1;
  if (!isNaN(idx) && idx >= 0 && idx < pendingTransfer.candidates.length) {
    selectedAddress = pendingTransfer.candidates[idx].address;
  } else {
    if (isValidSuiAddress(userText.trim())) {
      selectedAddress = userText.trim();
    } else {
      const found = pendingTransfer.candidates.find((c) =>
        c.address.toLowerCase().includes(text),
      );
      if (found) {
        selectedAddress = found.address;
      }
    }
  }

  if (selectedAddress) {
    const amount = pendingTransfer.amount;
    const recipientAlias =
      pendingTransfer.candidates.find((c) => c.address === selectedAddress)
        ?.alias || selectedAddress;
    pendingTransfer = null;

    (window.electronAPI as any).broadcastPetEvent(`chat-reply-${instanceId}`, {
      text: tt("processingTransfer"),
    });

    try {
      const savedSettings: any = await window.electronAPI.getSettings();
      if (!savedSettings.zkLoginSession && !savedSettings.agentSecretKey) {
        const errText = tt("walletNotSynced");
        localChatHistory.push({ role: "assistant", content: errText });
        (window.electronAPI as any).broadcastPetEvent(
          `chat-reply-${instanceId}`,
          { text: errText },
        );
        return;
      }

      const { SuiJsonRpcClient, getJsonRpcFullnodeUrl } =
        await import("@mysten/sui/jsonRpc");
      const { Transaction } = await import("@mysten/sui/transactions");

      const client = new SuiJsonRpcClient({
        url: getJsonRpcFullnodeUrl("testnet"),
        network: "testnet",
      });

      const tx = new Transaction();
      tx.setSender(savedSettings.suiAddress);
      const [coin] = tx.splitCoins(tx.gas, [
        Math.floor(amount * 1_000_000_000),
      ]);
      tx.transferObjects([coin], selectedAddress);

      await executeTransactionWithWallet(client, tx, savedSettings);
      const successText = tt("transferSuccess", {
        amount: amount.toString(),
        recipient: recipientAlias,
      });

      localChatHistory.push({ role: "assistant", content: successText });
      (window.electronAPI as any).broadcastPetEvent(
        `chat-reply-${instanceId}`,
        { text: successText },
      );
    } catch (e: any) {
      console.error("[ClarifyTransfer] FULL ERROR:", e, "stack:", e.stack);
      const errMsg = `${e.message}\n${e.stack?.split('\n').slice(0,3).join(' | ')}`;
      const friendlyMsg = tt("transferFailed", { error: errMsg });

      localChatHistory.push({ role: "assistant", content: friendlyMsg });
      (window.electronAPI as any).broadcastPetEvent(
        `chat-reply-${instanceId}`,
        { text: friendlyMsg },
      );
    }
  } else {
    let list = `${tt("invalidChoice")}\n`;
    pendingTransfer.candidates.forEach((cand, idx) => {
      list += `${idx + 1}. ${cand.alias} (${cand.address.substring(0, 6)}...${cand.address.substring(cand.address.length - 4)})\n`;
    });
    (window.electronAPI as any).broadcastPetEvent(`chat-reply-${instanceId}`, {
      text: list,
    });
  }
}

async function handleConfirmTransfer(userText: string) {
  const text = userText.trim().toLowerCase();
  const confirmWords = ["ok", "oke", "yes", "confirm", "y", "đồng ý", "ừ"];
  const cancelWords = ["no", "cancel", "hủy", "không", "n"];

  if (cancelWords.some((w) => text === w)) {
    pendingConfirmTransfer = null;
    (window.electronAPI as any).broadcastPetEvent(`chat-reply-${instanceId}`, {
      text: tt("transferCancelled"),
    });
    return;
  }

  if (!confirmWords.some((w) => text === w)) {
    (window.electronAPI as any).broadcastPetEvent(`chat-reply-${instanceId}`, {
      text: '⚠️ Reply "ok" to confirm or "cancel" to abort.',
    });
    return;
  }

  const pending = pendingConfirmTransfer;
  pendingConfirmTransfer = null;
  if (!pending) return;
  const { recipient, amount } = pending;

  (window.electronAPI as any).broadcastPetEvent(`chat-reply-${instanceId}`, {
    text: tt("processingTransfer"),
  });

  try {
    const savedSettings: any = await window.electronAPI.getSettings();
    console.log("[ConfirmTransfer] recipient:", recipient, "amount:", amount, "suiAddress:", savedSettings?.suiAddress, "zkSession:", !!savedSettings?.zkLoginSession);
    if (!recipient) { throw new Error("Recipient is undefined"); }
    if (!savedSettings?.suiAddress) { throw new Error("suiAddress is undefined in settings"); }
    const { SuiJsonRpcClient, getJsonRpcFullnodeUrl } =
      await import("@mysten/sui/jsonRpc");
    const { Transaction } = await import("@mysten/sui/transactions");

    const client = new SuiJsonRpcClient({
      url: getJsonRpcFullnodeUrl("testnet"),
      network: "testnet",
    });
    const tx = new Transaction();
    tx.setSender(savedSettings.suiAddress);
    const [coin] = tx.splitCoins(tx.gas, [Math.floor(amount * 1_000_000_000)]);
    tx.transferObjects([coin], recipient);

    await executeTransactionWithWallet(client, tx, savedSettings);
    const successText = tt("transferSuccess", {
      amount: amount.toString(),
      recipient: recipient.slice(0, 10),
    });
    localChatHistory.push({ role: "assistant", content: successText });
    (window.electronAPI as any).broadcastPetEvent(`chat-reply-${instanceId}`, {
      text: successText,
    });
  } catch (e: any) {
    console.error("[ConfirmTransfer] FULL ERROR:", e, "stack:", e.stack);
    const errText = `❌ Transfer failed: ${e.message}\n${e.stack?.split('\n').slice(0,3).join(' | ')}`;
    localChatHistory.push({ role: "assistant", content: errText });
    (window.electronAPI as any).broadcastPetEvent(`chat-reply-${instanceId}`, {
      text: errText,
    });
  }
}

async function handleLocalChat(userText: string) {
  const savedSettings: any = await window.electronAPI.getSettings();

  const FAST_TRANSFER_WALLETS: { alias: string; address: string }[] =
    savedSettings?.fastTransferWallets || [];

  // Resolve a recipient that may be either a raw 0x address or a saved contact alias.
  const resolveRecipient = (input: string): string => {
    if (!input) return input;
    if (input.startsWith("0x")) return input;
    const hit = FAST_TRANSFER_WALLETS.find(
      (w) => w.alias.toLowerCase() === input.trim().toLowerCase(),
    );
    return hit ? hit.address : input;
  };

  try {
    // Dynamic system prompt update with language from settings + current local time
    const lang = savedSettings?.language || currentLanguage || "en";
    const now = new Date();
    const locale =
      lang === "vi"
        ? "vi-VN"
        : lang === "zh"
          ? "zh-CN"
          : lang === "fr"
            ? "fr-FR"
            : lang === "it"
              ? "it-IT"
              : "en-US";
    const timeStr = now.toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const dateStr = now.toLocaleDateString(locale, {
      weekday: "long",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    if (localChatHistory.length > 0 && localChatHistory[0].role === "system") {
      localChatHistory[0].content = buildSystemPrompt(lang, timeStr, dateStr);
    }

    localChatHistory.push({ role: "user", content: userText });

    // For non-Vietnamese languages, inject a strong reminder to prevent model defaulting to Vietnamese
    const langName = LANG_NAME_MAP[lang] || "English";
    if (lang !== "vi") {
      localChatHistory.push({
        role: "system",
        content: `[IMPORTANT: Reply in ${langName} only. Do NOT use Vietnamese.]`,
      });
    }

    const payload: any = {
      model: "qwen2.5-1.5b.gguf",
      messages: localChatHistory,
    };

    const response = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    // Remove injected language reminder from history (don't accumulate)
    if (
      lang !== "vi" &&
      localChatHistory.length > 1 &&
      localChatHistory[localChatHistory.length - 1].role === "system"
    ) {
      localChatHistory.pop();
    }

    const data = await response.json();
    const message = data.choices[0].message;

    // Helper: strip any <tag>...</tag> patterns from text before showing to user
    function cleanResponseText(text: string): string {
      if (!text) return "";
      // Remove <tool_call>...</tool_call> and any other XML-like tags
      let cleaned = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "");
      cleaned = cleaned.replace(/<\/?tool_call>/g, "");
      // Remove any leftover angle-bracket tags like <|...|>
      cleaned = cleaned.replace(/<\|[^>]*\|>/g, "");
      return cleaned.trim();
    }

    // Friendly processing messages based on tool name
    function getProcessingMessage(fnName: string): string {
      const t = translations[currentLanguage] || translations["en"];
      const msgs: Record<string, string> = {
        transfer_sui: t.processingTransfer || "💸 Processing transfer...",
        check_wallet_balance: "💰 ...",
        swap_sui_to_usdc: "🔄 ...",
        set_pomodoro_timer: "⏱️ ...",
        bonk_pet: "🥊 ...",
        send_pet_gift: "🎁 ...",
        rename_pet: "✨ ...",
        check_pet_stats: "📊 ...",
        add_fast_transfer_wallet: "📝 ...",
        remove_fast_transfer_wallet: "🗑️ ...",
        start_auto_trade: "🤖 ...",
        stop_auto_trade: "🛑 ...",
        configure_auto_trade: "⚙️ ...",
        get_auto_trade_status: "📊 ...",
        execute_desired_trade: "💹 ...",
        stop_desired_trade: "🛑 ...",
      };
      return msgs[fnName] || t.processing || "⏳ Processing...";
    }

    // Translate technical errors into friendly messages
    function friendlyError(rawError: string, action: string): string {
      const e = rawError.toLowerCase();

      // Specific (token) before generic (gas/balance) — otherwise the generic
      // "insufficient"+"coin" branch would always shadow the token message.
      if (
        e.includes("insufficientcoinbalance") ||
        e.includes("not enough coin")
      ) {
        return tt("errInsufficientToken", { action });
      }
      if (
        e.includes("insufficient") &&
        (e.includes("gas") || e.includes("balance") || e.includes("coin"))
      ) {
        return tt("errInsufficientBalance", { action });
      }
      if (e.includes("dryrunfailed") || e.includes("dry run failed")) {
        return tt("errDryRun", { action });
      }
      if (
        e.includes("network") ||
        e.includes("fetch") ||
        e.includes("econnrefused") ||
        e.includes("enotfound") ||
        e.includes("failed to fetch")
      ) {
        return tt("errNetwork", { action });
      }
      if (e.includes("timeout") || e.includes("timed out")) {
        return tt("errTimeout", { action });
      }
      if (
        e.includes("invalid") &&
        (e.includes("address") || e.includes("hex"))
      ) {
        return tt("errInvalidAddress", { action });
      }
      if (
        e.includes("object not found") ||
        e.includes("objectnotfound") ||
        e.includes("not exist")
      ) {
        return tt("errObjectNotFound", { action });
      }
      if (
        e.includes("moveabort") ||
        e.includes("execution failure") ||
        e.includes("move abort")
      ) {
        return tt("errContractReject", { action });
      }
      if (
        e.includes("429") ||
        e.includes("rate limit") ||
        e.includes("too many requests")
      ) {
        return tt("errRateLimit", { action });
      }
      if (
        e.includes("secret") ||
        e.includes("keypair") ||
        e.includes("invalid key") ||
        e.includes("cannot sign") ||
        e.includes("ephemeral")
      ) {
        return tt("errSessionExpired", { action });
      }
      if (
        e.includes("reject") ||
        e.includes("user rejected") ||
        e.includes("cancelled")
      ) {
        return tt("errUserCancelled", { action });
      }

      const short =
        rawError.length > 120 ? `${rawError.substring(0, 120)}...` : rawError;
      return tt("errGeneric", { action, error: short });
    }

    // Detect <tool_call> tags in text content
    let detectedToolCall: any = null;
    if (message.content) {
      const toolCallMatch = message.content.match(
        /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/,
      );
      if (toolCallMatch) {
        try {
          const parsed = JSON.parse(toolCallMatch[1]);
          if (parsed.name) {
            let parsedArgs = parsed.arguments;
            if (typeof parsedArgs === "string") {
              try {
                parsedArgs = JSON.parse(parsedArgs);
              } catch {
                /* keep as-is */
              }
            }
            detectedToolCall = {
              id: `call_fallback_${Date.now()}`,
              type: "function",
              function: {
                name: parsed.name,
                arguments:
                  typeof parsedArgs === "string"
                    ? parsedArgs
                    : JSON.stringify(parsedArgs || {}),
              },
            };
          }
        } catch (parseErr) {
          console.warn(
            "[Local AI] Failed to parse <tool_call> content:",
            parseErr,
          );
        }
      }
    }

    // Also check native tool_calls from llama.cpp (just in case)
    if (
      !detectedToolCall &&
      message.tool_calls &&
      message.tool_calls.length > 0
    ) {
      detectedToolCall = message.tool_calls[0];
    }

    if (detectedToolCall) {
      // Store cleaned text in history
      localChatHistory.push({
        role: "assistant",
        content: cleanResponseText(message.content || ""),
      });

      const call = detectedToolCall;
      const fnName = call.function.name;
      let args: any = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch (jsonErr) {
        console.warn(
          "[Local AI] Failed to parse tool call arguments:",
          jsonErr,
        );
      }

      // Show friendly processing message to user immediately
      (window.electronAPI as any).broadcastPetEvent(
        `chat-reply-${instanceId}`,
        { text: getProcessingMessage(fnName) },
      );

      let toolResult = "";
      if (fnName === "swap_sui_to_usdc") {
        if (!savedSettings.zkLoginSession && !savedSettings.agentSecretKey) {
          toolResult = tt("walletNotSynced");
        } else {
          try {
            // M4: validate amount is a finite positive number before use.
            const amtNum =
              typeof args.amount === "number"
                ? args.amount
                : parseFloat(args.amount);
            if (!Number.isFinite(amtNum) || amtNum <= 0) {
              toolResult = "❌ Invalid SUI amount for swap.";
            } else {
              // M3: perform a REAL SUI→USDC swap via the Cetus Aggregator
              // instead of transferring SUI to a treasury and faking the rate.
              // Mainnet is used because testnet has no USDC liquidity pool.
              const { SuiJsonRpcClient, getJsonRpcFullnodeUrl } =
                await import("@mysten/sui/jsonRpc");
              const { Transaction } = await import("@mysten/sui/transactions");
              const { AggregatorClient, Env } =
                await import("@cetusprotocol/aggregator-sdk");

              const SUI_TYPE = "0x2::sui::SUI";
              const USDC_MAINNET =
                "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
              const sender = savedSettings.suiAddress;
              const amountMist = BigInt(Math.floor(amtNum * 1_000_000_000)).toString();

              const client = new SuiJsonRpcClient({
                url: getJsonRpcFullnodeUrl("mainnet"),
                network: "mainnet",
              });
              const agg = new AggregatorClient({
                endpoint: "https://api-sui.cetus.zone/router_v3/find_routes",
                signer: sender,
                env: Env.Mainnet,
              });

              const router = await agg.findRouters({
                from: SUI_TYPE,
                target: USDC_MAINNET,
                amount: amountMist,
                byAmountIn: true,
              });
              if (!router) {
                toolResult = "❌ No SUI→USDC swap route available right now.";
              } else {
                const tx = new Transaction();
                await agg.fastRouterSwap({
                  router,
                  txb: tx,
                  slippage: 0.01,
                  refreshAllCoins: true,
                });
                tx.setSender(sender);
                const res: any = await executeTransactionWithWallet(
                  client,
                  tx,
                  savedSettings,
                );
                const status = res?.effects?.status?.status;
                const digest = res?.digest || "";
                toolResult =
                  status === "success" || (!status && digest)
                    ? `✅ Swapped ${amtNum} SUI → USDC via Cetus. Tx: ${digest.slice(0, 16)}...`
                    : `❌ Swap failed${status ? `: ${status}` : ""}.`;
              }
            }
          } catch (e: any) {
            toolResult = friendlyError(e.message || e.toString(), "Swap");
          }
        }
      } else if (fnName === "check_wallet_balance") {
        if (!savedSettings.suiAddress) {
          toolResult = "❌ Wallet not configured. Set up in Settings first.";
        } else {
          try {
            const rpcUrl = "https://fullnode.testnet.sui.io:443";
            const balRes: any = await window.electronAPI.suiRpcCall(
              "suix_getBalance",
              [savedSettings.suiAddress],
              rpcUrl,
            );
            const balance =
              parseInt(balRes?.result?.totalBalance || "0") / 1_000_000_000;
            toolResult = `Balance: ${balance.toFixed(4)} SUI`;
          } catch {
            toolResult =
              "❌ Cannot check balance. Network error, try again later.";
          }
        }
      } else if (fnName === "set_pomodoro_timer") {
        const mins = args.focus_minutes || 25;
        window.electronAPI.startPomo(mins, 5);
        toolResult = `Pomodoro set for ${mins} min.`;
      } else if (fnName === "transfer_sui") {
        if (!savedSettings.zkLoginSession && !savedSettings.agentSecretKey) {
          toolResult = tt("walletNotSynced");
        } else {
          try {
            const recipient = args.recipient_address || args.recipient || args.address || args.to;
            // M4: coerce + validate amount (finite, positive) before any tx math.
            const amountRaw = args.amount ?? args.value;
            const amount =
              typeof amountRaw === "number" ? amountRaw : parseFloat(amountRaw);

            if (!recipient || !Number.isFinite(amount) || amount <= 0) {
              toolResult = "❌ Missing recipient address or valid amount.";
            } else {
              const candidates = FAST_TRANSFER_WALLETS.filter(
                (item) =>
                  item.alias.toLowerCase() === recipient.toLowerCase() ||
                  item.address.toLowerCase() === recipient.toLowerCase(),
              );

              if (candidates.length === 0) {
                if (isValidSuiAddress(recipient)) {
                  // SECURITY: never trust a model-supplied `confirmed` flag for
                  // an un-whitelisted address. Always require explicit
                  // out-of-band user confirmation — the "ok" reply handled by
                  // handleConfirmTransfer is what actually sends.
                  pendingConfirmTransfer = { recipient, amount };
                  toolResult =
                    '⚠️ This address is not in your whitelist. Reply "ok" to confirm transfer.';
                } else {
                  toolResult = `❌ Recipient "${recipient}" is not a valid Sui address or whitelist alias.`;
                }
              } else if (candidates.length === 1) {
                const resolvedAddress = candidates[0].address;
                const { SuiJsonRpcClient, getJsonRpcFullnodeUrl } =
                  await import("@mysten/sui/jsonRpc");
                const { Transaction } =
                  await import("@mysten/sui/transactions");

                const client = new SuiJsonRpcClient({
                  url: getJsonRpcFullnodeUrl("testnet"),
                  network: "testnet",
                });

                const tx = new Transaction();
                tx.setSender(savedSettings.suiAddress);
                const [coin] = tx.splitCoins(tx.gas, [
                  Math.floor(amount * 1_000_000_000),
                ]);
                tx.transferObjects([coin], resolvedAddress);

                await executeTransactionWithWallet(client, tx, savedSettings);
                toolResult = tt("transferSuccess", {
                  amount: amount.toString(),
                  recipient: candidates[0].alias,
                });
              } else {
                pendingTransfer = {
                  recipientAlias: recipient,
                  amount,
                  candidates,
                };

                let reply = `⚠️ Multiple matches for "${recipient}":\n`;
                candidates.forEach((cand, idx) => {
                  reply += `${idx + 1}. ${cand.alias} (${cand.address.substring(0, 6)}...${cand.address.substring(cand.address.length - 4)})\n`;
                });
                reply += `Pick a number (1-${candidates.length}), enter address, or "cancel".`;
                toolResult = reply;
              }
            }
          } catch (e: any) {
            console.error("[Transfer] FULL ERROR:", e);
            toolResult = `❌ Transfer failed: ${e.message || e.toString()}\nStack: ${e.stack?.split('\n').slice(0,3).join(' | ')}`;
          }
        }
      } else if (fnName === "add_fast_transfer_wallet") {
        // M5: the whitelist is an auto-approve path for transfers, so it must
        // NOT be mutable by the model. Direct the user to add it themselves in
        // Settings (an explicit, independent action).
        const address = args.address;
        if (!isValidSuiAddress(address)) {
          toolResult = "❌ Invalid Sui address.";
        } else {
          toolResult = `🔒 For your safety, I can't add addresses to the fast-transfer whitelist. Please add ${address.slice(0, 10)}... yourself in Settings → Wallet.`;
        }
      } else if (fnName === "remove_fast_transfer_wallet") {
        const address = args.address;
        const alias = args.alias;
        if (!address && !alias) {
          toolResult = "❌ Missing address or alias to remove.";
        } else {
          const currentList = [...FAST_TRANSFER_WALLETS];
          let filteredList = currentList;
          if (address) {
            filteredList = currentList.filter(
              (w) => w.address.toLowerCase() !== address.toLowerCase(),
            );
          } else if (alias) {
            filteredList = currentList.filter(
              (w) => w.alias.toLowerCase() !== alias.toLowerCase(),
            );
          }

          if (filteredList.length < currentList.length) {
            await window.electronAPI.updateSettings({
              fastTransferWallets: filteredList,
            });
            toolResult = `✅ Removed ${alias || address} from fast transfer list.`;
          } else {
            toolResult = `ℹ️ ${alias || address} not found in list.`;
          }
        }
      } else if (
        fnName === "start_auto_trade" ||
        fnName === "stop_auto_trade" ||
        fnName === "configure_auto_trade" ||
        fnName === "get_auto_trade_status"
      ) {
        // ── Auto-trade: starts/stops the real AgentTradeEngine ──
        const wallet: "pet" | "agent" =
          String(args.wallet || "agent").toLowerCase() === "pet"
            ? "pet"
            : "agent";
        const walletLabel = wallet === "agent" ? "Agent wallet" : "Pet wallet";
        const currentAutoTrade: Record<string, any> = {
          ...(savedSettings.autoTrade || {}),
        };
        const existing = currentAutoTrade[wallet] || {};

        const describeStrategy = (cfg: any): string => {
          if (!cfg || cfg.action === undefined) return "using default config from Settings";
          const verb = cfg.action === "sell" ? "Sell" : "Buy";
          return `${verb} ${cfg.amount ?? "?"} ${cfg.token || "SUI"} every ${cfg.interval_minutes ?? 60} min`;
        };

        if (fnName === "start_auto_trade") {
          // Actually start the trade engine
          if (!savedSettings.agentSecretKey && wallet === "agent") {
            toolResult = "❌ No agent wallet found. Generate one in Settings first.";
          } else {
            currentAutoTrade[wallet] = { ...existing, enabled: true };
            await window.electronAPI.updateSettings({
              autoTrade: currentAutoTrade,
            });
            // Start AgentTradeEngine if not already running
            if (!agentTradeEngine) {
              agentTradeEngine = new AgentTradeEngine(
                {
                  budgetSui: existing.amount || 5,
                  cooldownMs: (existing.interval_minutes || 15) * 60 * 1000,
                  slippagePct: 1,
                  agentSecretKey: savedSettings.agentSecretKey || "",
                },
                (log: any) => {
                  if (log.action === "BUY" || log.action === "SELL") {
                    showSpeech(`💹 ${log.message}`, 6000, false, "auto-trade");
                  }
                },
              );
              agentTradeEngine.start();
            }
            toolResult = `✅ Started AI Agent Trade for ${walletLabel}. ${describeStrategy(existing)}`;
          }
        } else if (fnName === "stop_auto_trade") {
          currentAutoTrade[wallet] = { ...existing, enabled: false };
          await window.electronAPI.updateSettings({
            autoTrade: currentAutoTrade,
          });
          if (agentTradeEngine) {
            agentTradeEngine.stop();
            agentTradeEngine = null;
          }
          toolResult = `🛑 Stopped AI Agent Trade for ${walletLabel}.`;
        } else if (fnName === "configure_auto_trade") {
          const action = args.action === "sell" ? "sell" : "buy";
          const token = args.token || "SUI";
          const amount =
            typeof args.amount === "number"
              ? args.amount
              : parseFloat(args.amount) || existing.amount;
          const interval =
            typeof args.interval_minutes === "number"
              ? args.interval_minutes
              : parseInt(args.interval_minutes) ||
                existing.interval_minutes ||
                60;
          const newCfg = {
            enabled: existing.enabled ?? false,
            action,
            token,
            amount,
            interval_minutes: interval,
          };
          currentAutoTrade[wallet] = newCfg;
          await window.electronAPI.updateSettings({
            autoTrade: currentAutoTrade,
          });
          toolResult = `⚙️ Config saved for ${walletLabel}: ${describeStrategy(newCfg)}.`;
        } else {
          // get_auto_trade_status
          if (!existing || existing.enabled === undefined) {
            toolResult = `${walletLabel} has no trade config yet. Configure in Settings > AI Agent Trade.`;
          } else {
            toolResult = `${walletLabel} trade is ${existing.enabled ? "ON ✅" : "OFF 🛑"} — ${describeStrategy(existing)}.`;
          }
        }
      } else if (fnName === "execute_desired_trade") {
        // Owner activates the EXACT configured trade (real on-chain execution).
        const wallet: "pet" | "agent" =
          String(args.wallet || "agent").toLowerCase() === "pet"
            ? "pet"
            : "agent";
        const override: Partial<DesiredTradeConfig> & { wallet: "pet" | "agent" } = { wallet };
        if (args.action === "buy" || args.action === "sell") override.action = args.action;
        if (typeof args.token === "string" && args.token) override.token = args.token;
        const amt = typeof args.amount === "number" ? args.amount : parseFloat(args.amount);
        if (!Number.isNaN(amt) && amt > 0) override.amount = amt;
        if (args.env === "testnet" || args.env === "mainnet") override.env = args.env;
        if (args.mode === "once" || args.mode === "recurring") override.mode = args.mode;
        toolResult = await activateDesiredTrade(override);
      } else if (fnName === "stop_desired_trade") {
        toolResult = stopDesiredTrade();
      } else if (fnName === "bonk_pet") {
        if (!savedSettings.zkLoginSession && !savedSettings.agentSecretKey) {
          toolResult = tt("walletNotSynced");
        } else {
          try {
            const targetAddress = resolveRecipient(args.target_address);
            if (!targetAddress) {
              toolResult = "❌ Missing target pet address.";
            } else if (!targetAddress.startsWith("0x")) {
              toolResult = `❌ Recipient "${args.target_address}" not found. Use a 0x address or add an alias first.`;
            } else {
              const { SuiJsonRpcClient, getJsonRpcFullnodeUrl } =
                await import("@mysten/sui/jsonRpc");
              const { Transaction } = await import("@mysten/sui/transactions");

              const client = new SuiJsonRpcClient({
                url: getJsonRpcFullnodeUrl("testnet"),
                network: "testnet",
              });

              // 1. Tìm Object ID của PetNFT của người dùng
              let petObjectId = "";
              if (
                activePetConfig?.slug &&
                activePetConfig.slug.startsWith("nft-")
              ) {
                petObjectId = activePetConfig.slug.substring(4);
              } else {
                const userAddr = savedSettings.suiAddress;
                const petType =
                  "0x924f6dc9f3ea41d59c8c29aee26808fa830e68cfc84e11542836bb1b7ad5280c::pet_nft::PetNFT";
                const ownedPetsRes: any = await window.electronAPI.suiRpcCall(
                  "suix_getOwnedObjects",
                  [userAddr, { filter: { StructType: petType } }],
                  "https://fullnode.testnet.sui.io:443",
                );
                if (
                  ownedPetsRes?.result?.data &&
                  ownedPetsRes.result.data.length > 0
                ) {
                  petObjectId = ownedPetsRes.result.data[0].data.objectId;
                }
              }

              if (!petObjectId) {
                toolResult =
                  "❌ You need at least 1 MiniPet NFT to bonk. Mint a pet first!";
              } else {
                // 2. Tìm Coin<PET_TOKEN> để thanh toán phí gõ đầu
                const tokenType =
                  "0xf20998a7f30a94ead030ad6528899aafff4693900fb4b547f59882615a0c24a4::pet_token::PET_TOKEN";
                const coinsRes: any = await window.electronAPI.suiRpcCall(
                  "suix_getCoins",
                  [savedSettings.suiAddress, tokenType],
                  "https://fullnode.testnet.sui.io:443",
                );

                const coins = coinsRes?.result?.data || [];
                if (coins.length === 0) {
                  toolResult = "❌ Not enough MIPET! Bonk fee is 100 MIPET.";
                } else {
                  const totalBalance = coins.reduce(
                    (acc: number, c: any) => acc + parseInt(c.balance || "0"),
                    0,
                  );
                  const requiredFee = 100 * 1_000_000_000;
                  if (totalBalance < requiredFee) {
                    toolResult = `❌ Not enough MIPET! Have ${(totalBalance / 1_000_000_000).toFixed(2)}, need 100 MIPET.`;
                  } else {
                    const tx = new Transaction();
                    const primaryCoin = coins[0].coinObjectId;
                    if (coins.length > 1) {
                      tx.mergeCoins(
                        tx.object(primaryCoin),
                        coins
                          .slice(1)
                          .map((c: any) => tx.object(c.coinObjectId)),
                      );
                    }

                    // Gọi hàm bonk_pet trong Move contract
                    tx.moveCall({
                      target:
                        "0x924f6dc9f3ea41d59c8c29aee26808fa830e68cfc84e11542836bb1b7ad5280c::pet_nft::bonk_pet",
                      arguments: [
                        tx.object(
                          "0xc5345d14d5abd2b26014d8ce6f190349eb587d385593429d25f65dfdc067a958",
                        ), // GlobalConfig ID
                        tx.object(petObjectId),
                        tx.object(primaryCoin),
                        tx.pure.address(targetAddress),
                      ],
                    });

                    await executeTransactionWithWallet(
                      client,
                      tx,
                      savedSettings,
                    );
                    toolResult = `✅ Bonked successfully!`;
                  }
                }
              }
            }
          } catch (e: any) {
            toolResult = friendlyError(e.message || e.toString(), "Bonk");
          }
        }
      } else if (fnName === "send_pet_gift") {
        if (!savedSettings.zkLoginSession && !savedSettings.agentSecretKey) {
          toolResult = tt("walletNotSynced");
        } else {
          try {
            const recipient = resolveRecipient(args.recipient_address);
            const amount = args.amount;
            const msgText = args.message;

            if (!recipient || amount === undefined || msgText === undefined) {
              toolResult =
                "❌ Missing info. Need recipient address, SUI amount, and message.";
            } else if (!recipient.startsWith("0x")) {
              toolResult = `❌ Recipient "${args.recipient_address}" not found. Use a 0x address or add an alias first.`;
            } else {
              const { SuiJsonRpcClient, getJsonRpcFullnodeUrl } =
                await import("@mysten/sui/jsonRpc");
              const { Transaction } = await import("@mysten/sui/transactions");

              const client = new SuiJsonRpcClient({
                url: getJsonRpcFullnodeUrl("testnet"),
                network: "testnet",
              });

              // 1. Tìm Object ID của PetNFT của người dùng
              let petObjectId = "";
              if (
                activePetConfig?.slug &&
                activePetConfig.slug.startsWith("nft-")
              ) {
                petObjectId = activePetConfig.slug.substring(4);
              } else {
                const userAddr = savedSettings.suiAddress;
                const petType =
                  "0x924f6dc9f3ea41d59c8c29aee26808fa830e68cfc84e11542836bb1b7ad5280c::pet_nft::PetNFT";
                const ownedPetsRes: any = await window.electronAPI.suiRpcCall(
                  "suix_getOwnedObjects",
                  [userAddr, { filter: { StructType: petType } }],
                  "https://fullnode.testnet.sui.io:443",
                );
                if (
                  ownedPetsRes?.result?.data &&
                  ownedPetsRes.result.data.length > 0
                ) {
                  petObjectId = ownedPetsRes.result.data[0].data.objectId;
                }
              }

              if (!petObjectId) {
                toolResult =
                  "❌ You need at least 1 MiniPet NFT to send gifts. Mint a pet first!";
              } else {
                const tx = new Transaction();
                const [paymentCoin] = tx.splitCoins(tx.gas, [
                  Math.floor(amount * 1_000_000_000),
                ]);

                // Gọi hàm send_message trong Move contract
                tx.moveCall({
                  target:
                    "0x924f6dc9f3ea41d59c8c29aee26808fa830e68cfc84e11542836bb1b7ad5280c::pet_nft::send_message",
                  arguments: [
                    tx.object(petObjectId),
                    paymentCoin,
                    tx.pure.address(recipient),
                    tx.pure.vector(
                      "u8",
                      Array.from(new TextEncoder().encode(msgText)),
                    ),
                  ],
                });

                maybeAppendLevelUp(tx);

                await executeTransactionWithWallet(client, tx, savedSettings);
                toolResult = `✅ Sent ${amount} SUI with message "${msgText}".`;
              }
            }
          } catch (e: any) {
            toolResult = friendlyError(e.message || e.toString(), "Gift");
          }
        }
      } else if (fnName === "rename_pet") {
        if (!savedSettings.zkLoginSession && !savedSettings.agentSecretKey) {
          toolResult = tt("walletNotSynced");
        } else {
          try {
            const newName = (args.new_name || args.name || "")
              .toString()
              .trim();
            if (!newName) {
              toolResult = "❌ Missing new pet name.";
            } else if (newName.length > 32) {
              toolResult = "❌ Name too long (max 32 characters).";
            } else {
              const { SuiJsonRpcClient, getJsonRpcFullnodeUrl } =
                await import("@mysten/sui/jsonRpc");
              const { Transaction } = await import("@mysten/sui/transactions");
              const client = new SuiJsonRpcClient({
                url: getJsonRpcFullnodeUrl("testnet"),
                network: "testnet",
              });

              const PKG =
                "0x924f6dc9f3ea41d59c8c29aee26808fa830e68cfc84e11542836bb1b7ad5280c";
              const CONFIG_ID =
                "0xc5345d14d5abd2b26014d8ce6f190349eb587d385593429d25f65dfdc067a958";
              const TOKEN_TYPE =
                "0xf20998a7f30a94ead030ad6528899aafff4693900fb4b547f59882615a0c24a4::pet_token::PET_TOKEN";

              // 1. Tìm PetNFT của người dùng
              let petObjectId = "";
              if (
                activePetConfig?.slug &&
                activePetConfig.slug.startsWith("nft-")
              ) {
                petObjectId = activePetConfig.slug.substring(4);
              } else {
                const petType = `${PKG}::pet_nft::PetNFT`;
                const ownedPetsRes: any = await window.electronAPI.suiRpcCall(
                  "suix_getOwnedObjects",
                  [
                    savedSettings.suiAddress,
                    { filter: { StructType: petType } },
                  ],
                  "https://fullnode.testnet.sui.io:443",
                );
                if (
                  ownedPetsRes?.result?.data &&
                  ownedPetsRes.result.data.length > 0
                ) {
                  petObjectId = ownedPetsRes.result.data[0].data.objectId;
                }
              }

              if (!petObjectId) {
                toolResult =
                  "❌ You need at least 1 MiniPet NFT to rename. Mint a pet first!";
              } else {
                // 2. Gom Coin<PET_TOKEN> để trả phí đổi tên
                const coinsRes: any = await window.electronAPI.suiRpcCall(
                  "suix_getCoins",
                  [savedSettings.suiAddress, TOKEN_TYPE],
                  "https://fullnode.testnet.sui.io:443",
                );
                const coins = coinsRes?.result?.data || [];
                if (coins.length === 0) {
                  toolResult = "❌ No MIPET in wallet to pay rename fee!";
                } else {
                  const tx = new Transaction();
                  const primaryCoin = coins[0].coinObjectId;
                  if (coins.length > 1) {
                    tx.mergeCoins(
                      tx.object(primaryCoin),
                      coins.slice(1).map((c: any) => tx.object(c.coinObjectId)),
                    );
                  }
                  tx.moveCall({
                    target: `${PKG}::pet_nft::rename_pet`,
                    arguments: [
                      tx.object(CONFIG_ID),
                      tx.object(petObjectId),
                      tx.object(primaryCoin),
                      tx.pure.vector(
                        "u8",
                        Array.from(new TextEncoder().encode(newName)),
                      ),
                    ],
                  });
                  await executeTransactionWithWallet(client, tx, savedSettings);
                  toolResult = `✅ Pet renamed to "${newName}".`;
                }
              }
            }
          } catch (e: any) {
            toolResult = friendlyError(e.message || e.toString(), "Rename");
          }
        }
      } else if (fnName === "check_pet_stats") {
        try {
          const PKG =
            "0x924f6dc9f3ea41d59c8c29aee26808fa830e68cfc84e11542836bb1b7ad5280c";
          if (!savedSettings.suiAddress) {
            toolResult = "❌ Wallet not configured. Set up in Settings first.";
          } else {
            const petType = `${PKG}::pet_nft::PetNFT`;
            const ownedRes: any = await window.electronAPI.suiRpcCall(
              "suix_getOwnedObjects",
              [
                savedSettings.suiAddress,
                {
                  filter: { StructType: petType },
                  options: { showContent: true },
                },
              ],
              "https://fullnode.testnet.sui.io:443",
            );
            const data = ownedRes?.result?.data || [];
            if (data.length === 0) {
              toolResult =
                "❌ You don't own any MiniPet NFT. Mint a pet first!";
            } else {
              const f = data[0]?.data?.content?.fields || {};
              const name = f.name || "Pet";
              toolResult = `${name} — Lv.${f.level ?? "?"}, EXP ${f.experience ?? "?"}, Happy ${f.happiness ?? "?"}/100, Rarity ${f.rarity ?? "?"}, Perfection ${f.perfection_score ?? "?"}.`;
            }
          }
        } catch {
          toolResult =
            "❌ Cannot read pet stats. Network error, try again later.";
        }
      } else {
        toolResult = "❌ Unknown tool command.";
      }

      // Check if the tool result indicates an error/failure
      const isError =
        /fail|error|fail|error|not enough|missing|no .* configured|unknown/i.test(
          toolResult,
        );

      if (isError) {
        // Show error directly — don't let the model misinterpret it
        localChatHistory.push({ role: "assistant", content: toolResult });
        (window.electronAPI as any).broadcastPetEvent(
          `chat-reply-${instanceId}`,
          { text: toolResult },
        );
      } else {
        // Success — show the tool result directly (it's already user-friendly)
        localChatHistory.push({ role: "assistant", content: toolResult });
        (window.electronAPI as any).broadcastPetEvent(
          `chat-reply-${instanceId}`,
          { text: toolResult },
        );
      }
    } else {
      // Regular chat response — clean any stray tags before showing
      const cleanText = cleanResponseText(message.content || "");
      localChatHistory.push({ role: "assistant", content: cleanText });
      (window.electronAPI as any).broadcastPetEvent(
        `chat-reply-${instanceId}`,
        { text: cleanText },
      );
    }
  } catch (err: any) {
    console.error("Local AI error:", err);
    (window.electronAPI as any).broadcastPetEvent(`chat-reply-${instanceId}`, {
      text: "Oops, my brain is not ready yet.",
    });
  }
}

init().catch(console.error);

// --- Debug mode (press D to toggle) ---
let debugMode = false;
let debugTimer: ReturnType<typeof setInterval> | null = null;

document.addEventListener("keydown", (e) => {
  if (e.key !== "d" && e.key !== "D") return;
  debugMode = !debugMode;
  const canvas = document.getElementById(
    "pet-canvas",
  ) as HTMLCanvasElement | null;
  const panel = document.getElementById("debug-overlay") as HTMLElement | null;
  if (!canvas || !panel) return;
  canvas.classList.toggle("debug", debugMode);
  panel.classList.toggle("visible", debugMode);
  document.body.classList.toggle("debug", debugMode);

  if (debugMode) {
    debugTimer = setInterval(() => {
      const dpr = window.devicePixelRatio || 1;
      const lx = (window.screenX / dpr).toFixed(1);
      const ly = (window.screenY / dpr).toFixed(1);
      panel.textContent =
        `id: ${instanceId}\n` +
        `pos: ${lx}, ${ly} (logical)\n` +
        `size: ${window.innerWidth}x${window.innerHeight} (logical)\n` +
        `dpr: ${dpr}\n` +
        `scale: ${currentScale.toFixed(2)}`;
    }, 200);
  } else {
    if (debugTimer) {
      clearInterval(debugTimer);
      debugTimer = null;
    }
    panel.textContent = "";
  }
});
