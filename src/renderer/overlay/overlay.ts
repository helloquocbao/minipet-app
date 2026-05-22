import { SpriteRenderer } from './engine/sprite-renderer';
import { AnimationController } from './engine/animation-controller';
import { PetStateMachine } from './engine/pet-state-machine';
import { PETDEX_SPRITE, INTERACTION } from '../../shared/constants';
import { translations, Language } from '../../shared/i18n/translations';
import { SuiMonitor } from '../blockchain/monitor';
import { getAllWebviewWindows } from '@tauri-apps/api/webviewWindow';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { SecurityAgent } from '../blockchain/agent';

let statusAlarming = false;
let currentScale = 1.0;
let isSpeechVisible = false;
let speechTimeout: NodeJS.Timeout | null = null;
let currentLanguage: Language = 'en';
let instanceId: string | null = null;
let lastGlobalSpeechTime = 0;
let controller: AnimationController;
let stateMachine: PetStateMachine;
let currentSpeechText = '';
let suiMonitor: SuiMonitor | null = null;
let securityAgent: SecurityAgent | null = null;
let currentActivePets: any[] = [];
let speechWindowRef: any = null;
let lastContextKey = '';
let lastCommentTime = 0;
let isChatActive = false;

async function getOrCreateSpeechWindow() {
  if (speechWindowRef) return speechWindowRef;
  const label = `speech-${instanceId}`;
  
  const allWindows = await getAllWebviewWindows();
  let win = allWindows.find(w => w.label === label);
  
  if (!win) {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
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
  speechWindowRef = win;
  return win;
}

async function syncSpeechWindowPosition() {
  if (!speechWindowRef || !isSpeechVisible) return;
  const pos = window.electronAPI.getLogicalPosition();
  if (pos.x === null || pos.y === null) return;
  
  const safeScale = Number(currentScale) || 1.0;
  const petWidth = Math.ceil(PETDEX_SPRITE.FRAME_WIDTH * safeScale);
  
  const speechW = 260;
  const speechH = 160;
  const newX = pos.x + (petWidth / 2) - (speechW / 2);
  const newY = pos.y - speechH + 20; 
  
  const { LogicalPosition } = await import('@tauri-apps/api/window');
  await speechWindowRef.setPosition(new LogicalPosition(newX, newY));
}

function isChosenToSpeak(seedStr: string): boolean {
  if (!currentActivePets || currentActivePets.length === 0) return true;
  const sortedIds = currentActivePets.map(p => p.id).sort();
  const myIndex = sortedIds.indexOf(instanceId!);
  if (myIndex === -1) return true;

  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = ((hash << 5) - hash) + seedStr.charCodeAt(i);
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
  if (opt.length === 0) return '';

  const array = new Uint32Array(1);
  window.crypto.getRandomValues(array);
  const randomIndex = array[0] % opt.length;

  return opt[randomIndex];
}

/**
 * Initializes the overlay pet instance.
 */
async function init(): Promise<void> {
  // Setup Tauri API shim before any window.electronAPI calls
  const { setupElectronShim } = await import('../../lib/electron-shim');
  setupElectronShim();

  const params = new URLSearchParams(window.location.search);
  instanceId = params.get('id');
  console.log('[Overlay] init, instanceId:', instanceId, 'href:', window.location.href);

  if (!instanceId) {
    console.error('[Overlay] No instanceId provided.');
    return;
  }

  const canvas = document.getElementById('pet-canvas') as HTMLCanvasElement;

  // 1. Fetch pet instance configuration
  let petData: any;
  try {
    petData = await window.electronAPI.getInstanceConfig(instanceId);
    console.log('[Overlay] petData:', JSON.stringify(petData));
  } catch (e) {
    console.error('[Overlay] getInstanceConfig failed:', e);
    return;
  }
  if (!petData) {
    console.error('[Overlay] petData is null');
    return;
  }

  // 2. Initialize the sprite renderer
  const renderer = new SpriteRenderer(
    canvas,
    PETDEX_SPRITE.FRAME_WIDTH,
    PETDEX_SPRITE.FRAME_HEIGHT
  );

  // 3. Load the pet spritesheet
  if (petData?.spritesheetPath) {
    try {
      console.log('[Overlay] Loading spritesheet:', petData.spritesheetPath);
      await renderer.loadSpritesheet(petData.spritesheetPath);
      console.log('[Overlay] Spritesheet loaded OK');
    } catch (err) {
      console.error('[Overlay] Failed to load spritesheet:', err);
    }
  }

  // 4. Initialize animation controllers and state machine
  const savedSettings: any = await window.electronAPI.getSettings();
  currentActivePets = savedSettings?.activePets || [];
  const initialScale = Number(petData.scale || savedSettings?.scale) || 1.0;
  const isWalkingEnabled = savedSettings?.enableWalking !== false;
  currentLanguage = savedSettings?.language || 'en';

  controller = new AnimationController(renderer, instanceId!);
  stateMachine = new PetStateMachine(controller, initialScale, isWalkingEnabled);
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
  syncWindowSize();

  // --- Multi-Pet: Chasing Logic ---
  window.electronAPI.onPositionsUpdate((data: any) => {
    const { positions } = data;
    // Identify other pet instances
    const otherPets = positions.filter((p: any) => p.id !== instanceId);
    if (otherPets.length > 0) {
      // Small chance (5%) for a pet to "chase" another when walking
      if (Math.random() < 0.05 && stateMachine.getState() === 'walk') {
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
      showSpeech(getRandomPingSpeech(), INTERACTION.SPEECH_DURATION_DEFAULT, false, 'Ping');
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
    if (!isChosenToSpeak('pomo_' + sessionType)) return;
    const t = translations[currentLanguage];
    const randomBuffer = new Uint32Array(1);
    window.crypto.getRandomValues(randomBuffer);
    const delay = randomBuffer[0] % 2500;

    setTimeout(() => {
      const choices = sessionType === 'focus' ? t.pomoFinishedWork : t.pomoFinishedBreak;
      const msg = pickUniqueRandom(choices);
      if (msg) showSpeech(msg, INTERACTION.SPEECH_DURATION_LONG, false, 'Pomo');
    }, delay);
  });

  setupRandomSpeech(stateMachine);
  setupContextMonitoring();

  // --- Settings Update Handling ---
  window.electronAPI.onSettingsUpdate(async (data: any) => {
    const { settings } = data;
    currentActivePets = settings.activePets || [];
    currentLanguage = settings.language || 'en';
    console.log('[Overlay] Settings updated, language:', currentLanguage);

    // Find this instance's specific configuration
    const myInstance = settings.activePets.find((p: any) => p.id === instanceId);
    if (myInstance) {
      currentScale = myInstance.scale || settings.scale;
      stateMachine.setScale(currentScale);
      stateMachine.setWalkingEnabled(settings.enableWalking);
      controller.setWalkingEnabled(settings.enableWalking);
      syncWindowSize();
    }
  });

  // --- Intelligence & Sync ---
  window.electronAPI.onPetSay((payload: string | { text: string; priority?: boolean }) => {
    let text: string;
    let priority = false;
    if (typeof payload === 'object' && payload !== null) {
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
        'intelWebYoutube', 'intelWebSocial', 'intelWebDev', 'intelWebAI',
        'intelWebDesign', 'intelAppCode', 'intelAppWeb', 'intelAppMusic',
        'intelAppChat', 'intelAppTerminal', 'intelAppDesign', 'intelAppMeeting',
        'intelAppProductivity', 'intelAppFinder', 'intelAppDefault',
        'intelTimeLate', 'intelTimeLunch'
      ];

      for (const cat of categories) {
        const variants = t[cat];
        if (Array.isArray(variants) && variants.includes(text)) {
          speechToSay = pickUniqueRandom(variants);
          break;
        }
      }
    }

    showSpeech(speechToSay, INTERACTION.SPEECH_DURATION_DEFAULT, priority, 'Intel');
  });

  window.electronAPI.onSomeoneSpeaking(() => {
    lastGlobalSpeechTime = Date.now();
  });

  setupMouseInteraction(canvas, stateMachine);

  // --- Master Election for Blockchain Monitor ---
  setupMasterElection();

  // --- Blockchain Events ---
  window.electronAPI.onBlockchainEvent((event: any) => {
    if (!isChosenToSpeak(JSON.stringify(event))) return;
    console.log('[Overlay] Blockchain event received:', event);
    console.log('[Overlay] Current Language:', currentLanguage);

    const lang = (currentLanguage && translations[currentLanguage]) ? currentLanguage : 'en';
    const t = translations[lang];
    console.log('[Overlay] Using translation keys:', Object.keys(t).slice(0, 5), '...');
    console.log('[Overlay] Event type:', event.event_type);
    const amountStr = (event.amount / 1000000000).toFixed(3);

    if (event.event_type === 'message') {
      stateMachine.forceState('happy');
      let msg = t.blockchainMessage || '{pet}: {message} (+{amount} {coin})';
      msg = msg.replace('{pet}', event.pet_slug || 'Someone')
        .replace('{message}', event.message || '')
        .replace('{amount}', amountStr)
        .replace('{coin}', event.coin_type || 'SUI');
      console.log('[Overlay] Showing blockchain message:', msg);
      showSpeech(msg, 7000, true, 'Blockchain:Message');
    } else if (event.event_type === 'bonk') {
      stateMachine.forceState('jump');
      let msg = t.blockchainBonk || '{pet} bonked me! (-{amount} {coin})';
      msg = msg.replace('{pet}', event.pet_slug || 'Someone')
        .replace('{amount}', amountStr)
        .replace('{coin}', event.coin_type || 'SUI');
      console.log('[Overlay] Showing blockchain bonk:', msg);
      showSpeech(msg, 5000, true, 'Blockchain:Bonk');
    } else if (event.event_type === 'receive_coin') {
      // If we just showed a message or bonk in this SAME tick, receive_coin should win
      stateMachine.forceState('happy');

      const variations = t.blockchainReceiveCoin || [
        `Wow! Just received {amount} {coin}! 🚀`
      ];

      let randomMsg = variations[Math.floor(Math.random() * variations.length)];
      randomMsg = randomMsg.replace('{amount}', amountStr)
        .replace('{coin}', event.coin_type || 'SUI');

      console.log('[Overlay] Showing blockchain receive:', randomMsg);
      showSpeech(randomMsg, 8000, true, 'Blockchain:Receive');
    } else if (event.event_type === 'send_coin') {
      stateMachine.forceState('jump'); // Maybe a bit surprised/active

      const variations = t.blockchainSendCoin || [
        `Sent {amount} {coin}. 👋`
      ];

      let randomMsg = variations[Math.floor(Math.random() * variations.length)];
      randomMsg = randomMsg.replace('{amount}', amountStr)
        .replace('{coin}', event.coin_type || 'SUI');

      console.log('[Overlay] Showing blockchain send:', randomMsg);
      showSpeech(randomMsg, 6000, true, 'Blockchain:Send');
    }
  });

  // --- Real-time Speech Sync (Event Driven) ---
  window.electronAPI.onWindowMoved((_x: number, _y: number) => {
    if (isSpeechVisible && currentSpeechText) {
      syncSpeechWindowPosition();
    }
  });

  // --- AI Chat Events ---
  (window.electronAPI as any).onCustomEvent(`chat-mode-toggle-${instanceId}`, (payload: any) => {
    if (payload && payload.active === false) {
      toggleChatMode(false);
    }
  });

  (window.electronAPI as any).onCustomEvent(`user-chat-submit-${instanceId}`, (payload: any) => {
    if (payload && payload.text) {
      handleLocalChat(payload.text);
    }
  });

  // --- Local AI Bootup Logic ---
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  
  try {
    const hasModel = await invoke('check_model_exists');
    if (!hasModel) {
      const lang = (currentLanguage && translations[currentLanguage]) ? currentLanguage : 'en';
      const t = translations[lang];
      
      let initialMsg = t.modelDownloading || "Downloading brain...";
      initialMsg = initialMsg
        .replace('{percent}', '0.0')
        .replace('{downloaded}', '0.0')
        .replace('{total}', '398.0');
      showSpeech(initialMsg, 999999, true, 'System');
      
      let lastPercentInt = -1;
      const unlisten = await listen('model-download-progress', (event: any) => {
        const payload = event.payload as any;
        const percentNum = payload.progress;
        const percentInt = Math.floor(percentNum);
        
        if (percentInt !== lastPercentInt) {
          lastPercentInt = percentInt;
          const percentStr = percentNum.toFixed(1);
          const downloadedMB = (payload.downloaded / 1048576).toFixed(1);
          const totalMB = (payload.total / 1048576).toFixed(1);
          
          const currentLang = (currentLanguage && translations[currentLanguage]) ? currentLanguage : 'en';
          const currentT = translations[currentLang];
          
          let progressMsg = currentT.modelDownloading || "Downloading brain...";
          progressMsg = progressMsg
            .replace('{percent}', percentStr)
            .replace('{downloaded}', downloadedMB)
            .replace('{total}', totalMB);
            
          showSpeech(progressMsg, 999999, true, 'System');
        }
      });
      
      await invoke('download_model');
      unlisten();
      
      const postLang = (currentLanguage && translations[currentLanguage]) ? currentLanguage : 'en';
      const postT = translations[postLang];
      showSpeech(postT.modelDownloadComplete || "Tải xong rồi! Đang khởi động não...", 4000, true, 'System');
    }
    
    await invoke('start_ai_server');
    console.log("[Local AI] Server started on port 8080");
  } catch (err) {
    console.error("[Local AI] Boot failed:", err);
  }
}

/**
 * Ensures only one pet window runs the SuiMonitor to stay within RPC rate limits.
 * The window with the alphabetically lowest label is elected as Master.
 */
async function setupMasterElection() {
  const checkMaster = async () => {
    try {
      const allWindows = await getAllWebviewWindows();
      const overlayWindows = allWindows.filter(w => w.label.startsWith('overlay-'));
      const sortedLabels = overlayWindows.map(w => w.label).sort();
      const currentWin = getCurrentWebviewWindow();
      const myLabel = currentWin.label;

      if (myLabel === sortedLabels[0]) {
        if (!suiMonitor) {
          console.log(`[Overlay] ${myLabel} elected as Master. Starting SuiMonitor.`);
          suiMonitor = new SuiMonitor();
        }
        if (!securityAgent) {
          console.log(`[Overlay] ${myLabel} elected as Master. Starting SecurityAgent.`);
          securityAgent = new SecurityAgent();
          securityAgent.start();
        }
      } else {
        if (suiMonitor) {
          console.log(`[Overlay] ${myLabel} is no longer Master. Stopping SuiMonitor.`);
          (suiMonitor as any).stopPolling?.();
          suiMonitor = null;
        }
        if (securityAgent) {
          console.log(`[Overlay] ${myLabel} is no longer Master. Stopping SecurityAgent.`);
          securityAgent.stop();
          securityAgent = null;
        }
      }
    } catch (err) {
      console.error('[Overlay] Master election failed:', err);
    }
  };

  // Initial check
  await checkMaster();

  // Re-elect every 10 seconds in case windows are closed/opened
  setInterval(checkMaster, 10000);
}

/**
 * Sets up mouse and drag-and-drop interactions.
 */
function setupMouseInteraction(canvas: HTMLCanvasElement, stateMachine: PetStateMachine): void {
  let isDragging = false;
  let wasDragged = false;
  let startX = 0;
  let startY = 0;

  canvas.addEventListener('mousedown', e => {
    if (e.button === 0) {
      e.preventDefault();

      // 1. Instant response: focus and pause autonomous movement
      window.electronAPI.focus();
      controller.pauseMovement(true);

      // 2. Native drag: buttery smooth and bypasses focus lag
      // Some systems may need a manual fallback if startDragging fails
      window.electronAPI.startDragging();

      isDragging = true;
      wasDragged = false;
      startX = e.screenX;
      startY = e.screenY;

      // 3. UI state
      stateMachine.forceState('drag');
      window.electronAPI.setIgnoreMouseEvents(false);
    }
  });

  window.addEventListener('mousemove', e => {
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
      stateMachine.transitionTo('idle');
      controller.resetPosition();
      controller.pauseMovement(false);

      if (instanceId) {
        window.electronAPI.savePosition(instanceId);
      }
    }
  };

  window.addEventListener('mouseup', stopDragging);
  window.addEventListener('blur', stopDragging);

  let clickCount = 0;
  let clickTimer: NodeJS.Timeout | null = null;

  canvas.addEventListener('click', () => {
    if (statusAlarming) {
      window.electronAPI.stopAlarm();
      hideSpeech();
      return;
    }

    if (wasDragged) return;

    clickCount++;
    if (clickTimer) clearTimeout(clickTimer);

    const t = translations[currentLanguage];

    if (clickCount === 1) {
      stateMachine.forceState('happy');
      showSpeech(pickUniqueRandom(t.hello));
    } else if (clickCount === 2) {
      conversationHistory = [];
      toggleChatMode(true);
    } else if (clickCount >= 3) {
      if (stateMachine.getWalkingEnabled()) {
        stateMachine.forceState('run');
        showSpeech(pickUniqueRandom(t.run));
      } else {
        stateMachine.forceState('happy');
        showSpeech(t.movingDisabled);
      }
    }

    clickTimer = setTimeout(() => {
      clickCount = 0;
      clickTimer = null;
    }, 600);
  });

  canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    window.electronAPI.openSettings();
  });

  // --- Click-through management removed for reliability ---
  // Since the window is now tightly fitted to the pet size, 
  // we no longer need complex ignore logic which was causing focus issues.

  /**
   * Drag-and-drop file eating handlers using native Tauri events.
   */
  window.electronAPI.onDragDrop(async (type: string, paths: string[]) => {
    if (type === 'enter') {
      stateMachine.forceState('jump');
    } else if (type === 'leave') {
      stateMachine.transitionTo('idle');
    } else if (type === 'drop') {

      if (!paths || paths.length === 0) {
        stateMachine.transitionTo('idle');
        return;
      }

      const t = translations[currentLanguage];
      stateMachine.forceState('eat');
      showSpeech(pickUniqueRandom(t.eating), INTERACTION.SPEECH_DURATION_DEFAULT, false, 'Eat');

      try {
        const result: any = await window.electronAPI.eatFile(paths);
        if (result && !result.success) {
          showSpeech(pickUniqueRandom(t.hello), INTERACTION.SPEECH_DURATION_DEFAULT, false, 'EatError');
        }
      } catch (err) {
        console.error('Overlay: Failed to eat file:', err);
      } finally {
        setTimeout(() => {
          stateMachine.transitionTo('idle');
        }, 1000);
      }
    }
  });
}

