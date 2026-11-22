// 검증 스크립트 공통 도구.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = join(ROOT, 'verify-out');

// 금지 문자: 줄표(U+2014, U+2013)와 가운뎃점(U+00B7, U+318D, U+30FB, U+2027).
// 이 파일에도 그 문자를 직접 적지 않고 코드 값으로만 적는다.
export const FORBIDDEN = [0x2014, 0x2013, 0x00b7, 0x318d, 0x30fb, 0x2027];
export const FORBIDDEN_RE = new RegExp(`[${FORBIDDEN.map((c) => `\\u${c.toString(16).padStart(4, '0')}`).join('')}]`, 'g');

export function codeName(ch) {
  return `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
}

/** 글자에서 금지 문자를 찾는다. 줄 번호와 문자 코드를 돌려준다. */
export function findForbidden(text) {
  const hits = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const m = line.match(FORBIDDEN_RE);
    if (m) hits.push({ line: i + 1, chars: [...new Set(m.map(codeName))] });
  });
  return hits;
}

const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx', '.json', '.css', '.html', '.md', '.txt', '.svg', '.yml', '.yaml', '.csv', '']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'test-results', 'playwright-report', 'verify-out', 'release']);

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i <= 0 ? '' : name.slice(i).toLowerCase();
}

/** 폴더 아래의 글자 파일을 모두 찾는다. 글꼴과 그림 같은 이진 파일은 뺀다. */
export function walkTextFiles(dir, skipDirs = SKIP_DIRS) {
  const out = [];
  const visit = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (!skipDirs.has(name)) visit(full);
      } else if (TEXT_EXT.has(extOf(name))) {
        out.push(full);
      }
    }
  };
  visit(dir);
  return out;
}

export function rel(path) {
  return relative(ROOT, path).split('\\').join('/');
}

export function readText(path) {
  return readFileSync(path, 'utf8');
}
