import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ViewBase } from './view-base';
import { ReadoutComponent, BarComponent, PillComponent } from '../ui/widgets';
import { MiniTrendComponent } from '../ui/mini-trend.component';
import { SimService } from '../sim/sim.service';

@Component({
  selector: 'nol-reactor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ReadoutComponent, BarComponent, PillComponent, MiniTrendComponent],
  template: `
    <div class="grid cols">
      <section class="panel" id="w-neutronics">
        <h2>Neutronics</h2>
        <nol-readout label="Neutron power" [value]="h('neutron_power')" units="%" [dp]="1"
          [deviation]="dev('neutron_power')" [flag]="faultFlag('neutron_power')"
          [level]="h('neutron_power') > 108 ? 'alarm' : 'normal'" />
        <nol-bar [value]="h('neutron_power')" [min]="0" [max]="120" [markers]="[100, 112]"
          [level]="h('neutron_power') > 108 ? 'alarm' : 'normal'" />
        <nol-readout label="Thermal power" [value]="h('thermal_power')" units="MW" [dp]="0" />
        <nol-readout label="Net reactivity" [value]="h('reactivity_pcm')" units="pcm" [dp]="0" />
        <nol-readout label="Xenon-135" [value]="h('xenon')" units="%" [dp]="1" />
        <nol-readout label="Decay heat" [value]="decayPct()" units="% rated" [dp]="2" />
        <div class="mt"><nol-mini-trend [keys]="['neutron_power']" /></div>
      </section>

      <section class="panel" id="w-rods">
        <h2>Control Rods</h2>
        <nol-readout label="Bank position" [value]="h('rod_pos')" units="% withdrawn" [dp]="1"
          [deviation]="dev('rod_pos')" />
        <nol-bar [value]="h('rod_pos')" [min]="0" [max]="100" />
        <div class="row">
          <span class="dim">Rod control</span>
          <nol-pill [text]="ctl().mode_rod_auto ? 'AUTO' : 'MANUAL'" [cls]="ctl().mode_rod_auto ? 'on' : 'hold'" />
          <button (click)="setRodMode(!ctl().mode_rod_auto)">{{ ctl().mode_rod_auto ? 'Take manual' : 'Return to auto' }}</button>
        </div>
        @if (!ctl().mode_rod_auto && !tripped()) {
          <div class="rodpad">
            <button (mousedown)="rod(-max)" (mouseup)="rod(0)" (mouseleave)="rod(0)">▼ INSERT</button>
            <span class="num">{{ manualSpeed().toFixed(4) }}/s</span>
            <button (mousedown)="rod(max)" (mouseup)="rod(0)" (mouseleave)="rod(0)">▲ WITHDRAW</button>
          </div>
        }
        @if (ctl().mode_rod_auto) {
          <label class="row">Target power
            <input type="range" min="0" max="100" step="1" [ngModel]="ctl().target_power"
              (ngModelChange)="setTargetPower($event)" />
            <span class="num">{{ ctl().target_power.toFixed(0) }}%</span>
          </label>
          <div class="dim">Controller error: <span class="num">{{ ctl().rod_error.toFixed(2) }}</span></div>
        }
        <div class="row">
          <button class="danger" (click)="tripReactor()" [disabled]="tripped()">MANUAL REACTOR TRIP</button>
          <button (click)="resetTrip()" [disabled]="!tripped()">RESET TRIP</button>
          @if (tripped()) { <nol-pill text="TRIPPED" cls="bad" /> }
        </div>
      </section>

      <section class="panel" id="w-reactivity">
        <h2>Reactivity balance</h2>
        @if (phys(); as p) {
          <table>
            <tbody>
              <tr><td>Rods</td><td class="num">{{ pcm(p.rho_rods) }}</td></tr>
              <tr><td>Fuel (Doppler)</td><td class="num">{{ pcm(p.rho_fuel) }}</td></tr>
              <tr><td>Moderator temp</td><td class="num">{{ pcm(p.rho_mod) }}</td></tr>
              <tr><td>Xenon</td><td class="num">{{ pcm(p.rho_xenon) }}</td></tr>
              <tr><td>Boron</td><td class="num">{{ pcm(p.rho_boron) }}</td></tr>
              <tr><td>External / scenario</td><td class="num">{{ pcm(p.rho_external) }}</td></tr>
              <tr><td>Scram</td><td class="num">{{ pcm(p.rho_scram) }}</td></tr>
              <tr class="tot"><td>Net</td><td class="num">{{ pcm(p.reactivity) }}</td></tr>
            </tbody>
          </table>
          <p class="dim sm">Shown because instructor/debug mode is on - this is hidden physical
            truth. Operators infer reactivity from power rate-of-change and rod position.</p>
        } @else {
          <p class="dim">Enable <strong>INSTR</strong> mode (top bar) to see the reactivity component
            breakdown. Normally the operator estimates reactivity from the indicated
            reactivity meter (<span class="num">{{ h('reactivity_pcm').toFixed(0) }} pcm</span>) and
            power behaviour.</p>
        }
      </section>

      <section class="panel" id="w-rx-temps">
        <h2>Temperatures</h2>
        <nol-readout label="Fuel (avg)" [value]="h('t_fuel')" units="°C" [dp]="0" />
        <nol-readout label="Coolant T-avg" [value]="h('t_avg')" units="°C" [dp]="1"
          [deviation]="dev('t_avg')" [level]="h('t_avg') > 322 ? 'warn' : 'normal'" />
        <nol-readout label="Hot leg" [value]="h('t_hot')" units="°C" [dp]="1" />
        <nol-readout label="Cold leg" [value]="h('t_cold')" units="°C" [dp]="1" />
        <nol-readout label="ΔT (hot − cold)" [value]="h('delta_t')" units="°C" [dp]="1" />
        <div class="mt"><nol-mini-trend [keys]="['t_fuel', 't_avg', 't_hot', 't_cold']" /></div>
      </section>
    </div>
  `,
  styles: [
    `
      .cols {
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      }
      .row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 8px 0;
        flex-wrap: wrap;
      }
      .rodpad {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 8px 0;
      }
      table .tot td {
        border-top: 2px solid var(--line);
        font-weight: 700;
      }
      .mt {
        margin-top: 10px;
      }
      .sm {
        font-size: 10px;
      }
      input[type='range'] {
        flex: 1;
      }
    `,
  ],
})
export class ReactorComponent extends ViewBase {
  private readonly svc = inject(SimService);
  readonly max = 0.004;
  readonly manualSpeed = computed(() => this.pendingSpeed);
  private pendingSpeed = 0;

  readonly ctl = computed(() => this.snap()!.controllers);
  readonly tripped = computed(() => this.snap()?.controllers.reactor_trip_latched ?? false);
  // Derived from HMI values so it is available without instructor mode:
  // thermal% = (fission + decay)·100 ; subtract indicated fission power.
  readonly decayPct = computed(() => Math.max(0, this.h('thermal_power') / 10 - this.h('neutron_power')));

  pcm(v: number): string {
    return (v * 1e5).toFixed(0);
  }
  setRodMode(auto: boolean): void {
    void this.svc.action({ type: 'rod_mode', mode: auto ? 'auto' : 'manual' });
  }
  setTargetPower(v: number): void {
    void this.svc.action({ type: 'target_power', value: v });
  }
  rod(speed: number): void {
    this.pendingSpeed = speed;
    void this.svc.action({ type: 'rod_speed', value: speed });
  }
  tripReactor(): void {
    void this.svc.action({ type: 'trip_reactor' });
  }
  resetTrip(): void {
    void this.svc.action({ type: 'reset_trip' });
  }
}
