import { PetListItem } from "../../shared/types/pet.types";
import { UserSettings } from "../../shared/types/settings.types";
import { translations, Language } from "../../shared/i18n/translations";
import { SUI_CONFIG } from "../../shared/constants";

// --- State Management ---
let cachedPetList: PetListItem[] = [];
let currentSettings: UserSettings | null = null;
let lastSettingsJson = "";

/** Strict Sui address check: 0x + exactly 64 hex chars. */
function isValidSuiAddress(addr: unknown): addr is string {
  return typeof addr === "string" && /^0x[0-9a-fA-F]{64}$/.test(addr);
}
const thumbnailCache = new Map<string, string>();
let isInitialized = false;

const updateExplorerLink = (addr: string) => {
  const link = document.getElementById("explorer-link") as HTMLAnchorElement;
  if (link) {
    if (addr && addr.startsWith("0x")) {
      link.href = `https://testnet.suivision.xyz/account/${addr}`;
      link.style.display = "flex";
    } else {
      link.style.display = "none";
    }
  }
};

// --- Global Throttled Toast ---
let lastToastMessage = "";
let lastToastTime = 0;

function showToast(
  message: string,
  type: "success" | "error" = "success",
): void {
  const now = Date.now();
  if (message === lastToastMessage && now - lastToastTime < 2000) return;

  lastToastMessage = message;
  lastToastTime = now;

  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));

  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => {
      toast.remove();
      if (lastToastMessage === message) lastToastMessage = "";
    }, 300);
  }, 3000);
}

async function loadNftPets(): Promise<PetListItem[]> {
  if (
    !currentSettings ||
    !currentSettings.suiEnabled ||
    !currentSettings.suiAddress
  ) {
    return [];
  }
  try {
    const addr = currentSettings.suiAddress;
    const rpcUrl = SUI_CONFIG.RPC_URL;
    const PACKAGE_ID = SUI_CONFIG.PACKAGE_ID;
    const petType = `${PACKAGE_ID}::pet_nft::PetNFT`;

    // Querying owned NFT pets from Sui testnet
    const api = (window as any).electronAPI;
    const response: any = await api.suiRpcCall(
      "suix_getOwnedObjects",
      [
        addr,
        {
          filter: { StructType: petType },
          options: { showType: true, showContent: true, showDisplay: true },
        },
      ],
      rpcUrl,
    );

    if (response.error) throw new Error(response.error.message);
    const data = response.result.data || [];
    // Found NFT pets

    return data
      .map((obj: any) => {
        const fields = obj.data?.content?.fields;
        if (!fields) return null;

        const objectId = obj.data.objectId;
        const name = fields.name || "Unnamed NFT";
        const imgUrl = fields.image_url || fields.sprite_url || "";
        const level = fields.level || "1";
        const perfection = fields.perfection_score || "0";
        const rarity = fields.rarity || "Common";

        return {
          slug: `nft-${objectId}`,
          displayName: `${name} - [${rarity}]`,
          description: `Level: ${level} | Perfection: ${(Number(perfection) / 100).toFixed(2)}%`,
          thumbnailPath: imgUrl,
          isDefault: false,
          isActive: false,
        };
      })
      .filter(Boolean) as PetListItem[];
  } catch (err) {
    console.error("[Settings] Failed to fetch NFT pets:", err);
    return [];
  }
}

async function updateCachedPetList() {
  const api = (window as any).electronAPI;
  if (!api) return;

  const { invoke } = await import("@tauri-apps/api/core");
  const lyraDataUrl = await invoke<string>("get_spritesheet_data", {
    slug: "lyra",
  }).catch(() => "");

  const lyraItem = {
    slug: "lyra",
    displayName: "Lyra",
    description: "A cute white fluffy cat companion.",
    thumbnailPath: lyraDataUrl,
    isDefault: true,
    isActive: false,
  };

  if (
    !currentSettings ||
    !currentSettings.suiEnabled ||
    !currentSettings.suiAddress
  ) {
    cachedPetList = [lyraItem];
  } else {
    const nftPets = await loadNftPets();
    cachedPetList = [lyraItem, ...nftPets];
  }
}

/**
 * Main initialization function for the settings UI.
 */
export async function initSettings(): Promise<void> {
  if (isInitialized) return;
  isInitialized = true;

  // Initializing stable settings
  const { setupElectronShim } = await import("../../lib/electron-shim");
  setupElectronShim();

  const api = (window as any).electronAPI;
  if (!api) return;

  try {
    const [settings] = await Promise.all([api.getSettings()]);

    currentSettings = settings;
    lastSettingsJson = JSON.stringify(settings);

    await updateCachedPetList();

    // Initial Sync
    refreshUI();
    setupGlobalEventListeners();
    setupTabs();
    setupAutoTradeTab();
    setupAgentWallet();
    void setupPomodoro(settings.language || "en");

    // Unified settings update listener
    api.onSettingsUpdate((data: any) => {
      void (async () => {
        const updated = data.settings;
        const updatedJson = JSON.stringify(updated);
        if (updatedJson === lastSettingsJson) return;

        const old = currentSettings;
        currentSettings = updated;
        lastSettingsJson = updatedJson;

        const langChanged = updated.language !== old?.language;
        const petsChanged =
          JSON.stringify(updated.activePets) !==
          JSON.stringify(old?.activePets);
        const suiStateChanged =
          updated.suiEnabled !== old?.suiEnabled ||
          updated.suiAddress !== old?.suiAddress;

        if (langChanged || petsChanged || suiStateChanged) {
          if (suiStateChanged) {
            void updateCachedPetList().then(() => {
              requestAnimationFrame(() => refreshUI());
            });
          }
          requestAnimationFrame(() => refreshUI());
        } else {
          populateForm(updated);
        }
      })();
    });

    // Reload settings when window gets focus (handles updates from external processes like release sync)
    window.addEventListener("focus", () => {
      void (async () => {
        try {
          const latest = await api.getSettings();
          const latestJson = JSON.stringify(latest);
          if (latestJson !== lastSettingsJson) {
            currentSettings = latest;
            lastSettingsJson = latestJson;
            void updateCachedPetList().then(() => {
              requestAnimationFrame(() => refreshUI());
            });
            requestAnimationFrame(() => refreshUI());
          }
        } catch (err) {
          console.error("Failed to reload settings on focus:", err);
        }
      })();
    });
  } catch (err) {
    console.error("Settings: Init failed:", err);
  }
}

let refreshPending = false;
function refreshUI() {
  if (refreshPending || !currentSettings) return;
  refreshPending = true;

  requestAnimationFrame(() => {
    const settings = currentSettings;
    if (!settings) return;
    const lang = (settings.language as Language) || "en";
    applyTranslations(lang);
    renderPetGallery(cachedPetList, settings);
    renderActivePets(settings, cachedPetList);
    populateForm(settings);
    refreshPending = false;
  });
}

function applyTranslations(lang: Language): void {
  const t = translations[lang];
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n") as string;
    if (t[key]) el.textContent = t[key];
  });
  // Also update tooltips
  document
    .querySelectorAll<HTMLElement>("[data-tooltip-i18n]")
    .forEach((el) => {
      const key = el.getAttribute("data-tooltip-i18n") as string;
      if (t[key]) el.setAttribute("data-tooltip", t[key]);
    });
}

function renderPetGallery(pets: PetListItem[], settings: UserSettings) {
  const gallery = document.getElementById("pet-gallery");
  if (!gallery) return;

  const activeSlugs = new Set(settings.activePets.map((p) => p.slug));
  const fragment = document.createDocumentFragment();

  for (const pet of pets) {
    if (pet.thumbnailPath && !thumbnailCache.has(pet.slug)) {
      thumbnailCache.set(pet.slug, pet.thumbnailPath);
    }

    const isSpawned = activeSlugs.has(pet.slug);
    const card = document.createElement("div");
    card.className = `pet-card ${isSpawned ? "active" : ""}`;
    card.dataset.slug = pet.slug;
    card.dataset.spawned = isSpawned ? "true" : "false";

    const thumb = document.createElement("div");
    thumb.className = "pet-thumb";
    thumb.style.backgroundImage = `url('${thumbnailCache.get(pet.slug) || pet.thumbnailPath}')`;
    if (pet.slug.startsWith("nft-")) {
      thumb.style.backgroundSize = "contain";
      thumb.style.backgroundPosition = "center";
    }

    const name = document.createElement("div");
    name.className = "pet-name";
    name.textContent = pet.displayName;

    // Delete pet functionality removed by user request
    card.appendChild(thumb);
    card.appendChild(name);
    fragment.appendChild(card);
  }

  gallery.innerHTML = "";
  gallery.appendChild(fragment);
}

function renderActivePets(settings: UserSettings, pets: PetListItem[]) {
  const container = document.getElementById("active-pets-list");
  if (!container) return;

  if (settings.activePets.length === 0) {
    container.innerHTML = "";
    container.style.display = "none";
    return;
  }

  container.style.display = "flex";
  const fragment = document.createDocumentFragment();

  for (const instance of settings.activePets) {
    const petType = pets.find((p) => p.slug === instance.slug);
    if (!petType) continue;

    const item = document.createElement("div");
    item.className = "active-pet-item";

    const thumb = document.createElement("div");
    thumb.className = "mini-thumb";
    thumb.style.backgroundImage = `url('${thumbnailCache.get(petType.slug) || petType.thumbnailPath}')`;
    if (petType.slug.startsWith("nft-")) {
      thumb.style.backgroundSize = "contain";
      thumb.style.backgroundPosition = "center";
    }

    const name = document.createElement("span");
    name.className = "instance-name";
    name.textContent = petType.displayName;

    item.appendChild(thumb);
    item.appendChild(name);
    fragment.appendChild(item);
  }

  container.innerHTML = "";
  container.appendChild(fragment);
}