/**
 * Updates the internal speech bubble text and visibility.
 */
async function updateSpeechOverlay(text: string, visible: boolean) {
  try {
    const win = await getOrCreateSpeechWindow();
    if (visible) {
      await win.show();
      await syncSpeechWindowPosition();
    }
    // Gửi event sang speech window
    window.electronAPI.broadcastPetEvent(`update-speech-${instanceId}`, { text, visible });
    
    if (!visible) {
      setTimeout(() => win.hide(), 350);
    }
  } catch (err) {
    console.error('Failed to update speech window:', err);
  }
}

async function syncWindowSize(): Promise<void> {
  const safeScale = Number(currentScale) || 1.0;
  const petWidth = Math.ceil(PETDEX_SPRITE.FRAME_WIDTH * safeScale);
  const petHeight = Math.ceil(PETDEX_SPRITE.FRAME_HEIGHT * safeScale);

  const canvas = document.getElementById('pet-canvas') as HTMLCanvasElement;
  if (canvas) {
    canvas.style.width = `${petWidth}px`;
    canvas.style.height = `${petHeight}px`;
  }

  // Khung xanh bây giờ chỉ bao bọc đúng con Pet (khung đỏ)
  const winWidth = petWidth;
  const winHeight = petHeight;

  try {
    await window.electronAPI.resizeKeepBottom(winWidth, winHeight);
  } catch (err) {
    console.error('Failed to resize window:', err);
  }
  
  if (isSpeechVisible) {
    syncSpeechWindowPosition();
  }
}

