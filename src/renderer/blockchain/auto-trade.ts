import type {
  AutoTradeConfig,
  AutoTradeWallet,
} from "../../shared/types/settings.types";

/** Callback used to surface a simulated trade to the user (e.g. a speech bubble). */
type NotifyFn = (text: string) => void;

const WALLETS: AutoTradeWallet[] = ["pet", "agent"];

/**
 * AutoTradeSimulator — a SIMULATED automated-trading loop.
 *
 * It does NOT place any real on-chain order. On a fixed polling tick it reads the
 * latest `autoTrade` config from settings and, for every wallet whose strategy is
 * `enabled`, "executes" a mock trade once each `interval_minutes` has elapsed.
 *
 * Intended to run only on the master overlay instance (see master election in overlay.ts).
 */
export class AutoTradeSimulator {
  /**
   * DEMO_MODE rút ngắn thời gian để quay video demo.
   *  - true : tick mỗi 3s, và 1 "phút" cấu hình được quy đổi thành 2s thực.
   *           (vd: interval_minutes=1 → ~2s, interval_minutes=30 → ~60s)
   *  - false: tick mỗi 20s, 1 phút = 60s thực (hành vi production).
   */
  private static readonly DEMO_MODE = true;

  /** How often the loop wakes up to check whether a trade is due (ms). */
  private static readonly TICK_MS = AutoTradeSimulator.DEMO_MODE
    ? 3_000
    : 20_000;

  /** Số ms tương ứng với 1 "phút" trong cấu hình interval_minutes. */
  private static readonly MINUTE_MS = AutoTradeSimulator.DEMO_MODE
    ? 2_000
    : 60_000;

  private timer: ReturnType<typeof setInterval> | null = null;
  private notify: NotifyFn;

  /** Timestamp (ms) of the last simulated trade per wallet. */
  private lastRun: Partial<Record<AutoTradeWallet, number>> = {};

  constructor(notify: NotifyFn) {
    this.notify = notify;
  }

  public start(): void {
    if (this.timer) return;
    // Run an immediate check, then poll.
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, AutoTradeSimulator.TICK_MS);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.lastRun = {};
  }

  private async tick(): Promise<void> {
    try {
      const settings: any = await (window as any).electronAPI.getSettings();
      const autoTrade: Partial<Record<AutoTradeWallet, AutoTradeConfig>> =
        settings?.autoTrade || {};
      const now = Date.now();

      for (const wallet of WALLETS) {
        const cfg = autoTrade[wallet];
        if (!cfg || !cfg.enabled) {
          // Forget the schedule when disabled so it fires promptly on re-enable.
          delete this.lastRun[wallet];
          continue;
        }

        const intervalMs =
          Math.max(1, cfg.interval_minutes ?? 60) *
          AutoTradeSimulator.MINUTE_MS;
        const last = this.lastRun[wallet];

        // First time we see it enabled: arm the schedule without trading immediately.
        if (last === undefined) {
          this.lastRun[wallet] = now;
          continue;
        }

        if (now - last >= intervalMs) {
          this.lastRun[wallet] = now;
          this.simulateTrade(wallet, cfg);
        }
      }
    } catch (err) {
      console.error("[AutoTrade] tick failed:", err);
    }
  }

  private simulateTrade(wallet: AutoTradeWallet, cfg: AutoTradeConfig): void {
    const label = wallet === "agent" ? "Agent" : "Pet";
    const action = cfg.action === "sell" ? "Sell" : "Buy";
    const token = cfg.token || "SUI";
    const amount = cfg.amount ?? 1;

    const price = 1 + Math.random() * 0.6;
    const value = (amount * price).toFixed(2);

    const text = `💹 [SIMULATE] [${label}] ${action} ${amount} ${token} @ $${price.toFixed(3)} ≈ $${value}`;
    try {
      this.notify(text);
    } catch {
      /* best-effort */
    }
  }
}
