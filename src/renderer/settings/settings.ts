import { PetListItem } from '../../shared/types/pet.types';
import { UserSettings } from '../../shared/types/settings.types';
import { translations, Language } from '../../shared/i18n/translations';
import { INTERACTION } from '../../shared/constants';
import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';

// --- State Management ---
let cachedPetList: PetListItem[] = [];
let currentSettings: UserSettings | null = null;
let lastSettingsJson = '';
const thumbnailCache = new Map<string, string>();
let isInitialized = false;

const updateExplorerLink = (addr: string) => {
  const link = document.getElementById('explorer-link') as HTMLAnchorElement;
  if (link) {
    if (addr && addr.startsWith('0x')) {
      link.href = `https://testnet.suivision.xyz/account/${addr}`;
      link.style.display = 'flex';
    } else {
      link.style.display = 'none';
    }
  }
};

// --- Global Throttled Toast ---
let lastToastMessage = '';
let lastToastTime = 0;

function showToast(message: string, type: 'success' | 'error' = 'success'): void {
  const now = Date.now();
  if (message === lastToastMessage && now - lastToastTime < 2000) return;
  
  lastToastMessage = message;
  lastToastTime = now;

  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));

  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => {
      toast.remove();
      if (lastToastMessage === message) lastToastMessage = '';
    }, 300);
  }, 3000);
}

async function loadNftPets(): Promise<PetListItem[]> {
  if (!currentSettings || !currentSettings.suiEnabled || !currentSettings.suiAddress) {
    return [];
  }
  try {
    const addr = currentSettings.suiAddress;
    const rpcUrl = getJsonRpcFullnodeUrl('testnet');
    const PACKAGE_ID = '0x924f6dc9f3ea41d59c8c29aee26808fa830e68cfc84e11542836bb1b7ad5280c';
    const petType = `${PACKAGE_ID}::pet_nft::PetNFT`;

    console.log('[Settings] Querying owned NFT pets from Sui testnet for:', addr);
    const api = (window as any).electronAPI;
    const response: any = await api.suiRpcCall('suix_getOwnedObjects', [
      addr,
      {
        filter: { StructType: petType },
        options: { showType: true, showContent: true, showDisplay: true }
      }
    ], rpcUrl);

    if (response.error) throw new Error(response.error.message);
    const data = response.result.data || [];
    console.log('[Settings] Found NFT pets:', data.length);

    return data.map((obj: any) => {
      const fields = obj.data?.content?.fields;
      if (!fields) return null;
      
      const objectId = obj.data.objectId;
      const name = fields.name || 'Unnamed NFT';
      const imgUrl = fields.image_url || fields.sprite_url || '';
      const level = fields.level || '1';
      const perfection = fields.perfection_score || '0';
      
      return {
        slug: `nft-${objectId}`,
        displayName: name,
        description: `Level: ${level} | Perfection: ${(Number(perfection) / 100).toFixed(2)}%`,
        thumbnailPath: imgUrl,
        isDefault: false,
        isActive: false
      };
    }).filter(Boolean) as PetListItem[];
  } catch (err) {
    console.error('[Settings] Failed to fetch NFT pets:', err);
    return [];
  }
}

async function updateCachedPetList() {
  const api = (window as any).electronAPI;
  if (!api) return;
  const nftPets = await loadNftPets();
  cachedPetList = [...nftPets];
}

/**
 * Main initialization function for the settings UI.
 */
