/**
 * DesiredTradeExecutor — owner-configured automated trade.
 *
 * Unlike AgentTradeEngine (which derives its own BUY/SELL signal from an EMA
 * crossover), this executor performs the EXACT trade the owner configured
 * (action + token + amount) when the owner activates it.
 *
 *  - env 'testnet' : proves autonomous execution with a real on-chain SUI
 *                    split + self-transfer (costs gas only, no market risk).
 *  - env 'mainnet' : performs a REAL swap through the Cetus Aggregator
 *                    (buy = SUI→token, sell = token→SUI). Real funds at risk.
 *
 *  - mode 'once'      : executes a single trade on activation, then stops.
 *  - mode 'recurring' : executes immediately, then repeats every interval.
 *
 * Signing uses the Agent wallet secret key (base64), consistent with
 * AgentTradeEngine. The pet calls this on the master overlay instance.
 */

import type { TradeLog } from './agent-trade';

export type TradeEnv = 'testnet' | 'mainnet';
export type TradeMode = 'once' | 'recurring';

export interface DesiredTradeConfig {
  /** 'buy' = spend SUI to get token; 'sell' = spend token to get SUI. */
  action: 'buy' | 'sell';
  /** Token symbol (e.g. 'USDC', 'CETUS') or a full coin type '0x..::..::..'. */
  token: string;
  /** Amount to trade. For buy: SUI in; for sell: token in. */
  amount: number;
  env: TradeEnv;
  mode: TradeMode;
  /** Minutes between trades when mode === 'recurring'. */
  intervalMinutes: number;
  /** Max slippage percent for mainnet swaps. */
  slippagePct: number;
  /** Base64-encoded Agent wallet secret key used to sign. */
  agentSecretKey: string;
}

type LogCallback = (log: TradeLog) => void;

/** Known coin types per environment. Symbols are matched case-insensitively. */
const TOKEN_MAP: Record<TradeEnv, Record<string, string>> = {
  testnet: {
    SUI: '0x2::sui::SUI',
    USDC: '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC',
  },
  mainnet: {
    SUI: '0x2::sui::SUI',
    USDC: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    CETUS: '0x06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS',
  },
};

const SUI_TYPE = '0x2::sui::SUI';
const CETUS_AGG_ENDPOINT = 'https://api-sui.cetus.zone/router_v3/find_routes';

export class DesiredTradeExecutor {
  private config: DesiredTradeConfig;
  private logCb: LogCallback;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private tradeCount = 0;

  constructor(config: DesiredTradeConfig, logCb: LogCallback) {
    this.config = config;
    this.logCb = logCb;
  }

  public isRunning(): boolean {
    return this.running;
  }

  /** Activate the configured trade. Runs once immediately; repeats if recurring. */
  public async activate(): Promise<void> {
    if (this.running) {
      this.log('SIGNAL', 'Desired trade already active.');
      return;
    }
    this.running = true;
    const { action, amount, token, env, mode } = this.config;
    this.log(
      'SIGNAL',
      `Owner activated: ${action.toUpperCase()} ${amount} ${token} on ${env} (${mode}).`,
    );

    await this.executeOnce();

    if (mode === 'recurring' && this.running) {
      const intervalMs = Math.max(1, this.config.intervalMinutes) * 60_000;
      this.timer = setInterval(() => {
        void this.executeOnce();
      }, intervalMs);
    } else {
      // One-shot complete (or stopped mid-execution): clean teardown.
      this.finish();
    }
  }

  /** Clean teardown shared by one-shot completion. */
  private finish(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
  }

  public stop(): void {
    if (this.running) {
      this.log('SIGNAL', `Desired trade stopped. Trades executed: ${this.tradeCount}.`);
    }
    this.finish();
  }

  private resolveCoinType(token: string): string {
    const t = token.trim();
    if (t.startsWith('0x') && t.includes('::')) return t;
    const map = TOKEN_MAP[this.config.env];
    const found = map[t.toUpperCase()];
    if (!found) {
      throw new Error(
        `Unknown token "${token}" on ${this.config.env}. Use a known symbol (${Object.keys(map).join(', ')}) or a full 0x..::..::.. coin type.`,
      );
    }
    return found;
  }

  private async executeOnce(): Promise<void> {
    try {
      // Abort if stopped between scheduling and execution.
      if (!this.running) return;
      if (!this.config.agentSecretKey) {
        this.log('ERROR', 'No Agent wallet key. Generate an Agent wallet in Settings first.');
        this.stop();
        return;
      }
      // Validate amount before any base-unit math.
      if (!Number.isFinite(this.config.amount) || this.config.amount <= 0) {
        this.log('ERROR', `Invalid trade amount: ${this.config.amount}.`);
        this.stop();
        return;
      }
      if (this.config.env === 'mainnet') {
        await this.executeMainnetSwap();
      } else {
        await this.executeTestnetProof();
      }
    } catch (err: any) {
      this.log('ERROR', `Execution failed: ${err?.message || err}`);
    }
  }

