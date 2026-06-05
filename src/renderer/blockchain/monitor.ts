import { SUI_CONFIG } from '../../shared/constants';

export class SuiMonitor {
  private address: string = '';
  private enabled: boolean = false;
  private lastEventCursor: any = null;
  private lastBalance: string | null = null;
  private pollInterval: any = null;
  private packageId: string = SUI_CONFIG.PACKAGE_ID;

  // --- Multi-Agent State ---
  private flaggedNFTs: Set<string> = new Set();
  
  // Timestamps for throttling alerts to prevent spamming the user
  private lastGasAlertTime: number = 0;
  private lastDeFiAlertTime: number = 0;
  private lastReminderAlertTime: number = 0;

  // --- Agent Balance Monitor ---
  private agentAddress: string = '';
  private lastAgentBalance: string | null = null;

  // --- Staggered Poll Counters ---
  private pollTick: number = 0;

  constructor() {
    void this.init().catch(console.error);
  }

  private async init() {
    const api = (window as any).electronAPI;
    const settings = await api.getSettings();
    await this.updateConfig(settings);

    // Listen for settings updates
    api.onSettingsUpdate((data: any) => {
      void this.updateConfig(data.settings).catch(console.error);
    });
  }

  private async updateConfig(settings: any) {
    this.address = settings.suiAddress || '';
    this.enabled = settings.suiEnabled || false;

    if (settings.agentSecretKey) {
      try {
        const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
        const keypair = Ed25519Keypair.fromSecretKey(settings.agentSecretKey);
        this.agentAddress = keypair.toSuiAddress();
      } catch (err) {
        console.error('[SuiMonitor] Failed to derive agent address:', err);
        this.agentAddress = '';
      }
    } else {
      this.agentAddress = '';
    }

    if (this.enabled && this.address) {
      this.startPolling();
    } else {
      this.stopPolling();
    }
  }

  private startPolling() {
    if (this.pollInterval) return;
    
    // Initial check
    void this.checkBlockchain().catch(console.error);
    
    this.pollInterval = setInterval(() => {
      this.pollTick++;
      void this.checkBlockchain().catch(console.error);
    }, 10000); // Base interval: 10 seconds
  }

  public stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private async checkBlockchain() {
    if (!this.address || !this.enabled) return;

    try {
      // Staggered polling: not all checks run every tick
      const tasks: Promise<void>[] = [];

      // Balance check: every tick (~10s)
      tasks.push(this.checkBalance());

      // Agent balance: every 2nd tick (~20s)
      if (this.pollTick % 2 === 0) {
        tasks.push(this.checkAgentBalance());
      }

      // Events: every 3rd tick (~30s)
      if (this.pollTick % 3 === 0) {
        tasks.push(this.checkEvents());
      }

      // Phishing NFT scan: every 6th tick (~60s)
      if (this.pollTick % 6 === 0) {
        tasks.push(this.checkPhishingNFTs());
      }

      // DeFi health: every 12th tick (~120s)
      if (this.pollTick % 12 === 0) {
        tasks.push(this.checkDeFiHealth());
      }

      await Promise.all(tasks);
    } catch (error) {
      console.error('[SuiMonitor] Polling error:', error);
    }
  }

  // --- Agent 1: Balance & Gas Guardian ---
  private async checkBalance() {
    const api = (window as any).electronAPI;
    try {
      const rpcUrl = SUI_CONFIG.RPC_URL;
      const response: any = await api.suiRpcCall('suix_getBalance', [this.address, '0x2::sui::SUI'], rpcUrl);
      
      if (response.error) throw new Error(response.error.message);
      const balance = response.result;

      if (this.lastBalance !== null && balance.totalBalance !== this.lastBalance) {
        const diff = BigInt(balance.totalBalance) - BigInt(this.lastBalance);
        if (diff > 0n) {
          const amount = Number(diff) / 1_000_000_000;
          api.broadcastPetEvent('pet:say', {
            text: `💰 Nhận được SUI! +${amount.toFixed(2)} SUI vừa hạ cánh vào ví sếp kìa! 🚀`,
            priority: true
          });
        } else if (diff < 0n) {
          const amount = Number(-diff) / 1_000_000_000;
          api.broadcastPetEvent('pet:say', {
            text: `💸 Ví vừa gửi đi -${amount.toFixed(2)} SUI thành công nha boss!`,
            priority: true
          });
        }
      }
      this.lastBalance = balance.totalBalance;
    } catch (e) {
      console.error('[SuiMonitor] Balance check failed', e);
    }
  }

