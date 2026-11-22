// 10장 8번: 색 대비 계산.
// 글자와 바탕 조합은 4.5:1 이상, 입력 테두리와 그래프 윤곽은 3:1 이상(밝은 화면과 어두운 화면 모두).
// 색 값은 src/styles/tokens.css 에서 읽는다.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT, readText, ROOT } from './lib.mjs';

const css = readText(join(ROOT, 'src/styles/tokens.css'));

function readVars(block) {
  const vars = {};
  for (const m of block.matchAll(/--([a-z-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)) vars[m[1]] = m[2].toUpperCase();
  return vars;
}

const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
if (darkStart < 0) {
  console.error('tokens.css 에서 어두운 화면 색을 찾지 못했어요.');
  process.exit(1);
}
const themes = { '밝은 화면': readVars(css.slice(0, darkStart)), '어두운 화면': readVars(css.slice(darkStart)) };

function luminance(hex) {
  const f = (v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}

export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// [앞 색, 바탕 색, 쓰임, 기준]
const PAIRS = [
  ['text', 'bg', '본문 글자와 배경', 4.5],
  ['text', 'surface', '본문 글자와 표면', 4.5],
  ['text-sub', 'bg', '보조 글자와 배경', 4.5],
  ['text-sub', 'surface', '보조 글자와 표면', 4.5],
  ['accent', 'bg', '포인트색 글자(글자 버튼, 링크)와 배경', 4.5],
  ['accent', 'surface', '포인트색 글자와 표면', 4.5],
  ['on-accent', 'accent', '포인트 위 글자(주 버튼)', 4.5],
  ['ok', 'bg', '정답 표식 글자와 배경', 4.5],
  ['ok', 'surface', '정답 표식 글자와 표면', 4.5],
  ['bad', 'bg', '오답 표식 글자와 배경', 4.5],
  ['bad', 'surface', '오답 표식 글자와 표면', 4.5],
  ['warn', 'bg', '경고 글자(미입력)와 배경', 4.5],
  ['warn', 'surface', '경고 글자와 표면', 4.5],
  ['outline', 'bg', '입력 테두리, 그래프 윤곽과 배경', 3],
  ['outline', 'surface', '입력 테두리, 그래프 윤곽과 표면', 3],
  ['accent', 'bg', '고른 칸 테두리, 초점 표시와 배경', 3],
  ['accent', 'surface', '고른 칸 테두리와 표면', 3],
  ['text', 'bg', '표시 칸 윤곽(고민, 찍음)과 배경', 3],
  ['text', 'surface', '표시 칸 윤곽과 표면', 3],
  ['warn', 'bg', '미입력 칸 테두리와 배경', 3],
  ['warn', 'surface', '안내문 왼쪽 띠와 표면', 3],
];

const rows = [];
let ok = true;
for (const [theme, vars] of Object.entries(themes)) {
  for (const [fg, bg, use, min] of PAIRS) {
    if (!vars[fg] || !vars[bg]) {
      console.error(`${theme}: --${fg} 또는 --${bg} 색이 없어요.`);
      ok = false;
      continue;
    }
    const ratio = Math.floor(contrast(vars[fg], vars[bg]) * 100) / 100;
    const pass = ratio >= min;
    if (!pass) ok = false;
    rows.push({ theme, use, fg: vars[fg], bg: vars[bg], ratio, min, pass });
  }
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'contrast.json'), JSON.stringify({ ok, themes, rows }, null, 2));

for (const r of rows) console.log(`${r.pass ? '통과' : '실패'}  ${r.theme}  ${r.use}  ${r.fg} / ${r.bg}  ${r.ratio.toFixed(2)}:1 (기준 ${r.min}:1)`);
const worst = (min) => rows.filter((r) => r.min === min).reduce((a, b) => (a.ratio < b.ratio ? a : b));
console.log(`글자 조합 최저 ${worst(4.5).ratio.toFixed(2)}:1, 테두리와 윤곽 최저 ${worst(3).ratio.toFixed(2)}:1`);
process.exit(ok ? 0 : 1);
