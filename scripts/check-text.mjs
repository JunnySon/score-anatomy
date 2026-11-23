// 10장 7번 가운데 파일 검사: 소스, 문서, 빌드 결과, 커밋 메시지에 금지 문자가 없는지 본다.
// 화면에 그려진 글자는 화면 검사(e2e)에서 따로 본다.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findForbidden, OUT, readText, rel, ROOT, walkTextFiles } from './lib.mjs';

const groups = [
  { name: '소스와 설정', files: walkTextFiles(ROOT, new Set(['node_modules', '.git', 'test-results', 'playwright-report', 'verify-out', 'release', 'dist', 'dist-single', 'docs', 'Web'])) },
  { name: '문서', files: [...walkTextFiles(join(ROOT, 'docs')), join(ROOT, 'README.md')].filter((f) => existsSync(f)) },
  { name: '빌드 결과(dist)', files: existsSync(join(ROOT, 'dist')) ? walkTextFiles(join(ROOT, 'dist')) : [] },
  { name: '단일 HTML(dist-single)', files: existsSync(join(ROOT, 'dist-single')) ? walkTextFiles(join(ROOT, 'dist-single')) : [] },
  // 전달용 파일(아티팩트용 파일, 단일 HTML 사본). 압축 파일은 이진 파일이라 여기서 보지 않는다.
  { name: '전달용 파일(release)', optional: true, files: existsSync(join(ROOT, 'release')) ? walkTextFiles(join(ROOT, 'release'), new Set()) : [] },
  // 앱용 묶음(아이폰 앱 껍데기에 싣는 단일 HTML 두 가지와 manifest.json). 소스와 설정 묶음에서는 빼고 여기서 센다.
  { name: '앱용 묶음(ios/ScoreAnatomy/Web)', files: existsSync(join(ROOT, 'ios/ScoreAnatomy/Web')) ? walkTextFiles(join(ROOT, 'ios/ScoreAnatomy/Web'), new Set()) : [] },
];

const result = { groups: [], commits: { count: 0, hits: [], checked: false }, missing: [], ok: true };

for (const g of groups) {
  // README.md는 문서 묶음에서만 센다.
  const files = g.name === '소스와 설정' ? g.files.filter((f) => rel(f) !== 'README.md') : g.files;
  const hits = [];
  for (const f of files) {
    for (const h of findForbidden(readText(f))) hits.push({ file: rel(f), ...h });
  }
  result.groups.push({ name: g.name, files: files.length, hits });
  if (hits.length > 0) result.ok = false;
  if (files.length === 0 && !g.optional) {
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
  result.commits.checked = true;
  if (result.commits.hits.length > 0) result.ok = false;
} catch {
  // 저장소(.git)가 있는데 커밋 메시지를 읽지 못했으면 검사하지 못한 것이므로 통과시키지 않는다.
  result.commits.count = 0;
  if (existsSync(join(ROOT, '.git'))) result.ok = false;
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'text.json'), JSON.stringify(result, null, 2));

for (const g of result.groups) {
  console.log(`${g.name}: 파일 ${g.files}개, 금지 문자 ${g.hits.length}곳`);
  for (const h of g.hits.slice(0, 20)) console.log(`  ${h.file}:${h.line} ${h.chars.join(' ')}`);
}
console.log(
  result.commits.checked
    ? `커밋 메시지: ${result.commits.count}개, 금지 문자 ${result.commits.hits.length}곳`
    : '커밋 메시지: 읽지 못했어요(git 저장소가 아니거나 git을 실행하지 못함)',
);
if (result.missing.length > 0) console.log(`검사할 파일이 없는 묶음: ${result.missing.join(', ')}`);
process.exit(result.ok ? 0 : 1);
