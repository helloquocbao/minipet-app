import { SpriteRenderer } from './engine/sprite-renderer';
import { AnimationController } from './engine/animation-controller';
import { PetStateMachine } from './engine/pet-state-machine';
import { PETDEX_SPRITE, INTERACTION } from '../../shared/constants';
import { translations, Language } from '../../shared/i18n/translations';
import { SuiMonitor } from '../blockchain/monitor';
import { getAllWebviewWindows } from '@tauri-apps/api/webviewWindow';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

let statusAlarming = false;
let currentScale = 1.0;
let isSpeechVisible = false;
let speechTimeout: NodeJS.Timeout | null = null;
let currentLanguage: Language = 'en';
let instanceId: string | null = null;
let lastGlobalSpeechTime = 0;
let isExternalDragging = false;
let lastIgnoreState = true;
let controller: AnimationController;
let stateMachine: PetStateMachine;
let currentSpeechText = '';
let suiMonitor: SuiMonitor | null = null;

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
  const initialScale = Number(petData.scale || savedSettings?.scale) || 1.0;
  const isWalkingEnabled = savedSettings?.enableWalking !== false;
  currentLanguage = savedSettings?.language || 'en';

  controller = new AnimationController(renderer, instanceId!);
  stateMachine = new PetStateMachine(controller, initialScale, isWalkingEnabled);
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

  window.electronAPI.onPomoTick((state: any) => {
    // Regular tick updates (currently handled by settings window)
  });

  (window.electronAPI as any).onPomoFinished((sessionType: string) => {
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

  // --- Settings Update Handling ---
  window.electronAPI.onSettingsUpdate(async (data: any) => {
    const { settings } = data;
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
  window.electronAPI.onPetSay((text: string) => {
    // 1. Stricter sync check to prevent simultaneous speech
    const timeSinceLastSpeech = Date.now() - lastGlobalSpeechTime;
    if (timeSinceLastSpeech < INTERACTION.SPEECH_SYNC_COOLDOWN) return;

    const t = translations[currentLanguage];
    
    // 2. Diversification Logic: 
    // If the backend sends a generic string, try to find if it belongs to a category 
    // and pick a DIFFERENT random variant so pets don't say the exact same thing.
    let speechToSay = text;
    const categories = [
      'intelWebYoutube', 'intelWebSocial', 'intelWebDev', 'intelWebAI', 
      'intelWebDesign', 'intelAppCode', 'intelAppWeb', 'intelAppMusic',
      'intelAppChat', 'intelAppTerminal', 'intelAppDesign', 'intelAppMeeting',
      'intelAppProductivity', 'intelAppFinder', 'intelAppDefault'
    ];

    for (const cat of categories) {
      const variants = t[cat];
      if (Array.isArray(variants) && variants.includes(text)) {
        // Belong to this category! Pick a fresh one from the array.
        speechToSay = pickUniqueRandom(variants);
        break;
      }
    }

    const randomBuffer = new Uint32Array(1);
    window.crypto.getRandomValues(randomBuffer);
    
    // Increased delay range (0.2s - 3.2s) to ensure clear "winners" in the speech race
    const delay = (randomBuffer[0] % 3000) + 200; 

    setTimeout(() => {
      // Final race-condition check
      const updatedTimeSinceLast = Date.now() - lastGlobalSpeechTime;
      if (updatedTimeSinceLast > 1000 && !isSpeechVisible) {
        showSpeech(speechToSay, INTERACTION.SPEECH_DURATION_DEFAULT, false, 'Intel');
      }
    }, delay);
  });

  window.electronAPI.onSomeoneSpeaking(() => {
    lastGlobalSpeechTime = Date.now();
  });

  setupMouseInteraction(canvas, stateMachine);

  // --- Master Election for Blockchain Monitor ---
  setupMasterElection();

  // --- Blockchain Events ---
  window.electronAPI.onBlockchainEvent((event: any) => {
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
  window.electronAPI.onWindowMoved((x: number, y: number) => {
    if (isSpeechVisible && currentSpeechText) {
      updateSpeechOverlay(currentSpeechText, true);
    }
  });
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
      } else {
        if (suiMonitor) {
          console.log(`[Overlay] ${myLabel} is no longer Master. Stopping SuiMonitor.`);
          // SuiMonitor currently doesn't have a destroy, but it will stop polling if we lose master status
          // and we can null it out.
          (suiMonitor as any).stopPolling?.();
          suiMonitor = null;
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
      stateMachine.forceState('jump');
      showSpeech(pickUniqueRandom(t.exercise));
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
      isExternalDragging = true;
      stateMachine.forceState('jump');
    } else if (type === 'leave') {
      isExternalDragging = false;
      stateMachine.transitionTo('idle');
    } else if (type === 'drop') {
      isExternalDragging = false;

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
function updateSpeechOverlay(text: string, visible: boolean) {
  const bubble = document.getElementById('speech-bubble');
  if (!bubble) return;

  if (visible) {
    bubble.textContent = text;
    bubble.classList.add('visible');
    
    // Position bubble above pet based on current pet height
    const canvas = document.getElementById('pet-canvas');
    if (canvas) {
        const petHeight = canvas.offsetHeight;
        bubble.style.bottom = `${petHeight + 10}px`;
    }
  } else {
    bubble.classList.remove('visible');
  }
}

async function syncWindowSize(): Promise<void> {
  const safeScale = Number(currentScale) || 1.0;
  const petWidth = Math.ceil(PETDEX_SPRITE.FRAME_WIDTH * safeScale);
  const petHeight = Math.ceil(PETDEX_SPRITE.FRAME_HEIGHT * safeScale);

  // Unified window size (320x320 set in Rust)
  // We keep the internal canvas size updated
  const canvas = document.getElementById('pet-canvas') as HTMLCanvasElement;
  if (canvas) {
    canvas.style.width = `${petWidth}px`;
    canvas.style.height = `${petHeight}px`;
  }
}

/**
 * Displays a speech bubble with the given text for a specific duration.
 */
function showSpeech(text: string, duration: number = INTERACTION.SPEECH_DURATION_DEFAULT, priority: boolean = false, source: string = 'unknown'): void {
  console.log(`[Overlay] showSpeech from ${source}: "${text}" (priority: ${priority})`);
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

  // Notify other pets to stay silent
  window.electronAPI.notifySpeaking();

  speechTimeout = setTimeout(hideSpeech, duration);
}

function hideSpeech(): void {
  isSpeechVisible = false;
  currentSpeechText = '';
  (window as any).isCurrentSpeechPriority = false;
  updateSpeechOverlay('', false);

  if (speechTimeout) {
    clearTimeout(speechTimeout);
    speechTimeout = null;
  }
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


