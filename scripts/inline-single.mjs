// 단일 HTML 빌드의 마무리 단계.
// vite build --mode single 이 만든 dist-single 의 JS와 CSS를 index.html 안에 넣어 파일 1개로 만든다(scripts/inline.mjs).
// 이 빌드는 시스템 글꼴만 쓰므로 글꼴 파일이 없다.

import { readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inlineDir } from './inline.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist-single');
const htmlPath = join(outDir, 'index.html');

let html;
try {
  html = inlineDir(outDir);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}

writeFileSync(htmlPath, html);
rmSync(join(outDir, 'assets'), { recursive: true, force: true });

const files = readdirSync(outDir);
if (files.length !== 1 || files[0] !== 'index.html') {
  console.error('dist-single 에 index.html 말고 다른 파일이 남아 있어요:', files.join(', '));
  process.exit(1);
}
const kb = Math.round(statSync(htmlPath).size / 1024);
console.log(`단일 HTML 완성: dist-single/index.html (${kb} KB)`);