export async function initSettings(): Promise<void> {
  if (isInitialized) return;
  isInitialized = true;
  
  console.log('[Settings] Initializing stable settings...');
  const { setupElectronShim } = await import('../../lib/electron-shim');
  setupElectronShim();

  const api = (window as any).electronAPI;
  if (!api) return;

  try {
    const [settings] = await Promise.all([
      api.getSettings()
    ]);

    // Force enable AI and Blockchain for Hackathon Demo Zero-Config
    if (!settings.aiEnabled || !settings.suiEnabled) {
      settings.aiEnabled = true;
      settings.suiEnabled = true;
      await api.updateSettings({ aiEnabled: true, suiEnabled: true });
    }

    currentSettings = settings;
    lastSettingsJson = JSON.stringify(settings);

    await updateCachedPetList();

    // Initial Sync
    refreshUI();
    setupGlobalEventListeners();
    setupTabs();
    setupPomodoro(settings.language || 'en');

    // Unified settings update listener
    api.onSettingsUpdate(async (data: any) => {
      const updated = data.settings;
      const updatedJson = JSON.stringify(updated);
      if (updatedJson === lastSettingsJson) return;

      const old = currentSettings;
      currentSettings = updated;
      lastSettingsJson = updatedJson;

      const langChanged = updated.language !== old?.language;
      const petsChanged = JSON.stringify(updated.activePets) !== JSON.stringify(old?.activePets);
      const suiStateChanged = updated.suiEnabled !== old?.suiEnabled || updated.suiAddress !== old?.suiAddress;

      if (langChanged || petsChanged || suiStateChanged) {
        if (suiStateChanged) {
          updateCachedPetList().then(() => {
            requestAnimationFrame(() => refreshUI());
          });
        }
        requestAnimationFrame(() => refreshUI());
      } else {
        populateForm(updated);
      }
    });

    // Reload settings when window gets focus (handles updates from external processes like release sync)
    window.addEventListener('focus', async () => {
      try {
        const latest = await api.getSettings();
        const latestJson = JSON.stringify(latest);
        if (latestJson !== lastSettingsJson) {
          currentSettings = latest;
          lastSettingsJson = latestJson;
          updateCachedPetList().then(() => {
            requestAnimationFrame(() => refreshUI());
          });
          requestAnimationFrame(() => refreshUI());
        }
      } catch (err) {
        console.error('Failed to reload settings on focus:', err);
      }
    });

  } catch (err) {
    console.error('Settings: Init failed:', err);
  }
}

let refreshPending = false;
function refreshUI() {
  if (refreshPending || !currentSettings) return;
  refreshPending = true;
  
  requestAnimationFrame(() => {
    const lang = currentSettings!.language as Language || 'en';
    applyTranslations(lang);
    renderPetGallery(cachedPetList, currentSettings!);
    renderActivePets(currentSettings!, cachedPetList);
    populateForm(currentSettings!);
    refreshPending = false;
  });
}

function applyTranslations(lang: Language): void {
  const t = translations[lang];
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n') as string;
    if (t[key]) el.textContent = t[key];
  });
}

function renderPetGallery(pets: PetListItem[], settings: UserSettings) {
  const gallery = document.getElementById('pet-gallery');
  if (!gallery) return;

  const activeSlugs = new Set(settings.activePets.map(p => p.slug));
  const t = translations[settings.language as Language || 'en'];
  const fragment = document.createDocumentFragment();

  for (const pet of pets) {
    if (pet.thumbnailPath && !thumbnailCache.has(pet.slug)) {
      thumbnailCache.set(pet.slug, pet.thumbnailPath);
    }

    const isSpawned = activeSlugs.has(pet.slug);
    const card = document.createElement('div');
    card.className = `pet-card ${isSpawned ? 'active' : ''}`;
    card.dataset.slug = pet.slug;
    card.dataset.spawned = isSpawned ? 'true' : 'false';

    const thumb = document.createElement('div');
    thumb.className = 'pet-thumb';
    thumb.style.backgroundImage = `url('${thumbnailCache.get(pet.slug) || pet.thumbnailPath}')`;

    const name = document.createElement('div');
    name.className = 'pet-name';
    name.textContent = pet.displayName;

    if (!pet.isDefault && !pet.slug.startsWith('nft-')) {
      const delBtn = document.createElement('div');
      delBtn.className = 'delete-pet-btn';
      delBtn.innerHTML = '×';
      delBtn.dataset.action = 'delete';
      delBtn.title = t.deletePet || 'Delete';
      card.appendChild(delBtn);
    }

    card.appendChild(thumb);
    card.appendChild(name);
    fragment.appendChild(card);
  }

  gallery.innerHTML = '';
  gallery.appendChild(fragment);
}

