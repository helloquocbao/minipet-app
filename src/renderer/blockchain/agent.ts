import { listen, UnlistenFn } from '@tauri-apps/api/event';

export class SecurityAgent {
  private rpcUrl: string = 'https://fullnode.mainnet.sui.io:443'; 
  private unlistenCb: UnlistenFn | null = null;
  
  // Từ điển các câu nói ngẫu nhiên
  private dict = {
    thinking: [
      "Để tui giúp bạn check cái này nha 🕵️‍♂️",
      "Đánh hơi thấy địa chỉ Sui! Đợi xíu để tui soi... 🐾",
      "Có người copy địa chỉ mới kìa! Đang quét blockchain... 🚀"
    ],
    safe: [
      "✅ Ngon lành! Token này trong sạch nha boss!",
      "✅ Nhìn có vẻ an toàn đấy! Quyền Mint đã khóa.",
      "✅ Check xong! TreasuryCap an toàn, cứ yên tâm!"
    ],
    scam: [
      "🚨 Á á á! Kèo này có mùi lùa gà nha boss! (Chưa khóa Mint)",
      "🚨 Cảnh báo đỏ! Dev vẫn cầm chìa khóa in tiền, cẩn thận mất trắng!",
      "🚨 Honeypot alert! Chạy ngay đi trước khi mọi chuyện tồi tệ hơn!"
    ],
    fake: [
      "⚠️ Ê, token này không tồn tại hoặc là hàng fake nha!",
      "⚠️ Hình như địa chỉ ma rồi, quét không ra kết quả nào!"
    ],
    account: [
      "🔍 Check xong! Địa chỉ này không phải là Object hay Token, có vẻ là một địa chỉ ví cá nhân (Account Address) nha sếp! 👤",
      "👤 Hừm, đây là một địa chỉ ví Sui chứ không phải Token hay Object đâu boss ơi!"
    ],
    warning: [
      "⚠️ Tên coin có thể bị làm giả! Nhớ check kỹ địa chỉ gốc nha sếp!",
      "⚠️ Dev vẫn giữ quyền nâng cấp (UpgradeCap). Cẩn thận nó chèn code lùa gà!"
    ],
    error: [
      "❌ Lỗi mạng gòi, không check được...",
      "❌ Đang check thì đứt mạng, boss thử lại sau nha!"
    ]
  };

  constructor() {
    console.log('[SecurityAgent] Initialized Event-driven On-chain Analysis Agent');
  }