function setupGlobalEventListeners() {
  const api = (window as any).electronAPI;

  document.getElementById("pet-gallery")?.addEventListener("click", (e) => {
    void (async () => {
      const target = e.target as HTMLElement;
      const card = target.closest(".pet-card") as HTMLElement;
      if (!card || !currentSettings) return;

      const slug = card.dataset.slug ?? "";
      const isSpawned = card.dataset.spawned === "true";
      const pet = cachedPetList.find((p) => p.slug === slug);
      if (!pet) return;

      // Delete pet handler removed

      try {
        if (isSpawned) {
          // Pet is already active, do nothing.
          return;
        } else {
          // Automatically spawn the pet. The backend will handle clearing the old pet.
          card.classList.add("active");
          await api.spawnPet(slug);
        }
        await updateCachedPetList();
        refreshUI();
      } catch (err: any) {
        showToast(err.toString(), "error");
        refreshUI();
      }
    })();
  });

  // Remove instance handler removed

  const langSelect = document.getElementById(
    "language-select",
  ) as HTMLSelectElement;
  langSelect?.addEventListener("change", () =>
    api.updateSettings({ language: langSelect.value }),
  );

  const scaleRange = document.getElementById("scale-range") as HTMLInputElement;
  const scaleValue = document.getElementById("scale-value") as HTMLElement;
  let scaleDebounce: any = null;
  scaleRange?.addEventListener("input", () => {
    const val = parseFloat(scaleRange.value);
    scaleValue.textContent = `${val.toFixed(1)}x`;
    if (scaleDebounce) clearTimeout(scaleDebounce);
    scaleDebounce = setTimeout(() => api.updateSettings({ scale: val }), 150);
  });

  document.getElementById("walking-toggle")?.addEventListener("change", (e) => {
    api.updateSettings({
      enableWalking: (e.target as HTMLInputElement).checked,
    });
  });

  document.getElementById("startup-toggle")?.addEventListener("change", (e) => {
    api.updateSettings({
      launchAtStartup: (e.target as HTMLInputElement).checked,
    });
  });

  document
    .getElementById("ai-enabled-toggle")
    ?.addEventListener("change", (e) => {
      void (async () => {
        const target = e.target as HTMLInputElement;
        await api.updateSettings({ aiEnabled: target.checked });
        updateAiStatusUI(target.checked);
      })();
    });

  const geminiApiKeyInput = document.getElementById(
    "gemini-api-key-input",
  ) as HTMLInputElement;
  let geminiKeyDebounce: any = null;
  geminiApiKeyInput?.addEventListener("input", () => {
    if (geminiKeyDebounce) clearTimeout(geminiKeyDebounce);
    geminiKeyDebounce = setTimeout(() => {
      void (async () => {
        const key = geminiApiKeyInput.value.trim();
        await api.updateSettings({ geminiApiKey: key });
      })();
    }, 500);
  });

  document
    .getElementById("toggle-api-key-visibility")
    ?.addEventListener("click", () => {
      if (geminiApiKeyInput) {
        const isPassword = geminiApiKeyInput.type === "password";
        geminiApiKeyInput.type = isPassword ? "text" : "password";
        const btn = document.getElementById("toggle-api-key-visibility");
        if (btn) btn.textContent = isPassword ? "🙈" : "👁️";
      }
    });

  // Automatically refresh UI on blockchain events (e.g. received money)
  api.onBlockchainEvent((_event: any) => {
    void refreshSuiBalance();
    void refreshSuiAssets();
    void refreshSuiActivity();
  });

  document
    .getElementById("sui-enabled-toggle")
    ?.addEventListener("change", (e) => {
      void (async () => {
        const target = e.target as HTMLInputElement;
        await api.updateSettings({ suiEnabled: target.checked });
        updateSuiStatusUI(target.checked);
        if (target.checked) {
          setTimeout(() => {
            void refreshSuiBalance();
          }, 100);
        }
      })();
    });

  const suiAddressInput = document.getElementById(
    "sui-address-input",
  ) as HTMLInputElement;
  let suiAddrDebounce: any = null;

  const saveSuiAddress = () => {
    void (async () => {
      if (suiAddrDebounce) clearTimeout(suiAddrDebounce);
      const addr = suiAddressInput.value.trim();
      updateExplorerLink(addr);
      if (addr === "" || (addr.startsWith("0x") && addr.length >= 64)) {
        const current = await api.getSettings();
        if (current.suiAddress !== addr) {
          await api.updateSettings({
            suiAddress: addr,
            suiEnabled: addr !== "",
          });
          showToast("Đã lưu địa chỉ ví SUI thành công!", "success");
        }
      }
    })();
  };

  suiAddressInput?.addEventListener("input", () => {
    if (suiAddrDebounce) clearTimeout(suiAddrDebounce);
    suiAddrDebounce = setTimeout(saveSuiAddress, 500);
  });

  suiAddressInput?.addEventListener("change", saveSuiAddress);

  suiAddressInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      suiAddressInput.blur(); // Tự động kích hoạt sự kiện change để lưu ngay lập tức
    }
  });

  document.getElementById("copy-address-btn")?.addEventListener("click", () => {
    const val = suiAddressInput.value.trim();
    if (val) {
      void navigator.clipboard.writeText(val);
      showToast(
        translations[(currentSettings?.language as Language) || "en"]
          .addressCopied || "Address copied!",
      );
    }
  });

  document.getElementById("check-wallet-btn")?.addEventListener("click", () => {
    void refreshSuiBalance();
    void refreshSuiAssets();
    void refreshSuiActivity();
  });

  const explorerLink = document.getElementById("explorer-link");
  if (explorerLink) {
    explorerLink.addEventListener("click", (e) => {
      e.preventDefault();
      const href = (explorerLink as HTMLAnchorElement).href;
      if (href && href !== "#" && api.open_url) {
        api.open_url(href);
      }
    });
  }

  document
    .getElementById("sync-browser-btn")
    ?.addEventListener("click", (e) => {
      e.preventDefault();
      const isDev =
        window.location.port !== "" || window.location.hostname === "127.0.0.1";
      const syncUrl = isDev
        ? "https://onchain.minipet.xyz/sync-login"
        : "https://onchain.minipet.xyz/sync-login";
      if (api.open_url) {
        api.open_url(syncUrl);
      } else {
        window.open(syncUrl, "_blank");
      }
    });

  document
    .getElementById("disconnect-wallet-btn")
    ?.addEventListener("click", () => {
      void (async () => {
        const lang = currentSettings?.language || "en";
        const isVi = lang === "vi";
        const confirmMsg = isVi
          ? "Bạn có muốn ngắt kết nối ví SUI không?"
          : "Are you sure you want to disconnect your SUI wallet?";
        const successMsg = isVi
          ? "Ngắt kết nối ví thành công!"
          : "Wallet disconnected successfully!";
        // eslint-disable-next-line no-alert
        if (confirm(confirmMsg)) {
          await api.updateSettings({ suiAddress: "", suiEnabled: false });
          showToast(successMsg);
        }
      })();
    });

  document
    .getElementById("refresh-blockchain-btn")
    ?.addEventListener("click", () => {
      void (async () => {
        const btn = document.getElementById("refresh-blockchain-btn");
        if (btn) btn.classList.add("spinning");
        await Promise.all([
          refreshSuiBalance(),
          refreshSuiAssets(),
          refreshSuiActivity(),
        ]);
        setTimeout(() => btn?.classList.remove("spinning"), 600);
      })();
    });

  document
    .getElementById("ping-pet-btn")
    ?.addEventListener("click", () => api.pingPet());

  // --- Brain (AI Model) Management ---
  const brainStatus = document.getElementById("brain-status");
  const downloadBrainBtn = document.getElementById(
    "download-brain-btn",
  ) as HTMLButtonElement;
  const deleteBrainBtn = document.getElementById(
    "delete-brain-btn",
  ) as HTMLButtonElement;

  async function refreshBrainStatus() {
    const { invoke } = await import("@tauri-apps/api/core");
    const exists = await invoke<boolean>("check_model_exists");
    if (brainStatus) brainStatus.textContent = exists ? "✅ 986MB" : "";
    if (downloadBrainBtn)
      downloadBrainBtn.style.display = exists ? "none" : "inline-flex";
    if (deleteBrainBtn)
      deleteBrainBtn.style.display = exists ? "inline-flex" : "none";
  }

  void refreshBrainStatus();

  downloadBrainBtn?.addEventListener("click", () => {
    void (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");
      downloadBrainBtn.disabled = true;
      downloadBrainBtn.textContent = "⏳ ...";
      if (brainStatus) brainStatus.textContent = "0%";
      try {
        const unlisten = await listen(
          "model-download-progress",
          (event: any) => {
            const p = event.payload as any;
            const pct = p.progress?.toFixed(1) || "0";
            if (brainStatus) brainStatus.textContent = `${pct}%`;
          },
        );
        await invoke("download_model");
        unlisten();
        showToast("Brain downloaded successfully! 🧠");
      } catch (err: any) {
        showToast(`Download failed: ${err?.message || err}`, "error");
      }
      downloadBrainBtn.disabled = false;
      downloadBrainBtn.textContent = "⬇️ Download";
      void refreshBrainStatus();
    })();
  });

  deleteBrainBtn?.addEventListener("click", () => {
    void (async () => {
      const lang = currentSettings?.language || "en";
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        await invoke("delete_model");
        showToast(lang === "vi" ? "Đã xóa bộ não AI!" : "AI brain deleted!");
      } catch (err: any) {
        showToast(`Delete failed: ${err?.message || err}`, "error");
      }
      void refreshBrainStatus();
    })();
  });

  const addWhitelistBtn = document.getElementById("add-whitelist-btn");
  const whitelistAliasInput = document.getElementById(
    "whitelist-alias-input",
  ) as HTMLInputElement;
  const whitelistAddressInput = document.getElementById(
    "whitelist-address-input",
  ) as HTMLInputElement;

  addWhitelistBtn?.addEventListener("click", () => {
    void (async () => {
      if (!currentSettings) return;
      const alias = whitelistAliasInput.value.trim();
      const address = whitelistAddressInput.value.trim();

      if (!alias) {
        showToast("Alias is required!");
        return;
      }
      if (!isValidSuiAddress(address)) {
        showToast("Invalid Sui Address!");
        return;
      }

      const wallets = currentSettings.fastTransferWallets || [];
      if (
        wallets.some(
          (w: any) => w.address.toLowerCase() === address.toLowerCase(),
        )
      ) {
        showToast("Address is already in whitelist!");
        return;
      }

      const newList = [...wallets, { alias, address }];
      const settingsRef = currentSettings;

      await api.updateSettings({ fastTransferWallets: newList });

      // Capture inputs before any async gap for atomic update
      const aliasInput = whitelistAliasInput;
      const addrInput = whitelistAddressInput;
      settingsRef.fastTransferWallets = newList;
      aliasInput.value = "";
      addrInput.value = "";

      renderFastTransferList(settingsRef);
      showToast("Added to whitelist! 🎉");
    })();
  });
}

