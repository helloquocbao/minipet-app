import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { SUI_CONFIG } from '../../shared/constants';
import { translations, Language } from '../../shared/i18n/translations';

export class SecurityAgent {
  private rpcUrl: string = SUI_CONFIG.RPC_URL;
  private unlistenCb: UnlistenFn | null = null;
  private lang: Language = 'en';

  constructor() {
    // Initialized Event-driven On-chain Analysis Agent
  }

  private get t() {
    return translations[this.lang] || translations['en'];
  }

  private pickRandom(arr: string[]): string {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  public async start() {
    const api = (window as any).electronAPI;
    try {
      const settings = await api.getSettings();
      this.lang = (settings?.language as Language) || 'en';
    } catch { /* use default */ }

    api.onSettingsUpdate((data: any) => {
      if (data?.settings?.language) this.lang = data.settings.language as Language;
    });

    this.unlistenCb = await listen('clipboard://sui-address-copied', (event: any) => {
      const address = event.payload as string;
      void this.handleNewAddress(address).catch(console.error);
    });
  }

  public stop() {
    if (this.unlistenCb) {
      this.unlistenCb();
      this.unlistenCb = null;
    }
  }

  private getApi() {
    return (window as any).electronAPI;
  }

  private async handleNewAddress(text: string) {
    const api = this.getApi();
    if (!api) return;

    let userAddress = '';
    try {
      const settings = await api.getSettings();
      userAddress = settings?.suiAddress || '';
      if (userAddress && text.trim().toLowerCase() === userAddress.trim().toLowerCase()) {
        api.broadcastPetEvent('pet:say', { text: this.t.agentOwnWallet, priority: true });
        return;
      }
    } catch (err) {
      console.error('[SecurityAgent] Failed to check user settings:', err);
    }

    const trimmed = text.trim();
    if (!userAddress && trimmed.startsWith('0x') && trimmed.length === 66 && !trimmed.includes('::')) {
      const msg = (this.t.agentSuggestSync as string)
        .replace('{address}', `${trimmed.slice(0, 8)}...${trimmed.slice(-6)}`);
      api.broadcastPetEvent('pet:say', { text: msg, priority: true });
      api.broadcastPetEvent('wallet:suggest-sync', { address: trimmed });
      return;
    }

    api.broadcastPetEvent('pet:say', { text: this.pickRandom(this.t.agentThinking), priority: true });

    await new Promise<void>(resolve => { setTimeout(resolve, 1500); });

    if (trimmed.includes('::')) {
      await this.analyzeCoinType(trimmed);
    } else {
      await this.analyzeObject(trimmed);
    }
  }

  private async analyzeCoinType(coinType: string) {
    const api = this.getApi();
    try {
      const response: any = await api.suiRpcCall('suix_getCoinMetadata', [coinType], this.rpcUrl);
      if (response.error || !response.result) {
        api.broadcastPetEvent('blockchain:event', { event_type: 'bonk', pet_slug: 'Agent' });
        api.broadcastPetEvent('pet:say', { text: this.pickRandom(this.t.agentFake), priority: true });
      } else {
        const data = response.result;
        let supplyStr = 'N/A';
        try {
          const supplyRes: any = await api.suiRpcCall('suix_getTotalSupply', [coinType], this.rpcUrl);
          if (supplyRes.result && supplyRes.result.value !== undefined) {
            const rawSupply = BigInt(supplyRes.result.value);
            const decimals = data.decimals || 0;
            const supplyNum = Number(rawSupply) / Math.pow(10, decimals);
            supplyStr = supplyNum.toLocaleString(undefined, { maximumFractionDigits: 2 });
          }
        } catch (supplyErr) {
          console.error('[SecurityAgent] Supply fetch error:', supplyErr);
        }

        const msg = (this.t.agentTokenInfo as string)
          .replace('{name}', data.name)
          .replace('{symbol}', data.symbol)
          .replace('{decimals}', data.decimals)
          .replace('{supply}', supplyStr);
        api.broadcastPetEvent('pet:say', { text: msg, priority: true });
        
        setTimeout(() => {
          api.broadcastPetEvent('pet:say', { text: this.pickRandom(this.t.agentWarning), priority: true });
        }, 4500);
      }
    } catch (e) {
      console.error(e);
      api.broadcastPetEvent('pet:say', { text: this.pickRandom(this.t.agentError), priority: true });
    }
  }

  private async analyzeObject(objectId: string) {
    const api = this.getApi();
    try {
      const response: any = await api.suiRpcCall('sui_getObject', [
        objectId, 
        { showType: true, showOwner: true }
      ], this.rpcUrl);

      if (response.error || response.result?.error || !response.result?.data) {
        let balanceStr = '0.000';
        let assetsCount = 0;
        let isWallet = false;

        try {
          const balResponse: any = await api.suiRpcCall('suix_getBalance', [objectId, '0x2::sui::SUI'], this.rpcUrl);
          if (balResponse.result && balResponse.result.totalBalance !== undefined) {
            isWallet = true;
            const bal = BigInt(balResponse.result.totalBalance);
            balanceStr = (Number(bal) / 1_000_000_000).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
          }

          const assetsResponse: any = await api.suiRpcCall('suix_getOwnedObjects', [objectId], this.rpcUrl);
          if (assetsResponse.result && assetsResponse.result.data) {
            isWallet = true;
            assetsCount = assetsResponse.result.data.length;
          }
        } catch (walletErr) {
          console.error('[SecurityAgent] Wallet check error:', walletErr);
        }

        if (isWallet) {
          const shortAddr = `${objectId.slice(0, 8)}...${objectId.slice(-6)}`;
          const msg = (this.t.agentWalletInfo as string)
            .replace('{shortAddr}', shortAddr)
            .replace('{balance}', balanceStr)
            .replace('{assets}', assetsCount.toString());
          api.broadcastPetEvent('pet:say', { text: msg, priority: true });
        } else {
          api.broadcastPetEvent('pet:say', { text: this.pickRandom(this.t.agentFake), priority: true });
        }
        return;
      }

      const objData = response.result.data;
      const type = objData.type || '';
      const owner = objData.owner;

      if (type.includes('0x2::coin::TreasuryCap')) {
        if (owner && typeof owner === 'object' && 'AddressOwner' in owner) {
          api.broadcastPetEvent('blockchain:event', { event_type: 'bonk', pet_slug: 'Agent' });
          api.broadcastPetEvent('pet:say', { text: this.pickRandom(this.t.agentScam), priority: true });
          return;
        } else {
          api.broadcastPetEvent('pet:say', { text: this.pickRandom(this.t.agentSafe), priority: true });
          return;
        }
      }

      if (type.includes('0x2::package::UpgradeCap')) {
        if (owner && typeof owner === 'object' && 'AddressOwner' in owner) {
          api.broadcastPetEvent('blockchain:event', { event_type: 'bonk', pet_slug: 'Agent' });
          api.broadcastPetEvent('pet:say', { text: this.t.agentWarning[1], priority: true });
          return;
        }
      }

      let ownerStatus = this.t.agentOwnerUnknown as string;
      if (owner === 'Immutable') {
        ownerStatus = this.t.agentOwnerImmutable as string;
      } else if (owner && typeof owner === 'object') {
        if ('AddressOwner' in owner) {
          const ownerAddr = owner.AddressOwner;
          ownerStatus = (this.t.agentOwnerAddress as string).replace('{addr}', `${ownerAddr.slice(0, 8)}...${ownerAddr.slice(-6)}`);
        } else if ('ObjectOwner' in owner) {
          const ownerObj = owner.ObjectOwner;
          ownerStatus = (this.t.agentOwnerObject as string).replace('{addr}', `${ownerObj.slice(0, 8)}...${ownerObj.slice(-6)}`);
        } else if ('Shared' in owner) {
          ownerStatus = this.t.agentOwnerShared as string;
        }
      }

      const typeParts = type.split('::');
      const simplifiedType = typeParts[typeParts.length - 1];
      const shortId = `${objectId.slice(0, 8)}...${objectId.slice(-6)}`;

      const msg = (this.t.agentObjectInfo as string)
        .replace('{type}', simplifiedType)
        .replace('{shortId}', shortId)
        .replace('{owner}', ownerStatus);
      api.broadcastPetEvent('pet:say', { text: msg, priority: true });
    } catch (e) {
      console.error(e);
      api.broadcastPetEvent('pet:say', { text: this.pickRandom(this.t.agentError), priority: true });
    }
  }
}