function renderActivePets(settings: UserSettings, pets: PetListItem[]) {
  const container = document.getElementById('active-pets-list');
  if (!container) return;

  if (settings.activePets.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  container.style.display = 'flex';
  const fragment = document.createDocumentFragment();
  const t = translations[settings.language as Language || 'en'];

  for (const instance of settings.activePets) {
    const petType = pets.find(p => p.slug === instance.slug);
    if (!petType) continue;

    const item = document.createElement('div');
    item.className = 'active-pet-item';
    
    const thumb = document.createElement('div');
    thumb.className = 'mini-thumb';
    thumb.style.backgroundImage = `url('${thumbnailCache.get(petType.slug) || petType.thumbnailPath}')`;

    const name = document.createElement('span');
    name.className = 'instance-name';
    name.textContent = petType.displayName;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-instance-btn';
    removeBtn.innerHTML = '×';
    removeBtn.dataset.instanceId = instance.id;
    removeBtn.dataset.action = 'remove';
    removeBtn.title = t.removePet;

    if (settings.activePets.length <= 1) removeBtn.style.display = 'none';

    item.appendChild(thumb);
    item.appendChild(name);
    item.appendChild(removeBtn);
    fragment.appendChild(item);
  }

  container.innerHTML = '';
  container.appendChild(fragment);
}

function setupGlobalEventListeners() {
  const api = (window as any).electronAPI;
  
  document.getElementById('pet-gallery')?.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const card = target.closest('.pet-card') as HTMLElement;
    if (!card || !currentSettings) return;

    const slug = card.dataset.slug!;
    const isSpawned = card.dataset.spawned === 'true';
    const pet = cachedPetList.find(p => p.slug === slug);
    if (!pet) return;

    if (target.classList.contains('delete-pet-btn')) {
      e.stopPropagation();
      const t = translations[currentSettings.language as Language || 'en'];
      if (confirm(`${t.deletePet || 'Delete'} ${pet.displayName}?`)) {
        await api.deletePet(slug);
        thumbnailCache.delete(slug);
        await updateCachedPetList();
        refreshUI();
      }
      return;
    }

    try {
      if (isSpawned) {
        const instance = currentSettings.activePets.find(ap => ap.slug === slug);
        if (instance) await api.removePet(instance.id);
      } else {
        // Automatically spawn the pet. The backend will handle clearing the old pet.
        card.classList.add('active');
        await api.spawnPet(slug);
      }
    } catch (err: any) {
      showToast(err.toString(), 'error');
      refreshUI();
    }
  });

  document.getElementById('active-pets-list')?.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    if (target.dataset.action === 'remove' && target.dataset.instanceId) {
      await api.removePet(target.dataset.instanceId);
    }
  });

  const langSelect = document.getElementById('language-select') as HTMLSelectElement;
  langSelect?.addEventListener('change', () => api.updateSettings({ language: langSelect.value }));

  const scaleRange = document.getElementById('scale-range') as HTMLInputElement;
  const scaleValue = document.getElementById('scale-value') as HTMLElement;
  let scaleDebounce: any = null;
  scaleRange?.addEventListener('input', () => {
    const val = parseFloat(scaleRange.value);
    scaleValue.textContent = `${val.toFixed(1)}x`;
    if (scaleDebounce) clearTimeout(scaleDebounce);
    scaleDebounce = setTimeout(() => api.updateSettings({ scale: val }), 150);
  });

  document.getElementById('walking-toggle')?.addEventListener('change', (e) => {
    api.updateSettings({ enableWalking: (e.target as HTMLInputElement).checked });
  });

  document.getElementById('startup-toggle')?.addEventListener('change', (e) => {
    api.updateSettings({ launchAtStartup: (e.target as HTMLInputElement).checked });
  });

  document.getElementById('ai-enabled-toggle')?.addEventListener('change', async (e) => {
    const target = e.target as HTMLInputElement;
    target.checked = true;
    await api.updateSettings({ aiEnabled: true });
    updateAiStatusUI(true);
  });

  const geminiApiKeyInput = document.getElementById('gemini-api-key-input') as HTMLInputElement;
  let geminiKeyDebounce: any = null;
  geminiApiKeyInput?.addEventListener('input', () => {
    if (geminiKeyDebounce) clearTimeout(geminiKeyDebounce);
    geminiKeyDebounce = setTimeout(async () => {
        const key = geminiApiKeyInput.value.trim();
        await api.updateSettings({ geminiApiKey: key });
    }, 500);
  });

  document.getElementById('toggle-api-key-visibility')?.addEventListener('click', () => {
    if (geminiApiKeyInput) {
      const isPassword = geminiApiKeyInput.type === 'password';
      geminiApiKeyInput.type = isPassword ? 'text' : 'password';
      const btn = document.getElementById('toggle-api-key-visibility');
      if (btn) btn.textContent = isPassword ? '🙈' : '👁️';
    }
  });

  // Automatically refresh UI on blockchain events (e.g. received money)
  api.onBlockchainEvent((event: any) => {
    console.log('[Settings] Blockchain event received:', event);
    refreshSuiBalance();
    refreshSuiAssets();
    refreshSuiActivity();
  });

  document.getElementById('sui-enabled-toggle')?.addEventListener('change', async (e) => {
    const target = e.target as HTMLInputElement;
    target.checked = true;
    await api.updateSettings({ suiEnabled: true });
    updateSuiStatusUI(true);
    setTimeout(() => refreshSuiBalance(), 100);
  });

  const suiAddressInput = document.getElementById('sui-address-input') as HTMLInputElement;
  let suiAddrDebounce: any = null;

  const saveSuiAddress = async () => {
    if (suiAddrDebounce) clearTimeout(suiAddrDebounce);
    const addr = suiAddressInput.value.trim();
    updateExplorerLink(addr);
    if (addr === '' || (addr.startsWith('0x') && addr.length >= 64)) {
      const current = await api.getSettings();
      if (current.suiAddress !== addr) {
        await api.updateSettings({ suiAddress: addr, suiEnabled: addr !== '' });
        showToast('Đã lưu địa chỉ ví SUI thành công!', 'success');
      }
    }
  };

  suiAddressInput?.addEventListener('input', () => {
    if (suiAddrDebounce) clearTimeout(suiAddrDebounce);
    suiAddrDebounce = setTimeout(saveSuiAddress, 500);
  });

  suiAddressInput?.addEventListener('change', saveSuiAddress);

  suiAddressInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      suiAddressInput.blur(); // Tự động kích hoạt sự kiện change để lưu ngay lập tức
    }
  });

  document.getElementById('copy-address-btn')?.addEventListener('click', () => {
    const val = suiAddressInput.value.trim();
    if (val) {
      navigator.clipboard.writeText(val);
      showToast(translations[currentSettings?.language as Language || 'en'].addressCopied || 'Address copied!');
    }
  });
  document.getElementById('copy-agent-address-btn')?.addEventListener('click', () => {
    const val = (document.getElementById('agent-address-input') as HTMLInputElement)?.value.trim();
    if (val) {
      navigator.clipboard.writeText(val);
      showToast(translations[currentSettings?.language as Language || 'en'].addressCopied || 'Address copied!');
    }
  });
  document.getElementById('check-wallet-btn')?.addEventListener('click', () => {
    refreshSuiBalance();
    refreshSuiAssets();
    refreshSuiActivity();
  });

  const explorerLink = document.getElementById('explorer-link');
  if (explorerLink) {
    explorerLink.addEventListener('click', (e) => {
      e.preventDefault();
      const href = (explorerLink as HTMLAnchorElement).href;
      if (href && href !== '#' && api.open_url) {
        api.open_url(href);
      }
    });
  }

  document.getElementById('sync-browser-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    const isDev = window.location.port !== '' || window.location.hostname === '127.0.0.1';
    const syncUrl = isDev ? 'http://localhost:3000/sync-login' : 'https://onchain.minipet.xyz/sync-login';
    if (api.open_url) {
      api.open_url(syncUrl);
    } else {
      window.open(syncUrl, '_blank');
    }
  });

  document.getElementById('disconnect-wallet-btn')?.addEventListener('click', async () => {
    const lang = currentSettings?.language || 'en';
    const isVi = lang === 'vi';
    const confirmMsg = isVi ? 'Bạn có muốn ngắt kết nối ví SUI không?' : 'Are you sure you want to disconnect your SUI wallet?';
    const successMsg = isVi ? 'Ngắt kết nối ví thành công!' : 'Wallet disconnected successfully!';
    if (confirm(confirmMsg)) {
      await api.updateSettings({ suiAddress: '', suiEnabled: false });
      showToast(successMsg);
    }
  });

  document.getElementById('refresh-blockchain-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('refresh-blockchain-btn');
    if (btn) btn.classList.add('spinning');
    await Promise.all([
      refreshSuiBalance(),
      refreshSuiAssets(),
      refreshSuiActivity()
    ]);
    setTimeout(() => btn?.classList.remove('spinning'), 600);
  });

  document.getElementById('ping-pet-btn')?.addEventListener('click', () => api.pingPet());
}