function populateForm(settings: UserSettings): void {
  const langSelect = document.getElementById(
    "language-select",
  ) as HTMLSelectElement;
  const scaleRange = document.getElementById("scale-range") as HTMLInputElement;
  const scaleValue = document.getElementById("scale-value") as HTMLElement;
  const walkingToggle = document.getElementById(
    "walking-toggle",
  ) as HTMLInputElement;
  const startupToggle = document.getElementById(
    "startup-toggle",
  ) as HTMLInputElement;

  if (langSelect) langSelect.value = settings.language || "en";
  if (scaleRange) {
    scaleRange.value = (settings.scale || 1.0).toString();
    scaleValue.textContent = `${(settings.scale || 1.0).toFixed(1)}x`;
  }
  if (walkingToggle) walkingToggle.checked = settings.enableWalking !== false;
  if (startupToggle && navigator.userAgent.indexOf("Mac") === -1) {
    startupToggle.checked = settings.launchAtStartup || false;
  }

  const suiToggle = document.getElementById(
    "sui-enabled-toggle",
  ) as HTMLInputElement;
  const suiAddr = document.getElementById(
    "sui-address-input",
  ) as HTMLInputElement;
  const aiToggle = document.getElementById(
    "ai-enabled-toggle",
  ) as HTMLInputElement;
  const geminiApiKeyInp = document.getElementById(
    "gemini-api-key-input",
  ) as HTMLInputElement;
  // Cập nhật trực tiếp trạng thái UI từ settings thực tế
  updateAiStatusUI(settings.aiEnabled || false);
  updateSuiStatusUI(settings.suiEnabled || false);

  if (aiToggle) {
    aiToggle.checked = settings.aiEnabled || false;
  }
  if (geminiApiKeyInp && document.activeElement !== geminiApiKeyInp) {
    geminiApiKeyInp.value = settings.geminiApiKey || "";
  }

  if (suiToggle) {
    suiToggle.checked = settings.suiEnabled || false;
  }
  if (settings.suiEnabled) {
    void refreshSuiBalance();
    void refreshSuiAssets();
    void refreshSuiActivity();
  }
  if (suiAddr && document.activeElement !== suiAddr) {
    suiAddr.value = settings.suiAddress || "";
    updateExplorerLink(settings.suiAddress || "");
  }

  const syncBtn = document.getElementById("sync-browser-btn");
  const disconnectBtn = document.getElementById("disconnect-wallet-btn");
  const hasWallet = !!settings.suiAddress;
  if (syncBtn) syncBtn.style.display = hasWallet ? "none" : "flex";
  if (disconnectBtn) disconnectBtn.style.display = hasWallet ? "flex" : "none";

  renderFastTransferList(settings);

  // Reflect agent wallet address + trading wallet preview
  updateAgentWalletUI();
}

function renderFastTransferList(settings: any) {
  const container = document.getElementById("fast-transfer-list");
  if (!container) return;

  const wallets: { alias: string; address: string }[] =
    settings.fastTransferWallets || [];

  if (wallets.length === 0) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = wallets
    .map(
      (wallet, index) => `
    <li class="whitelist-item">
      <span class="whitelist-alias">${wallet.alias || "Unnamed"}</span>
      <span class="whitelist-address">${wallet.address.slice(0, 10)}...${wallet.address.slice(-6)}</span>
      <button class="remove-whitelist-btn" data-index="${index}" aria-label="Remove">✕</button>
    </li>
  `,
    )
    .join("");

  container.querySelectorAll(".remove-whitelist-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      void (async () => {
        if (!currentSettings) return;
        const idxStr = (e.currentTarget as HTMLElement).getAttribute(
          "data-index",
        );
        if (idxStr === null) return;
        const idx = parseInt(idxStr);

        const newList = [...wallets];
        newList.splice(idx, 1);

        const api = (window as any).electronAPI;
        await api.updateSettings({ fastTransferWallets: newList });
        // eslint-disable-next-line require-atomic-updates
        currentSettings.fastTransferWallets = newList;
        renderFastTransferList(currentSettings);
      })();
    });
  });
}

function updateSuiStatusUI(enabled: boolean) {
  const status = document.getElementById("sui-status");
  if (status) {
    status.textContent = enabled ? "Active" : "Disconnected";
    status.classList.toggle("active", enabled);
  }
}

function updateAiStatusUI(enabled: boolean) {
  const status = document.getElementById("ai-status");
  if (status) {
    status.textContent = enabled ? "Active" : "Inactive";
    status.classList.toggle("active", enabled);
  }
}

async function refreshSuiBalance() {
  const api = (window as any).electronAPI;
  const suiAddressInput = document.getElementById(
    "sui-address-input",
  ) as HTMLInputElement;
  const addr = suiAddressInput?.value.trim() || currentSettings?.suiAddress;
  const enabled =
    (document.getElementById("sui-enabled-toggle") as HTMLInputElement)
      ?.checked ?? currentSettings?.suiEnabled;

  const display = document.getElementById("sui-balance-display");

  if (!enabled || !addr) {
    if (display) display.textContent = "0.000 SUI";
    return;
  }

  // Basic SUI address validation
  if (!isValidSuiAddress(addr)) {
    if (display) display.textContent = "Invalid Address";
    return;
  }

  if (display) display.textContent = "...";

  try {
    const rpcUrl = SUI_CONFIG.RPC_URL;

    const response: any = await api.suiRpcCall(
      "suix_getBalance",
      [addr, "0x2::sui::SUI"],
      rpcUrl,
    );

    if (response.error) {
      throw new Error(response.error.message || "RPC Error");
    }

    const balance = response.result;
    if (display) {
      if (balance && balance.totalBalance !== undefined) {
        // SUI has 9 decimals
        const totalBalance = BigInt(balance.totalBalance);
        const amount = Number(totalBalance) / 1_000_000_000;
        display.textContent = `${amount.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} SUI`;
      } else {
        console.warn("[Settings] Balance field missing in response:", balance);
        display.textContent = "0.000 SUI";
      }
    }
  } catch (err: any) {
    console.error("[Settings] SUI Balance Fetch Error:", {
      message: err.message,
      stack: err.stack,
      cause: err.cause,
      name: err.name,
    });
    if (display) {
      display.textContent = `Error: ${err.message || "Load failed"}`;
      display.title = err.stack || ""; // Show stack on hover for debug
      display.style.fontSize = "12px";
      display.style.color = "#ff5555";
    }
  }
}

async function refreshSuiAssets() {
  const api = (window as any).electronAPI;
  const suiAddressInput = document.getElementById(
    "sui-address-input",
  ) as HTMLInputElement;
  const addr = suiAddressInput?.value.trim() || currentSettings?.suiAddress;
  const enabled =
    (document.getElementById("sui-enabled-toggle") as HTMLInputElement)
      ?.checked ?? currentSettings?.suiEnabled;

  if (!enabled || !addr) return;

  const container = document.getElementById("wallet-assets-list");
  if (!container) return;

  try {
    const rpcUrl = SUI_CONFIG.RPC_URL;

    const PACKAGE_ID = SUI_CONFIG.PACKAGE_ID;
    const petType = `${PACKAGE_ID}::pet_nft::PetNFT`;
    const response: any = await api.suiRpcCall(
      "suix_getOwnedObjects",
      [
        addr,
        {
          filter: { StructType: petType },
          options: { showType: true, showContent: true, showDisplay: true },
        },
      ],
      rpcUrl,
    );

    if (response.error) throw new Error(response.error.message);
    const data = response.result.data || [];

    if (!data || data.length === 0) {
      container.innerHTML = `<div class="empty-state">No project NFTs found in this wallet</div>`;
      return;
    }

    // SECURITY: NFT name/level/image_url are attacker-settable on-chain data.
    // Build via textContent/createElement — never innerHTML — and only allow
    // http(s)/ipfs image URLs.
    container.innerHTML = "";
    for (const obj of data) {
      const fields = obj.data?.content?.fields || {};
      const name = String(fields.name || obj.data?.display?.data?.name || "PetNFT");
      const level = String(fields.level ?? "1");
      const imgUrl = String(fields.image_url || fields.sprite_url || "");
      const safeImg = /^(https?:|ipfs:)/i.test(imgUrl) ? imgUrl : "";

      const item = document.createElement("div");
      item.className = "asset-item";

      const icon = document.createElement("div");
      icon.className = "asset-icon";
      if (safeImg) {
        const img = document.createElement("img");
        img.src = safeImg;
        img.style.cssText =
          "width: 100%; height: 100%; object-fit: contain; border-radius: 6px;";
        icon.appendChild(img);
      } else {
        icon.textContent = "🐾";
      }

      const info = document.createElement("div");
      info.className = "asset-info";
      const nameSpan = document.createElement("span");
      nameSpan.className = "asset-name";
      nameSpan.textContent = `${name} (Lv. ${level})`;
      const typeSpan = document.createElement("span");
      typeSpan.className = "asset-type";
      typeSpan.textContent = "PetNFT";
      info.append(nameSpan, typeSpan);

      item.append(icon, info);
      container.appendChild(item);
    }
  } catch (err) {
    console.error("Failed to fetch assets:", err);
    container.innerHTML = `<div class="empty-state">Failed to load assets</div>`;
  }
}