  private pickRandom(arr: string[]): string {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  public async start() {
    console.log('[SecurityAgent] Listening for clipboard events...');
    this.unlistenCb = await listen('clipboard://sui-address-copied', (event: any) => {
      const address = event.payload as string;
      this.handleNewAddress(address);
    });
  }

  public stop() {
    if (this.unlistenCb) {
      this.unlistenCb();
      this.unlistenCb = null;
      console.log('[SecurityAgent] Stopped listening.');
    }
  }

  private getApi() {
    return (window as any).electronAPI;
  }

  private async handleNewAddress(text: string) {
    const api = this.getApi();
    if (!api) return;

    // Pet nói: "Để tui giúp bạn..."
    api.broadcastPetEvent('pet:say', { text: this.pickRandom(this.dict.thinking), priority: true });

    // Thêm delay giả lập chút xíu để tạo cảm giác "đang check"
    await new Promise(resolve => setTimeout(resolve, 1500));

    if (text.includes('::')) {
      await this.analyzeCoinType(text);
    } else {
      await this.analyzeObject(text);
    }
  }

  private async analyzeCoinType(coinType: string) {
    const api = this.getApi();
    try {
      const response: any = await api.suiRpcCall('suix_getCoinMetadata', [coinType], this.rpcUrl);
      if (response.error || !response.result) {
        api.broadcastPetEvent('blockchain:event', { event_type: 'bonk', pet_slug: 'Agent' });
        api.broadcastPetEvent('pet:say', { text: this.pickRandom(this.dict.fake), priority: true });
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

        const msg = `🪙 Token: ${data.name} (${data.symbol})\n🔢 Decimals: ${data.decimals}\n📊 Tổng cung: ${supplyStr}`;
        api.broadcastPetEvent('pet:say', { text: msg, priority: true });
        
        // Delay một xíu rồi nói thêm câu cảnh báo
        setTimeout(() => {
          api.broadcastPetEvent('pet:say', { text: this.pickRandom(this.dict.warning), priority: true });
        }, 4500);
      }
    } catch (e) {
      console.error(e);
      api.broadcastPetEvent('pet:say', { text: this.pickRandom(this.dict.error), priority: true });
    }
  }

  private async analyzeObject(objectId: string) {
    const api = this.getApi();
    try {
      const response: any = await api.suiRpcCall('sui_getObject', [
        objectId, 
        { showType: true, showOwner: true }
      ], this.rpcUrl);

      // Nếu không tồn tại object, tiến hành check xem có phải địa chỉ ví (Account Address) không
      if (response.error || response.result?.error || !response.result?.data) {
        let balanceStr = '0.000';
        let assetsCount = 0;
        let isWallet = false;

        try {
          // Check số dư SUI
          const balResponse: any = await api.suiRpcCall('suix_getBalance', [objectId, '0x2::sui::SUI'], this.rpcUrl);
          if (balResponse.result && balResponse.result.totalBalance !== undefined) {
            isWallet = true;
            const bal = BigInt(balResponse.result.totalBalance);
            balanceStr = (Number(bal) / 1_000_000_000).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
          }

          // Check tài sản/NFTs sở hữu
          const assetsResponse: any = await api.suiRpcCall('suix_getOwnedObjects', [{ owner: objectId }], this.rpcUrl);
          if (assetsResponse.result && assetsResponse.result.data) {
            isWallet = true;
            assetsCount = assetsResponse.result.data.length;
          }
        } catch (walletErr) {
          console.error('[SecurityAgent] Wallet check error:', walletErr);
        }

        if (isWallet) {
          const shortAddr = `${objectId.slice(0, 8)}...${objectId.slice(-6)}`;
          const msg = `👤 Ví SUI cá nhân\n🔗 ID: ${shortAddr}\n💰 Số dư: ${balanceStr} SUI\n📦 Tài sản: ${assetsCount} NFTs/Objects`;
          api.broadcastPetEvent('pet:say', { text: msg, priority: true });
        } else {
          api.broadcastPetEvent('pet:say', { text: this.pickRandom(this.dict.fake), priority: true });
        }
        return;
      }

      const objData = response.result.data;
      const type = objData.type || '';
      const owner = objData.owner;

      // Scoring 1: Nếu là TreasuryCap và do ví cá nhân giữ -> Cảnh báo Scam
      if (type.includes('0x2::coin::TreasuryCap')) {
        if (owner && typeof owner === 'object' && 'AddressOwner' in owner) {
          api.broadcastPetEvent('blockchain:event', { event_type: 'bonk', pet_slug: 'Agent' });
          api.broadcastPetEvent('pet:say', { text: this.pickRandom(this.dict.scam), priority: true });
          return;
        } else {
          api.broadcastPetEvent('pet:say', { text: this.pickRandom(this.dict.safe), priority: true });
          return;
        }
      }

      // Scoring 2: UpgradeCap (Quyền nâng cấp Smart Contract)
      if (type.includes('0x2::package::UpgradeCap')) {
        if (owner && typeof owner === 'object' && 'AddressOwner' in owner) {
          api.broadcastPetEvent('blockchain:event', { event_type: 'bonk', pet_slug: 'Agent' });
          api.broadcastPetEvent('pet:say', { text: this.dict.warning[1], priority: true }); // Đọc câu cảnh báo UpgradeCap
          return;
        }
      }

      // Phân tích quyền sở hữu cụ thể
      let ownerStatus = 'Không rõ';
      if (owner === 'Immutable') {
        ownerStatus = '🔒 Không thể thay đổi (Immutable)';
      } else if (owner && typeof owner === 'object') {
        if ('AddressOwner' in owner) {
          const ownerAddr = owner.AddressOwner;
          ownerStatus = `👤 Cá nhân sở hữu: ${ownerAddr.slice(0, 8)}...${ownerAddr.slice(-6)}`;
        } else if ('ObjectOwner' in owner) {
          const ownerObj = owner.ObjectOwner;
          ownerStatus = `📦 Object sở hữu: ${ownerObj.slice(0, 8)}...${ownerObj.slice(-6)}`;
        } else if ('Shared' in owner) {
          ownerStatus = `🌐 Shared Object (Dùng chung)`;
        }
      }

      // Lấy tên rút gọn của Type
      const typeParts = type.split('::');
      const simplifiedType = typeParts[typeParts.length - 1];
      const shortId = `${objectId.slice(0, 8)}...${objectId.slice(-6)}`;

      const msg = `📦 Sui Object (${simplifiedType})\n🔗 ID: ${shortId}\n🔑 Quyền sở hữu: ${ownerStatus}`;
      api.broadcastPetEvent('pet:say', { text: msg, priority: true });
    } catch (e) {
      console.error(e);
      api.broadcastPetEvent('pet:say', { text: this.pickRandom(this.dict.error), priority: true });
    }
  }
}
