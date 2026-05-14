import { SpriteRenderer } from './engine/sprite-renderer';
import { AnimationController } from './engine/animation-controller';
import { PetStateMachine } from './engine/pet-state-machine';
import { PETDEX_SPRITE, INTERACTION } from '../../shared/constants';
import { translations, Language } from '../../shared/i18n/translations';

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
      showSpeech(getRandomPingSpeech());
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
      if (msg) showSpeech(msg, INTERACTION.SPEECH_DURATION_LONG);
    }, delay);
  });

  setupRandomSpeech(stateMachine);

  // --- Settings Update Handling ---
  window.electronAPI.onSettingsUpdate(async (data: any) => {
    const { settings } = data;
    currentLanguage = settings.language || 'en';
    
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
        showSpeech(speechToSay);
      }
    }, delay);
  });

  window.electronAPI.onSomeoneSpeaking(() => {
    lastGlobalSpeechTime = Date.now();
  });

  setupMouseInteraction(canvas, stateMachine);
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
      showSpeech(pickUniqueRandom(t.eating));

      try {
        const result: any = await window.electronAPI.eatFile(paths);
        if (result && !result.success) {
          showSpeech(pickUniqueRandom(t.hello));
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
 * Automatically adjusts the window size to prevent cropping, especially when speech bubbles are visible.
 * Compensates Y position to keep the pet's bottom edge fixed.
 */
// Constants for the separate speech window (must match Rust)
const SPEECH_WIDTH = 300;
const SPEECH_HEIGHT = 80;
const OVERLAY_WIDTH = 192;

/**
 * Updates the separate speech window's position and text.
 */
function updateSpeechOverlay(text: string, visible: boolean) {
  const pos = (window.electronAPI as any).getLogicalPosition?.() || { x: window.screenX, y: window.screenY };
  const dpr = window.devicePixelRatio || 1;
  
  let winX = pos.x;
  let winY = pos.y;
  if (winX > window.screen.width) { winX /= dpr; winY /= dpr; }

  // Position above pet: center horizontally relative to actual pet window width
  const currentPetWidth = window.innerWidth;
  const speechX = winX - (SPEECH_WIDTH - currentPetWidth) / 2.0;
  const speechY = winY - SPEECH_HEIGHT;

  (window.electronAPI as any).updateSpeech(text, visible, speechX, speechY);
}

async function syncWindowSize(): Promise<void> {
  const safeScale = Number(currentScale) || 1.0;
  const petWidth = Math.ceil(PETDEX_SPRITE.FRAME_WIDTH * safeScale);
  const petHeight = Math.ceil(PETDEX_SPRITE.FRAME_HEIGHT * safeScale);

  // Pet window now always fits exactly the pet sprite
  const newHeight = petHeight;
  const newWidth = petWidth;

  if (newHeight === window.innerHeight && newWidth === window.innerWidth) return;

  await (window.electronAPI as any).resizeKeepBottom(newWidth, newHeight);
}

/**
 * Displays a speech bubble with the given text for a specific duration.
 */
function showSpeech(text: string, duration: number = INTERACTION.SPEECH_DURATION_DEFAULT): void {
  if (speechTimeout) clearTimeout(speechTimeout);
  isSpeechVisible = true;
  currentSpeechText = text;
  
  // Use separate speech window
  updateSpeechOverlay(text, true);

  // Notify other pets to stay silent
  window.electronAPI.notifySpeaking();

  speechTimeout = setTimeout(hideSpeech, duration);
}

/**
 * Hides the speech bubble.
 */
function hideSpeech(): void {
  isSpeechVisible = false;
  currentSpeechText = '';
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
  const t = translations[currentLanguage];
  const options = t.pingResponses || [t.hello, '🐾', '❤️', '✨'];
  return pickUniqueRandom(options);
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
        showSpeech(pickUniqueRandom(choices));
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

// --- Real-time Speech Sync (Event Driven) ---
window.electronAPI.onWindowMoved((x: number, y: number) => {
  if (isSpeechVisible && currentSpeechText) {
    updateSpeechOverlay(currentSpeechText, true);
  }
});