async function refreshSuiActivity() {
  const api = (window as any).electronAPI;
  const suiAddressInput = document.getElementById(
    "sui-address-input",
  ) as HTMLInputElement;
  const addr = suiAddressInput?.value.trim() || currentSettings?.suiAddress;
  const enabled =
    (document.getElementById("sui-enabled-toggle") as HTMLInputElement)
      ?.checked ?? currentSettings?.suiEnabled;

  if (!enabled || !addr) return;

  const container = document.getElementById("recent-activity-list");
  if (!container) return;

  try {
    const rpcUrl = SUI_CONFIG.RPC_URL;

    const response: any = await api.suiRpcCall(
      "suix_queryEvents",
      [
        {
          MoveModule: {
            package: SUI_CONFIG.PACKAGE_ID,
            module: "pet_nft",
          },
        },
        null,
        5,
        true,
      ],
      rpcUrl,
    );

    if (response.error) throw new Error(response.error.message);
    const data = response.result.data || [];

    if (!data || data.length === 0) {
      container.innerHTML = `<div class="empty-state">No recent activity</div>`;
      return;
    }

    // SECURITY: event fields (type, parsedJson.text) are attacker-controlled
    // on-chain data. Build the DOM with textContent — never innerHTML — to
    // prevent XSS in this privileged settings webview.
    container.innerHTML = "";
    for (const event of data) {
      const type = String(event.type ?? "").split("::").pop() || "Event";
      const time = new Date(Number(event.timestampMs)).toLocaleTimeString();
      const isMe = event.sender === currentSettings?.suiAddress;

      let desc: string;
      if (type === "MessageEvent")
        desc = `Message: "${String(event.parsedJson?.text ?? "")}"`;
      else if (type === "BonkEvent") desc = `Pet was bonked!`;
      else desc = `Interaction with pet contract`;

      const item = document.createElement("div");
      item.className = "activity-item";

      const header = document.createElement("div");
      header.className = "activity-header";
      const typeSpan = document.createElement("span");
      typeSpan.className = "activity-type";
      typeSpan.textContent = type;
      const timeSpan = document.createElement("span");
      timeSpan.className = "activity-time";
      timeSpan.textContent = time;
      header.append(typeSpan, timeSpan);

      const descP = document.createElement("p");
      descP.className = "activity-desc";
      descP.textContent = `${desc} ${isMe ? "(You)" : ""}`;

      item.append(header, descP);
      container.appendChild(item);
    }
  } catch (err) {
    console.error("Failed to fetch activity:", err);
    container.innerHTML = `<div class="empty-state">Failed to load activity</div>`;
  }
}

async function refreshAgentBalance(): Promise<void> {
  const api = (window as any).electronAPI;
  const display = document.getElementById("agent-balance-display");
  const addr =
    currentSettings?.agentAddress ||
    (
      document.getElementById("agent-address-input") as HTMLInputElement
    )?.value.trim();

  if (!display) return;
  if (!isValidSuiAddress(addr)) {
    display.textContent = "0.000 SUI";
    return;
  }

  display.textContent = "...";
  try {
    const response: any = await api.suiRpcCall(
      "suix_getBalance",
      [addr, "0x2::sui::SUI"],
      SUI_CONFIG.RPC_URL,
    );
    if (response.error) throw new Error(response.error.message || "RPC Error");
    const totalBalance = BigInt(response.result?.totalBalance || "0");
    const amount = Number(totalBalance) / 1_000_000_000;
    display.textContent = `${amount.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} SUI`;
  } catch (err) {
    console.error("[Settings] Agent balance fetch error:", err);
    display.textContent = "0.000 SUI";
  }
}

/** Returns the active trading wallet address based on the auto-trade dropdown selection. */
function getTradeWalletAddress(): string {
  const sel =
    (document.getElementById("trade-wallet-select") as HTMLSelectElement)
      ?.value || "agent";
  if (sel === "zklogin") return currentSettings?.suiAddress || "";
  return currentSettings?.agentAddress || "";
}

/** Updates the read-only address preview next to the trading wallet dropdown. */
function updateTradeWalletAddress(): void {
  const span = document.getElementById("trade-wallet-address");
  if (!span) return;
  const addr = getTradeWalletAddress();
  if (addr && addr.startsWith("0x")) {
    span.textContent = addr;
    span.style.color = "var(--accent)";
  } else {
    const sel =
      (document.getElementById("trade-wallet-select") as HTMLSelectElement)
        ?.value || "agent";
    const lang = (currentSettings?.language as Language) || "en";
    const t = translations[lang];
    span.textContent =
      sel === "agent"
        ? t.tradingWalletNotSet || "Not configured"
        : t.tradingWalletNotSet || "Not configured";
    span.style.color = "var(--text-muted)";
    span.title = "";
  }
}

function updateAgentWalletUI(): void {
  const addrInput = document.getElementById(
    "agent-address-input",
  ) as HTMLInputElement;
  const generateBtn = document.getElementById(
    "generate-agent-btn",
  ) as HTMLButtonElement;
  const addr = currentSettings?.agentAddress || "";

  if (addrInput && document.activeElement !== addrInput) {
    addrInput.value = addr;
  }
  if (generateBtn && !generateBtn.disabled) {
    const lang = (currentSettings?.language as Language) || "en";
    const t = translations[lang];
    generateBtn.textContent =
      addr && addr.startsWith("0x")
        ? t.regenerateAgentBtn || "Regenerate Agent Wallet"
        : t.generateAgentBtn || "Generate Agent Wallet";
  }
  updateTradeWalletAddress();
}

function setupAgentWallet(): void {
  const api = (window as any).electronAPI;
  const generateBtn = document.getElementById(
    "generate-agent-btn",
  ) as HTMLButtonElement;
  const addrInput = document.getElementById(
    "agent-address-input",
  ) as HTMLInputElement;
  const copyBtn = document.getElementById("copy-agent-address-btn");

  updateAgentWalletUI();
  void refreshAgentBalance();

  document
    .getElementById("reload-agent-balance-btn")
    ?.addEventListener("click", () => {
      void refreshAgentBalance();
    });

  generateBtn?.addEventListener("click", () => {
    void (async () => {
      if (!api?.generateAgentKeypair) {
        showToast("Tính năng sinh ví Agent không khả dụng.", "error");
        return;
      }
      const lang = currentSettings?.language || "en";
      const isVi = lang === "vi";
      const hasWallet = !!(
        currentSettings?.agentAddress &&
        currentSettings.agentAddress.startsWith("0x")
      );

      if (hasWallet) {
        const { ask } = await import("@tauri-apps/plugin-dialog");
        const confirmed = await ask(
          isVi
            ? "Ví Agent hiện tại sẽ bị thay thế. Nếu ví đang có SUI, bạn sẽ mất quyền truy cập. Bạn chắc chắn muốn tạo ví mới?"
            : "The current Agent wallet will be replaced. If it holds SUI, you will lose access. Are you sure?",
          {
            title: isVi ? "Xác nhận tạo lại ví" : "Confirm Regenerate",
            kind: "warning",
          },
        );
        if (!confirmed) return;
      }

      generateBtn.disabled = true;
      generateBtn.textContent = isVi ? "Đang sinh ví..." : "Generating...";
      try {
        const secretB64: string = await api.generateAgentKeypair(hasWallet);
        const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519");
        const secretBytes = Uint8Array.from(atob(secretB64), (c) =>
          c.charCodeAt(0),
        );
        const keypair = Ed25519Keypair.fromSecretKey(secretBytes);
        const address = keypair.getPublicKey().toSuiAddress();

        await api.updateSettings({ agentAddress: address });
        if (currentSettings) currentSettings.agentAddress = address;
        if (addrInput) addrInput.value = address;

        showToast(
          isVi ? "Đã sinh ví Agent thành công! 🎉" : "Agent wallet created! 🎉",
        );
        void refreshAgentBalance();
      } catch (err: any) {
        console.error("[Settings] Generate agent wallet failed:", err);
        showToast(
          (isVi
            ? "Sinh ví Agent thất bại: "
            : "Failed to create Agent wallet: ") + (err?.message || err),
          "error",
        );
      } finally {
        generateBtn.disabled = false;
        updateAgentWalletUI();
      }
    })();
  });

  copyBtn?.addEventListener("click", () => {
    const val = addrInput?.value.trim();
    if (val && val.startsWith("0x")) {
      void navigator.clipboard.writeText(val);
      showToast("Đã copy địa chỉ ví Agent!");
    }
  });
}

function setupTabs(): void {
  const tabs = document.querySelectorAll(".nav-item");
  const panels = document.querySelectorAll(".tab-panel");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.getAttribute("data-tab");
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      panels.forEach((p) => {
        p.classList.remove("active");
        if (p.id === `tab-${target}`) {
          p.classList.add("active");
          if (target === "ai-web3") {
            void refreshSuiBalance();
            void refreshSuiAssets();
            void refreshSuiActivity();
          }
        }
      });
    });
  });
}

