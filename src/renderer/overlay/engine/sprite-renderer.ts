/**
 * SpriteRenderer — Double-buffered sprite renderer using OffscreenCanvas.
 *
 * All compositing happens on an OffscreenCanvas (never shown to user).
 * The visible canvas is updated with a single drawImage() call — atomic,
 * no clearRect visible to the compositor, no flicker.
 */
export class SpriteRenderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private off: OffscreenCanvas;
  private offCtx: OffscreenCanvasRenderingContext2D;
  private spritesheet: HTMLImageElement | null = null;
  private frameWidth: number;
  private frameHeight: number;

  constructor(canvas: HTMLCanvasElement, frameWidth: number, frameHeight: number) {
    this.canvas = canvas;
    this.frameWidth = frameWidth;
    this.frameHeight = frameHeight;

    // Start at a sane size; will be corrected on first drawFrame call
    this.canvas.width = frameWidth;
    this.canvas.height = frameHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D rendering context from canvas');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;

    // Offscreen buffer — same initial size
    this.off = new OffscreenCanvas(frameWidth, frameHeight);
    const offCtx = this.off.getContext('2d');
    if (!offCtx) throw new Error('Failed to get offscreen 2D context');
    this.offCtx = offCtx;
    this.offCtx.imageSmoothingEnabled = false;
  }

  async loadSpritesheet(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this.spritesheet = img;
        const expectedW = this.frameWidth * 8;
        const expectedH = this.frameHeight * 9;
        if (img.naturalWidth < expectedW || img.naturalHeight < expectedH) {
          // Single-frame image (e.g. NFT avatar) — use full image as 1 frame
          this.frameWidth  = img.naturalWidth;
          this.frameHeight = img.naturalHeight;
        }
        resolve();
      };
      img.onerror = reject;
      img.src = src;
    });
  }

  drawFrame(col: number, row: number, scale: number = 1.0, flip: boolean = false): void {
    if (!this.spritesheet) return;

    const dw = Math.round(this.frameWidth  * scale);
    const dh = Math.round(this.frameHeight * scale);

    // ── Step 1: resize offscreen buffer if needed ──────────────────────────
    if (this.off.width !== dw || this.off.height !== dh) {
      this.off.width  = dw;
      this.off.height = dh;
      this.offCtx.imageSmoothingEnabled = false;
    }

    // ── Step 2: compose new frame on the offscreen canvas ──────────────────
    // clearRect + drawImage here is fine — this canvas is NEVER composited
    // by the macOS display pipeline until we explicitly blit it below.
    this.offCtx.clearRect(0, 0, dw, dh);
    this.offCtx.save();
    if (flip) {
      this.offCtx.translate(dw, 0);
      this.offCtx.scale(-1, 1);
    }
    this.offCtx.drawImage(
      this.spritesheet,
      col * this.frameWidth,
      row * this.frameHeight,
      this.frameWidth,
      this.frameHeight,
      0, 0, dw, dh
    );
    this.offCtx.restore();

    // ── Step 3: resize visible canvas if needed, then blit ─────────────────
    if (this.canvas.width !== dw || this.canvas.height !== dh) {
      this.canvas.width  = dw;
      this.canvas.height = dh;
      this.ctx.imageSmoothingEnabled = false;
    }

    // 'copy' mode replaces every destination pixel including alpha —
    // no ghost from previous frame, no clearRect needed on visible canvas.
    this.ctx.globalCompositeOperation = 'copy';
    this.ctx.drawImage(this.off, 0, 0);
    this.ctx.globalCompositeOperation = 'source-over'; // restore default
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