function populateForm(settings: UserSettings): void {
  const langSelect = document.getElementById('language-select') as HTMLSelectElement;
  const scaleRange = document.getElementById('scale-range') as HTMLInputElement;
  const scaleValue = document.getElementById('scale-value') as HTMLElement;
  const walkingToggle = document.getElementById('walking-toggle') as HTMLInputElement;
  const startupToggle = document.getElementById('startup-toggle') as HTMLInputElement;

  if (langSelect) langSelect.value = settings.language || 'en';
  if (scaleRange) {
    scaleRange.value = (settings.scale || 1.0).toString();
    scaleValue.textContent = `${(settings.scale || 1.0).toFixed(1)}x`;
  }
  if (walkingToggle) walkingToggle.checked = settings.enableWalking !== false;
  if (startupToggle && navigator.userAgent.indexOf('Mac') === -1) {
    startupToggle.checked = settings.launchAtStartup || false;
  }

  const suiToggle = document.getElementById('sui-enabled-toggle') as HTMLInputElement;
  const suiAddr = document.getElementById('sui-address-input') as HTMLInputElement;
  const aiToggle = document.getElementById('ai-enabled-toggle') as HTMLInputElement;
  const geminiApiKeyInp = document.getElementById('gemini-api-key-input') as HTMLInputElement;
  const agentAddressInp = document.getElementById('agent-address-input') as HTMLInputElement;

  // Cập nhật trực tiếp trạng thái UI từ settings thực tế
  updateAiStatusUI(settings.aiEnabled || false);
  updateSuiStatusUI(settings.suiEnabled || false);

  if (aiToggle) {
    aiToggle.checked = settings.aiEnabled || false;
  }
  if (geminiApiKeyInp && document.activeElement !== geminiApiKeyInp) {
    geminiApiKeyInp.value = settings.geminiApiKey || '';
  }
  if (agentAddressInp) {
    if (settings.agentAddress) {
      agentAddressInp.value = settings.agentAddress;
    } else {
      // Generate new one
      import('@mysten/sui/keypairs/ed25519').then(({ Ed25519Keypair }) => {
        const kp = new Ed25519Keypair();
        const address = kp.toSuiAddress();
        const secret = kp.getSecretKey();
        agentAddressInp.value = address;
        // Save to settings
        (window as any).electronAPI.updateSettings({
          agentAddress: address,
          agentSecretKey: secret
        });
      }).catch(err => console.error('Failed to generate agent keypair:', err));
    }
  }

  if (suiToggle) {
    suiToggle.checked = settings.suiEnabled || false;
  }
  if (settings.suiEnabled) {
    refreshSuiBalance();
    refreshSuiAssets();
    refreshSuiActivity();
  }
  if (suiAddr && document.activeElement !== suiAddr) {
    suiAddr.value = settings.suiAddress || '';
    updateExplorerLink(settings.suiAddress || '');
  }

  const syncBtn = document.getElementById('sync-browser-btn');
  const disconnectBtn = document.getElementById('disconnect-wallet-btn');
  const hasWallet = !!settings.suiAddress;
  if (syncBtn) syncBtn.style.display = hasWallet ? 'none' : 'flex';
  if (disconnectBtn) disconnectBtn.style.display = hasWallet ? 'flex' : 'none';

  renderFastTransferList(settings);
}

