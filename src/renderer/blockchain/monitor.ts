import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';

export class SuiMonitor {
  private address: string = '';
  private enabled: boolean = false;
  private lastEventCursor: any = null;
  private lastBalance: string | null = null;
  private pollInterval: any = null;
  private packageId: string = '0x9953930b201460e1d5a71a06708fc7347952a1228221805f32be97e93892705a';

  constructor() {
    this.init();
  }

  private async init() {
    const api = (window as any).electronAPI;
    const settings = await api.getSettings();
    this.updateConfig(settings);

    // Listen for settings updates
    api.onSettingsUpdate((data: any) => {
      this.updateConfig(data.settings);
    });
  }

  private updateConfig(settings: any) {
    this.address = settings.suiAddress || '';
    this.enabled = settings.suiEnabled || false;

    console.log('[SuiMonitor] UpdateConfig:', { enabled: this.enabled, address: this.address });

    if (this.enabled && this.address) {
      this.startPolling();
    } else {
      this.stopPolling();
    }
  }

  private startPolling() {
    if (this.pollInterval) return;
    console.log('[SuiMonitor] Starting polling for address:', this.address);
    
    // Initial check
    this.checkBlockchain();
    
    this.pollInterval = setInterval(() => {
      console.log('[SuiMonitor] Polling tick...');
      this.checkBlockchain();
    }, 5000); 
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
      await Promise.all([
        this.checkEvents(),
        this.checkBalance()
      ]);
    } catch (error) {
      console.error('[SuiMonitor] Polling error:', error);
    }
  }

  private async checkBalance() {
    const api = (window as any).electronAPI;
    try {
      const rpcUrl = getJsonRpcFullnodeUrl('testnet');
      const response: any = await api.suiRpcCall('suix_getBalance', [this.address, '0x2::sui::SUI'], rpcUrl);
      
      if (response.error) throw new Error(response.error.message);
      const balance = response.result;
      console.log('[SuiMonitor] Balance check success:', balance.totalBalance);

      if (this.lastBalance !== null && balance.totalBalance !== this.lastBalance) {
        const diff = BigInt(balance.totalBalance) - BigInt(this.lastBalance);
        console.log('[SuiMonitor] Balance changed. Diff:', diff.toString());
        if (diff > 0n) {
          console.log('[SuiMonitor] Balance increased! Detected new SUI incoming.');
          // Received SUI
          const amount = Number(diff);
          api.broadcastPetEvent('blockchain:event', {
            event_type: 'receive_coin',
            amount: amount,
            coin_type: 'SUI',
            pet_slug: 'Someone',
            message: ''
          });
        } else if (diff < 0n) {
          console.log('[SuiMonitor] Balance decreased! SUI sent/spent.');
          const amount = Number(-diff);
          api.broadcastPetEvent('blockchain:event', {
            event_type: 'send_coin',
            amount: amount,
            coin_type: 'SUI',
            pet_slug: 'Me',
            message: ''
          });
        }
      }
      this.lastBalance = balance.totalBalance;
    } catch (e) {
      console.error('[SuiMonitor] Balance check failed', e);
    }
  }

  private async checkEvents() {
    const api = (window as any).electronAPI;
    try {
      const rpcUrl = getJsonRpcFullnodeUrl('testnet');
      const response: any = await api.suiRpcCall('suix_queryEvents', [{
        query: {
          MoveModule: {
            package: this.packageId,
            module: 'pet_nft'
          }
        },
        limit: 10,
        descendingOrder: true
      }], rpcUrl);

      if (response.error) throw new Error(response.error.message);
      const data = response.result.data || [];

      if (data && data.length > 0) {
        console.log(`[SuiMonitor] Processing ${data.length} potential new events...`);
        // Process new events
        for (const event of data) {
          // Check if we already processed this event
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
    const amount = parsed.amount ? Number(parsed.amount) : 0;
    
    if (type.includes('MessageEvent')) {
      if (parsed.recipient === this.address && parsed.text) {
        api.broadcastPetEvent('blockchain:event', {
          event_type: 'message',
          message: parsed.text,
          pet_slug: event.sender.substring(0, 6) + '...',
          amount: amount,
          coin_type: 'SUI'
        });
      }
    } else if (type.includes('BonkEvent')) {
      if (parsed.target_pet_id) {
         api.broadcastPetEvent('blockchain:event', {
          event_type: 'bonk',
          pet_slug: event.sender.substring(0, 6) + '...',
          amount: amount,
          coin_type: 'SUI'
        });
      }
    }
  }
}
