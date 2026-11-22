// 단일 HTML(dist-single/index.html)을 claude.ai 아티팩트 규격에 맞는 파일로 바꾼다.
// 앱 코드는 단일 HTML과 같고, 감싸는 방식만 다르다.
//
// 아티팩트 규격에서 달라지는 점:
// - doctype, html, head, body 태그 없이 내용만 적는다(게시할 때 뼈대가 씌워진다).
// - 보는 사람이 고른 테마가 html의 data-theme 속성으로 온다. 기기 설정과 함께 이 값도 따른다.
// - 뼈대가 안전 영역 여백을 이미 주므로 앱의 위아래 안전 영역 여백은 뺀다. 높이는 100%로 맞춘다.
// - 주소의 # 뒤 경로가 아티팩트 주소와 오가지 않으므로 화면 이동을 메모리에서만 한다.
//
// 쓰는 법: npm run build:single 뒤에 node scripts/make-artifact.mjs

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib.mjs';

const src = join(ROOT, 'dist-single/index.html');
if (!existsSync(src)) {
  console.error('dist-single/index.html 이 없어요. 먼저 npm run build:single 을 실행해 주세요.');
  process.exit(1);
}

const html = readFileSync(src, 'utf8');
const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '점수 해부';
const cssMatch = /<style>([\s\S]*?)<\/style>/.exec(html);
const jsMatch = /<script type="module">([\s\S]*?)<\/script>/.exec(html);
if (!cssMatch || !jsMatch) {
  console.error('단일 HTML에서 스타일이나 스크립트를 찾지 못했어요.');
  process.exit(1);
}

let css = cssMatch[1];
const js = jsMatch[1];

// 어두운 화면 색을 기기 설정과 data-theme 두 가지로 모두 따르게 한다.
const darkRe = /@media \(prefers-color-scheme:\s*dark\)\{:root\{([^}]*)\}\}/;
const dark = darkRe.exec(css);
if (!dark) {
  console.error('스타일에서 어두운 화면 색 블록을 찾지 못했어요.');
  process.exit(1);
}
const darkDecls = `${dark[1].replace(/;$/, '')};color-scheme:dark`;
css = css.replace(darkRe, () => `@media (prefers-color-scheme:dark){:root:not([data-theme=light]){${darkDecls}}}:root[data-theme=dark]{${darkDecls}}`);
if (!css.includes('color-scheme:light dark')) {
  console.error('스타일에서 color-scheme 선언을 찾지 못했어요.');
  process.exit(1);
}
css = css.replace('color-scheme:light dark', 'color-scheme:light');

// 뼈대가 주는 안전 영역 여백과 겹치지 않게 한다.
const overrides = [
  '.app{height:100%}',
  '.top{padding-top:0}',
  '.app--notop .body{padding-top:var(--s6)}',
  '.dock{padding-bottom:0}',
  '.sheet{padding-bottom:0}',
].join('');

const out = [
  `<title>${title}</title>`,
  `<style>${css}</style>`,
  `<style>${overrides}</style>`,
  '<div id="root"></div>',
  '<script>window.__SA_MEMORY_ROUTER__ = true;</script>',
  `<script type="module">${js}</script>`,
  '',
].join('\n');

const dir = join(ROOT, 'release');
mkdirSync(dir, { recursive: true });
const dest = join(dir, 'score-anatomy-artifact.html');
writeFileSync(dest, out);
console.log(`아티팩트용 파일 완성: release/score-anatomy-artifact.html (${Math.round(statSync(dest).size / 1024)} KB)`);