/**
 * Displays a speech bubble with the given text for a specific duration.
 */
function showSpeech(text: string, duration: number = INTERACTION.SPEECH_DURATION_DEFAULT, priority: boolean = false, source: string = 'unknown'): void {
  console.log(`[Overlay] showSpeech from ${source}: "${text}" (priority: ${priority})`);
  if (isChatActive) {
    console.log('[Overlay] Skipping speech because chat mode is active.');
    return;
  }
  if (speechTimeout) clearTimeout(speechTimeout);
  if (!priority && isSpeechVisible) {
    if ((window as any).isCurrentSpeechPriority) {
      console.log('[Overlay] Skipping non-priority speech as priority speech is visible.');
      return;
    }
  }

  isSpeechVisible = true;
  currentSpeechText = text;
  (window as any).isCurrentSpeechPriority = priority;

  // Use separate speech window
  updateSpeechOverlay(text, true);
  syncWindowSize(); // Phình to cửa sổ ra để chứa chữ

  // Notify other pets to stay silent
  window.electronAPI.notifySpeaking();

  if (!isChatActive) {
    speechTimeout = setTimeout(hideSpeech, duration);
  }
}

function toggleChatMode(active: boolean) {
  isChatActive = active;
  if (!active) {
    hideSpeech();
  }
  const t = translations[currentLanguage] || translations['en'];
  const welcomeText = t.askMeAnything || 'Ask me anything! 🧠';
  (window.electronAPI as any).broadcastPetEvent(`chat-mode-${instanceId}`, { active, welcomeText });
}

