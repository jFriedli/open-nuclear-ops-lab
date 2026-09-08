// Builds the Rust simulation engine to WASM and places the artefacts where the
// Angular build and the sim worker expect them:
//   app/src/wasm/          — JS bindings + .d.ts imported by the worker
//   app/public/            — the .wasm binary, served next to the worker bundle
//
// Run from the `app/` directory:  node scripts/build-wasm.mjs

import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..');
const repoDir = resolve(appDir, '..');
const engineDir = resolve(repoDir, 'engine');
const outDir = resolve(appDir, 'src/wasm');
const publicDir = resolve(appDir, 'public');

console.log('› wasm-pack build (release, target web)…');
execSync(`wasm-pack build --release --target web --out-dir "${outDir}" --out-name nol_engine`, {
  cwd: engineDir,
  stdio: 'inherit',
});

mkdirSync(publicDir, { recursive: true });
copyFileSync(resolve(outDir, 'nol_engine_bg.wasm'), resolve(publicDir, 'nol_engine_bg.wasm'));
// wasm-pack drops files we do not want tracked; keep the wasm dir minimal.
for (const f of ['.gitignore', 'package.json', 'README.md', 'LICENSE']) {
  try {
    rmSync(resolve(outDir, f));
  } catch {
    /* not present */
  }
}
console.log('✓ copied nol_engine_bg.wasm → app/public/');
