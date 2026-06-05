import { listen, emit } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

const bubble = document.getElementById('bubble');
if (!bubble) throw new Error('Element bubble not found');
const speechText = document.getElementById('speech-text');
if (!speechText) throw new Error('Element speech-text not found');
const chatContainer = document.getElementById('chat-container');
if (!chatContainer) throw new Error('Element chat-container not found');
const chatInput = document.getElementById('chat-input') as HTMLInputElement;

const win = getCurrentWebviewWindow();

// Make the window click-through so it never blocks the user
void win.setIgnoreCursorEvents(true);

// Extract instance ID from window label (speech-{id})
const label = win.label;
const instanceId = label.replace('speech-', '');

const closeBtn = document.getElementById('close-btn');
if (!closeBtn) throw new Error('Element close-btn not found');
let isChatActive = false;

// Listen for speech updates
void listen(`update-speech-${instanceId}`, (event: any) => {
  const { text, visible } = event.payload;
  
  if (visible) {
    // Don't overwrite chat content with regular speech
    if (isChatActive) return;
    speechText.textContent = text;
    bubble.classList.add('visible');
  } else if (!isChatActive) {
    bubble.classList.remove('visible');
  }
});

// Close button click toggles chat mode off
closeBtn.addEventListener('click', () => {
  void emit(`chat-mode-toggle-${instanceId}`, { active: false });
});

// Listen for chat mode activation/deactivation
void listen(`chat-mode-${instanceId}`, (event: any) => {
  const { active, welcomeText } = event.payload;
  isChatActive = active;
  
  if (active) {
    bubble.classList.add('visible');
    bubble.classList.add('chat-active');
    chatContainer.style.display = 'block';
    closeBtn.style.display = 'block';
    speechText.textContent = welcomeText || 'Ask me anything! 🧠';
    
    // Enable interaction
    void win.setIgnoreCursorEvents(false);
    setTimeout(() => chatInput.focus(), 100);
  } else {
    bubble.classList.remove('chat-active');
    chatContainer.style.display = 'none';
    closeBtn.style.display = 'none';
    void win.setIgnoreCursorEvents(true);
    bubble.classList.remove('visible');
    chatInput.readOnly = false;
    chatInput.style.opacity = '1';
  }
});

chatInput.addEventListener('keydown', (e) => {
  void (async () => {
    if (e.key === 'Escape') {
      void emit(`chat-mode-toggle-${instanceId}`, { active: false });
    } else if (e.key === 'Enter') {
      const text = chatInput.value.trim();
      if (!text) return;
      
      chatInput.value = '';
      speechText.textContent = 'Thinking...';
      chatInput.readOnly = true;
      chatInput.style.opacity = '0.6';
      void emit(`user-chat-submit-${instanceId}`, { text });
    }
  })();
});

// Listen for chat replies from the overlay (AI Agent)
void listen(`chat-reply-${instanceId}`, (event: any) => {
  const { text } = event.payload;
  speechText.textContent = text;
  chatInput.readOnly = false;
  chatInput.style.opacity = '1';
  chatInput.focus();
});

// Close chat mode when the speech window loses focus (user clicks outside)
window.addEventListener('blur', () => {
  void (async () => {
    if (isChatActive) {
      // Wait a brief moment to let the OS register the active application change
      await new Promise<void>(resolve => { setTimeout(resolve, 80); });
      
      try {
        const activeApp = await (window as any).electronAPI.getActiveApp();
        console.warn("[Speech] Window blurred. Active app in OS:", activeApp);
        const nameLower = (activeApp || '').toLowerCase();
        
        // If the active app is still MiniPet, it means they just hovered out (or clicked on the pet overlay),
        // so we do not close the chat bubble!
        if (nameLower === 'minipet') {
          return;
        }
      } catch (err) {
        console.error("[Speech] Failed to check active app on blur:", err);
      }
      
      void emit(`chat-mode-toggle-${instanceId}`, { active: false });
    }
  })();
});
