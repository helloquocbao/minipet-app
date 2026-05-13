/**
 * PetStateMachine — Finite State Machine for managing pet behaviors and transitions.
 */
import { PetState, AnimationConfig } from '../../../shared/types/pet.types';
import { DEFAULT_ANIMATIONS } from '../../../shared/constants';
import { AnimationController } from './animation-controller';

interface StateRule {
  minDuration: number;
  maxDuration: number;
  transitions: PetState[];
}

export class PetStateMachine {
  private currentState: PetState = 'idle';
  private controller: AnimationController;
  private animations: Record<string, AnimationConfig>;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private scale: number = 1.0;
  private enableWalking: boolean = true;

  // Behavioral rules for automatic state transitions
  private rules: Partial<Record<PetState, StateRule>> = {
    idle: { minDuration: 15000, maxDuration: 40000, transitions: ['sleep', 'walk'] },
    walk: { minDuration: 5000, maxDuration: 20000, transitions: ['idle'] },
    run: { minDuration: 5000, maxDuration: 10000, transitions: ['idle'] }, 
    sleep: { minDuration: 20000, maxDuration: 60000, transitions: ['idle'] },
  };

  constructor(controller: AnimationController, scale: number = 1.0, enableWalking: boolean = true) {
    this.controller = controller;
    this.scale = scale;
    this.enableWalking = enableWalking;
    this.animations = { ...(DEFAULT_ANIMATIONS as any) };
    this.controller.onAnimationEnd = nextState => this.transitionTo(nextState);
  }

  /**
   * Returns the current state of the pet.
   */
  getState(): PetState {
    return this.currentState;
  }

  /**
   * Enables or disables autonomous walking behavior.
   */
  setWalkingEnabled(enabled: boolean): void {
    this.enableWalking = enabled;
    this.controller.setWalkingEnabled(enabled);

    // If walking is disabled while currently in a walk state, immediately return to idle.
    if (!enabled && this.currentState === 'walk') {
      this.transitionTo('idle');
    }
  }

  /**
   * Returns whether walking is currently enabled.
   */
  getWalkingEnabled(): boolean {
    return this.enableWalking;
  }

  /**
   * Updates the visual scale of the pet.
   */
  setScale(scale: number): void {
    this.scale = scale;
    this.controller.setScale(scale);
  }

  /**
   * Updates the animation configurations (for custom pets).
   */
  updateAnimations(newAnimations: any): void {
    this.animations = { ...(DEFAULT_ANIMATIONS as any), ...newAnimations };
  }

  /**
   * Triggers a 'notify' state (usually for alerts).
   */
  notify(): void {
    this.forceState('notify');
  }

  /**
   * Starts the alarm mode (infinite jumping/notifying).
   */
  startAlarm(): void {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    // Forces the pet into a looping 'notify' animation
    const config = { ...this.animations['notify'], loop: true };
    this.controller.play(config, this.scale);
    this.currentState = 'notify';
  }

  /**
   * Stops the alarm mode and returns to idle.
   */
  stopAlarm(): void {
    this.transitionTo('idle');
  }

  /**
   * Starts the state machine.
   */
  start(): void {
    this.transitionTo('idle');
  }

  /**
   * Transitions the pet to a new state.
   * @param state The target PetState.
   */
  transitionTo(state: PetState): void {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    this.currentState = state;
    const config = this.animations[state];

    if (config) {
      this.controller.play(config, this.scale);
    }

    // Schedule the next transition if rules exist for the current state
    const rule = this.rules[state];
    if (rule && config?.loop) {
      this.scheduleTransition(rule);
    }
  }

  /**
   * Forces an immediate transition to a specific state.
   */
  forceState(state: PetState): void {
    this.transitionTo(state);
  }

  /**
   * Schedules an automatic transition to a next possible state.
   */
  private scheduleTransition(rule: StateRule): void {
    const duration = Math.random() * (rule.maxDuration - rule.minDuration) + rule.minDuration;
    this.timerId = setTimeout(() => {
      let possibleTransitions = rule.transitions;

      // Filter out 'walk' state if walking is disabled
      if (!this.enableWalking) {
        possibleTransitions = possibleTransitions.filter(s => s !== 'walk');
      }

      // Select a random next state from possible transitions
      const nextState =
        possibleTransitions.length > 0
          ? possibleTransitions[Math.floor(Math.random() * possibleTransitions.length)]
          : 'idle';

      this.transitionTo(nextState);
    }, duration);
  }

  /**
   * Resets internal position tracker after manual drag.
   */
  resetPosition(): void {
    this.controller.resetPosition();
  }

  /**
   * Returns the window rectangle from the controller.
   */
  getRect() {
    return this.controller.getRect();
  }

  /**
   * Cleans up resources used by the state machine.
   */
  destroy(): void {
    if (this.timerId) clearTimeout(this.timerId);
    this.controller.stop();
  }
}