function renderFastTransferList(settings: any) {
  const container = document.getElementById('fast-transfer-list');
  if (!container) return;
  
  const wallets: string[] = settings.fastTransferWallets || [];
  
  if (wallets.length === 0) {
    container.innerHTML = `
      <li style="padding: 12px; text-align: center; color: rgba(255,255,255,0.5); font-size: 13px;">
        Empty whitelist
      </li>
    `;
    return;
  }
  
  container.innerHTML = wallets.map(wallet => `
    <li style="padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.05); font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #a78bfa; word-break: break-all;">
      ${wallet}
    </li>
  `).join('');
}

function updateSuiStatusUI(enabled: boolean) {
  const status = document.getElementById('sui-status');
  if (status) {
    status.textContent = enabled ? 'Active' : 'Disconnected';
    status.classList.toggle('active', enabled);
  }
}

function updateAiStatusUI(enabled: boolean) {
  const status = document.getElementById('ai-status');
  if (status) {
    status.textContent = enabled ? 'Active' : 'Inactive';
    status.classList.toggle('active', enabled);
  }
}

async function refreshSuiBalance() {
  const api = (window as any).electronAPI;
  const suiAddressInput = document.getElementById('sui-address-input') as HTMLInputElement;
  const addr = suiAddressInput?.value.trim() || currentSettings?.suiAddress;
  const enabled = (document.getElementById('sui-enabled-toggle') as HTMLInputElement)?.checked ?? currentSettings?.suiEnabled;

  const display = document.getElementById('sui-balance-display');

  if (!enabled || !addr) {
    console.log('[Settings] Skipping balance fetch: disabled or no address');
    if (display) display.textContent = '0.000 SUI';
    return;
  }

  // Basic SUI address validation
  if (!addr.startsWith('0x') || addr.length < 64) {
    console.log('[Settings] Skipping balance fetch: invalid address format');
    if (display) display.textContent = 'Invalid Address';
    return;
  }
  
  if (display) display.textContent = '...';

  try {
    const rpcUrl = getJsonRpcFullnodeUrl('testnet');
    console.log('[Settings] Fetching balance via Rust for:', addr);
    
    const response: any = await api.suiRpcCall('suix_getBalance', [addr, '0x2::sui::SUI'], rpcUrl);
    
    if (response.error) {
        throw new Error(response.error.message || 'RPC Error');
    }

    const balance = response.result;
    console.log('[Settings] Raw balance result (Rust):', balance);
    if (display) {
      if (balance && balance.totalBalance !== undefined) {
        // SUI has 9 decimals
        const totalBalance = BigInt(balance.totalBalance);
        const amount = Number(totalBalance) / 1_000_000_000;
        display.textContent = `${amount.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} SUI`;
      } else {
        console.warn('[Settings] Balance field missing in response:', balance);
        display.textContent = '0.000 SUI';
      }
    }
  } catch (err: any) {
    console.error('[Settings] SUI Balance Fetch Error:', {
      message: err.message,
      stack: err.stack,
      cause: err.cause,
      name: err.name
    });
    if (display) {
        display.textContent = `Error: ${err.message || 'Load failed'}`;
        display.title = err.stack || ''; // Show stack on hover for debug
        display.style.fontSize = '12px';
        display.style.color = '#ff5555';
    }
  }
}