  /** Testnet: real on-chain SUI split + self-transfer proving autonomous signing. */
  private async executeTestnetProof(): Promise<void> {
    const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
    const { SuiJsonRpcClient, getJsonRpcFullnodeUrl } = await import('@mysten/sui/jsonRpc');
    const { Transaction } = await import('@mysten/sui/transactions');

    const secretBytes = Uint8Array.from(atob(this.config.agentSecretKey), (c) => c.charCodeAt(0));
    const keypair = Ed25519Keypair.fromSecretKey(secretBytes);
    const agentAddress = keypair.getPublicKey().toSuiAddress();
    const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' });

    // Probe amount in SUI: for buy use the SUI budget; for sell use a tiny fixed probe.
    const probeSui = this.config.action === 'buy' ? this.config.amount : 0.01;
    const amountMist = Math.max(1, Math.floor(probeSui * 1_000_000_000));

    const balRes: any = await client.getBalance({ owner: agentAddress, coinType: SUI_TYPE });
    const balanceSui = Number(BigInt(balRes.totalBalance || '0')) / 1_000_000_000;
    if (balanceSui < probeSui + 0.01) {
      this.log('ERROR', `Insufficient testnet SUI: ${balanceSui.toFixed(4)} < ${probeSui} + gas. Fund agent wallet!`);
      return;
    }

    const tx = new Transaction();
    const [coin] = tx.splitCoins(tx.gas, [amountMist]);
    tx.transferObjects([coin], agentAddress); // self-transfer = proof of execution
    tx.setSender(agentAddress);
    const txBytes = await tx.build({ client });
    const { signature } = await keypair.signTransaction(txBytes);
    const result: any = await client.executeTransactionBlock({
      transactionBlock: txBytes,
      signature,
      options: { showEffects: true },
    });

    const digest = result.digest || '';
    const status = result.effects?.status?.status || 'unknown';
    const act: TradeLog['action'] = this.config.action === 'sell' ? 'SELL' : 'BUY';
    if (status === 'success') {
      this.tradeCount++;
      this.log(
        act,
        `✅ [TESTNET] ${this.config.action.toUpperCase()} ${this.config.amount} ${this.config.token} proof executed. Tx: ${digest.slice(0, 16)}...`,
        digest,
      );
    } else {
      this.log('ERROR', `❌ Testnet tx failed: ${status} | ${digest}`);
    }
  }

  /** Mainnet: real Cetus Aggregator swap. Buy = SUI→token, Sell = token→SUI. */
  private async executeMainnetSwap(): Promise<void> {
    const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
    const { SuiJsonRpcClient, getJsonRpcFullnodeUrl } = await import('@mysten/sui/jsonRpc');
    const { Transaction } = await import('@mysten/sui/transactions');
    const { AggregatorClient, Env } = await import('@cetusprotocol/aggregator-sdk');

    const secretBytes = Uint8Array.from(atob(this.config.agentSecretKey), (c) => c.charCodeAt(0));
    const keypair = Ed25519Keypair.fromSecretKey(secretBytes);
    const agentAddress = keypair.getPublicKey().toSuiAddress();

    const tokenType = this.resolveCoinType(this.config.token);
    const isBuy = this.config.action === 'buy';
    const fromType = isBuy ? SUI_TYPE : tokenType;
    const targetType = isBuy ? tokenType : SUI_TYPE;

    // Resolve input-coin decimals to convert the human amount to base units.
    const rpc = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('mainnet'), network: 'mainnet' });
    const decimals = fromType === SUI_TYPE ? 9 : await this.fetchDecimals(rpc, fromType);
    const amountBase = BigInt(Math.floor(this.config.amount * 10 ** decimals)).toString();

    // Pre-flight balance check on the input coin.
    const balRes: any = await rpc.getBalance({ owner: agentAddress, coinType: fromType });
    if (BigInt(balRes.totalBalance || '0') < BigInt(amountBase)) {
      this.log(
        'ERROR',
        `Insufficient ${isBuy ? 'SUI' : this.config.token} balance for ${this.config.amount}. Fund the agent wallet on mainnet.`,
      );
      return;
    }

    const agg = new AggregatorClient({
      endpoint: CETUS_AGG_ENDPOINT,
      signer: agentAddress,
      env: Env.Mainnet,
    });

    const router = await agg.findRouters({
      from: fromType,
      target: targetType,
      amount: amountBase,
      byAmountIn: true,
    });
    if (!router) {
      this.log('ERROR', `No swap route found for ${fromType} → ${targetType}.`);
      return;
    }

    const txb = new Transaction();
    await agg.fastRouterSwap({
      router,
      txb,
      slippage: Math.max(0.001, this.config.slippagePct / 100),
      refreshAllCoins: true,
    });
    txb.setSender(agentAddress);

    const result: any = await agg.sendTransaction(txb, keypair);
    const digest = result?.digest || '';
    const status = result?.effects?.status?.status || 'unknown';
    const act: TradeLog['action'] = isBuy ? 'BUY' : 'SELL';
    if (status === 'success') {
      this.tradeCount++;
      this.log(
        act,
        `✅ [MAINNET] ${this.config.action.toUpperCase()} ${this.config.amount} ${this.config.token} swapped via Cetus. Tx: ${digest.slice(0, 16)}...`,
        digest,
      );
    } else {
      this.log('ERROR', `❌ Mainnet swap failed: ${status} | ${digest}`);
    }
  }

  private async fetchDecimals(rpc: any, coinType: string): Promise<number> {
    try {
      const meta: any = await rpc.getCoinMetadata({ coinType });
      const d = meta?.decimals;
      return typeof d === 'number' ? d : 9;
    } catch {
      return 9;
    }
  }

  private log(action: TradeLog['action'], message: string, txDigest?: string): void {
    this.logCb({ timestamp: Date.now(), action, message, txDigest });
  }
}
