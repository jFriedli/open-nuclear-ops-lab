import { Injectable, NgZone, signal, computed, inject } from '@angular/core';
import type { FromWorker, ToWorker, ClockCommand } from './protocol';
import type { Snapshot } from './sim.types';
import { TrendsService } from '../core/trends.service';

export const SPEEDS = [0.25, 0.5, 1, 2, 5, 10] as const;

@Injectable({ providedIn: 'root' })
export class SimService {
  private readonly zone = inject(NgZone);
  private readonly trends = inject(TrendsService);
  private worker: Worker | null = null;
  private cmdId = 0;
  private pending = new Map<number, (r: { ok: boolean; reason: string }) => void>();

  readonly snapshot = signal<Snapshot | null>(null);
  readonly connected = signal(false);
  readonly error = signal<string | null>(null);
  readonly lastCommand = signal<{ ok: boolean; reason: string } | null>(null);

  readonly running = computed(() => this.snapshot()?.running ?? false);
  readonly speed = computed(() => this.snapshot()?.speed ?? 1);
  readonly simTime = computed(() => this.snapshot()?.sim_time ?? 0);

  start(): void {
    if (this.worker) return;
    this.worker = new Worker(new URL('./sim.worker', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.handle(ev.data);
    this.worker.onerror = (e) => this.zone.run(() => this.error.set(e.message || 'worker error'));
    this.send({ type: 'init' });
  }

  private handle(msg: FromWorker): void {
    this.zone.run(() => {
      switch (msg.type) {
        case 'ready':
          this.connected.set(true);
          break;
        case 'error':
          this.error.set(msg.message);
          break;
        case 'snapshot':
          this.snapshot.set(msg.snapshot);
          this.trends.ingest(msg.snapshot);
          break;
        case 'command-result': {
          const cb = this.pending.get(msg.id);
          if (cb) {
            this.pending.delete(msg.id);
            cb({ ok: msg.ok, reason: msg.reason });
          }
          const stamp = { ok: msg.ok, reason: msg.reason };
          this.lastCommand.set(stamp);
          setTimeout(() => {
            if (this.lastCommand() === stamp) this.lastCommand.set(null);
          }, 4500);
          break;
        }
      }
    });
  }

  private send(m: ToWorker): void {
    this.worker?.postMessage(m);
  }

  clock(cmd: ClockCommand): void {
    this.send({ type: 'clock', cmd });
  }
  pause(): void {
    this.clock({ kind: 'pause' });
  }
  resume(): void {
    this.clock({ kind: 'resume' });
  }
  stepOnce(): void {
    this.clock({ kind: 'step-once' });
  }
  setSpeed(speed: number): void {
    this.clock({ kind: 'set-speed', speed });
  }

  setDebug(on: boolean): void {
    this.send({ type: 'set-debug', on });
  }

  action(payload: Record<string, unknown>): Promise<{ ok: boolean; reason: string }> {
    const id = ++this.cmdId;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.send({ type: 'action', json: JSON.stringify(payload), id });
    });
  }

  loadScenario(json: string): Promise<{ ok: boolean; reason: string }> {
    const id = ++this.cmdId;
    this.trends.clear();
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.send({ type: 'load-scenario', json, id });
    });
  }

  reset(): Promise<{ ok: boolean; reason: string }> {
    const id = ++this.cmdId;
    this.trends.clear();
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.send({ type: 'reset', id });
    });
  }
}