async function refreshSuiAssets() {
  const api = (window as any).electronAPI;
  const suiAddressInput = document.getElementById('sui-address-input') as HTMLInputElement;
  const addr = suiAddressInput?.value.trim() || currentSettings?.suiAddress;
  const enabled = (document.getElementById('sui-enabled-toggle') as HTMLInputElement)?.checked ?? currentSettings?.suiEnabled;

  if (!enabled || !addr) return;
  
  const container = document.getElementById('wallet-assets-list');
  if (!container) return;

  try {
    const rpcUrl = getJsonRpcFullnodeUrl('testnet');
    console.log('[Settings] Fetching assets via Rust for:', addr);
    
    const PACKAGE_ID = '0x924f6dc9f3ea41d59c8c29aee26808fa830e68cfc84e11542836bb1b7ad5280c';
    const petType = `${PACKAGE_ID}::pet_nft::PetNFT`;
    const response: any = await api.suiRpcCall('suix_getOwnedObjects', [
        addr,
        {
          filter: { StructType: petType },
          options: { showType: true, showContent: true, showDisplay: true }
        }
    ], rpcUrl);

    if (response.error) throw new Error(response.error.message);
    const data = response.result.data || [];

    if (!data || data.length === 0) {
      container.innerHTML = `<div class="empty-state">No project NFTs found in this wallet</div>`;
      return;
    }

    container.innerHTML = data.map((obj: any) => {
      const fields = obj.data?.content?.fields || {};
      const name = fields.name || obj.data?.display?.data?.name || 'PetNFT';
      const level = fields.level || '1';
      const imgUrl = fields.image_url || fields.sprite_url || '';
      
      const iconHtml = imgUrl 
        ? `<div class="asset-icon"><img src="${imgUrl}" style="width: 100%; height: 100%; object-fit: contain; border-radius: 6px;" /></div>`
        : `<div class="asset-icon">🐾</div>`;

      return `
        <div class="asset-item">
          ${iconHtml}
          <div class="asset-info">
            <span class="asset-name">${name} (Lv. ${level})</span>
            <span class="asset-type">PetNFT</span>
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error('Failed to fetch assets:', err);
    container.innerHTML = `<div class="empty-state">Failed to load assets</div>`;
  }
}

async function refreshSuiActivity() {
  const api = (window as any).electronAPI;
  const suiAddressInput = document.getElementById('sui-address-input') as HTMLInputElement;
  const addr = suiAddressInput?.value.trim() || currentSettings?.suiAddress;
  const enabled = (document.getElementById('sui-enabled-toggle') as HTMLInputElement)?.checked ?? currentSettings?.suiEnabled;

  if (!enabled || !addr) return;
  
  const container = document.getElementById('recent-activity-list');
  if (!container) return;

  try {
    const rpcUrl = getJsonRpcFullnodeUrl('testnet');
    console.log('[Settings] Fetching activity via Rust for:', addr);

    const response: any = await api.suiRpcCall('suix_queryEvents', [
        {
          MoveModule: {
            package: '0x924f6dc9f3ea41d59c8c29aee26808fa830e68cfc84e11542836bb1b7ad5280c',
            module: 'pet_nft'
          }
        },
        null,
        5,
        true
    ], rpcUrl);

    if (response.error) throw new Error(response.error.message);
    const data = response.result.data || [];

    if (!data || data.length === 0) {
      container.innerHTML = `<div class="empty-state">No recent activity</div>`;
      return;
    }

    container.innerHTML = data.map((event: any) => {
      const type = event.type.split('::').pop();
      const time = new Date(Number(event.timestampMs)).toLocaleTimeString();
      const isMe = event.sender === currentSettings?.suiAddress;
      
      let desc: string;
      if (type === 'MessageEvent') desc = `Message: "${event.parsedJson.text}"`;
      else if (type === 'BonkEvent') desc = `Pet was bonked!`;
      else desc = `Interaction with pet contract`;

      return `
        <div class="activity-item">
          <div class="activity-header">
            <span class="activity-type">${type}</span>
            <span class="activity-time">${time}</span>
          </div>
          <p class="activity-desc">${desc} ${isMe ? '(You)' : ''}</p>
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error('Failed to fetch activity:', err);
    container.innerHTML = `<div class="empty-state">Failed to load activity</div>`;
  }
}

function setupTabs(): void {
  const tabs = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.tab-panel');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-tab');
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      panels.forEach(p => {
        p.classList.remove('active');
        if (p.id === `tab-${target}`) {
          p.classList.add('active');
          if (target === 'blockchain') {
            refreshSuiBalance();
            refreshSuiAssets();
            refreshSuiActivity();
          }
        }
      });
    });
  });
}

