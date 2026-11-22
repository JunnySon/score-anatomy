// 10장 7번 가운데 파일 검사: 소스, 문서, 빌드 결과, 커밋 메시지에 금지 문자가 없는지 본다.
// 화면에 그려진 글자는 화면 검사(e2e)에서 따로 본다.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findForbidden, OUT, readText, rel, ROOT, walkTextFiles } from './lib.mjs';

const groups = [
  { name: '소스와 설정', files: walkTextFiles(ROOT, new Set(['node_modules', '.git', 'test-results', 'playwright-report', 'verify-out', 'release', 'dist', 'dist-single', 'docs'])) },
  { name: '문서', files: [...walkTextFiles(join(ROOT, 'docs')), join(ROOT, 'README.md')].filter((f) => existsSync(f)) },
  { name: '빌드 결과(dist)', files: existsSync(join(ROOT, 'dist')) ? walkTextFiles(join(ROOT, 'dist')) : [] },
  { name: '단일 HTML(dist-single)', files: existsSync(join(ROOT, 'dist-single')) ? walkTextFiles(join(ROOT, 'dist-single')) : [] },
];

const result = { groups: [], commits: { count: 0, hits: [] }, missing: [], ok: true };

for (const g of groups) {
  // README.md는 문서 묶음에서만 센다.
  const files = g.name === '소스와 설정' ? g.files.filter((f) => rel(f) !== 'README.md') : g.files;
  const hits = [];
  for (const f of files) {
    for (const h of findForbidden(readText(f))) hits.push({ file: rel(f), ...h });
  }
  result.groups.push({ name: g.name, files: files.length, hits });
  if (hits.length > 0) result.ok = false;
  if (files.length === 0) {
    result.missing.push(g.name);
    result.ok = false;
  }
}

// 커밋 메시지
try {
  const log = execFileSync('git', ['log', '--format=%H%x1f%B%x1e'], { cwd: ROOT, encoding: 'utf8' });
  const commits = log.split('\x1e').map((c) => c.trim()).filter(Boolean);
  result.commits.count = commits.length;
  for (const c of commits) {
    const [hash, body = ''] = c.split('\x1f');
    const hits = findForbidden(body);
    if (hits.length > 0) result.commits.hits.push({ commit: hash.slice(0, 7), hits });
  }
  if (result.commits.hits.length > 0) result.ok = false;
} catch {
  result.commits.count = 0;
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'text.json'), JSON.stringify(result, null, 2));

for (const g of result.groups) {
  console.log(`${g.name}: 파일 ${g.files}개, 금지 문자 ${g.hits.length}곳`);
  for (const h of g.hits.slice(0, 20)) console.log(`  ${h.file}:${h.line} ${h.chars.join(' ')}`);
}
console.log(`커밋 메시지: ${result.commits.count}개, 금지 문자 ${result.commits.hits.length}곳`);
if (result.missing.length > 0) console.log(`검사할 파일이 없는 묶음: ${result.missing.join(', ')}`);
process.exit(result.ok ? 0 : 1);