function hideSpeech(): void {
  isChatActive = false;
  isSpeechVisible = false;
  currentSpeechText = '';
  (window as any).isCurrentSpeechPriority = false;
  updateSpeechOverlay('', false);
  syncWindowSize(); // Thu gọn cửa sổ lại sát rịt con Pet

  if (speechTimeout) {
    clearTimeout(speechTimeout);
    speechTimeout = null;
  }
  
  (window.electronAPI as any).broadcastPetEvent(`chat-mode-${instanceId}`, { active: false });
}

/**
 * Returns a random speech text for ping responses.
 */
function getRandomPingSpeech(): string {
  const lang = (currentLanguage && translations[currentLanguage]) ? currentLanguage : 'en';
  const t = translations[lang];
  const choices = Array.isArray(t.pingResponses) ? t.pingResponses : (Array.isArray(t.hello) ? t.hello : ['🐾', '❤️', '✨']);
  return pickUniqueRandom(choices);
}

/**
 * Sets up a background interval for occasional random speech.
 */
function setupRandomSpeech(stateMachine: PetStateMachine): void {
  setInterval(() => {
    // Only speak randomly if no one has spoken recently across all instances
    const timeSinceLastSpeech = Date.now() - lastGlobalSpeechTime;

    if (!isSpeechVisible && !statusAlarming && timeSinceLastSpeech > INTERACTION.SPEECH_SYNC_COOLDOWN && Math.random() < INTERACTION.RANDOM_SPEECH_CHANCE) {
      const state = stateMachine.getState();
      const t = translations[currentLanguage];

      if (state === 'sleep') {
        showSpeech('Zzz...');
      } else {
        const choices = t.randomSpeeches || ['🐾', '❤️', '✨'];
        showSpeech(pickUniqueRandom(choices), INTERACTION.SPEECH_DURATION_DEFAULT, false, 'Random');
      }
    }
  }, INTERACTION.RANDOM_SPEECH_INTERVAL);
}

