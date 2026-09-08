import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ViewBase } from './view-base';
import { ReadoutComponent, BarComponent, PillComponent } from '../ui/widgets';
import { MiniTrendComponent } from '../ui/mini-trend.component';
import { SimService } from '../sim/sim.service';

@Component({
  selector: 'nol-secondary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ReadoutComponent, BarComponent, PillComponent, MiniTrendComponent],
  template: `
    <div class="grid cols">
      @for (k of [1, 2]; track k) {
        <section class="panel">
          <h2>Steam generator {{ k }}</h2>
          <nol-readout label="Level (narrow range)" [value]="h('sg' + k + '_level')" units="%" [dp]="1"
            [deviation]="dev('sg' + k + '_level')" [level]="sgLevel(k)" />
          <nol-bar [value]="h('sg' + k + '_level')" [min]="0" [max]="100" [markers]="[25, 65, 85]" [level]="sgLevel(k)" />
          <nol-readout label="Steam pressure" [value]="h('sg' + k + '_pressure')" units="MPa" [dp]="2" />
          <nol-readout label="Steam flow" [value]="h('sg' + k + '_steam_flow')" units="%" [dp]="1" />
          <nol-readout label="Feed flow" [value]="h('sg' + k + '_fw_flow')" units="%" [dp]="1" />
          @if (phys(); as p) {
            <div class="dim sm">Primary → SG heat: {{ (p.sg[k - 1].heat_in).toFixed(0) }} MW</div>
          }
        </section>
      }

      <section class="panel">
        <h2>Feedwater</h2>
        @for (i of [0, 1]; track i) {
          <div class="rcp">
            <span>MFW-{{ i + 1 }}</span>
            <nol-pill [text]="mfw()[i] ? 'RUNNING' : 'STOPPED'" [cls]="mfw()[i] ? 'on' : 'off'" />
            <button (click)="toggleMfw(i, !mfw()[i])" [disabled]="!mfw()[i] && !acPower()">
              {{ mfw()[i] ? 'Stop' : 'Start' }}
            </button>
          </div>
        }
        <div class="row">
          <span class="dim">Aux feedwater</span>
          <nol-pill [text]="phys()?.afw_on ? 'RUNNING (auto)' : 'STANDBY'" [cls]="phys()?.afw_on ? 'on' : 'off'" />
        </div>
        <div class="row">
          <span class="dim">Feedwater control</span>
          <nol-pill [text]="ctl().mode_fw_auto ? 'AUTO (3-element)' : 'MANUAL'" [cls]="ctl().mode_fw_auto ? 'on' : 'hold'" />
          <button (click)="setFwMode(!ctl().mode_fw_auto)">{{ ctl().mode_fw_auto ? 'Manual' : 'Auto' }}</button>
        </div>
        <label class="row">SG level setpoint
          <input type="range" min="45" max="75" step="1" [ngModel]="lvlSp()" (ngModelChange)="setLvlSp($event)" />
          <span class="num">{{ lvlSp().toFixed(0) }}%</span>
        </label>
        <div class="mt"><nol-mini-trend [keys]="['sg1_level', 'sg2_level', 'sg1_fw_flow']" /></div>
      </section>

      <section class="panel">
        <h2>Turbine / generator</h2>
        <nol-readout label="Turbine speed" [value]="h('turbine_speed')" units="%" [dp]="1"
          [level]="h('turbine_speed') > 103 ? 'alarm' : 'normal'" />
        <nol-bar [value]="h('turbine_speed')" [min]="0" [max]="115" [markers]="[100, 106]"
          [level]="h('turbine_speed') > 103 ? 'alarm' : 'normal'" />
        <nol-readout label="Generator output" [value]="h('generator_mw')" units="MW" [dp]="0" />
        <div class="row">
          <span class="dim">Generator breaker</span>
          <nol-pill [text]="elec().generator_online ? 'CLOSED' : 'OPEN'" [cls]="elec().generator_online ? 'on' : 'off'" />
          <button (click)="connectGen(!elec().generator_online)">
            {{ elec().generator_online ? 'Trip breaker' : 'Synchronise' }}
          </button>
        </div>
        @if (phys(); as p) {
          <div class="row">
            <span class="dim">Throttle {{ (p.throttle * 100).toFixed(0) }}%</span>
            <span class="dim">Steam dump {{ (p.steam_dump * 100).toFixed(0) }}%</span>
          </div>
        }
        <label class="row">Load target
          <input type="range" min="0" max="100" step="1" [ngModel]="loadSp()" (ngModelChange)="setLoadSp($event)"
            [disabled]="ttrip()" />
          <span class="num">{{ loadSp().toFixed(0) }}%</span>
        </label>
        <div class="row">
          <button class="danger" (click)="tripTurbine()" [disabled]="ttrip()">MANUAL TURBINE TRIP</button>
          @if (ttrip()) { <nol-pill text="TRIPPED" cls="bad" /> }
        </div>
      </section>

      <section class="panel">
        <h2>Condenser</h2>
        <nol-readout label="Backpressure" [value]="h('condenser_pressure')" units="kPa" [dp]="1"
          [level]="h('condenser_pressure') > 12 ? 'warn' : 'normal'" />
        @if (phys(); as p) {
          <nol-readout label="Cooling effectiveness" [value]="p.condenser_effectiveness * 100" units="%" [dp]="0" />
        }
        <nol-bar [value]="h('condenser_pressure')" [min]="0" [max]="25" [markers]="[12, 20]"
          [level]="h('condenser_pressure') > 12 ? 'warn' : 'normal'" />
        <div class="mt"><nol-mini-trend [keys]="['generator_mw', 'condenser_pressure']" /></div>
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
export class SecondaryComponent extends ViewBase {
  private readonly svc = inject(SimService);
  readonly ctl = computed(() => this.snap()!.controllers);
  readonly elec = computed(() => this.snap()!.electrical);
  readonly ttrip = computed(() => this.snap()?.controllers.turbine_trip_latched ?? false);
  readonly mfw = computed(() => this.phys()?.mfw_pump ?? [true, true]);
  readonly acPower = computed(() => {
    const e = this.snap()?.electrical;
    return !!e && (e.offsite_power || (e.generator_online && e.generator_mw > 5));
  });
  private lvlSpV = 65;
  private loadSpV = 100;
  lvlSp = () => this.lvlSpV;
  loadSp = () => this.loadSpV;

  sgLevel(k: number): 'normal' | 'warn' | 'alarm' {
    const l = this.h(`sg${k}_level`);
    if (l < 25 || l > 85) return 'alarm';
    if (l < 35 || l > 80) return 'warn';
    return 'normal';
  }
  toggleMfw(i: number, on: boolean): void {
    void this.svc.action({ type: 'mfw', index: i, on });
  }
  setFwMode(auto: boolean): void {
    void this.svc.action({ type: 'fw_mode', mode: auto ? 'auto' : 'manual' });
  }
  setLvlSp(v: number): void {
    this.lvlSpV = v;
    void this.svc.action({ type: 'sg_level_setpoint', value: v });
  }
  setLoadSp(v: number): void {
    this.loadSpV = v;
    void this.svc.action({ type: 'target_load', value: v });
  }
  connectGen(on: boolean): void {
    void this.svc.action({ type: 'generator', connect: on });
  }
  tripTurbine(): void {
    void this.svc.action({ type: 'trip_turbine' });
  }
}
