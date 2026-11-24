import { rmSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = resolve(root, 'dist');
rmSync(dist, { recursive: true, force: true });
const tsc = resolve(root, 'node_modules/typescript/bin/tsc');
for (const [dir, extra] of [
  ['esm', ['--declaration']],
  ['cjs', ['--module', 'commonjs', '--moduleResolution', 'node10', '--ignoreDeprecations', '5.0']],
]) {
  const out = resolve(dist, dir);
  const run = spawnSync(process.execPath, [tsc, '--project', resolve(root, 'tsconfig.json'),
    '--noEmit', 'false', '--outDir', out, ...extra], { stdio: 'inherit' });
  if (run.status !== 0) process.exit(run.status ?? 1);
  mkdirSync(out, { recursive: true });
  if (dir === 'esm') copyFileSync(resolve(root, 'src/types.d.ts'), resolve(out, 'types.d.ts'));
}
writeFileSync(resolve(dist, 'cjs/package.json'), '{"type":"commonjs"}\n');