async function setupPomodoro(lang: Language): Promise<void> {
  const api = (window as any).electronAPI;
  const focusInput = document.getElementById('pomo-focus-time') as HTMLInputElement;
  const breakInput = document.getElementById('pomo-break-time') as HTMLInputElement;
  const display = document.getElementById('pomo-display')!;
  const status = document.getElementById('pomo-status')!;
  const startBtn = document.getElementById('pomo-start-btn')!;
  const pauseBtn = document.getElementById('pomo-pause-btn')!;
  
  if (!focusInput || !breakInput) return;

  let isEditing = false;
  focusInput.addEventListener('focus', () => isEditing = true);
  focusInput.addEventListener('blur', () => isEditing = false);
  breakInput.addEventListener('focus', () => isEditing = true);
  breakInput.addEventListener('blur', () => isEditing = false);

  const updateUI = (state: any, currentLang: string) => {
    if (!state) return;
    const minutes = Math.floor((state.timeLeft || 0) / 60);
    const seconds = (state.timeLeft || 0) % 60;
    display.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    if (!isEditing) {
      if (state.focusMinutes) focusInput.value = state.focusMinutes.toString();
      if (state.breakMinutes) breakInput.value = state.breakMinutes.toString();
    }

    const t = translations[currentLang as Language] || translations['en'];
    status.className = `status-tag ${state.status} active`;
    status.textContent = state.status === 'idle' 
      ? (state.isWorkSession ? t.statusNextFocus : t.statusNextBreak)
      : (state.status === 'focus' ? t.statusFocus : t.statusBreak);

    startBtn.style.display = state.status === 'idle' ? 'inline-block' : 'none';
    pauseBtn.style.display = state.status === 'idle' ? 'none' : 'inline-block';
    if (state.status === 'idle') startBtn.textContent = state.isWorkSession ? t.startFocus : t.startBreak;
    
    focusInput.disabled = state.status !== 'idle';
    breakInput.disabled = state.status !== 'idle';
  };

  api.onPomoTick((state: any) => updateUI(state, currentSettings?.language || 'en'));
  
  startBtn.addEventListener('click', () => {
    api.startPomo(parseInt(focusInput.value) || 25, parseInt(breakInput.value) || 5);
  });

  pauseBtn.addEventListener('click', () => api.pausePomo());
  document.getElementById('pomo-reset-btn')?.addEventListener('click', () => api.resetPomo());
  document.getElementById('pomo-standard-btn')?.addEventListener('click', () => api.updatePomoConfig(25, 5));

  const updateConfig = () => {
    const f = parseInt(focusInput.value);
    const b = parseInt(breakInput.value);
    if (!isNaN(f) && !isNaN(b)) api.updatePomoConfig(f, b);
  };
  focusInput.addEventListener('input', updateConfig);
  breakInput.addEventListener('input', updateConfig);

  const initial = await api.getPomoState();
  if (initial) updateUI(initial, lang);
}

document.addEventListener('DOMContentLoaded', initSettings);
