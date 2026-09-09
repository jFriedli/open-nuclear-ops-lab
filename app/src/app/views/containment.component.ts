import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ViewBase } from './view-base';
import { ReadoutComponent, BarComponent, PillComponent } from '../ui/widgets';
import { MiniTrendComponent } from '../ui/mini-trend.component';
import { SimService } from '../sim/sim.service';

@Component({
  selector: 'nol-containment',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ReadoutComponent, BarComponent, PillComponent, MiniTrendComponent],
  template: `
    <div class="grid cols">
      <section class="panel" id="w-cnmt">
        <h2>Containment</h2>
        <nol-readout
          label="Containment pressure"
          [value]="s().cnmt_pressure"
          units="kPa"
          [dp]="1"
          [deviation]="dev('cnmt_pressure')"
          [level]="s().cnmt_pressure > 100 ? 'alarm' : s().cnmt_pressure > 15 ? 'warn' : 'normal'"
        />
        <nol-bar
          [value]="s().cnmt_pressure"
          [min]="0"
          [max]="200"
          [markers]="[15, 20, 140]"
          [level]="s().cnmt_pressure > 100 ? 'alarm' : s().cnmt_pressure > 15 ? 'warn' : 'normal'"
        />
        <nol-readout label="Containment temperature" [value]="s().cnmt_temp" units="°C" [dp]="1" />
        <nol-readout
          label="Containment sump level"
          [value]="s().cnmt_sump"
          units="%"
          [dp]="1"
          [level]="s().cnmt_sump > 15 ? 'warn' : 'normal'"
        />
        <nol-bar [value]="s().cnmt_sump" [min]="0" [max]="100" [markers]="[15]" />

        <div class="row">
          <span class="dim">Phase-A isolation</span>
          <nol-pill
            [text]="s().cnmt_isolated ? 'CLOSED' : 'OPEN'"
            [cls]="s().cnmt_isolated ? 'bad' : 'on'"
          />
          <button (click)="isolate(!s().cnmt_isolated)">
            {{ s().cnmt_isolated ? 'Reset' : 'Isolate' }}
          </button>
        </div>
        <div class="row">
          <span class="dim">Containment spray</span>
          <nol-pill
            [text]="s().cnmt_spray ? 'RUNNING' : 'STANDBY'"
            [cls]="s().cnmt_spray ? 'hold' : 'off'"
          />
          <button (click)="spray(!s().cnmt_spray)">{{ s().cnmt_spray ? 'Stop' : 'Start' }}</button>
        </div>
        @if (s().cnmt_isolated) {
          <p class="dim sm">
            Isolation has closed the letdown line — the pressurizer level must be held on charging
            alone.
          </p>
        }
        <div class="mt">
          <nol-mini-trend [keys]="['cnmt_pressure', 'cnmt_temp', 'cnmt_sump']" />
        </div>
      </section>

      <section class="panel" id="w-si">
        <h2>Safety injection &amp; accumulators</h2>
        <div class="row">
          <span class="dim">Safety injection</span>
          <nol-pill
            [text]="ctl().si_latched ? 'ACTUATED' : 'ARMED'"
            [cls]="ctl().si_latched ? 'bad' : 'on'"
          />
          @if (!ctl().si_latched) {
            <button (click)="actuateSi()">Manual SI</button>
          } @else {
            <button (click)="resetSi()">Reset SI</button>
          }
        </div>
        <nol-readout
          label="High-head SI + accumulator flow"
          [value]="s().si_flow_pct"
          units="%rated"
          [dp]="2"
        />
        <nol-readout
          label="Primary coolant loss to containment"
          [value]="s().primary_leak_pct"
          units="%rated"
          [dp]="2"
          [level]="s().primary_leak_pct > 0.2 ? 'alarm' : 'normal'"
        />
        <nol-readout
          label="Accumulator inventory"
          [value]="s().accumulator_pct"
          units="%"
          [dp]="1"
          [deviation]="dev('accum_level')"
          [level]="s().accumulator_pct < 35 ? 'warn' : 'normal'"
        />
        <nol-bar [value]="s().accumulator_pct" [min]="0" [max]="100" [markers]="[35]" />
        <p class="dim sm">
          Accumulators inject passively once primary pressure falls below ~4.2 MPa. High-head SI
          pumps need the essential bus. SI actuates automatically on low primary pressure ({{
            11.5
          }}
          MPa) or high containment pressure (20 kPa) and trips the reactor.
        </p>
      </section>

      <section class="panel" id="w-cvcs">
        <h2>Chemistry &amp; makeup (CVCS)</h2>
        <nol-readout
          label="Coolant boron"
          [value]="s().boron_ppm"
          units="ppm"
          [dp]="0"
          [deviation]="dev('boron_ppm')"
        />
        <nol-readout label="Boron reactivity" [value]="s().boron_pcm" units="pcm" [dp]="0" />
        <div class="row">
          <span class="dim">Makeup control</span>
          <nol-pill
            [text]="ctl().mode_cvcs_auto ? 'AUTO' : 'MANUAL'"
            [cls]="ctl().mode_cvcs_auto ? 'on' : 'hold'"
          />
          <button (click)="cvcsMode(!ctl().mode_cvcs_auto)">
            {{ ctl().mode_cvcs_auto ? 'Manual' : 'Auto' }}
          </button>
        </div>
        <nol-readout label="Charging demand" [value]="s().charging_pct" units="%" [dp]="0" />
        <nol-readout label="Letdown demand" [value]="s().letdown_pct" units="%" [dp]="0" />
        @if (!ctl().mode_cvcs_auto) {
          <label class="row"
            >Charging
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              [ngModel]="chargeCmd()"
              (ngModelChange)="setCharging($event)"
            />
            <span class="num">{{ chargeCmd() }}%</span>
          </label>
          <label class="row"
            >Letdown
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              [ngModel]="letdownCmd()"
              (ngModelChange)="setLetdown($event)"
            />
            <span class="num">{{ letdownCmd() }}%</span>
          </label>
        } @else {
          <label class="row"
            >Pzr level setpoint
            <input
              type="range"
              min="30"
              max="70"
              step="1"
              [ngModel]="levelSp()"
              (ngModelChange)="setLevelSp($event)"
            />
            <span class="num">{{ levelSp() }}%</span>
          </label>
        }
        <div class="row">
          <span class="dim">Boron adjust</span>
          <button (click)="borate(0.2)">Borate +</button>
          <button (click)="borate(-0.2)">Dilute −</button>
          <button (click)="borate(0)">Hold</button>
        </div>
        <div class="mt"><nol-mini-trend [keys]="['boron_ppm', 'pzr_level']" /></div>
      </section>

      <section class="panel">
        <h2>Fission-product barriers</h2>
        <p class="dim">
          Three barriers stand between the fuel and the environment: the fuel cladding, the reactor
          coolant pressure boundary, and the containment building. This page covers the systems that
          defend the second and third barriers.
        </p>
        <ul class="dim sm">
          <li>
            <b>Primary boundary</b> — a break or stuck-open relief valve is a loss of coolant. Watch
            primary pressure, pressurizer level, and the charging demand climbing to hold it.
          </li>
          <li>
            <b>Containment</b> — anything released from the primary raises containment pressure,
            temperature and sump level. Isolation closes penetrations; spray condenses steam.
          </li>
          <li>
            <b>Boron</b> — borated injection water adds negative reactivity, helping keep the core
            shut down as it cools and depressurises.
          </li>
        </ul>
      </section>
    </div>
  `,
  styles: [
    `
      .cols {
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
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
      ul {
        margin: 6px 0 0;
        padding-left: 16px;
      }
      li {
        margin: 4px 0;
      }
    `,
  ],
})
export class ContainmentComponent extends ViewBase {
  private readonly svc = inject(SimService);
  readonly s = computed(() => this.snap()!.safety);
  readonly ctl = computed(() => this.snap()!.controllers);

