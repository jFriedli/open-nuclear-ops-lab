import { computed, inject } from '@angular/core';
import { SimService } from '../sim/sim.service';
import { hv, type Snapshot } from '../sim/sim.types';

/** Small shared helper for view components. */
export class ViewBase {
  protected readonly sim = inject(SimService);
  protected readonly snap = this.sim.snapshot;
  protected readonly debug = computed(() => this.snap()?.physical != null);

  protected h(key: string): number {
    return hv(this.snap(), key);
  }
  protected dev(key: string): number {
    return hv(this.snap(), `${key}__dev`);
  }
  protected phys(): Snapshot['physical'] {
    return this.snap()?.physical ?? null;
  }
  /** 'hmi' if the displayed value is spoofed, 'signal' if the processed value is. */
  protected faultFlag(key: string): 'hmi' | 'signal' | null {
    const s = this.snap();
    if (!s) return null;
    if (s.hmi_faulted?.includes(key)) return 'hmi';
    if (s.signal_faulted?.includes(key)) return 'signal';
    return null;
  }
  protected fmt(v: number, dp = 1): string {
    return Number.isFinite(v) ? v.toFixed(dp) : '--';
  }
}
