import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ViewBase } from './view-base';
import { ReadoutComponent, BarComponent, PillComponent } from '../ui/widgets';
import { MiniTrendComponent } from '../ui/mini-trend.component';
import { SimService } from '../sim/sim.service';

@Component({
  selector: 'nol-primary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ReadoutComponent, BarComponent, PillComponent, MiniTrendComponent],
  template: `
    <div class="grid cols">
      <section class="panel">
        <h2>Reactor coolant pumps</h2>
        @for (i of [0, 1, 2, 3]; track i) {
          <div class="rcp">
            <span>RCP-{{ i + 1 }}</span>
            <nol-pill [text]="rcp()[i] ? 'RUNNING' : 'STOPPED'" [cls]="rcp()[i] ? 'on' : 'off'" />
            <button (click)="toggleRcp(i, !rcp()[i])" [disabled]="!rcp()[i] && !acPower()">
              {{ rcp()[i] ? 'Stop' : 'Start' }}
            </button>
          </div>
        }
        <nol-readout label="Primary flow" [value]="h('primary_flow')" units="%" [dp]="1"
          [level]="h('primary_flow') < 90 ? 'warn' : 'normal'" />
        <nol-bar [value]="h('primary_flow')" [min]="0" [max]="110" [markers]="[87]" />
        @if (!acPower()) { <p class="dim">RCPs require off-site power or the main generator — not available.</p> }
      </section>

      <section class="panel">
        <h2>Pressure &amp; pressurizer</h2>
        <nol-readout label="Primary pressure" [value]="h('primary_pressure')" units="MPa" [dp]="2"
          [deviation]="dev('primary_pressure')"
          [level]="pressLevel()" />
        <nol-bar [value]="h('primary_pressure')" [min]="12" [max]="17" [markers]="[13.2, 15.5, 16.8]"
          [level]="pressLevel()" />
        <nol-readout label="Pressurizer level" [value]="h('pzr_level')" units="%" [dp]="1"
          [deviation]="dev('pzr_level')" [level]="h('pzr_level') < 25 ? 'alarm' : 'normal'" />
        <nol-bar [value]="h('pzr_level')" [min]="0" [max]="100" [markers]="[15, 55, 85]" />
        <div class="row">
          <span class="dim">Pressurizer control</span>
          <nol-pill [text]="ctl().mode_pzr_auto ? 'AUTO' : 'MANUAL'" [cls]="ctl().mode_pzr_auto ? 'on' : 'hold'" />
          <button (click)="setPzrMode(!ctl().mode_pzr_auto)">{{ ctl().mode_pzr_auto ? 'Manual' : 'Auto' }}</button>
        </div>
        @if (ctl().mode_pzr_auto) {
          <label class="row">Setpoint
            <input type="range" min="14.5" max="16" step="0.05" [ngModel]="setpoint()"
              (ngModelChange)="setSetpoint($event)" />
            <span class="num">{{ setpoint().toFixed(2) }} MPa</span>
          </label>
        }
        @if (phys(); as p) {
          <div class="dim sm">Heaters {{ (p.pzr_heater_frac * 100).toFixed(0) }}% ·
            spray {{ (p.pzr_spray_frac * 100).toFixed(0) }}% ·
            relief valve {{ (p.porv * 100).toFixed(0) }}%</div>
        }
        <div class="mt"><nol-mini-trend [keys]="['primary_pressure', 'pzr_level']" /></div>
      </section>

      <section class="panel">
        <h2>Loop temperatures</h2>
        <nol-readout label="T-avg" [value]="h('t_avg')" units="°C" [dp]="1" [deviation]="dev('t_avg')" />
        <nol-readout label="Hot leg" [value]="h('t_hot')" units="°C" [dp]="1" />
        <nol-readout label="Cold leg" [value]="h('t_cold')" units="°C" [dp]="1" />
        <nol-readout label="ΔT" [value]="h('delta_t')" units="°C" [dp]="1" />
        <nol-readout label="Core heat to coolant" [value]="phys()?.core_heat_mw ?? 0" units="MW" [dp]="0" />
        <div class="mt"><nol-mini-trend [keys]="['t_hot', 't_cold', 't_avg']" /></div>
      </section>
    </div>
  `,
  styles: [
    `
      .cols {
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      }
      .rcp {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 3px 0;
      }
      .rcp span:first-child {
        width: 60px;
        font-family: var(--mono);
      }
      .row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 8px 0;
        flex-wrap: wrap;
      }
      input[type='range'] {
        flex: 1;
      }
      .mt {
        margin-top: 10px;
      }
      .sm {
        font-size: 10px;
      }
    `,
  ],
})
export class PrimaryComponent extends ViewBase {
  private readonly svc = inject(SimService);
  readonly rcp = computed(() => this.phys()?.rcp ?? this.rcpFromElec());
  readonly ctl = computed(() => this.snap()!.controllers);
  readonly acPower = computed(() => {
    const e = this.snap()?.electrical;
    return !!e && (e.offsite_power || (e.generator_online && e.generator_mw > 5));
  });
  private spOverride = 15.5;
  setpoint = () => this.spOverride;

  private rcpFromElec(): boolean[] {
    // Without debug we still know if pumps are powered from the electrical summary.
    const powered = this.snap()?.electrical.rcp_powered ?? true;
    return [powered, powered, powered, powered];
  }

  pressLevel(): 'normal' | 'warn' | 'alarm' {
    const p = this.h('primary_pressure');
    if (p > 16.8 || p < 13.2) return 'alarm';
    if (p > 16.2 || p < 14.2) return 'warn';
    return 'normal';
  }
  toggleRcp(i: number, on: boolean): void {
    void this.svc.action({ type: 'rcp', index: i, on });
  }
  setPzrMode(auto: boolean): void {
    void this.svc.action({ type: 'pzr_mode', mode: auto ? 'auto' : 'manual' });
  }
  setSetpoint(v: number): void {
    this.spOverride = v;
    void this.svc.action({ type: 'pzr_setpoint', value: v });
  }
}
