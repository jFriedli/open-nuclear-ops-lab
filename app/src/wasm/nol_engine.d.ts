/* tslint:disable */
/* eslint-disable */

export class Engine {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Apply an operator action (JSON). Returns a JSON `{ok, reason}`.
     */
    action(json: string): string;
    /**
     * Export the current run as a self-contained replayable session (JSON).
     */
    export_session(): string;
    /**
     * Replace the running scenario. Returns a JSON `{ok, reason}`.
     */
    load_scenario(json: string): string;
    /**
     * Load a session export and deterministically replay it. Returns
     * `{ok, reason}` JSON.
     */
    load_session(json: string): string;
    /**
     * Create an engine from a scenario JSON string. Pass `"baseline"` (or an
     * empty string) for the default stable full-power scenario.
     */
    constructor(scenario_json: string, seed: number);
    reset(): void;
    set_debug(on: boolean): void;
    set_running(running: boolean): void;
    set_speed(speed: number): void;
    /**
     * Full HMI snapshot as JSON.
     */
    snapshot(): string;
    /**
     * Advance the simulation by `n` fixed physics timesteps (DT seconds each).
     */
    step(n: number): void;
    /**
     * Physics timestep in seconds.
     */
    readonly dt: number;
    readonly simTime: number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_engine_free: (a: number, b: number) => void;
    readonly engine_action: (a: number, b: number, c: number) => [number, number];
    readonly engine_dt: (a: number) => number;
    readonly engine_export_session: (a: number) => [number, number];
    readonly engine_load_scenario: (a: number, b: number, c: number) => [number, number];
    readonly engine_load_session: (a: number, b: number, c: number) => [number, number];
    readonly engine_new: (a: number, b: number, c: number) => [number, number, number];
    readonly engine_reset: (a: number) => void;
    readonly engine_set_debug: (a: number, b: number) => void;
    readonly engine_set_running: (a: number, b: number) => void;
    readonly engine_set_speed: (a: number, b: number) => void;
    readonly engine_simTime: (a: number) => number;
    readonly engine_snapshot: (a: number) => [number, number];
    readonly engine_step: (a: number, b: number) => void;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