let isSimulating = false;
let simInterval: any = null;
let simWinRate = 0;
let simTradesCount = 0;
let simPnl = 0.0;

// Real AI Agent Trade engine instance
import { AgentTradeEngine, TradeLog } from "../blockchain/agent-trade";
let agentTradeEngine: AgentTradeEngine | null = null;

/**
 * Wires the "Desired Trade" card: the owner configures an exact trade and the
 * pet executes it on-chain when activated. Config persists to autoTrade.agent;
 * activation broadcasts to the master overlay which runs DesiredTradeExecutor.
 */
function setupDesiredTradeCard(): void {
  const actionEl = document.getElementById("desired-trade-action") as HTMLSelectElement | null;
  const tokenEl = document.getElementById("desired-trade-token") as HTMLInputElement | null;
  const amountEl = document.getElementById("desired-trade-amount") as HTMLInputElement | null;
  const envEl = document.getElementById("desired-trade-env") as HTMLSelectElement | null;
  const modeEl = document.getElementById("desired-trade-mode") as HTMLSelectElement | null;
  const intervalEl = document.getElementById("desired-trade-interval") as HTMLInputElement | null;
  const intervalGroup = document.getElementById("desired-trade-interval-group");
  const activateBtn = document.getElementById("desired-trade-activate");
  const stopBtn = document.getElementById("desired-trade-stop");
  const stateEl = document.getElementById("desired-trade-state");
  if (!actionEl || !tokenEl || !amountEl || !envEl || !modeEl || !intervalEl || !activateBtn || !stopBtn) {
    return;
  }

  const isVi = () => (currentSettings?.language || "en") === "vi";

  // Hydrate from saved config (agent wallet).
  const saved: any = currentSettings?.autoTrade?.agent || {};
  if (saved.action === "buy" || saved.action === "sell") actionEl.value = saved.action;
  if (typeof saved.token === "string" && saved.token) tokenEl.value = saved.token;
  if (typeof saved.amount === "number") amountEl.value = String(saved.amount);
  if (saved.env === "testnet" || saved.env === "mainnet") envEl.value = saved.env;
  if (saved.mode === "once" || saved.mode === "recurring") modeEl.value = saved.mode;
  if (typeof saved.interval_minutes === "number") intervalEl.value = String(saved.interval_minutes);

  const syncIntervalVisibility = () => {
    if (intervalGroup) intervalGroup.style.display = modeEl.value === "recurring" ? "" : "none";
  };
  syncIntervalVisibility();
  modeEl.addEventListener("change", syncIntervalVisibility);

  const readConfig = () => {
    const action = actionEl.value === "sell" ? "sell" : "buy";
    const token = (tokenEl.value || "SUI").trim();
    const amount = parseFloat(amountEl.value);
    const env = envEl.value === "mainnet" ? "mainnet" : "testnet";
    const mode = modeEl.value === "recurring" ? "recurring" : "once";
    const interval = Math.max(1, parseInt(intervalEl.value) || 60);
    return { action, token, amount, env, mode, interval };
  };

  // Two-click safeguard for real-money mainnet trades (no native alert/confirm).
  const defaultBtnText = activateBtn.textContent || "Kích hoạt";
  let mainnetArmed = false;
  let armTimer: ReturnType<typeof setTimeout> | null = null;
  const disarmMainnet = () => {
    mainnetArmed = false;
    activateBtn.textContent = defaultBtnText;
    if (armTimer) {
      clearTimeout(armTimer);
      armTimer = null;
    }
  };

  activateBtn.addEventListener("click", () => {
    void (async () => {
      const c = readConfig();
      if (!c.token || Number.isNaN(c.amount) || c.amount <= 0) {
        showToast(isVi() ? "Nhập token và số lượng hợp lệ." : "Enter a valid token and amount.", "error");
        return;
      }
      if (!currentSettings?.agentSecretKey) {
        showToast(
          isVi()
            ? "Chưa có ví Agent. Tạo ví Agent ở tab Blockchain trước."
            : "No Agent wallet. Generate one in the Blockchain tab first.",
          "error",
        );
        return;
      }
      if (c.env === "mainnet" && !mainnetArmed) {
        // First click on mainnet: arm and warn; require a second click to confirm.
        mainnetArmed = true;
        activateBtn.textContent = isVi() ? "Bấm lần nữa để xác nhận Mainnet" : "Click again to confirm Mainnet";
        if (stateEl) {
          stateEl.textContent = isVi()
            ? `⚠️ Mainnet TIỀN THẬT: ${c.action} ${c.amount} ${c.token} qua Cetus.`
            : `⚠️ Mainnet REAL funds: ${c.action} ${c.amount} ${c.token} via Cetus.`;
        }
        armTimer = setTimeout(disarmMainnet, 6000);
        return;
      }
      disarmMainnet();

      const api = (window as any).electronAPI;
      const autoTrade: Record<string, any> = { ...(currentSettings?.autoTrade || {}) };
      autoTrade.agent = {
        ...(autoTrade.agent || {}),
        enabled: true,
        action: c.action,
        token: c.token,
        amount: c.amount,
        env: c.env,
        mode: c.mode,
        interval_minutes: c.interval,
      };
      await api.updateSettings({ autoTrade });
      await api.broadcastPetEvent("trade:execute-desired", {
        wallet: "agent",
        action: c.action,
        token: c.token,
        amount: c.amount,
        env: c.env,
        mode: c.mode,
        intervalMinutes: c.interval,
      });

      if (stateEl) {
        const tail = c.mode === "recurring" ? (isVi() ? `, mỗi ${c.interval} phút` : `, every ${c.interval}m`) : "";
        stateEl.textContent = isVi()
          ? `✅ Đã kích hoạt: ${c.action} ${c.amount} ${c.token} · ${c.env}${tail}`
          : `✅ Activated: ${c.action} ${c.amount} ${c.token} · ${c.env}${tail}`;
      }
      showToast(isVi() ? "Pet đang thực hiện trade!" : "Pet is executing the trade!", "success");
    })();
  });

  stopBtn.addEventListener("click", () => {
    void (async () => {
      const api = (window as any).electronAPI;
      const autoTrade: Record<string, any> = { ...(currentSettings?.autoTrade || {}) };
      if (autoTrade.agent) autoTrade.agent = { ...autoTrade.agent, enabled: false };
      await api.updateSettings({ autoTrade });
      await api.broadcastPetEvent("trade:stop-desired", { wallet: "agent" });
      if (stateEl) stateEl.textContent = isVi() ? "🛑 Đã dừng." : "🛑 Stopped.";
      showToast(isVi() ? "Đã dừng trade." : "Trade stopped.", "success");
    })();
  });
}

