import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { TrendsService, TREND_VARS } from '../core/trends.service';

/** Compact multi-series sparkline drawn on a canvas, fed by TrendsService. */
@Component({
  selector: 'nol-mini-trend',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      <canvas #cv></canvas>
      <div class="legend">
        @for (k of keys(); track k) {
          <span [style.color]="color(k)">■ {{ label(k) }}</span>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .wrap {
        border: 1px solid var(--line);
        border-radius: 4px;
        background: var(--panel-3);
        padding: 4px;
      }
      canvas {
        width: 100%;
        height: 90px;
        display: block;
      }
      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        font-size: 10px;
        font-family: var(--mono);
        margin-top: 2px;
      }
    `,
  ],
})
export class MiniTrendComponent implements AfterViewInit {
  private readonly trends = inject(TrendsService);
  keys = input.required<string[]>();
  windowSec = input(300);
  private cv = viewChild.required<ElementRef<HTMLCanvasElement>>('cv');

  constructor() {
    effect(() => {
      this.trends.revision();
      this.keys();
      this.draw();
    });
  }
  ngAfterViewInit(): void {
    this.draw();
  }

  color(k: string): string {
    return TREND_VARS.find((v) => v.key === k)?.color ?? '#8ab';
  }
  label(k: string): string {
    return TREND_VARS.find((v) => v.key === k)?.label ?? k;
  }

  private draw(): void {
    const canvas = this.cv().nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 240;
    const hgt = canvas.clientHeight || 90;
    canvas.width = w * dpr;
    canvas.height = hgt * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);

    const { t, values } = this.trends.window(this.keys(), this.windowSec());
    if (t.length < 2) {
      ctx.fillStyle = '#667';
      ctx.font = '10px monospace';
      ctx.fillText('collecting data…', 6, 14);
      return;
    }
    const t0 = t[0];
    const t1 = t[t.length - 1];
    const span = t1 - t0 || 1;

    for (const k of this.keys()) {
      const ys = values.get(k) ?? [];
      let lo = Infinity;
      let hi = -Infinity;
      for (const y of ys) {
        if (Number.isFinite(y)) {
          lo = Math.min(lo, y);
          hi = Math.max(hi, y);
        }
      }
      if (!Number.isFinite(lo)) continue;
      const pad = (hi - lo) * 0.1 || 1;
      lo -= pad;
      hi += pad;
      ctx.beginPath();
      ctx.strokeStyle = this.color(k);
      ctx.lineWidth = 1.25;
      let started = false;
      for (let i = 0; i < ys.length; i++) {
        const y = ys[i];
        if (!Number.isFinite(y)) continue;
        const px = ((t[i] - t0) / span) * (w - 2) + 1;
        const py = hgt - 2 - ((y - lo) / (hi - lo || 1)) * (hgt - 4);
        if (!started) {
          ctx.moveTo(px, py);
          started = true;
        } else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }
}
