/**
 * AgentTradeEngine — MVP AI Agent Trade
 *
 * Executes real on-chain swaps on SUI testnet using Agent wallet.
 * Strategy: EMA crossover from SUI/USD price.
 * Exchange: SUI splitCoin swap (MVP proof-of-execution on testnet).
 *
 * For testnet: since there's no real USDC liquidity pool, we demonstrate
 * the full signing + execution flow by doing SUI self-transfers that prove
 * the agent wallet can sign and submit transactions autonomously.
 * On mainnet: replace executeTrade() body with Cetus Aggregator swap.
 */

import { SUI_CONFIG } from '../../shared/constants';

// Reserved for mainnet Cetus swap integration
const _USDC_TYPE = SUI_CONFIG.USDC_TYPE;

export interface TradeConfig {
  budgetSui: number;
  cooldownMs: number;
  slippagePct: number;
  agentSecretKey: string;
}

export interface TradeLog {
  timestamp: number;
  action: 'BUY' | 'SELL' | 'HOLD' | 'SIGNAL' | 'ERROR';
  message: string;
  txDigest?: string;
}

type LogCallback = (log: TradeLog) => void;

export class AgentTradeEngine {
  private config: TradeConfig;
  private logCb: LogCallback;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  private prices: number[] = [];
  private emaShort = 0;
  private emaLong = 0;
  private lastSignal: 'BUY' | 'SELL' | 'NONE' = 'NONE';
  private lastTradeTime = 0;
  private tradeCount = 0;

  // Shorter periods for demo responsiveness
  private static readonly EMA_SHORT_PERIOD = 3;
  private static readonly EMA_LONG_PERIOD = 8;
  private static readonly POLL_INTERVAL_MS = 10_000; // 10s

  constructor(config: TradeConfig, logCb: LogCallback) {
    this.config = config;
    this.logCb = logCb;
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.prices = [];
    this.emaShort = 0;
    this.emaLong = 0;
    this.lastSignal = 'NONE';
    this.tradeCount = 0;
    this.log('SIGNAL', 'AI Agent Trade engine started. Warming up price feed...');
    void this.tick();
    this.timer = setInterval(() => { void this.tick(); }, AgentTradeEngine.POLL_INTERVAL_MS);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    this.log('SIGNAL', `Engine stopped. Total trades executed: ${this.tradeCount}`);
  }

  public isRunning(): boolean {
    return this.running;
  }

  public updateConfig(config: Partial<TradeConfig>): void {
    Object.assign(this.config, config);
  }

  private async tick(): Promise<void> {
    try {
      const price = await this.fetchSuiPrice();
      if (price <= 0) {
        this.log('ERROR', 'Price feed unavailable. Retrying next tick...');
        return;
      }

      this.prices.push(price);

      if (this.prices.length < AgentTradeEngine.EMA_LONG_PERIOD) {
        this.log('SIGNAL', `Warming up (${this.prices.length}/${AgentTradeEngine.EMA_LONG_PERIOD}) SUI=$${price.toFixed(4)}`);
        return;
      }

      const prevShort = this.emaShort;
      const prevLong = this.emaLong;
      this.emaShort = this.calcEMA(this.prices, AgentTradeEngine.EMA_SHORT_PERIOD);
      this.emaLong = this.calcEMA(this.prices, AgentTradeEngine.EMA_LONG_PERIOD);

      const prevDiff = prevShort - prevLong;
      const currDiff = this.emaShort - this.emaLong;

      let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
      if (prevDiff <= 0 && currDiff > 0) signal = 'BUY';
      else if (prevDiff >= 0 && currDiff < 0) signal = 'SELL';

      this.log('SIGNAL', `SUI=$${price.toFixed(4)} EMA${AgentTradeEngine.EMA_SHORT_PERIOD}=$${this.emaShort.toFixed(4)} EMA${AgentTradeEngine.EMA_LONG_PERIOD}=$${this.emaLong.toFixed(4)} → ${signal}`);

      if (signal !== 'HOLD' && signal !== this.lastSignal) {
        const now = Date.now();
        if (now - this.lastTradeTime < this.config.cooldownMs) {
          const waitSec = Math.ceil((this.config.cooldownMs - (now - this.lastTradeTime)) / 1000);
          this.log('HOLD', `Signal=${signal} but cooldown active (${waitSec}s remaining)`);
          return;
        }
        this.lastSignal = signal;
        this.lastTradeTime = now;
        await this.executeTrade(signal, price);
      }

      if (this.prices.length > 60) this.prices = this.prices.slice(-30);
    } catch (err: any) {
      this.log('ERROR', `Tick: ${err.message || err}`);
    }
  }

