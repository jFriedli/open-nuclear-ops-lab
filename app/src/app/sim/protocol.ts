// Messages exchanged between the UI thread and the simulation Web Worker.

import type { Snapshot } from './sim.types';

export type ClockCommand =
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'step-once' }
  | { kind: 'set-speed'; speed: number };

export type ToWorker =
  | { type: 'init' }
  | { type: 'clock'; cmd: ClockCommand }
  | { type: 'action'; json: string; id: number }
  | { type: 'load-scenario'; json: string; id: number }
  | { type: 'load-session'; json: string; id: number }
  | { type: 'export-session'; id: number }
  | { type: 'reset'; id: number }
  | { type: 'set-debug'; on: boolean }
  | { type: 'request-snapshot' };

export type FromWorker =
  | { type: 'ready'; dt: number }
  | { type: 'error'; message: string }
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'command-result'; id: number; ok: boolean; reason: string }
  | { type: 'session'; id: number; json: string };

/** Fixed publication rate of state snapshots to the UI (Hz). */
export const SNAPSHOT_HZ = 15;
/** Simulated seconds advanced per wall-clock second at 1x. */
export const SIM_RATE = 1;
