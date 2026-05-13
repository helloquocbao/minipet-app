/**
 * SpriteRenderer — Renders a single frame from a spritesheet onto a 2D Canvas.
 */
export class SpriteRenderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private spritesheet: HTMLImageElement | null = null;
  private frameWidth: number;
  private frameHeight: number;

  constructor(canvas: HTMLCanvasElement, frameWidth: number, frameHeight: number) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.frameWidth = frameWidth;
    this.frameHeight = frameHeight;

    // Initialize Canvas with a default size (will be updated dynamically)
    this.canvas.width = 400;
    this.canvas.height = 440;

    // Disable image smoothing to maintain pixel-art crispness
    this.ctx.imageSmoothingEnabled = false;
  }

  /**
   * Loads the spritesheet image from a specified source path or URL.
   */
  async loadSpritesheet(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.spritesheet = img;
        resolve();
      };
      img.onerror = reject;
      img.src = src;
    });
  }

  /**
   * Draws a specific frame from the spritesheet onto the canvas.
   * @param col The column index of the frame.
   * @param row The row index of the frame.
   * @param scale The visual scale of the pet.
   * @param flip Whether to flip the image horizontally.
   */
  drawFrame(col: number, row: number, scale: number = 1.0, flip: boolean = false): void {
    if (!this.spritesheet) return;

    const destW = Math.round(this.frameWidth * scale);
    const destH = Math.round(this.frameHeight * scale);

    // Sync canvas dimensions with the scaled pet size
    if (this.canvas.width !== destW || this.canvas.height !== destH) {
      this.canvas.width = destW;
      this.canvas.height = destH;
      this.ctx.imageSmoothingEnabled = false;
    }

    // Clear previous frame
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.ctx.save();

    if (flip) {
      // Flip logic: Translate to center, scale horizontally, then translate back
      this.ctx.translate(destW / 2, destH / 2);
      this.ctx.scale(-1, 1);
      this.ctx.translate(-(destW / 2), -(destH / 2));
    }

    this.ctx.drawImage(
      this.spritesheet,
      col * this.frameWidth,
      row * this.frameHeight,
      this.frameWidth,
      this.frameHeight,
      0,
      0,
      destW,
      destH
    );

    this.ctx.restore();
  }

  /**
   * Clears the entire canvas.
   */
  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
