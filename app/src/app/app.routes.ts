import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'overview' },
  {
    path: 'overview',
    title: 'Plant Overview',
    loadComponent: () => import('./views/overview.component').then((m) => m.OverviewComponent),
  },
  {
    path: 'reactor',
    title: 'Reactor',
    loadComponent: () => import('./views/reactor.component').then((m) => m.ReactorComponent),
  },
  {
    path: 'primary',
    title: 'Primary System',
    loadComponent: () => import('./views/primary.component').then((m) => m.PrimaryComponent),
  },
  {
    path: 'secondary',
    title: 'Secondary / Turbine',
    loadComponent: () => import('./views/secondary.component').then((m) => m.SecondaryComponent),
  },
  {
    path: 'electrical',
    title: 'Electrical',
    loadComponent: () => import('./views/electrical.component').then((m) => m.ElectricalComponent),
  },
  {
    path: 'containment',
    title: 'Containment & Safeguards',
    loadComponent: () =>
      import('./views/containment.component').then((m) => m.ContainmentComponent),
  },
  {
    path: 'alarms',
    title: 'Alarm Console',
    loadComponent: () => import('./views/alarms.component').then((m) => m.AlarmsComponent),
  },
  {
    path: 'trends',
    title: 'Trends',
    loadComponent: () => import('./views/trends.component').then((m) => m.TrendsComponent),
  },
  {
    path: 'safety',
    title: 'Critical Safety Functions',
    loadComponent: () => import('./views/safety.component').then((m) => m.SafetyComponent),
  },
  {
    path: 'scenario',
    title: 'Scenario / Instructor',
    loadComponent: () => import('./views/scenario.component').then((m) => m.ScenarioComponent),
  },
  {
    path: 'eventlog',
    title: 'Event Log',
    loadComponent: () => import('./views/eventlog.component').then((m) => m.EventLogComponent),
  },
  {
    path: 'learn',
    title: 'Educational Mode',
    loadComponent: () => import('./views/learn.component').then((m) => m.LearnComponent),
  },
  { path: '**', redirectTo: 'overview' },
];
