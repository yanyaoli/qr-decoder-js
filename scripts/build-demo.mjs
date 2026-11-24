import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(root, 'dist-demo');
rmSync(output, { recursive: true, force: true });
mkdirSync(resolve(output, 'dist'), { recursive: true });
cpSync(resolve(root, 'index.html'), resolve(output, 'index.html'));
cpSync(resolve(root, 'demo.js'), resolve(output, 'demo.js'));
cpSync(resolve(root, 'dist/esm'), resolve(output, 'dist/esm'), { recursive: true });