function setupAutoTradeTab(): void {
  setupDesiredTradeCard();

  const aggrRange = document.getElementById(
    "aggressiveness-range",
  ) as HTMLInputElement;
  const aggrEmoji = document.getElementById("aggressiveness-emoji");
  const aggrText = document.getElementById("aggressiveness-text");

  const slRange = document.getElementById("sl-range") as HTMLInputElement;
  const slVal = document.getElementById("sl-value");

  const tpRange = document.getElementById("tp-range") as HTMLInputElement;
  const tpVal = document.getElementById("tp-value");

  const toggleBtn = document.getElementById(
    "toggle-trade-btn",
  ) as HTMLButtonElement;
  const clearBtn = document.getElementById("clear-terminal-btn");
  const termLogs = document.getElementById("trade-terminal-logs");

  const tradeStatus = document.getElementById("trade-status");
  const tradeModeBadge = document.getElementById("trade-mode-badge");

  // Load saved values from localStorage
  if (aggrRange) {
    const saved = localStorage.getItem("minipet-trade-aggr") || "2";
    aggrRange.value = saved;
    updateAggrUI(parseInt(saved));
    aggrRange.addEventListener("input", () => {
      const val = parseInt(aggrRange.value);
      localStorage.setItem("minipet-trade-aggr", val.toString());
      updateAggrUI(val);
    });
  }

  function updateAggrUI(val: number) {
    if (!aggrEmoji || !aggrText) return;
    const stages = [
      { emoji: "😴", text: "Thận trọng (Safe)", color: "#16a34a" },
      { emoji: "⚖️", text: "Cân bằng (Balanced)", color: "#2563eb" },
      { emoji: "🚀", text: "Đột phá (Moonshot)", color: "#6366f1" },
      { emoji: "🦍", text: "Degen Ape (High Risk)", color: "#db2777" },
      { emoji: "💀", text: "Kamikaze (Extreme)", color: "#dc2626" },
    ];
    const stage = stages[val - 1] || stages[1];
    aggrEmoji.textContent = stage.emoji;
    aggrText.textContent = stage.text;
    aggrText.style.color = stage.color;
  }

  if (slRange && slVal) {
    const saved = localStorage.getItem("minipet-trade-sl") || "5";
    slRange.value = saved;
    slVal.textContent = `${parseFloat(saved).toFixed(1)}%`;
    slRange.addEventListener("input", () => {
      slVal.textContent = `${parseFloat(slRange.value).toFixed(1)}%`;
      localStorage.setItem("minipet-trade-sl", slRange.value);
    });
  }

  if (tpRange && tpVal) {
    const saved = localStorage.getItem("minipet-trade-tp") || "15";
    tpRange.value = saved;
    tpVal.textContent = `${parseFloat(saved).toFixed(1)}%`;
    tpRange.addEventListener("input", () => {
      tpVal.textContent = `${parseFloat(tpRange.value).toFixed(1)}%`;
      localStorage.setItem("minipet-trade-tp", tpRange.value);
    });
  }

  // Radio triggers for Env
  const envRadios = document.querySelectorAll('input[name="tradeEnv"]');
  envRadios.forEach((radio) => {
    radio.addEventListener("change", (e) => {
      const val = (e.target as HTMLInputElement).value;
      if (tradeModeBadge) {
        if (val === "real") {
          tradeModeBadge.textContent = "REAL SUI (Mainnet)";
          tradeModeBadge.setAttribute("data-state", "real");
        } else {
          tradeModeBadge.textContent = "Paper Testing";
          tradeModeBadge.setAttribute("data-state", "paper");
        }
      }
    });
  });

  // Load other inputs from localstorage
  const inputs = [
    "trade-slippage",
    "trade-budget",
    "trade-cooldown",
    "trade-provider-select",
    "trade-exchange-select",
  ];
  inputs.forEach((id) => {
    const el = document.getElementById(id) as
      | HTMLInputElement
      | HTMLSelectElement;
    if (el) {
      const saved = localStorage.getItem(`minipet-trade-${id}`);
      if (saved) el.value = saved;
      el.addEventListener("change", () => {
        localStorage.setItem(`minipet-trade-${id}`, el.value);
        if (id === "trade-exchange-select") {
          updateExchangeFields();
        }
      });
      // also listener for input just in case
      el.addEventListener("input", () => {
        localStorage.setItem(`minipet-trade-${id}`, el.value);
      });
    }
  });

  const exchangeSelect = document.getElementById(
    "trade-exchange-select",
  ) as HTMLSelectElement;
  const apiInfoGroup = document.getElementById("exchange-api-info-group");
  const dexInfoGroup = document.getElementById("exchange-dex-info-group");
  const apiKeyInput = document.getElementById(
    "exchange-api-key",
  ) as HTMLInputElement;
  const apiSecretInput = document.getElementById(
    "exchange-api-secret",
  ) as HTMLInputElement;
  const connectBtn = document.getElementById(
    "connect-exchange-btn",
  ) as HTMLButtonElement;

  function updateExchangeFields() {
    if (!exchangeSelect) return;
    const val = exchangeSelect.value;
    const isCex = ["binance", "okx", "bybit"].includes(val);

    if (isCex) {
      if (apiInfoGroup) apiInfoGroup.style.display = "block";
      if (dexInfoGroup) dexInfoGroup.style.display = "none";

      // Load keys
      const savedKey =
        localStorage.getItem(`minipet-trade-api-key-${val}`) || "";
      const savedSecret =
        localStorage.getItem(`minipet-trade-api-secret-${val}`) || "";
      if (apiKeyInput) apiKeyInput.value = savedKey;
      if (apiSecretInput) apiSecretInput.value = savedSecret;

      if (connectBtn) {
        if (savedKey && savedSecret) {
          connectBtn.textContent = "Đã kết nối";
          connectBtn.style.background = "var(--green)";
        } else {
          connectBtn.textContent = "Kết nối";
          connectBtn.style.background = "var(--accent)";
        }
      }
    } else {
      if (apiInfoGroup) apiInfoGroup.style.display = "none";
      if (dexInfoGroup) dexInfoGroup.style.display = "flex";
    }
  }

  // Initialize exchange fields on start
  updateExchangeFields();

  // Trading wallet selector (Agent vs zkLogin)
  const walletSelect = document.getElementById(
    "trade-wallet-select",
  ) as HTMLSelectElement;
  if (walletSelect) {
    let savedWallet = localStorage.getItem("minipet-trade-wallet") || "agent";
    // Auto-select zklogin if no agent wallet but has zkLogin session
    if (
      savedWallet === "agent" &&
      !currentSettings?.agentSecretKey &&
      currentSettings?.zkLoginSession
    ) {
      savedWallet = "zklogin";
      localStorage.setItem("minipet-trade-wallet", "zklogin");
    }
    walletSelect.value = savedWallet;
    updateTradeWalletAddress();
    walletSelect.addEventListener("change", () => {
      localStorage.setItem("minipet-trade-wallet", walletSelect.value);
      updateTradeWalletAddress();
    });
  }

  if (connectBtn) {
    connectBtn.addEventListener("click", () => {
      if (!exchangeSelect) return;
      const val = exchangeSelect.value;
      const key = apiKeyInput?.value.trim() || "";
      const secret = apiSecretInput?.value.trim() || "";

      if (!key || !secret) {
        showToast("Vui lòng điền đầy đủ API Key và API Secret!", "error");
        return;
      }

      // Save credentials mock style
      localStorage.setItem(`minipet-trade-api-key-${val}`, key);
      localStorage.setItem(`minipet-trade-api-secret-${val}`, secret);

      connectBtn.textContent = "Đã kết nối";
      connectBtn.style.background = "var(--green)";
      showToast(`Đã kết nối API tài khoản ${val.toUpperCase()} thành công!`);

      // Add mock system log in simulation if running
      addLog(
        "system",
        `[SYSTEM] [API] Kết nối thành công API ${val.toUpperCase()}. Sẵn sàng giao dịch Spot.`,
      );
    });
  }

  // Handle mix mode changes and weighted config display
  const mixModeSelect = document.getElementById(
    "trade-mix-mode",
  ) as HTMLSelectElement;
  const weightedGroup = document.getElementById("weighted-config-group");
  if (mixModeSelect) {
    const saved = localStorage.getItem("minipet-trade-mix-mode") || "consensus";
    mixModeSelect.value = saved;
    if (weightedGroup)
      weightedGroup.style.display = saved === "weighted" ? "block" : "none";

    mixModeSelect.addEventListener("change", () => {
      localStorage.setItem("minipet-trade-mix-mode", mixModeSelect.value);
      if (weightedGroup)
        weightedGroup.style.display =
          mixModeSelect.value === "weighted" ? "block" : "none";
    });
  }

  // Handle algorithm checkboxes
  const algoCheckboxes = document.querySelectorAll('input[name="tradeAlgo"]');
  algoCheckboxes.forEach((cb) => {
    const input = cb as HTMLInputElement;
    const key = `minipet-trade-algo-${input.value}`;
    const saved = localStorage.getItem(key);
    if (saved !== null) {
      input.checked = saved === "true";
    }
    input.addEventListener("change", () => {
      localStorage.setItem(key, input.checked.toString());
      updateAlgoCardStyle(input);
    });
    updateAlgoCardStyle(input);
  });

  function updateAlgoCardStyle(input: HTMLInputElement) {
    const card = input.closest(".algo-checkbox-card") as HTMLElement;
    if (card) {
      if (input.checked) {
        card.style.borderColor = "var(--accent)";
        card.style.boxShadow = "0 0 8px var(--accent-glow)";
        card.style.background = "var(--accent-soft)";
      } else {
        card.style.borderColor = "var(--border)";
        card.style.boxShadow = "none";
        card.style.background = "var(--bg-elevated)";
      }
    }
  }

  function getSelectedAlgos(): string[] {
    const list: string[] = [];
    document
      .querySelectorAll('input[name="tradeAlgo"]:checked')
      .forEach((el) => {
        list.push((el as HTMLInputElement).value.toUpperCase());
      });
    return list;
  }

  // Toggle Bot Simulation
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      if (isSimulating) {
        stopSimulation();
      } else {
        // Check if user has a Pet NFT before allowing trade
        const hasNftPet = cachedPetList.some((p) => p.slug.startsWith("nft-"));
        if (!hasNftPet) {
          const lang = (currentSettings?.language as Language) || "en";
          const isVi = lang === "vi";
          showToast(
            isVi
              ? "Bạn cần kết nối ví có Pet NFT on-chain để sử dụng AI Agent Trade!"
              : "You need a synced wallet with at least 1 Pet NFT to use AI Agent Trade!",
            "error",
          );
          return;
        }
        startSimulation();
      }
    });
  }

  if (clearBtn && termLogs) {
    clearBtn.addEventListener("click", () => {
      termLogs.innerHTML = `<div style="color: #6272a4;">[SYSTEM] Logs cleared. Bot status: ${isSimulating ? "Active" : "Inactive"}</div>`;
    });
  }

  function startSimulation() {
    isSimulating = true;
    const lang = (currentSettings?.language as Language) || "en";
    const t = translations[lang];
    if (tradeStatus) {
      tradeStatus.textContent = t.botRunning || "Bot Running";
      tradeStatus.setAttribute("data-state", "on");
    }
    if (toggleBtn) {
      toggleBtn.textContent = t.stopAutoTrade || "Stop AI Agent";
      toggleBtn.style.background = "var(--red)";
    }

    const envReal = (document.getElementById("env-real") as HTMLInputElement)
      ?.checked;
    const walletSel =
      (document.getElementById("trade-wallet-select") as HTMLSelectElement)
        ?.value || "agent";
    const agentKey = currentSettings?.agentSecretKey;

    // Real mode: use AgentTradeEngine with on-chain execution
    // Works with either agent wallet or zkLogin (based on dropdown)
    if (envReal) {
      const signingKey = walletSel === "agent" ? agentKey : null;
      if (walletSel === "agent" && !agentKey) {
        addLog(
          "system",
          t.noSigningMethod ||
            "[ERROR] No agent wallet. Generate one in Settings first.",
        );
        isSimulating = false;
        return;
      }
      // For zkLogin: needs session (not yet implemented in trade engine)
      if (walletSel === "zklogin" && !currentSettings?.zkLoginSession) {
        addLog(
          "system",
          t.walletNotSynced ||
            "[ERROR] zkLogin session missing. Sync from browser first.",
        );
        isSimulating = false;
        return;
      }

      const budget = parseFloat(
        (document.getElementById("trade-budget") as HTMLInputElement)?.value ||
          "5",
      );
      const cooldown =
        parseInt(
          (document.getElementById("trade-cooldown") as HTMLInputElement)
            ?.value || "15",
        ) *
        60 *
        1000;
      const slippage = parseFloat(
        (document.getElementById("trade-slippage") as HTMLInputElement)
          ?.value || "1",
      );

      agentTradeEngine = new AgentTradeEngine(
        {
          budgetSui: budget,
          cooldownMs: cooldown,
          slippagePct: slippage,
          agentSecretKey: signingKey || "",
        },
        (log: TradeLog) => {
          const typeMap: Record<string, string> = {
            BUY: "buy",
            SELL: "sell",
            HOLD: "info",
            SIGNAL: "scan",
            ERROR: "system",
          };
          addLog(typeMap[log.action] || "info", log.message);
          if (log.action === "BUY" || log.action === "SELL") {
            simTradesCount++;
            updateStatsUI();
          }
        },
      );
      agentTradeEngine.start();
      addLog("system", `[SYSTEM] 🔴 REAL MODE — AI Agent Trade started.`);
      addLog(
        "info",
        `[WALLET] ${walletSel === "zklogin" ? "zkLogin" : "Agent"} · ${getTradeWalletAddress()?.slice(0, 10)}...`,
      );
      return;
    }

    // Paper mode: simulated trading
    const activeAlgos = getSelectedAlgos();
    const mixMode = mixModeSelect?.value || "consensus";

    addLog(
      "system",
      `[SYSTEM] AI Agent Trade (Paper Mode). Signal: ${getSelectedProviderText()}`,
    );
    const walletAddr = getTradeWalletAddress();
    if (walletAddr && walletAddr.startsWith("0x")) {
      addLog("info", `[WALLET] ${walletAddr.slice(0, 10)}... (paper mode)`);
    }
    addLog(
      "info",
      `[MIX ENGINE] Algorithms selected: [${activeAlgos.join(", ") || "NONE"}], Mode: ${mixMode.toUpperCase()}`,
    );
    addLog(
      "info",
      `[AI ENGINE] Analysing market conditions... Aggressiveness level: ${aggrRange?.value || 2}`,
    );

    // Reset stats slightly
    simTradesCount = 0;
    simWinRate = 0;
    simPnl = 0.0;
    updateStatsUI();

    // Trigger pet speak
    void (window as any).electronAPI?.broadcastPetEvent("pet:say", {
      text:
        currentSettings?.language === "vi"
          ? "Khởi động AI Agent Trade! Em sẽ giả lập cày tiền cho sếp nhé."
          : "AI Agent Trade started! Running in paper mode.",
      priority: true,
    });

    const simulationTick = () => {
      const actions = ["scan", "scan", "buy", "hold", "sell", "win"];
      const action = actions[Math.floor(Math.random() * actions.length)];

      const coins = ["SUI", "CETUS", "SEND", "FUD", "HAWK", "HIPPO", "PET"];
      const coin = coins[Math.floor(Math.random() * coins.length)];
      const budget = parseFloat(
        (document.getElementById("trade-budget") as HTMLInputElement)?.value ||
          "5",
      );
      const currentAlgos = getSelectedAlgos();

      const provider =
        (document.getElementById("trade-provider-select") as HTMLSelectElement)
          ?.value || "pet-ai";
      const exchangeEl = document.getElementById(
        "trade-exchange-select",
      ) as HTMLSelectElement;
      const exchangeVal = exchangeEl?.value || "cetus";
      const exchangeName =
        exchangeEl?.options[exchangeEl.selectedIndex]?.text || "Cetus Protocol";

      const isCex = ["binance", "okx", "bybit"].includes(exchangeVal);
      const apiKey = localStorage.getItem(
        `minipet-trade-api-key-${exchangeVal}`,
      );
      const exPrefix = isCex
        ? `[API ${exchangeVal.toUpperCase()}]`
        : `[${exchangeVal.toUpperCase()}]`;

      if (action === "scan") {
        const isEn = (currentSettings?.language || "en") !== "vi";
        let scans = isEn ? [
          `[SCAN] Scanning liquidity pool ${coin}/SUI on Cetus Protocol...`,
          `[SENTIMENT] Social sentiment (X/Twitter) for $${coin} spiking!`,
          `[MONITOR] Agent tracking whale wallet 0x4a8d... just deposited $${coin}.`,
        ] : [
          `[SCAN] Quét thanh khoản pool ${coin}/SUI trên Cetus Protocol...`,
          `[SENTIMENT] Chỉ số mạng xã hội (X/Twitter) của $${coin} tăng đột biến!`,
          `[MONITOR] Agent đang theo dõi ví whale 0x4a8d... vừa nạp $${coin}.`,
        ];
        if (provider === "deepbook" || exchangeVal === "deepbook") {
          scans = isEn ? [
            `[DEEPBOOK] Scanning orderbook for ${coin}/SUI pair...`,
            `[DEEPBOOK] Found large bid wall from whale at good price...`,
            `[DEEPBOOK] Measuring market depth on DeepBook CLOB...`,
          ] : [
            `[DEEPBOOK] Đang quét sổ lệnh (Orderbook) cặp giao dịch SUI/${coin}...`,
            `[DEEPBOOK] Tìm thấy tường mua (Bid Wall) lớn của whale tại mức giá tốt...`,
            `[DEEPBOOK] Đang đo độ sâu thị trường (Market Depth) trên DeepBook CLOB...`,
          ];
        }
        addLog("scan", scans[Math.floor(Math.random() * scans.length)]);
      } else if (action === "buy") {
        const isEn = (currentSettings?.language || "en") !== "vi";
        if (currentAlgos.length === 0) {
          addLog(
            "system",
            isEn ? `[WARNING] No algorithm selected! Please select at least 1.` : `[WARNING] Không có thuật toán nào được chọn để giao dịch! Vui lòng chọn ít nhất 1.`,
          );
          return;
        }

        if (isCex && !apiKey) {
          addLog(
            "system",
            isEn ? `[WARNING] No API configured for ${exchangeName}! Simulating in Testnet/Sandbox mode.` : `[WARNING] Chưa cấu hình API cho ${exchangeName}! Lệnh giả lập sẽ thực hiện dưới chế độ Testnet/Sandbox.`,
          );
        }

        // Print algorithm mix logs
        if (mixMode === "consensus") {
          addLog(
            "scan",
            isEn ? `[MIX CONSENSUS] All algorithms [${currentAlgos.join(", ")}] signal BUY.` : `[MIX CONSENSUS] Tất cả thuật toán [${currentAlgos.join(", ")}] đồng loạt báo hiệu MUA.`,
          );
        } else if (mixMode === "majority") {
          addLog(
            "scan",
            isEn ? `[MIX MAJORITY] Majority vote passed from [${currentAlgos.slice(0, Math.ceil(currentAlgos.length / 2 + 0.1)).join(", ")}].` : `[MIX MAJORITY] Đa số biểu quyết thông qua tín hiệu từ [${currentAlgos.slice(0, Math.ceil(currentAlgos.length / 2 + 0.1)).join(", ")}].`,
          );
        } else if (mixMode === "weighted") {
          const weights = currentAlgos.map(
            (a) => `${a}: ${(100 / currentAlgos.length).toFixed(0)}%`,
          );
          addLog(
            "scan",
            isEn ? `[MIX WEIGHTS] Portfolio allocation: { ${weights.join(", ")} }. Triggering buy.` : `[MIX WEIGHTS] Danh mục phân bổ: { ${weights.join(", ")} }. Kích hoạt mua.`,
          );
        } else {
          addLog(
            "scan",
            isEn ? `[MIX DEGEN] Fast BUY signal from algorithm ${currentAlgos[Math.floor(Math.random() * currentAlgos.length)]}.` : `[MIX DEGEN] Tín hiệu MUA nhanh từ thuật toán ${currentAlgos[Math.floor(Math.random() * currentAlgos.length)]}.`,
          );
        }

        if (exchangeVal === "deepbook") {
          addLog(
            "buy",
            isEn ? `[BUY] ${exPrefix} Market Buy ${budget} SUI for $${coin} on DeepBook CLOB orderbook` : `[BUY] ${exPrefix} Khớp lệnh Market Buy ${budget} SUI lấy $${coin} trên sổ lệnh DeepBook CLOB`,
          );
        } else if (isCex) {
          addLog(
            "buy",
            isEn ? `[BUY] ${exPrefix} Spot Buy order ${budget} SUI for $${coin} via API (Slippage: ${(Math.random() * 0.2 + 0.05).toFixed(2)}%)` : `[BUY] ${exPrefix} Đặt lệnh Mua Spot ${budget} SUI lấy $${coin} thành công via API (Slippage: ${(Math.random() * 0.2 + 0.05).toFixed(2)}%)`,
          );
        } else {
          addLog(
            "buy",
            isEn ? `[BUY] ${exPrefix} Swapped ${budget} SUI for $${coin} (Slippage: ${(Math.random() * 0.8 + 0.1).toFixed(2)}%)` : `[BUY] ${exPrefix} Đã swap ${budget} SUI lấy $${coin} (Slippage: ${(Math.random() * 0.8 + 0.1).toFixed(2)}%)`,
          );
        }
        simTradesCount++;
        updateStatsUI();

        // Trigger pet speak
        void (window as any).electronAPI?.broadcastPetEvent("pet:say", {
          text: `[SIMULATION] BUY $${coin} on ${exchangeName}`,
          priority: true,
        });
      } else if (action === "hold") {
        const isEn = (currentSettings?.language || "en") !== "vi";
        addLog(
          "info",
          isEn ? `[HOLD] ${exPrefix} Holding $${coin}. Unrealized P&L: ${(Math.random() * 6 - 2).toFixed(2)}%` : `[HOLD] ${exPrefix} Đang giữ lệnh $${coin}. Lợi nhuận tức thời: ${(Math.random() * 6 - 2).toFixed(2)}%`,
        );
      } else if (action === "sell") {
        const isEn = (currentSettings?.language || "en") !== "vi";
        const profit = Math.random() > 0.45;
        const targetPercent = profit
          ? parseFloat(tpRange?.value || "15")
          : -parseFloat(slRange?.value || "5");
        const finalPnL =
          ((budget * targetPercent) / 100) * (Math.random() * 0.4 + 0.8);

        if (profit) {
          addLog(
            "win",
            isEn ? `[TAKE PROFIT] ${exPrefix} Took profit on $${coin} at +${targetPercent.toFixed(1)}% (Profit +${finalPnL.toFixed(3)} SUI)` : `[TAKE PROFIT] ${exPrefix} Đã chốt lời $${coin} thành công tại mức +${targetPercent.toFixed(1)}% (Lãi +${finalPnL.toFixed(3)} SUI)`,
          );
          simPnl += finalPnL;

          // Trigger pet speak
          void (window as any).electronAPI?.broadcastPetEvent("pet:say", {
            text: `[SIMULATION] Take profit $${coin} on ${exchangeName}! ✅`,
            priority: true,
          });
        } else {
          addLog(
            "sell",
            isEn ? `[STOP LOSS] ${exPrefix} Auto stop-loss $${coin} at ${targetPercent.toFixed(1)}% (Loss ${finalPnL.toFixed(3)} SUI)` : `[STOP LOSS] ${exPrefix} Cắt lỗ tự động $${coin} tại mức ${targetPercent.toFixed(1)}% (Lỗ ${finalPnL.toFixed(3)} SUI)`,
          );
          simPnl += finalPnL;

          // Trigger pet speak
          void (window as any).electronAPI?.broadcastPetEvent("pet:say", {
            text: `[SIMULATION] Stop loss $${coin} on ${exchangeName} 🛑`,
            priority: true,
          });
        }
        simTradesCount++;
        updateStatsUI();
      } else {
        const isEn = (currentSettings?.language || "en") !== "vi";
        addLog(
          "system",
          isEn ? `[AI ANALYST] MiniPet suggests portfolio rebalancing...` : `[AI ANALYST] MiniPet gợi ý tái cơ cấu danh mục đầu tư...`,
        );
      }
    };

    // run once immediately
    simulationTick();
    simInterval = setInterval(simulationTick, 4000);
  }

  function stopSimulation() {
    isSimulating = false;
    if (simInterval) {
      clearInterval(simInterval);
      simInterval = null;
    }
    if (agentTradeEngine) {
      agentTradeEngine.stop();
      agentTradeEngine = null;
    }
    if (tradeStatus) {
      const lang = (currentSettings?.language as Language) || "en";
      const t = translations[lang];
      tradeStatus.textContent = t.botStopped || "Bot Stopped";
      tradeStatus.setAttribute("data-state", "off");
    }
    if (toggleBtn) {
      const lang = (currentSettings?.language as Language) || "en";
      const t = translations[lang];
      toggleBtn.textContent = t.activateAutoTrade || "Start AI Agent";
      toggleBtn.style.background = "var(--accent)";
    }
    addLog("system", "[SYSTEM] AI Agent Trade engine stopped.");

    void (window as any).electronAPI?.broadcastPetEvent("pet:say", {
      text:
        currentSettings?.language === "vi"
          ? "Đã dừng AI Agent Trade."
          : "AI Agent Trade stopped.",
      priority: true,
    });
  }

  function getSelectedProviderText(): string {
    const el = document.getElementById(
      "trade-provider-select",
    ) as HTMLSelectElement;
    return el ? el.options[el.selectedIndex]?.text : "MiniPet AI";
  }

  function addLog(type: string, text: string) {
    if (!termLogs) return;
    const line = document.createElement("div");
    line.className = `term-line ${type}`;
    if (type === "system") {
      line.style.color = "#6272a4";
      line.style.fontStyle = "italic";
    } else if (type === "info") {
      line.style.color = "#8be9fd";
    } else if (type === "buy") {
      line.style.color = "#50fa7b";
      line.style.fontWeight = "500";
    } else if (type === "sell") {
      line.style.color = "#ff5555";
      line.style.fontWeight = "500";
    } else if (type === "win") {
      line.style.color = "#ff79c6";
      line.style.background = "rgba(255, 121, 198, 0.1)";
    } else if (type === "scan") {
      line.style.color = "#f1fa8c";
    }
    const time = new Date().toLocaleTimeString();
    const cleanText = text.replace(/^\[SIMULATION\]\s*/i, "");
    const prefix = agentTradeEngine ? "[LIVE]" : "[SIMULATION]";
    line.textContent = `[${time}] ${prefix} ${cleanText}`;
    termLogs.appendChild(line);
    termLogs.scrollTop = termLogs.scrollHeight;

    // Limit to 100 logs
    while (termLogs.children.length > 100 && termLogs.firstChild) {
      termLogs.removeChild(termLogs.firstChild);
    }
  }

  function updateStatsUI() {
    const wrEl = document.getElementById("sim-winrate");
    const countEl = document.getElementById("sim-count");
    const pnlEl = document.getElementById("sim-pnl");
    const pnlPill = document.getElementById("sim-pnl-pill");

    if (countEl) countEl.textContent = simTradesCount.toString();

    // Simulate win rate based on positive PnL or random
    if (simTradesCount > 0) {
      const baseWinRate =
        simPnl >= 0
          ? 60 + Math.floor(Math.random() * 20)
          : 35 + Math.floor(Math.random() * 15);
      simWinRate = Math.min(100, maxZero(baseWinRate));
    } else {
      simWinRate = 0;
    }

    function maxZero(num: number) {
      return num > 0 ? num : 0;
    }

    if (wrEl) {
      wrEl.textContent = `${simWinRate}%`;
      wrEl.className =
        simWinRate >= 50 ? "stat-num text-green" : "stat-num text-red";
    }

    if (pnlEl) {
      const prefix = simPnl >= 0 ? "+" : "";
      pnlEl.textContent = `${prefix}${simPnl.toFixed(3)} SUI`;
      pnlEl.className = simPnl >= 0 ? "text-green" : "text-red";
    }

    if (pnlPill) {
      if (simPnl >= 0) {
        pnlPill.style.background = "rgba(34, 197, 94, 0.1)";
        pnlPill.style.color = "var(--green)";
        pnlPill.style.borderColor = "rgba(34, 197, 94, 0.2)";
      } else {
        pnlPill.style.background = "rgba(239, 68, 68, 0.1)";
        pnlPill.style.color = "var(--red)";
        pnlPill.style.borderColor = "rgba(239, 68, 68, 0.2)";
      }
    }
  }
}