  private chargeOverride = 30;
  private letdownOverride = 30;
  private levelSpOverride = 55;
  chargeCmd = () => this.chargeOverride;
  letdownCmd = () => this.letdownOverride;
  levelSp = () => this.levelSpOverride;

  isolate(on: boolean): void {
    void this.svc.action({ type: 'cnmt_isolate', on });
  }
  spray(on: boolean): void {
    void this.svc.action({ type: 'cnmt_spray', on });
  }
  actuateSi(): void {
    void this.svc.action({ type: 'safety_injection' });
  }
  resetSi(): void {
    void this.svc.action({ type: 'reset_si' });
  }
  cvcsMode(auto: boolean): void {
    void this.svc.action({ type: 'cvcs_mode', mode: auto ? 'auto' : 'manual' });
  }
  setCharging(v: number): void {
    this.chargeOverride = v;
    void this.svc.action({ type: 'charging', value: v / 100 });
  }
  setLetdown(v: number): void {
    this.letdownOverride = v;
    void this.svc.action({ type: 'letdown', value: v / 100 });
  }
  setLevelSp(v: number): void {
    this.levelSpOverride = v;
    void this.svc.action({ type: 'pzr_level_setpoint', value: v });
  }
  borate(rate: number): void {
    void this.svc.action({ type: 'boron', rate });
  }
}
