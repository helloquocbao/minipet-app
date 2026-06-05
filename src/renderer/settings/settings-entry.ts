import '../../lib/electron-shim';
import './settings';

// Theme toggle
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('theme-toggle-btn');
  const icon = btn?.querySelector('.theme-icon');

  const apply = (theme: string) => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('minipet-theme', theme);
    if (icon) icon.textContent = theme === 'dark' ? '🌙' : '☀️';
  };

  // Init icon based on current theme
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  if (icon) icon.textContent = current === 'dark' ? '🌙' : '☀️';

  btn?.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    apply(cur === 'dark' ? 'light' : 'dark');
  });
});

// Pomodoro stepper buttons
document.addEventListener('DOMContentLoaded', () => {
  // Stepper +/- buttons
  document.querySelectorAll<HTMLButtonElement>('.stepper-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const delta = parseInt(btn.dataset.delta || '0');
      if (!targetId) return;
      const input = document.getElementById(targetId) as HTMLInputElement;
      if (!input) return;
      const min = parseInt(input.min) || 1;
      const max = parseInt(input.max) || 999;
      const newVal = Math.min(max, Math.max(min, parseInt(input.value || '0') + delta));
      input.value = String(newVal);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  // Sync play/pause icons — unified start button
  const startBtn = document.getElementById('pomo-start-btn');
  const playIcon = document.getElementById('pomo-play-icon');
  const pauseIcon = document.getElementById('pomo-pause-icon');
  const pauseBtn = document.getElementById('pomo-pause-btn'); // hidden compat

  // Map pomo-status text → badge mode
  const statusObs = new MutationObserver(() => {
    const badge = document.getElementById('pomo-status');
    const label = document.getElementById('pomo-mode-label');
    const ring = document.getElementById('pomo-ring-fill');
    if (!badge) return;
    const text = (badge.textContent || '').toLowerCase();
    const isFocus = text.includes('focus');
    const isBreak = text.includes('break') || text.includes('rest');
    const isRunning = isFocus || isBreak;

    badge.setAttribute('data-mode', isFocus ? 'focus' : isBreak ? 'break' : 'idle');
    if (label) label.textContent = isFocus ? 'Focus' : isBreak ? 'Break' : 'Ready';
    if (ring) ring.setAttribute('data-mode', isBreak ? 'break' : 'focus');

    // Swap play/pause icons
    if (playIcon) playIcon.style.display = isRunning ? 'none' : '';
    if (pauseIcon) pauseIcon.style.display = isRunning ? '' : 'none';

    // Update label
    const startLabel = document.getElementById('pomo-start-label');
    if (startLabel) startLabel.textContent = isFocus ? 'Pause' : isBreak ? 'Pause' : 'Start';
  });

  const badge = document.getElementById('pomo-status');
  if (badge) statusObs.observe(badge, { childList: true, characterData: true, subtree: true });

  // Unified start/pause button
  startBtn?.addEventListener('click', () => {
    const playVisible = playIcon && playIcon.style.display !== 'none';
    if (playVisible) {
      // Currently paused/idle → start
      const focusInput = document.getElementById('pomo-focus-time') as HTMLInputElement;
      const breakInput = document.getElementById('pomo-break-time') as HTMLInputElement;
      // Trigger original start via api
      const api = (window as any).electronAPI;
      if (api) api.startPomo(parseInt(focusInput?.value || '25'), parseInt(breakInput?.value || '5'));
    } else {
      // Currently running → pause (reuse hidden btn)
      pauseBtn?.click();
    }
  });

  // Progress ring update from pomo-display time changes
  const display = document.getElementById('pomo-display');
  const ringFill = document.getElementById('pomo-ring-fill') as SVGCircleElement | null;
  let totalSecs = 25 * 60;

  const updateRing = (timeText: string) => {
    const [m, s] = timeText.split(':').map(Number);
    const remaining = (m || 0) * 60 + (s || 0);
    const circumference = 326.7;
    const offset = circumference * (1 - remaining / totalSecs);
    if (ringFill) ringFill.style.strokeDashoffset = String(Math.max(0, Math.min(circumference, offset)));
  };

  if (display) {
    new MutationObserver(() => {
      updateRing(display.textContent || '25:00');
    }).observe(display, { childList: true, characterData: true, subtree: true });
  }

  // Update totalSecs when inputs change
  const focusIn = document.getElementById('pomo-focus-time') as HTMLInputElement;
  const breakIn = document.getElementById('pomo-break-time') as HTMLInputElement;
  const recalcTotal = () => {
    const badge = document.getElementById('pomo-status');
    const isBreak = badge?.getAttribute('data-mode') === 'break';
    totalSecs = parseInt(isBreak ? breakIn?.value : focusIn?.value || '25') * 60 || 1500;
  };
  focusIn?.addEventListener('input', recalcTotal);
  breakIn?.addEventListener('input', recalcTotal);
});

// Populate data-tooltip from translations for i18n tooltip elements
import { translations } from '../../shared/i18n/translations';

function applyTooltips(lang: string) {
  const t = (translations as any)[lang] || translations['en'];
  document.querySelectorAll<HTMLElement>('[data-tooltip-i18n]').forEach(el => {
    const key = el.getAttribute('data-tooltip-i18n');
    if (key && t[key]) el.setAttribute('data-tooltip', t[key]);
  });
}

// Initial apply after DOM ready — language from settings
document.addEventListener('DOMContentLoaded', () => {
  // Will be overridden once settings load, default to en
  applyTooltips('en');
});

// Re-apply when language changes (settings update fires applyTranslations)
const _origApply = (window as any).__applyTranslations;
(window as any).__applyTooltips = applyTooltips;