function getSpeechCategory(appName: string, tabTitle: string | null): string {
  const appLower = appName.toLowerCase();
  
  // 1. If it's a browser, check the tab title first
  if (
    appLower.includes('chrome') ||
    appLower.includes('safari') ||
    appLower.includes('arc') ||
    appLower.includes('firefox') ||
    appLower.includes('brave') ||
    appLower.includes('browser')
  ) {
    if (tabTitle) {
      const tabLower = tabTitle.toLowerCase();
      if (tabLower.includes('youtube')) return 'intelWebYoutube';
      if (
        tabLower.includes('facebook') ||
        tabLower.includes('twitter') ||
        tabLower.includes('x.com') ||
        tabLower.includes('reddit') ||
        tabLower.includes('instagram') ||
        tabLower.includes('linkedin') ||
        tabLower.includes('tiktok')
      ) {
        return 'intelWebSocial';
      }
      if (
        tabLower.includes('github') ||
        tabLower.includes('stack overflow') ||
        tabLower.includes('stackoverflow') ||
        tabLower.includes('npm') ||
        tabLower.includes('localhost') ||
        tabLower.includes('docs') ||
        tabLower.includes('documentation') ||
        tabLower.includes('sui')
      ) {
        return 'intelWebDev';
      }
      if (
        tabLower.includes('chatgpt') ||
        tabLower.includes('claude') ||
        tabLower.includes('gemini') ||
        tabLower.includes('openai') ||
        tabLower.includes('v0.dev')
      ) {
        return 'intelWebAI';
      }
      if (
        tabLower.includes('figma') ||
        tabLower.includes('canva') ||
        tabLower.includes('dribbble') ||
        tabLower.includes('behance')
      ) {
        return 'intelWebDesign';
      }
    }
    return 'intelAppWeb';
  }

  // 2. Otherwise, check the app name
  if (
    appLower.includes('visual studio code') ||
    appLower.includes('vscode') ||
    appLower.includes('code') ||
    appLower.includes('xcode') ||
    appLower.includes('cursor') ||
    appLower.includes('intellij') ||
    appLower.includes('android studio') ||
    appLower.includes('sublime')
  ) {
    return 'intelAppCode';
  }
  if (
    appLower.includes('spotify') ||
    appLower.includes('music') ||
    appLower.includes('podcast')
  ) {
    return 'intelAppMusic';
  }
  if (
    appLower.includes('slack') ||
    appLower.includes('discord') ||
    appLower.includes('telegram') ||
    appLower.includes('whatsapp') ||
    appLower.includes('messages') ||
    appLower.includes('signal')
  ) {
    return 'intelAppChat';
  }
  if (
    appLower.includes('terminal') ||
    appLower.includes('iterm') ||
    appLower.includes('warp') ||
    appLower.includes('alacritty') ||
    appLower.includes('console')
  ) {
    return 'intelAppTerminal';
  }
  if (
    appLower.includes('figma') ||
    appLower.includes('photoshop') ||
    appLower.includes('illustrator') ||
    appLower.includes('sketch') ||
    appLower.includes('design')
  ) {
    return 'intelAppDesign';
  }
  if (
    appLower.includes('zoom') ||
    appLower.includes('teams') ||
    appLower.includes('meet') ||
    appLower.includes('webex')
  ) {
    return 'intelAppMeeting';
  }
  if (
    appLower.includes('notion') ||
    appLower.includes('obsidian') ||
    appLower.includes('notes') ||
    appLower.includes('calendar') ||
    appLower.includes('word') ||
    appLower.includes('excel') ||
    appLower.includes('powerpoint')
  ) {
    return 'intelAppProductivity';
  }
  if (appLower.includes('finder') || appLower.includes('files')) {
    return 'intelAppFinder';
  }

  return 'intelAppDefault';
}

