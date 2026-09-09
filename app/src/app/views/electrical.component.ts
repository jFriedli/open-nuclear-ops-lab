import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { ViewBase } from './view-base';
import { PillComponent, ReadoutComponent, BarComponent } from '../ui/widgets';
import { MiniTrendComponent } from '../ui/mini-trend.component';

@Component({
  selector: 'nol-electrical',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PillComponent, ReadoutComponent, BarComponent, MiniTrendComponent],
  template: `
    <div class="grid cols">
      <section class="panel" id="w-sld">
        <h2>Single-line (simplified)</h2>
        <div class="sld">
          <div class="node" [class.dead]="!e().grid_available">
            <b>OFF-SITE GRID</b>
            <nol-pill [text]="e().grid_available ? 'AVAILABLE' : 'LOST'" [cls]="e().grid_available ? 'on' : 'bad'" />
          </div>
          <div class="link" [class.hot]="e().offsite_power"></div>
          <div class="node" [class.dead]="!genSupplying()">
            <b>MAIN GENERATOR</b>
            <nol-pill [text]="genSupplying() ? e().generator_mw.toFixed(0) + ' MW' : 'OFFLINE'"
              [cls]="genSupplying() ? 'on' : 'off'" />
          </div>
          <div class="busrow">
            <div class="link vert" [class.hot]="e().essential_bus_energized"></div>
          </div>
          <div class="node bus" [class.dead]="!e().essential_bus_energized">
            <b>ESSENTIAL BUS</b>
            <nol-pill [text]="e().essential_bus_energized ? 'ENERGIZED' : 'DE-ENERGIZED'"
              [cls]="e().essential_bus_energized ? 'on' : 'bad'" />
            <span class="dim sm">source: {{ busSource() }}</span>
          </div>
          <div class="diesels">
            @for (d of diesels(); track d.name) {
              <div class="node" [class.dead]="!d.avail">
                <b>{{ d.name }}</b>
                <nol-pill [text]="d.run ? 'RUNNING' : d.avail ? 'STANDBY' : 'UNAVAILABLE'"
                  [cls]="d.run ? 'on' : d.avail ? 'off' : 'bad'" />
              </div>
            }
          </div>
        </div>
      </section>

      <section class="panel" id="w-loads">
        <h2>Loads &amp; battery</h2>
        <nol-readout label="Reactor coolant pumps powered" [value]="e().rcp_powered ? 1 : 0" [dp]="0" units="" />
        <div class="row"><span class="dim">RCP power source</span>
          <nol-pill [text]="e().rcp_powered ? 'AVAILABLE' : 'LOST'" [cls]="e().rcp_powered ? 'on' : 'bad'" /></div>
        <nol-readout label="Station battery (125 VDC)" [value]="h('battery_charge')" units="%" [dp]="1"
          [level]="h('battery_charge') < 40 ? 'alarm' : h('battery_charge') < 70 ? 'warn' : 'normal'" />
        <nol-bar [value]="h('battery_charge')" [min]="0" [max]="100" [markers]="[30, 60]"
          [level]="h('battery_charge') < 40 ? 'alarm' : h('battery_charge') < 70 ? 'warn' : 'normal'" />
        <p class="dim sm">Battery discharges whenever the essential bus is de-energized and recharges when
          AC power is restored. Endurance in this model is ~4 hours.</p>
        <div class="mt"><nol-mini-trend [keys]="['generator_mw', 'battery_charge']" /></div>
      </section>

      <section class="panel">
        <h2>How the supplies connect</h2>
        <p class="dim">The reactor coolant pumps and main feedwater pumps run only on off-site power
          or the main generator — never on the diesels. The diesels carry the essential bus: safety
          loads, auxiliary feedwater, instrumentation chargers. Below that is the station battery.</p>
      </section>
    </div>
  `,
  styles: [
    `
      .cols {
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      }
      .sld {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
      }
      .node {
        border: 1px solid var(--line);
        border-radius: 4px;
        background: var(--panel-3);
        padding: 6px 12px;
        text-align: center;
        min-width: 180px;
      }
      .node b {
        display: block;
        font-size: 11px;
        letter-spacing: 0.04em;
      }
      .node.bus {
        border-color: var(--accent);
        min-width: 240px;
      }
      .node.dead {
        opacity: 0.45;
      }
      .link {
        width: 2px;
        height: 16px;
        background: var(--line);
      }
      .link.hot {
        background: var(--ok);
        box-shadow: 0 0 6px var(--ok);
      }
      .diesels {
        display: flex;
        gap: 10px;
        margin-top: 6px;
      }
      .row {
        display: flex;
        gap: 8px;
        align-items: center;
        margin: 6px 0;
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
export class ElectricalComponent extends ViewBase {
  readonly e = computed(() => this.snap()!.electrical);
  readonly genSupplying = computed(() => this.e().generator_online && this.e().generator_mw > 5);
  readonly diesels = computed(() => [
    { name: 'EDG A', run: this.e().edg_a_running, avail: this.e().edg_a_available },
    { name: 'EDG B', run: this.e().edg_b_running, avail: this.e().edg_b_available },
  ]);
  busSource(): string {
    const e = this.e();
    if (this.genSupplying()) return 'main generator';
    if (e.offsite_power) return 'off-site power';
    if (e.edg_a_running || e.edg_b_running) return 'emergency diesel';
    return 'NONE';
  }
}
