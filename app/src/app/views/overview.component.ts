import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ViewBase } from './view-base';

@Component({
  selector: 'nol-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <div class="panel">
      <div class="mimic-wrap">
        <svg viewBox="0 0 960 500" class="mimic" [class.flow]="flowing()">
          <!-- ================= PRIMARY ================= -->
          <!-- Reactor vessel -->
          <a [routerLink]="'/reactor'">
            <rect x="60" y="200" width="90" height="150" rx="8" class="vessel"
              [class.tripped]="reactorTripped()" />
            <text x="105" y="192" class="lbl">REACTOR</text>
            <text x="105" y="270" class="big">{{ f(h('neutron_power'), 0) }}%</text>
            <text x="105" y="288" class="sub">fission power</text>
            <text x="105" y="330" class="sub">Tf {{ f(h('t_fuel'), 0) }}°C</text>
          </a>

          <!-- Hot leg to SGs -->
          <path d="M150 235 H 360" class="pipe hot" />
          <path d="M150 320 H 360" class="pipe hot" />
          <!-- Cold leg back -->
          <path d="M360 265 H 200 V 300 H 150" class="pipe cold" />
          <path d="M360 350 H 150" class="pipe cold" />

          <!-- RCPs -->
          @for (rcp of rcps(); track rcp.i) {
            <g [attr.transform]="'translate(' + (185 + rcp.i * 0) + ',0)'">
              <circle [attr.cx]="rcp.x" [attr.cy]="rcp.y" r="13" class="pump"
                [class.on]="rcp.on" [class.spin]="rcp.on && flowing()" />
              <text [attr.x]="rcp.x" [attr.y]="rcp.y + 4" class="tiny">P{{ rcp.i + 1 }}</text>
            </g>
          }
          <text x="230" y="392" class="sub">flow {{ f(h('primary_flow'), 0) }}%</text>

          <!-- Pressurizer -->
          <a [routerLink]="'/primary'">
            <rect x="250" y="120" width="34" height="80" rx="6" class="tank" />
            <rect x="250" [attr.y]="200 - pzr() * 0.8" width="34" [attr.height]="pzr() * 0.8" class="water" />
            <text x="267" y="112" class="lbl">PZR</text>
            <text x="267" y="215" class="sub">{{ f(h('pzr_level'), 0) }}%</text>
            <text x="267" y="230" class="sub">{{ f(h('primary_pressure'), 1) }} MPa</text>
            <line x1="267" y1="200" x2="267" y2="237" class="pipe hot" />
          </a>

          <!-- Steam generators -->
          @for (sg of sgs(); track sg.k) {
            <a [routerLink]="'/secondary'">
              <rect [attr.x]="360" [attr.y]="sg.y" width="60" height="90" rx="8" class="sg" />
              <rect x="360" [attr.y]="sg.y + 90 - sg.lvl * 0.85" width="60" [attr.height]="sg.lvl * 0.85" class="water" />
              <text [attr.x]="390" [attr.y]="sg.y - 6" class="lbl">SG-{{ sg.k }}</text>
              <text [attr.x]="390" [attr.y]="sg.y + 50" class="sub">{{ f(sg.lvl, 0) }}%</text>
              <text [attr.x]="390" [attr.y]="sg.y + 64" class="sub">{{ f(sg.press, 1) }} MPa</text>
            </a>
          }

          <!-- ================= SECONDARY ================= -->
          <!-- Steam lines to turbine -->
          <path d="M420 150 H 620 L 660 175" class="pipe steam" />
          <path d="M420 320 H 600 V 190 H 660" class="pipe steam" />

          <!-- Turbine + generator -->
          <a [routerLink]="'/secondary'">
            <polygon points="660,160 720,145 720,205 660,190" class="turbine"
              [class.tripped]="turbineTripped()" />
            <circle cx="760" cy="175" r="26" class="gen" [class.on]="genOnline()" />
            <text x="690" y="135" class="lbl">TURBINE</text>
            <text x="760" y="132" class="lbl">GEN</text>
            <text x="760" y="179" class="big">{{ f(h('generator_mw'), 0) }}</text>
            <text x="760" y="195" class="sub">MW</text>
            <text x="690" y="222" class="sub">{{ f(h('turbine_speed'), 0) }}% speed</text>
          </a>

          <!-- Condenser -->
          <a [routerLink]="'/secondary'">
            <path d="M720 205 V 260 H 640 V 300 H 760 V 260" class="pipe steam" />
            <rect x="640" y="300" width="150" height="45" rx="6" class="cond" />
            <text x="715" y="325" class="sub">CONDENSER {{ f(h('condenser_pressure'), 0) }} kPa</text>
          </a>

          <!-- Feedwater back to SGs -->
          <path d="M640 345 V 400 H 440 V 320" class="pipe feed" />
          <path d="M640 345 V 420 H 430 V 240" class="pipe feed" />
          <circle cx="560" cy="400" r="12" class="pump" [class.on]="mfwOn()" [class.spin]="mfwOn() && flowing()" />
          <text x="560" y="440" class="sub">FEEDWATER {{ mfwCount() }}/2 pumps</text>

          <!-- ================= ELECTRICAL ================= -->
          <a [routerLink]="'/electrical'">
            <rect x="830" y="140" width="110" height="150" rx="8" class="elec" />
            <text x="885" y="132" class="lbl">ELECTRICAL</text>
            <text x="885" y="162" class="sub" [class.bad]="!offsite()">GRID {{ offsite() ? 'OK' : 'LOST' }}</text>
            <text x="885" y="182" class="sub" [class.ok]="genOnline()">GEN {{ genOnline() ? 'ON' : 'OFF' }}</text>
            <text x="885" y="202" class="sub" [class.bad]="!essBus()">BUS {{ essBus() ? 'ENERG' : 'DEAD' }}</text>
            <text x="885" y="222" class="sub">EDG {{ edgRunning() }}</text>
            <text x="885" y="242" class="sub">BATT {{ f(h('battery_charge'), 0) }}%</text>
            <line x1="786" y1="175" x2="830" y2="185" class="pipe elecline" [class.hot]="essBus()" />
          </a>
        </svg>
      </div>
      <div class="legend dim">
        Click any component to open its detail view. Animated pipes mean the loop is circulating;
        red means tripped.
      </div>
    </div>
  `,
  styles: [
    `
      .mimic-wrap {
        overflow-x: auto;
      }
      .mimic {
        width: 100%;
        min-width: 760px;
        background: #0a0d11;
        border: 1px solid var(--line);
        border-radius: 6px;
      }
      .vessel {
        fill: #26333f;
        stroke: var(--accent);
        stroke-width: 2;
      }
      .vessel.tripped {
        stroke: var(--alarm);
      }
      .tank,
      .sg {
        fill: #1c2732;
        stroke: #4a6072;
        stroke-width: 1.5;
      }
      .water {
        fill: color-mix(in srgb, var(--accent-2) 45%, transparent);
      }
      .pump {
        fill: #2a3542;
        stroke: #607a8c;
        stroke-width: 1.5;
      }
      .pump.on {
        fill: #1f5c3a;
        stroke: var(--ok);
      }
      .turbine {
        fill: #33404d;
        stroke: var(--warn);
        stroke-width: 2;
      }
      .turbine.tripped {
        stroke: var(--alarm);
      }
      .gen {
        fill: #2a3542;
        stroke: #607a8c;
        stroke-width: 2;
      }
      .gen.on {
        fill: #3a3410;
        stroke: var(--warn);
      }
      .cond,
      .elec {
        fill: #18212b;
        stroke: #4a6072;
        stroke-width: 1.5;
      }
      .pipe {
        fill: none;
        stroke-width: 3;
        stroke-linejoin: round;
      }
      .pipe.hot {
        stroke: #b5462f;
      }
      .pipe.cold {
        stroke: #3f7fb5;
      }
      .pipe.steam {
        stroke: #7f9aab;
      }
      .pipe.feed {
        stroke: #3f8f6f;
      }
      .pipe.elecline {
        stroke: #444;
      }
      .pipe.elecline.hot {
        stroke: var(--ok);
      }
      .flow .pipe.hot,
      .flow .pipe.cold,
      .flow .pipe.steam,
      .flow .pipe.feed {
        stroke-dasharray: 10 8;
        animation: dash 1s linear infinite;
      }
      @keyframes dash {
        to {
          stroke-dashoffset: -18;
        }
      }
      .spin {
        transform-box: fill-box;
        transform-origin: center;
        animation: spin 1.4s linear infinite;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
      text {
        fill: var(--text);
        font-family: var(--mono);
      }
      .lbl {
        font-size: 11px;
        fill: var(--text-dim);
        text-anchor: middle;
      }
      .sub {
        font-size: 10px;
        fill: var(--text-dim);
        text-anchor: middle;
      }
      .tiny {
        font-size: 8px;
        fill: var(--text);
        text-anchor: middle;
      }
      .big {
        font-size: 18px;
        text-anchor: middle;
      }
      .ok {
        fill: var(--ok);
      }
      .bad {
        fill: var(--alarm);
      }
      .legend {
        font-size: 11px;
        margin-top: 8px;
      }
      a {
        cursor: pointer;
      }
    `,
  ],
})
export class OverviewComponent extends ViewBase {
  readonly reactorTripped = computed(() => this.snap()?.controllers.reactor_trip_latched ?? false);
  readonly turbineTripped = computed(() => this.snap()?.controllers.turbine_trip_latched ?? false);
  readonly flowing = computed(() => this.h('primary_flow') > 15 && (this.snap()?.running ?? false));
  readonly pzr = computed(() => Math.max(0, Math.min(100, this.h('pzr_level'))));
  readonly offsite = computed(() => this.snap()?.electrical.offsite_power ?? false);
  readonly genOnline = computed(() => this.snap()?.electrical.generator_online ?? false);
  readonly essBus = computed(() => this.snap()?.electrical.essential_bus_energized ?? false);
  readonly edgRunning = computed(() => {
    const e = this.snap()?.electrical;
    if (!e) return '-';
    return `${e.edg_a_running ? 'A' : '-'}${e.edg_b_running ? 'B' : '-'}`;
  });
  readonly mfwOn = computed(() => (this.snap()?.equipment.mfw_pump ?? [true, true]).some((x) => x));
  readonly mfwCount = computed(() => (this.snap()?.equipment.mfw_pump ?? [true, true]).filter((x) => x).length);

  readonly rcps = computed(() => {
    const on = this.snap()?.equipment.rcp ?? [true, true, true, true];
    const pos = [
      { x: 180, y: 300 },
      { x: 180, y: 350 },
      { x: 330, y: 265 },
      { x: 330, y: 350 },
    ];
    return pos.map((p, i) => ({ i, x: p.x, y: p.y, on: on[i] }));
  });

  readonly sgs = computed(() => [
    { k: 1, y: 90, lvl: Math.max(0, Math.min(100, this.h('sg1_level'))), press: this.h('sg1_pressure') },
    { k: 2, y: 250, lvl: Math.max(0, Math.min(100, this.h('sg2_level'))), press: this.h('sg2_pressure') },
  ]);

  f(v: number, dp: number): string {
    return this.fmt(v, dp);
  }
}