function setupContextMonitoring(): void {
  setInterval(async () => {
    // Only the elected Master window should poll the active app
    if (!suiMonitor) {
      return;
    }

    try {
      const activeApp = await window.electronAPI.getActiveApp();
      if (!activeApp) return;

      let browserTab: string | null = null;
      const appLower = activeApp.toLowerCase();
      if (
        appLower.includes('chrome') ||
        appLower.includes('safari') ||
        appLower.includes('arc') ||
        appLower.includes('firefox') ||
        appLower.includes('brave') ||
        appLower.includes('browser')
      ) {
        browserTab = await window.electronAPI.getBrowserTab(activeApp);
      }

      // Check for time-based contexts first (lunch or late night)
      const now = new Date();
      const hour = now.getHours();
      const min = now.getMinutes();
      let category = '';

      if (hour >= 23 || hour < 5) {
        category = 'intelTimeLate';
      } else if ((hour === 11 && min >= 30) || (hour === 12) || (hour === 13 && min === 0)) {
        category = 'intelTimeLunch';
      } else {
        category = getSpeechCategory(activeApp, browserTab);
      }

      const contextKey = `${category}_${activeApp}_${browserTab || ''}`;
      const nowTime = Date.now();
      
      // Comment if:
      // 1. Context changed and last comment was > 15s ago
      // 2. Same context and last comment was > 120s ago
      if ((contextKey !== lastContextKey && nowTime - lastCommentTime > 15000) || 
          (nowTime - lastCommentTime > 120000)) {
        
        lastContextKey = contextKey;
        lastCommentTime = nowTime;

        // Broadcast the category key to all pet windows
        window.electronAPI.broadcastPetEvent('pet:say', { text: category, priority: false });
      }
    } catch (err) {
      console.error('[ContextMonitor] Error polling active app:', err);
    }
  }, 5000);
}

