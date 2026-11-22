// 단일 HTML 빌드의 마무리 단계.
// vite build --mode single 이 만든 dist-single 의 JS와 CSS를 index.html 안에 넣어 파일 1개로 만든다.
// 이 빌드는 시스템 글꼴만 쓰므로 글꼴 파일이 없다.

import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist-single');
const htmlPath = join(outDir, 'index.html');

if (!existsSync(htmlPath)) {
  console.error('dist-single/index.html 이 없어요. 먼저 vite build --mode single 을 실행해 주세요.');
  process.exit(1);
}

let html = readFileSync(htmlPath, 'utf8');
const readAsset = (ref) => readFileSync(join(outDir, ref.replace(/^\.\//, '')), 'utf8');

// 미리 불러오기 표시는 파일이 없어지므로 지운다.
html = html.replace(/\s*<link rel="modulepreload"[^>]*>/g, '');

// 외부 CSS 파일을 style 태그로 바꾼다.
html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_m, ref) => {
  const css = readAsset(ref).replace(/<\/style/gi, '<\\/style');
  return `<style>${css}</style>`;
});

// 외부 JS 파일을 인라인 모듈 스크립트로 바꾼다.
html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g, (_m, ref) => {
  const js = readAsset(ref).replace(/<\/script/gi, '<\\/script');
  return `<script type="module">${js}</script>`;
});

const leftover = html.match(/(?:src|href)="\.\/assets\/[^"]+"/g);
if (leftover) {
  console.error('파일 안에 넣지 못한 자산이 있어요:', leftover.join(', '));
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
