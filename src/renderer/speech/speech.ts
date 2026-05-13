import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

const bubble = document.getElementById('bubble')!;
const win = getCurrentWebviewWindow();

// Make the window click-through so it never blocks the user
win.setIgnoreCursorEvents(true);

// Extract instance ID from window label (speech-{id})
const label = win.label;
const instanceId = label.replace('speech-', '');

listen(`update-speech-${instanceId}`, (event: any) => {
  const { text, visible } = event.payload;
  
  if (visible) {
    bubble.textContent = text;
    bubble.classList.add('visible');
  } else {
    bubble.classList.remove('visible');
  }
});
