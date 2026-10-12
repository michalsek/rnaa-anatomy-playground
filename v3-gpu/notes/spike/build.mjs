// node build.mjs <entry.ts> <out.html> [--plugin]   → single standalone HTML with the bundle inlined
import * as esbuild from 'esbuild';
import { writeFileSync } from 'node:fs';
const [entry, out] = process.argv.slice(2);
const plugins = [];
if (process.argv.includes('--plugin')) plugins.push((await import('unplugin-typegpu/esbuild')).default({}));
const result = await esbuild.build({
  entryPoints: [entry], bundle: true, minify: true, format: 'iife', target: 'es2022',
  write: false, metafile: true, legalComments: 'none', plugins,
});
const js = result.outputFiles[0].text;
const html = `<!doctype html><html><head><meta charset="utf-8"><title>TypeGPU spike</title>
<style>html,body{margin:0;background:#fff}canvas{display:block;width:800px;height:600px}</style></head>
<body><canvas></canvas><script>${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
writeFileSync(out, html);
writeFileSync(out.replace(/\.html$/, '.js'), js);
console.log(`${out}: bundle ${js.length} B minified`);