async function setupPomodoro(lang: Language): Promise<void> {
  const api = (window as any).electronAPI;
  const focusInput = document.getElementById(
    "pomo-focus-time",
  ) as HTMLInputElement;
  const breakInput = document.getElementById(
    "pomo-break-time",
  ) as HTMLInputElement;
  const display = document.getElementById("pomo-display");
  const status = document.getElementById("pomo-status");
  const startBtn = document.getElementById("pomo-start-btn");
  const pauseBtn = document.getElementById("pomo-pause-btn");

  if (
    !focusInput ||
    !breakInput ||
    !display ||
    !status ||
    !startBtn ||
    !pauseBtn
  )
    return;

  let isEditing = false;
  focusInput.addEventListener("focus", () => (isEditing = true));
  focusInput.addEventListener("blur", () => (isEditing = false));
  breakInput.addEventListener("focus", () => (isEditing = true));
  breakInput.addEventListener("blur", () => (isEditing = false));

  const updateUI = (state: any, currentLang: string) => {
    if (!state) return;
    const minutes = Math.floor((state.timeLeft || 0) / 60);
    const seconds = (state.timeLeft || 0) % 60;
    display.textContent = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

    if (!isEditing) {
      if (state.focusMinutes) focusInput.value = state.focusMinutes.toString();
      if (state.breakMinutes) breakInput.value = state.breakMinutes.toString();
    }

    const t = translations[currentLang as Language] || translations["en"];
    status.className = `status-tag ${state.status} active`;
    status.textContent =
      state.status === "idle"
        ? state.isWorkSession
          ? t.statusNextFocus
          : t.statusNextBreak
        : state.status === "focus"
          ? t.statusFocus
          : t.statusBreak;

    startBtn.style.display = state.status === "idle" ? "inline-block" : "none";
    pauseBtn.style.display = state.status === "idle" ? "none" : "inline-block";
    if (state.status === "idle")
      startBtn.textContent = state.isWorkSession ? t.startFocus : t.startBreak;

    focusInput.disabled = state.status !== "idle";
    breakInput.disabled = state.status !== "idle";
  };

  api.onPomoTick((state: any) =>
    updateUI(state, currentSettings?.language || "en"),
  );

  startBtn.addEventListener("click", () => {
    api.startPomo(
      parseInt(focusInput.value) || 25,
      parseInt(breakInput.value) || 5,
    );
  });

  pauseBtn.addEventListener("click", () => api.pausePomo());
  document
    .getElementById("pomo-reset-btn")
    ?.addEventListener("click", () => api.resetPomo());
  document
    .getElementById("pomo-standard-btn")
    ?.addEventListener("click", () => api.updatePomoConfig(25, 5));

  const updateConfig = () => {
    const f = parseInt(focusInput.value);
    const b = parseInt(breakInput.value);
    if (!isNaN(f) && !isNaN(b)) api.updatePomoConfig(f, b);
  };
  focusInput.addEventListener("input", updateConfig);
  breakInput.addEventListener("input", updateConfig);

  const initial = await api.getPomoState();
  if (initial) updateUI(initial, lang);
}

document.addEventListener("DOMContentLoaded", () => {
  void initSettings();
});