  // --- Agent Balance Monitor ---
  private async checkAgentBalance() {
    if (!this.agentAddress || !this.enabled) return;
    const api = (window as any).electronAPI;
    try {
      const rpcUrl = SUI_CONFIG.RPC_URL;
      const response: any = await api.suiRpcCall('suix_getBalance', [this.agentAddress, '0x2::sui::SUI'], rpcUrl);
      
      if (response.error) throw new Error(response.error.message);
      const balance = response.result;

      if (this.lastAgentBalance !== null && balance.totalBalance !== this.lastAgentBalance) {
        const diff = BigInt(balance.totalBalance) - BigInt(this.lastAgentBalance);
        if (diff > 0n) {
          const amount = Number(diff) / 1_000_000_000;
          api.broadcastPetEvent('pet:say', {
            text: `🤖 Yeah! Ví AI Agent vừa nhận thêm +${amount.toFixed(2)} SUI rồi nè sếp ơi! 🎉`,
            priority: true
          });
        }
      }
      this.lastAgentBalance = balance.totalBalance;
    } catch (e) {
      console.error('[SuiMonitor] Agent Balance check failed', e);
    }
  }



  // --- Agent 3: Phishing NFT Guardian 🛡️ ---
  private async checkPhishingNFTs() {
    const api = (window as any).electronAPI;
    try {
      const rpcUrl = SUI_CONFIG.RPC_URL;
      const response: any = await api.suiRpcCall('suix_getOwnedObjects', [
        this.address,
        {
          options: { showContent: true, showDisplay: true }
        }
      ], rpcUrl);

      if (response.result && response.result.data) {
        const objects = response.result.data;
        for (const obj of objects) {
          const objId = obj.data?.objectId;
          if (!objId || this.flaggedNFTs.has(objId)) continue;

          // Inspect object fields for phishing keywords
          const display = obj.data?.display?.data;
          const content = obj.data?.content;
          
          const name = (display?.name || content?.fields?.name || '').toLowerCase();
          const description = (display?.description || content?.fields?.description || '').toLowerCase();

          const spamKeywords = ['claim', 'reward', 'gift', 'free', 'airdrop', 'voucher', '5000 sui', '10000 sui', 'winner', 'giftbox'];
          const isPhishing = spamKeywords.some(kw => name.includes(kw) || description.includes(kw));

          if (isPhishing) {
            this.flaggedNFTs.add(objId);
            const nftName = display?.name || content?.fields?.name || 'Vô danh';
            const msg = `🚨 CẢNH BÁO PHISHING! Ví sếp vừa nhận được 1 NFT lạ mang tên: "${nftName}". Đây là NFT lừa đảo airdrop ảo. Tuyệt đối không click link lạ nha boss! ⛔`;
            api.broadcastPetEvent('pet:say', { text: msg, priority: true });
            api.broadcastPetEvent('blockchain:event', { event_type: 'bonk', pet_slug: 'Agent' });
            break; // Alert once per poll tick
          }
        }
      }
    } catch (e) {
      console.error('[SuiMonitor] Phishing scan failed', e);
    }
  }