  private calcEMA(data: number[], period: number): number {
    const k = 2 / (period + 1);
    let ema = data[0];
    for (let i = 1; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return ema;
  }

  private async fetchSuiPrice(): Promise<number> {
    // SECURITY: never fabricate a price. A random fallback can manufacture fake
    // EMA crossovers that trigger real on-chain trades. Return 0 (= "feed
    // unavailable") so the caller skips trading this tick.
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=sui&vs_currencies=usd', {
        signal: AbortSignal.timeout(5000)
      });
      if (!res.ok) return 0;
      const data = await res.json();
      return data.sui?.usd || 0;
    } catch {
      return 0;
    }
  }

  private async executeTrade(action: 'BUY' | 'SELL', price: number): Promise<void> {
    try {
      const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
      const { SuiJsonRpcClient, getJsonRpcFullnodeUrl } = await import('@mysten/sui/jsonRpc');
      const { Transaction } = await import('@mysten/sui/transactions');

      const secretBytes = Uint8Array.from(atob(this.config.agentSecretKey), c => c.charCodeAt(0));
      const keypair = Ed25519Keypair.fromSecretKey(secretBytes);
      const agentAddress = keypair.getPublicKey().toSuiAddress();
      const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' });

      // Check balance first
      const balRes: any = await client.getBalance({ owner: agentAddress, coinType: '0x2::sui::SUI' });
      const balanceSui = Number(BigInt(balRes.totalBalance || '0')) / 1_000_000_000;

      if (balanceSui < this.config.budgetSui + 0.01) {
        this.log('ERROR', `Insufficient balance: ${balanceSui.toFixed(4)} SUI < ${this.config.budgetSui} + gas. Fund agent wallet!`);
        return;
      }

      const amountMist = Math.floor(this.config.budgetSui * 1_000_000_000);
      const value = (this.config.budgetSui * price).toFixed(2);

      this.log(action, `${action} ${this.config.budgetSui} SUI @ $${price.toFixed(4)} ≈ $${value} | Agent: ${agentAddress.slice(0, 10)}...`);

      // --- TESTNET MVP ---
      // On testnet there's no real USDC pool, so we prove autonomous execution
      // by doing a SUI split+merge (costs gas, proves signing works).
      // On mainnet: replace with Cetus aggregator swap call.
      const tx = new Transaction();
      const [coin] = tx.splitCoins(tx.gas, [amountMist]);
      tx.transferObjects([coin], agentAddress); // self-transfer = proof of execution

      tx.setSender(agentAddress);
      const txBytes = await tx.build({ client });
      const { signature } = await keypair.signTransaction(txBytes);

      const result: any = await client.executeTransactionBlock({
        transactionBlock: txBytes,
        signature,
        options: { showEffects: true }
      });

      const digest = result.digest || '';
      const status = result.effects?.status?.status || 'unknown';

      if (status === 'success') {
        this.tradeCount++;
        this.log(action, `✅ ${action} confirmed! Tx: ${digest.slice(0, 16)}... | Gas used for on-chain proof.`);
      } else {
        this.log('ERROR', `❌ Tx failed: ${status} | ${digest}`);
      }
    } catch (err: any) {
      this.log('ERROR', `Execution failed: ${err.message || err}`);
    }
  }

  private log(action: TradeLog['action'], message: string, txDigest?: string): void {
    this.logCb({ timestamp: Date.now(), action, message, txDigest });
  }
}
