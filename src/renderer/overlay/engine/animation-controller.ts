/**
 * AnimationController — Controls the playback of pet animations and window movement logic.
 */
import { AnimationConfig, PetState } from '../../../shared/types/pet.types';
import { SpriteRenderer } from './sprite-renderer';

export class AnimationController {
  private renderer: SpriteRenderer;
  private instanceId: string;
  private currentConfig: AnimationConfig | null = null;
  private currentFrame: number = 0;
  private lastFrameTime: number = 0;
  private animationId: number = 0;
  private isPlaying: boolean = false;
  private walkingEnabled: boolean = true;
  private scale: number = 1.0;
  private direction: number = 1; // 1: Right, -1: Left
  private movementPaused: boolean = false;
  private lastSaveTime: number = 0;

  // Multi-Pet: Targets for the "chasing" behavior
  private targetX: number | null = null;
  private targetY: number | null = null;

  // Accumulates fractional movement to ensure smooth motion at low speeds
  private accumulatedX: number = 0;
  // Logical position tracked internally to avoid async screenX/Y lag
  private logicalX: number | null = null;

  public onAnimationEnd?: (nextState: PetState) => void;

  constructor(renderer: SpriteRenderer, instanceId: string) {
    this.renderer = renderer;
    this.instanceId = instanceId;
  }

  setWalkingEnabled(enabled: boolean): void {
    this.walkingEnabled = enabled;
  }

  /**
   * Pauses or resumes autonomous window movement (e.g. during drag).
   */
  pauseMovement(paused: boolean): void {
    this.movementPaused = paused;
    if (paused) this.resetPosition();
  }

  /**
   * Updates the visual scale of the pet.
   */
  setScale(scale: number): void {
    this.scale = scale;
    this.draw(); 
  }

  /**
   * Returns the current screen coordinates and dimensions of the pet window.
   */
  getRect() {
    return {
      x: window.screenX,
      y: window.screenY,
      width: window.innerWidth,
      height: window.innerHeight
    };
  }

  /**
   * Sets a target position for the pet to move towards.
   */
  setTarget(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
  }

  /**
   * Resets internal position tracker (call after manual drag).
   */
  resetPosition(): void {
    this.logicalX = null;
  }

  /**
   * Starts playing a specific animation state.
   */
  play(config: AnimationConfig, scale: number = 1.0): void {
    this.stop();
    this.resetPosition(); // Refresh coordinate base
    this.currentConfig = config;
    this.currentFrame = 0;
    this.scale = scale;
    this.isPlaying = true;
    this.lastFrameTime = performance.now();

    this.draw();
    this.loop();
  }

  /**
   * Stops the current animation playback.
   */
  stop(): void {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = 0;
    }
    this.isPlaying = false;
  }

  /**
   * Renders the current frame to the canvas.
   */
  private draw(): void {
    if (!this.currentConfig) return;
    
    let activeRow = this.currentConfig.row;
    let shouldFlip = this.direction === -1;

    // Logic for 9-row spritesheets: 
    // Uses Row 2 (index 1) for Right and Row 3 (index 2) for Left movement.
    if (activeRow === 1 || activeRow === 2) {
      activeRow = this.direction === -1 ? 2 : 1;
      shouldFlip = false; 
    }

    this.renderer.drawFrame(this.currentFrame, activeRow, this.scale, shouldFlip);
  }

  /**
   * Main animation and movement loop.
   */
  private loop = (): void => {
    if (!this.isPlaying || !this.currentConfig) return;

    const now = performance.now();
    const msPerFrame = 1000 / this.currentConfig.fps;

    if (now - this.lastFrameTime >= msPerFrame) {
      this.lastFrameTime = now;

      // 1. Handle window movement for walking/running states
      const isMovementAnimation = this.currentConfig.canMove || [1, 2].includes(this.currentConfig.row);
      
      if (isMovementAnimation && this.isPlaying && this.walkingEnabled) {
        const speed = (this.currentConfig.speed || 0.9) * this.scale;

        if (window.electronAPI && window.electronAPI.moveWindow && !this.movementPaused) {
          // Use logical position from shim or window
          const pos = (window.electronAPI as any).getLogicalPosition?.() || { x: window.screenX, y: window.screenY };
          const winX = pos.x;
          const winY = pos.y;

          const winW = window.innerWidth;
          const bounds = (window.electronAPI as any).getMonitorBounds?.() || { x: 0, width: window.screen.availWidth };
          const minX = bounds.x;
          const maxX = bounds.x + bounds.width;

          if (this.logicalX === null) this.logicalX = winX;
          const lx = this.logicalX as number;

          // Safety Check: If pet is spawned completely out of bounds (X or Y), teleport it back
          const outOfX = lx > maxX || lx + winW < minX;
          const outOfY = winY < -100 || winY > window.screen.availHeight + 100;
          
          if (outOfX || outOfY) {
            const newX = minX + (bounds.width - winW) / 2;
            const newY = window.screen.availHeight / 2;
            const deltaX = newX - lx;
            const deltaY = newY - winY;
            
            window.electronAPI.moveWindow(deltaX, deltaY);
            this.logicalX = newX;
            this.accumulatedX = 0;
            return; // Skip the rest of the movement frame
          }

          // Multi-Pet: Handle chasing behavior
          if (this.targetX !== null) {
            const centerX = lx + winW / 2;
            if (this.targetX < centerX - 50) {
              this.direction = -1;
            } else if (this.targetX > centerX + 50) {
              this.direction = 1;
            } else {
              this.targetX = null;
            }
          } else {
            if (this.direction === -1 && lx <= minX) {
              this.direction = 1;
              this.accumulatedX = 0;
            } else if (this.direction === 1 && lx + winW >= maxX) {
              this.direction = -1;
              this.accumulatedX = 0;
            }
          }

          this.accumulatedX += speed * this.direction;
          const actualMoveX = Math.trunc(this.accumulatedX);

          if (Math.abs(actualMoveX) >= 1) {
            window.electronAPI.moveWindow(actualMoveX, 0);
            this.logicalX = lx + actualMoveX;
            this.accumulatedX -= actualMoveX;

            // CRITICAL: We only update the X coordinate in the backend.
            // Throttle savePosition to avoid flooding IPC during walk.
            const now = performance.now();
            if (now - this.lastSaveTime > 1000) {
              window.electronAPI.savePosition(this.instanceId, this.logicalX, undefined);
              this.lastSaveTime = now;
            }
          }
        }
      }

      // 2. Render frame
      this.draw();

      // 3. Advance to the next frame
      if (this.currentConfig.loop) {
        this.currentFrame = (this.currentFrame + 1) % this.currentConfig.frameCount;
      } else {
        this.currentFrame++;
        if (this.currentFrame >= this.currentConfig.frameCount) {
          this.isPlaying = false;
          if (this.onAnimationEnd) {
            this.onAnimationEnd(this.currentConfig.nextState || 'idle');
          }
          return;
        }
      }
    }

    this.animationId = requestAnimationFrame(this.loop);
  };
}
