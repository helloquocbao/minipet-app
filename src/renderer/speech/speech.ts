import { listen, emit } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

const bubble = document.getElementById('bubble')!;
const speechText = document.getElementById('speech-text')!;
const chatContainer = document.getElementById('chat-container')!;
const chatInput = document.getElementById('chat-input') as HTMLInputElement;

const win = getCurrentWebviewWindow();

// Make the window click-through so it never blocks the user
win.setIgnoreCursorEvents(true);

// Extract instance ID from window label (speech-{id})
const label = win.label;
const instanceId = label.replace('speech-', '');

const closeBtn = document.getElementById('close-btn')!;
let isChatActive = false;

// Listen for speech updates
listen(`update-speech-${instanceId}`, (event: any) => {
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
  emit(`chat-mode-toggle-${instanceId}`, { active: false });
});

// Listen for chat mode activation/deactivation
listen(`chat-mode-${instanceId}`, (event: any) => {
  const { active, welcomeText } = event.payload;
  isChatActive = active;
  
  if (active) {
    bubble.classList.add('visible');
    bubble.classList.add('chat-active');
    chatContainer.style.display = 'block';
    closeBtn.style.display = 'block';
    speechText.textContent = welcomeText || 'Ask me anything! 🧠';
    
    // Enable interaction
    win.setIgnoreCursorEvents(false);
    setTimeout(() => chatInput.focus(), 100);
  } else {
    bubble.classList.remove('chat-active');
    chatContainer.style.display = 'none';
    closeBtn.style.display = 'none';
    win.setIgnoreCursorEvents(true);
    bubble.classList.remove('visible');
    chatInput.readOnly = false;
    chatInput.style.opacity = '1';
  }
});

chatInput.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') {
    emit(`chat-mode-toggle-${instanceId}`, { active: false });
  } else if (e.key === 'Enter') {
    const text = chatInput.value.trim();
    if (!text) return;
    
    chatInput.value = '';
    speechText.textContent = 'Thinking...';
    chatInput.readOnly = true;
    chatInput.style.opacity = '0.6';
    emit(`user-chat-submit-${instanceId}`, { text });
  }
});

// Listen for chat replies from the overlay (AI Agent)
listen(`chat-reply-${instanceId}`, (event: any) => {
  const { text } = event.payload;
  speechText.textContent = text;
  chatInput.readOnly = false;
  chatInput.style.opacity = '1';
  chatInput.focus();
});

// Close chat mode when the speech window loses focus (user clicks outside)
window.addEventListener('blur', async () => {
  if (isChatActive) {
    // Wait a brief moment to let the OS register the active application change
    await new Promise(resolve => setTimeout(resolve, 80));
    
    try {
      const activeApp = await (window as any).electronAPI.getActiveApp();
      console.log("[Speech] Window blurred. Active app in OS:", activeApp);
      const nameLower = (activeApp || '').toLowerCase();
      
      // If the active app is still MiniPet, it means they just hovered out (or clicked on the pet overlay),
      // so we do not close the chat bubble!
      if (nameLower === 'minipet') {
        return;
      }
    } catch (err) {
      console.error("[Speech] Failed to check active app on blur:", err);
    }
    
    emit(`chat-mode-toggle-${instanceId}`, { active: false });
  }
});