  // --- Agent 5: DeFi Liquidation & Gas Guardian 🛡️ ---
  private async checkDeFiHealth() {
    const api = (window as any).electronAPI;
    const now = Date.now();

    try {
      // 1. Gas check: alert if SUI balance is critically low (< 0.75 SUI)
      // Warns once every 20 minutes (20 * 60 * 1000 = 1,200,000 ms)
      if (this.lastBalance !== null) {
        const bal = BigInt(this.lastBalance);
        const suiAmount = Number(bal) / 1_000_000_000;
        if (suiAmount < 0.75 && suiAmount > 0) {
          if (now - this.lastGasAlertTime >= 1200000) {
            this.lastGasAlertTime = now;
            const msg = `⚠️ CẢNH BÁO GAS! Số dư ví của sếp chỉ còn **${suiAmount.toFixed(3)} SUI**. Sắp hết xăng trả phí giao dịch (Gas fee) rồi, sếp nhớ nạp thêm nha! 💸`;
            api.broadcastPetEvent('pet:say', { text: msg, priority: true });
          }
        }
      }

      if (now - this.lastDeFiAlertTime < 120000) return; // Cooldown: 120s

      // 2. DeFi Position check: look for Scallop/Navi smart contract objects in owned list
      const rpcUrl = SUI_CONFIG.RPC_URL;
      const response: any = await api.suiRpcCall('suix_getOwnedObjects', [
        this.address
      ], rpcUrl);

      if (response.result && response.result.data) {
        const objects = response.result.data;
        let hasDeFi = false;
        for (const obj of objects) {
          const type = obj.data?.type || '';
          if (type.includes('scallop') || type.includes('navi') || type.includes('obligation') || type.includes('BorrowKey')) {
            hasDeFi = true;
            break;
          }
        }

        if (hasDeFi) {
          this.lastDeFiAlertTime = now;
          const msg = `🛡️ GIÁM SÁT DEFI: Phát hiện sếp có vị thế Lending/Borrowing đang hoạt động. Nhớ chú ý biến động giá thị trường để bảo vệ tỷ lệ thanh lý (Health Factor) an toàn nha! 📈`;
          api.broadcastPetEvent('pet:say', { text: msg, priority: true });
        }
      }
    } catch (e) {
      console.error('[SuiMonitor] DeFi health check failed', e);
    }
  }

  // --- Legacy Event check for NFT contract ---
  private async checkEvents() {
    const api = (window as any).electronAPI;
    try {
      const rpcUrl = SUI_CONFIG.RPC_URL;
      const response: any = await api.suiRpcCall('suix_queryEvents', [
        {
          MoveModule: {
            package: this.packageId,
            module: 'pet_nft'
          }
        },
        null,
        10,
        true
      ], rpcUrl);

      if (response.error) throw new Error(response.error.message);
      const data = response.result.data || [];

      if (data && data.length > 0) {
        for (const event of data) {
          if (this.lastEventCursor && 
              (event.id.txDigest === this.lastEventCursor.txDigest && event.id.eventSeq === this.lastEventCursor.eventSeq)) {
            break;
          }
          this.processEvent(event);
        }
        this.lastEventCursor = data[0].id;
      }
    } catch (e) {
      console.error('[SuiMonitor] Event check failed', e);
    }
  }

  private processEvent(event: any) {
    const api = (window as any).electronAPI;
    const type = event.type;
    const parsed: any = event.parsedJson;
    const amount = parsed.amount || parsed.fee || 0;
    
    if (type.includes('MessageEvent')) {
      if (parsed.recipient === this.address && parsed.message) {
        api.broadcastPetEvent('blockchain:event', {
          event_type: 'message',
          message: parsed.message,
          pet_slug: parsed.pet_slug || 'Someone',
          amount: Number(amount),
          coin_type: 'SUI'
        });
      }
    } else if (type.includes('BonkEvent')) {
      if (parsed.target === this.address) {
         api.broadcastPetEvent('blockchain:event', {
          event_type: 'bonk',
          pet_slug: parsed.pet_slug || 'Someone',
          amount: Number(amount),
          coin_type: 'SUI'
        });
      }
    }
  }
}
