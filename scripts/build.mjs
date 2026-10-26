import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist', 'renderer');

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/renderer/app.js')],
  outfile: path.join(outDir, 'app.bundle.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome130'],
  minify: false,
  sourcemap: false,
  legalComments: 'none',
});

await cp(path.join(root, 'src/renderer/index.html'), path.join(outDir, 'index.html'));
await cp(path.join(root, 'src/renderer/styles.css'), path.join(outDir, 'styles.css'));

if (process.argv.includes('--watch')) {
  const { context } = await import('esbuild');
  const ctx = await context({
    entryPoints: [path.join(root, 'src/renderer/app.js')],
    outfile: path.join(outDir, 'app.bundle.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome130'],
    sourcemap: true,
    logLevel: 'info',
  });
  await ctx.watch();
  console.log('Watch mode: watching app.js for changes.');
} else {
  console.log('Build complete: dist/renderer');
}