let toolsSupported = true;
const localChatHistory: any[] = [
  { role: "system", content: "You are MiniPet, a helpful virtual desktop pet assistant on macOS. Keep your answers extremely short and concise (under 2 sentences). You must use tools to help user. Answer in Vietnamese." }
];

async function handleLocalChat(userText: string) {
  const savedSettings: any = await window.electronAPI.getSettings();

  const FAST_TRANSFER_WALLETS = [
    "0x1230000000000000000000000000000000000000000000000000000000000456",
    "0xabc0000000000000000000000000000000000000000000000000000000000def"
  ];
  
  try {
    localChatHistory.push({ role: "user", content: userText });

    const payload: any = {
      model: "qwen2.5-0.5b.gguf",
      messages: localChatHistory
    };

    if (toolsSupported) {
      payload.tools = [
        {
          type: "function",
          function: {
            name: "check_wallet_balance",
            description: "Check the SUI wallet balance.",
            parameters: { type: "object", properties: {} }
          }
        },
        {
          type: "function",
          function: {
            name: "set_pomodoro_timer",
            description: "Start a Pomodoro focus session.",
            parameters: { 
              type: "object", 
              properties: { focus_minutes: { type: "number" } },
              required: ["focus_minutes"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "transfer_sui",
            description: "Transfer SUI. Amount is in SUI.",
            parameters: { 
              type: "object", 
              properties: { 
                recipient_address: { type: "string" },
                amount: { type: "number" },
                confirmed: { type: "boolean" }
              },
              required: ["recipient_address", "amount"]
            }
          }
        }
      ];
      payload.tool_choice = "auto";
    }

    let response = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok && toolsSupported) {
      let errMsg = "";
      try {
        const errText = await response.clone().text().catch(() => "");
        console.warn("[Local AI] Error response body:", errText);
        errMsg = errText;
        try {
          const errData = JSON.parse(errText);
          errMsg = errData?.message || errData?.error?.message || errText || "";
        } catch { /* empty */ }
      } catch (e) {
        console.error("[Local AI] Failed to read error response:", e);
      }

      if (response.status === 500 || response.status === 400 || errMsg.includes("tools") || errMsg.includes("param")) {
        console.warn("[Local AI] Tools parameter not supported or caused error. Retrying and falling back to text-only mode. Error:", errMsg);
        toolsSupported = false;
        delete payload.tools;
        delete payload.tool_choice;
        response = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      }
    }

    const data = await response.json();
    const message = data.choices[0].message;
    
    if (message.tool_calls && message.tool_calls.length > 0) {
      localChatHistory.push(message);
      
      const call = message.tool_calls[0];
      const fnName = call.function.name;
      const args = JSON.parse(call.function.arguments);
      
      let toolResult = "";
      if (fnName === "check_wallet_balance") {
        if (!savedSettings.walletAddress) {
          toolResult = "No wallet configured.";
        } else {
          try {
            const rpcUrl = "https://fullnode.testnet.sui.io:443"; 
            const balRes: any = await window.electronAPI.suiRpcCall("suix_getBalance", [savedSettings.walletAddress], rpcUrl);
            const balance = parseInt(balRes?.result?.totalBalance || "0") / 1_000_000_000;
            toolResult = `Balance is ${balance.toFixed(2)} SUI`;
          } catch { toolResult = "Failed to fetch balance."; }
        }
      } else if (fnName === "set_pomodoro_timer") {
        const mins = args.focus_minutes || 25;
        window.electronAPI.startPomo(mins, 5);
        toolResult = `Started Pomodoro timer for ${mins} minutes.`;
      } else if (fnName === "transfer_sui") {
        if (!savedSettings.agentSecretKey) {
          toolResult = "No AI Agent burner wallet configured.";
        } else {
          try {
            const recipient = args.recipient_address;
            const amount = args.amount;
            const confirmed = args.confirmed;
            
            if (!recipient || !amount) {
              toolResult = "Missing recipient or amount.";
            } else {
              const isWhitelisted = FAST_TRANSFER_WALLETS.includes(recipient);
              if (!isWhitelisted && !confirmed) {
                toolResult = "Recipient is not in the FAST_TRANSFER_WALLETS list. You MUST ask user: 'Địa chỉ ví này hơi lạ, bạn có chắc chắn muốn chuyển không? Hãy chat \"oke\" để xác nhận nhé!'";
              } else {
                const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
                const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');
                const { Transaction } = await import('@mysten/sui/transactions');
                
                const keypair = Ed25519Keypair.fromSecretKey(savedSettings.agentSecretKey);
                const client = new SuiClient({ url: getFullnodeUrl('testnet') });
                
                const tx = new Transaction();
                const [coin] = tx.splitCoins(tx.gas, [Math.floor(amount * 1_000_000_000)]);
                tx.transferObjects([coin], recipient);
                
                const result = await client.signAndExecuteTransaction({ signer: keypair, transaction: tx });
                toolResult = `Successfully transferred ${amount} SUI. Transaction digest: ${result.digest}`;
              }
            }
          } catch(e: any) {
            toolResult = `Transfer failed: ${e.message || e.toString()}`;
          }
        }
      } else {
        toolResult = "Unknown function.";
      }
      
      localChatHistory.push({
        role: "tool",
        tool_call_id: call.id,
        content: toolResult
      });
      
      const nextPayload = {
        model: "qwen2.5-0.5b.gguf",
        messages: localChatHistory,
      };
      
      const nextResponse = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextPayload)
      });
      
      const nextData = await nextResponse.json();
      const finalMessage = nextData.choices[0].message;
      localChatHistory.push(finalMessage);
      
      (window.electronAPI as any).broadcastPetEvent(`chat-reply-${instanceId}`, { text: finalMessage.content });
    } else {
      localChatHistory.push(message);
      (window.electronAPI as any).broadcastPetEvent(`chat-reply-${instanceId}`, { text: message.content });
    }
    
  } catch (err: any) {
    console.error("Local AI error:", err);
    (window.electronAPI as any).broadcastPetEvent(`chat-reply-${instanceId}`, { text: "Oops, bộ não siêu nhỏ của tớ chưa sẵn sàng." });
  }
}


init().catch(console.error);

// --- Debug mode (press D to toggle) ---
let debugMode = false;
let debugTimer: ReturnType<typeof setInterval> | null = null;

document.addEventListener('keydown', (e) => {
  if (e.key !== 'd' && e.key !== 'D') return;
  debugMode = !debugMode;
  const canvas = document.getElementById('pet-canvas')!;
  const panel = document.getElementById('debug-overlay')!;
  canvas.classList.toggle('debug', debugMode);
  panel.classList.toggle('visible', debugMode);
  document.body.classList.toggle('debug', debugMode);

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
    if (debugTimer) { clearInterval(debugTimer); debugTimer = null; }
    panel.textContent = '';
  }
});


