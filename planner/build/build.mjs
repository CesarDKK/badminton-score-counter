// Bygger planner/tp-bundle.js (mdb-reader + Buffer-polyfill til browseren).
// Køres via Docker som de øvrige node-opgaver, fra mappen planner/:
//   MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD:/app" -w /app node:20-alpine \
//     sh -c "npm install --no-audit --no-fund && npm run build"
// Det færdige bundle committes, så nginx-imaget ikke behøver node.
import * as esbuild from 'esbuild';
import { polyfillNode } from 'esbuild-plugin-polyfill-node';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const her = path.dirname(fileURLToPath(import.meta.url));

await esbuild.build({
    entryPoints: [path.join(her, 'entry.js')],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    minify: true,
    target: ['es2020'],
    outfile: path.join(her, '..', 'tp-bundle.js'),
    plugins: [polyfillNode({ globals: { buffer: true, process: true } })],
    logLimit: 0,
});
console.log('tp-bundle.js bygget');
