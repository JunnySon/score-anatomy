// npm run verify
// 작업 지시서 10장의 자동 검증을 전부 실행하고 결과를 docs/검증결과.md 에 남긴다.
// 실행해서 확인한 수치만 적는다.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { findForbidden, OUT, ROOT } from './lib.mjs';

const require = createRequire(import.meta.url);
const isWin = process.platform === 'win32';
const npx = isWin ? 'npx.cmd' : 'npx';
const npm = isWin ? 'npm.cmd' : 'npm';
const started = Date.now();

function run(label, cmd, args) {
  console.log(`\n=== ${label} ===`);
  const t = Date.now();
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, FORCE_COLOR: '0' } });
  const ok = r.status === 0;
  console.log(`--- ${label}: ${ok ? '통과' : '실패'} (${((Date.now() - t) / 1000).toFixed(1)}초)`);
  return { ok, seconds: (Date.now() - t) / 1000 };
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function pngCount(dir) {
  const full = join(ROOT, 'docs/screens', dir);
  if (!existsSync(full)) return 0;
  return readdirSync(full).filter((f) => f.endsWith('.png') && statSync(join(full, f)).size > 0).length;
}

// 0. 이전 결과를 지운다.
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
rmSync(join(ROOT, 'docs/screens'), { recursive: true, force: true });

// 1. 단위 테스트
const unitRun = run('1. 단위 테스트', npx, ['vitest', 'run', '--reporter=default', '--reporter=json', `--outputFile.json=${join(OUT, 'unit.json')}`]);

// 빌드(타입 검사 포함)와 단일 HTML
const buildRun = run('빌드', npm, ['run', 'build']);
const singleRun = run('단일 HTML 빌드', npm, ['run', 'build:single']);

// 8. 색 대비 계산
const contrastRun = run('8. 색 대비 계산', process.execPath, [join(ROOT, 'scripts/check-contrast.mjs')]);

// 2, 3, 4, 5, 6, 7(화면), 9, 10. 브라우저로 화면 검사
const e2eRun = buildRun.ok && singleRun.ok ? run('2~10. 화면 검사', npx, ['playwright', 'test', '--trace', 'off']) : { ok: false, seconds: 0 };

// ---------- 결과 모으기 ----------
const unit = readJson(join(OUT, 'unit.json'));
const contrast = readJson(join(OUT, 'contrast.json'));
const e2e = readJson(join(OUT, 'e2e.json'));
const metrics = existsSync(join(OUT, 'metrics.jsonl'))
  ? readFileSync(join(OUT, 'metrics.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
  : [];

const tests = [];
function walk(suite, path) {
  for (const s of suite.suites ?? []) walk(s, s.title && !s.title.endsWith('.ts') ? [...path, s.title] : path);
  for (const spec of suite.specs ?? []) {
    const results = spec.tests.flatMap((t) => t.results);
    tests.push({
      file: spec.file,
      title: [...path, spec.title].join(' > '),
      ok: spec.ok,
      ms: results.reduce((s, r) => s + (r.duration ?? 0), 0),
    });
  }
}
if (e2e) for (const s of e2e.suites ?? []) walk(s, []);
const byFile = (name) => tests.filter((t) => t.file.endsWith(name));
const allOk = (list) => list.length > 0 && list.every((t) => t.ok);

const audits = metrics.filter((m) => m.kind === 'audit');
const net = metrics.filter((m) => m.kind === 'network');
const leaks = metrics.filter((m) => m.kind === 'leak');
const leakControls = metrics.filter((m) => m.kind === 'leak-control');
const flows = metrics.filter((m) => m.kind === 'flow');
const small = metrics.filter((m) => m.kind === 'small');
const tours = metrics.filter((m) => m.kind === 'tour');
const single = metrics.find((m) => m.kind === 'single') ?? null;

const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);
const min = (list, f) => (list.length > 0 ? Math.min(...list.map(f)) : null);
const max = (list, f) => (list.length > 0 ? Math.max(...list.map(f)) : null);
const count = (list, f) => sum(list, (x) => f(x).length);
const withTargets = audits.filter((a) => a.targetCount > 0);
const withGap = audits.filter((a) => a.minGap !== null);
const smallAudits = audits.filter((a) => a.run === 'light-360x640' || a.run === 'small-keypad' || a.run === 'small-rows');
const fitAudits = smallAudits.filter((a) => a.mustFit);

const text = readJson(join(OUT, 'text.json'));

// ---------- 항목별 판정 ----------
const unitOk = unitRun.ok && unit !== null && unit.numFailedTests === 0 && unit.numTotalTests > 0;
const flowTests = byFile('flow.spec.ts');
const flowOk = allOk(flowTests) && flowTests.length === 4 && flows.length === 4;
const smallTests = [...byFile('small.spec.ts'), ...tests.filter((t) => t.title.includes('360x640'))];
const smallOk =
  allOk(smallTests) &&
  smallAudits.length > 0 &&
  count(smallAudits, (a) => a.overlaps) === 0 &&
  count(smallAudits, (a) => a.obscured) === 0 &&
  count(fitAudits, (a) => a.outside) === 0 &&
  fitAudits.every((a) => !a.scrolls);
const fontOk = audits.length > 0 && count(audits, (a) => a.smallText) === 0 && min(audits, (a) => a.minFont) >= 13;
const targetOk = withTargets.length > 0 && count(audits, (a) => a.smallTargets) === 0 && min(withTargets, (a) => Math.min(a.minTargetW, a.minTargetH)) >= 47.5;
const netOk = net.length > 0 && count(net, (n) => n.external) === 0 && (single ? single.external === 0 : false);
const screenTextOk = audits.length > 0 && count(audits, (a) => a.forbidden) === 0 && count(audits, (a) => a.exclamation) === 0 && count(audits, (a) => a.emoji) === 0;
const renderedContrastOk = audits.length > 0 && count(audits, (a) => a.lowContrast) === 0;
const contrastOk = contrastRun.ok && contrast !== null && contrast.ok && renderedContrastOk;
const leakOk = leaks.length > 0 && count(leaks, (l) => l.leaks) === 0 && leakControls.length > 0 && leakControls.every((c) => c.caught27 > 0 && c.caught15 > 0);
const shots = { light: pngCount('light'), dark: pngCount('dark'), small: pngCount('small') };
const expectedShots = tours.find((t) => t.shots > 0)?.shots ?? 0;
const shotsOk = expectedShots > 0 && shots.light === expectedShots && shots.dark === expectedShots;

// ---------- 보고서 ----------
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())} (${zone})`;
const mark = (ok) => (ok ? '통과' : '실패');
const ver = (name) => {
  try {
    return require(join(ROOT, 'node_modules', name, 'package.json')).version;
  } catch {
    return '확인 못 함';
  }
};
let browserVersion = '확인 못 함';
try {
  const out = spawnSync(process.execPath, ['-e', "require('@playwright/test').chromium.launch().then(async (b) => { console.log(b.version()); await b.close(); })"], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (out.status === 0) browserVersion = out.stdout.trim();
} catch {
  browserVersion = '확인 못 함';
}

const L = [];
const say = (s = '') => L.push(s);

function buildReport(textOk, textResult) {
  L.length = 0;
  const items = [
    ['1', '단위 테스트', unitOk, unit ? `${unit.numTotalTests}개 가운데 ${unit.numPassedTests}개 통과, 실패 ${unit.numFailedTests}개` : '결과 파일 없음'],
    [
      '2',
      '화면 흐름(390x844)',
      flowOk,
      `흐름 ${flowTests.length}개 가운데 ${flowTests.filter((t) => t.ok).length}개 통과(시험 A 키패드, 시험 A 5행, 시험 B, 시험 C). 점수 해부의 78, 7점, 8점, 3~7점, 약 75점, 6~10점 확인`,
    ],
    [
      '3',
      '작은 화면(360x640)',
      smallOk,
      `화면 상태 ${smallAudits.length}개 검사(스크롤 없이 들어와야 하는 답 입력 상태 ${fitAudits.length}개 포함). 겹침 ${count(smallAudits, (a) => a.overlaps)}곳, 가려짐 ${count(smallAudits, (a) => a.obscured)}곳, 답 입력 화면에서 화면 밖 ${count(fitAudits, (a) => a.outside)}곳, 스크롤 생김 ${fitAudits.filter((a) => a.scrolls).length}곳`,
    ],
    ['4', '글자 크기 13px 이상', fontOk, `화면 상태 ${audits.length}개에서 보이는 글자 ${sum(audits, (a) => a.textCount)}개 검사. 가장 작은 글자 ${min(audits, (a) => a.minFont)}px, 13px 미만 ${count(audits, (a) => a.smallText)}개`],
    [
      '5',
      '터치 영역 48x48px 이상',
      targetOk,
      `조작 요소 ${sum(audits, (a) => a.targetCount)}개 검사. 가장 작은 폭 ${min(withTargets, (a) => a.minTargetW)}px, 가장 작은 높이 ${min(withTargets, (a) => a.minTargetH)}px, 48px 미만 ${count(audits, (a) => a.smallTargets)}개. 예외 없음`,
    ],
    [
      '6',
      '외부 요청 0건',
      netOk,
      `테스트 ${net.length}개에서 요청 ${sum(net, (n) => n.total)}건 관찰, 자기 주소 밖 ${count(net, (n) => n.external)}건. 단일 HTML은 요청 ${single ? single.requests : '?'}건(파일 자신뿐), 밖으로 ${single ? single.external : '?'}건`,
    ],
    [
      '7',
      '금지 문자, 느낌표, 이모지',
      textOk && screenTextOk,
      textResult
        ? `${textResult.groups.map((g) => `${g.name} ${g.files}개에서 ${g.hits.length}곳`).join(', ')}, 커밋 메시지 ${textResult.commits.count}개에서 ${textResult.commits.hits.length}곳. 그려진 화면 상태 ${audits.length}개에서 금지 문자 ${count(audits, (a) => a.forbidden)}, 느낌표 ${count(audits, (a) => a.exclamation)}, 이모지 ${count(audits, (a) => a.emoji)}`
        : '결과 파일 없음',
    ],
    [
      '8',
      '색 대비',
      contrastOk,
      contrast
        ? `색 값 계산: 글자 조합 최저 ${min(contrast.rows.filter((r) => r.min === 4.5), (r) => r.ratio).toFixed(2)}:1(기준 4.5:1), 테두리와 윤곽 최저 ${min(contrast.rows.filter((r) => r.min === 3), (r) => r.ratio).toFixed(2)}:1(기준 3:1), 조합 ${contrast.rows.length}개 가운데 실패 ${contrast.rows.filter((r) => !r.pass).length}개. 그려진 글자 ${sum(audits, (a) => a.contrastCount)}개의 실제 대비 최저 ${min(audits.filter((a) => a.contrastCount > 0), (a) => a.minContrast)}:1, 4.5:1 미만 ${count(audits, (a) => a.lowContrast)}개`
        : '결과 파일 없음',
    ],
    [
      '9',
      '정답 노출',
      leakOk,
      `"정답 보기"를 누르기 전 상태를 ${leaks.length}번 검사, 노출 ${count(leaks, (l) => l.leaks)}건. 대조 검사 ${leakControls.length}번 모두에서 정답을 연 뒤에는 검사기가 노출을 잡아냄`,
    ],
    ['10', '화면 캡처', shotsOk, `밝은 화면 ${shots.light}장, 어두운 화면 ${shots.dark}장(390x844, 2배 해상도), 작은 화면 ${shots.small}장(360x640). 기대한 장수는 화면마다 ${expectedShots}장`],
  ];
  const failed = items.filter((i) => !i[2]);
  const otherFailed = tests.filter((t) => !t.ok);

  say('# 검증 결과');
  say();
  say(failed.length === 0 && otherFailed.length === 0 ? '결론: 10장의 자동 검증 10개 항목이 모두 통과했어요.' : `결론: 실패한 항목이 있어요. 항목 ${failed.length}개, 테스트 ${otherFailed.length}개.`);
  say();
  say('이 문서는 `npm run verify`가 실행할 때마다 새로 써요. 손으로 고치지 않아요.');
  say('수치는 모두 이번 실행에서 실제로 잰 값이에요.');
  say();
  say(`- 실행 시각: ${stamp}`);
  say(`- 걸린 시간: ${Math.round((Date.now() - started) / 1000)}초`);
  say(`- 환경: Node ${process.version}, Vite ${ver('vite')}, React ${ver('react')}, Vitest ${ver('vitest')}, Playwright ${ver('@playwright/test')}, Chromium ${browserVersion}(화면 없이 실행), ${process.platform}`);
  say('- 브라우저: Chromium 하나로만 검사했어요. 실제 아이폰 Safari와 안드로이드 Chrome 기기에서는 확인하지 못했어요.');
  say();
  say('## 항목별 결과');
  say();
  say('| 번호 | 항목 | 결과 | 실제 수치 |');
  say('| --- | --- | --- | --- |');
  for (const [no, name, ok, detail] of items) say(`| ${no} | ${name} | ${mark(ok)} | ${detail} |`);
  say();
  if (failed.length > 0 || otherFailed.length > 0) {
    say('## 실패한 것');
    say();
    for (const [no, name] of failed) say(`- ${no}번 ${name}`);
    for (const t of otherFailed) say(`- 테스트: ${t.title}`);
    say();
  }

  say('## 1. 단위 테스트');
  say();
  if (unit) {
    say('| 파일 | 테스트 수 | 실패 |');
    say('| --- | --- | --- |');
    for (const f of unit.testResults) {
      const name = f.name.replace(ROOT, '').replace(/^[\\/]/, '').split('\\').join('/');
      say(`| ${name} | ${f.assertionResults.length} | ${f.assertionResults.filter((a) => a.status !== 'passed').length} |`);
    }
    say();
    say('7장 검산 예시의 기대값(실제 78점, 맞힌 문항 24개, 추측 표시 정답 7점, 찍음 전체 배점 18점, 찍기 운을 평균으로 본 점수 74.6, 실수 표시 오답 8점, 그 외 오답 14점, 등급별 남은 점수, 계단 3개)과');
    say('추가 경우(표시 없음, 전부 정답, 전부 안 풂, 컷 범위 안, 컷 범위 위, 컷 자료 없음, 확정 컷, 섞인 배열 시험 B)는 src/logic/scoring.test.ts 에 있어요.');
    say();
  }

  say('## 2. 화면 흐름과 그 밖의 화면 테스트');
  say();
  say('| 테스트 | 결과 | 걸린 시간 |');
  say('| --- | --- | --- |');
  for (const t of tests) say(`| ${t.title} | ${mark(t.ok)} | ${(t.ms / 1000).toFixed(1)}초 |`);
  say();
  say(`테스트 ${tests.length}개 가운데 ${tests.filter((t) => t.ok).length}개 통과.`);
  say();

  say('## 3, 4, 5. 화면 상태별 검사');
  say();
  say('화면 상태마다 브라우저가 실제로 그린 결과를 읽어서 검사했어요.');
  say();
  say('| 검사 묶음 | 화면 상태 | 가장 작은 글자 | 가장 작은 터치 영역 | 요소 사이 최소 간격 | 겹침 | 가려짐 | 진한 색 면적 최대 |');
  say('| --- | --- | --- | --- | --- | --- | --- | --- |');
  const runs = [...new Set(audits.map((a) => a.run))];
  for (const id of runs) {
    const list = audits.filter((a) => a.run === id);
    const wt = list.filter((a) => a.targetCount > 0);
    const wg = list.filter((a) => a.minGap !== null);
    say(
      `| ${id} | ${list.length}개 | ${min(list, (a) => a.minFont)}px | ${wt.length ? `${min(wt, (a) => a.minTargetW)}x${min(wt, (a) => a.minTargetH)}px` : '없음'} | ${wg.length ? `${min(wg, (a) => a.minGap)}px` : '없음'} | ${count(list, (a) => a.overlaps)} | ${count(list, (a) => a.obscured)} | ${(max(list, (a) => a.accentRatio) * 100).toFixed(1)}% |`,
    );
  }
  say();
  say(`- 요소 사이 간격: 같은 스크롤 영역 안에서 온전히 보이는 조작 요소끼리 쟀어요. 8px 미만 ${count(audits, (a) => a.tightGaps)}곳, 전체 최소 ${withGap.length ? min(withGap, (a) => a.minGap) : '없음'}px.`);
  say(`- 주 숫자(56px)는 화면마다 최대 ${max(audits, (a) => a.heroCount)}개, 주 버튼은 화면마다 최대 ${max(audits, (a) => a.primaryCount)}개였어요.`);
  say(`- 진한 색 면적은 포인트색으로 칠한 면의 넓이를 화면 넓이로 나눈 값이에요. 가장 큰 화면이 ${(max(audits, (a) => a.accentRatio) * 100).toFixed(1)}%였어요(기준 10% 이하).`);
  say(`- 작은 화면 답 입력: 키패드 방식 ${small.find((s) => s.mode === 'keypad')?.checked ?? 0}개 상태, 5행 방식 ${small.find((s) => s.mode === 'rows')?.checked ?? 0}개 상태를 따로 검사했어요.`);
  say();

  say('## 6. 외부 요청');
  say();
  say(`테스트마다 브라우저가 보낸 요청을 모두 기록했어요. 요청 ${sum(net, (n) => n.total)}건이 전부 앱을 연 주소 안으로 갔고, 밖으로 나간 요청은 ${count(net, (n) => n.external)}건이에요.`);
  say('글꼴(Pretendard dynamic subset)과 스크립트는 프로젝트 안에 실려 있어요. 서비스 워커는 등록하지 않아요.');
  if (single) say(`단일 HTML 파일(${Math.round(single.bytes / 1024)} KB)은 파일 자신 말고는 아무것도 읽지 않았어요(요청 ${single.requests}건).`);
  say();

  say('## 7. 금지 문자');
  say();
  say('찾는 문자: U+2014, U+2013, U+00B7, U+318D, U+30FB, U+2027. 화면 문구에서는 느낌표와 이모지도 찾아요.');
  say();
  if (textResult) {
    say('| 대상 | 검사한 수 | 찾은 곳 |');
    say('| --- | --- | --- |');
    for (const g of textResult.groups) say(`| ${g.name} | 파일 ${g.files}개 | ${g.hits.length} |`);
    say(`| 커밋 메시지 | ${textResult.commits.count}개 | ${textResult.commits.hits.length} |`);
    say(`| 화면에 그려진 글자와 접근성 라벨 | 화면 상태 ${audits.length}개 | ${count(audits, (a) => a.forbidden)} |`);
    say(`| 화면의 느낌표 | 화면 상태 ${audits.length}개 | ${count(audits, (a) => a.exclamation)} |`);
    say(`| 화면의 이모지 | 화면 상태 ${audits.length}개 | ${count(audits, (a) => a.emoji)} |`);
    say();
    for (const g of textResult.groups) for (const h of g.hits) say(`- ${h.file} ${h.line}번째 줄: ${h.chars.join(', ')}`);
  }
  say('문구 파일(src/strings.ts)의 모든 문구는 단위 테스트(src/strings.test.ts)에서도 같은 검사를 해요.');
  say();

  say('## 8. 색 대비');
  say();
  if (contrast) {
    say('색 값(src/styles/tokens.css)으로 계산한 대비예요.');
    say();
    say('| 화면 | 쓰임 | 앞 색 | 바탕 색 | 대비 | 기준 | 결과 |');
    say('| --- | --- | --- | --- | --- | --- | --- |');
    for (const r of contrast.rows) say(`| ${r.theme} | ${r.use} | ${r.fg} | ${r.bg} | ${r.ratio.toFixed(2)}:1 | ${r.min}:1 | ${mark(r.pass)} |`);
    say();
  }
  say(`브라우저가 실제로 그린 글자 ${sum(audits, (a) => a.contrastCount)}개도 계산된 글자색과 바탕색으로 다시 쟀어요. 가장 낮은 대비는 ${min(audits.filter((a) => a.contrastCount > 0), (a) => a.minContrast)}:1, 4.5:1에 못 미친 글자는 ${count(audits, (a) => a.lowContrast)}개예요.`);
  say();

  say('## 9. 정답 노출');
  say();
  say('검산 예시에서 틀린 문항 6개(11, 15, 20, 21, 27, 29번)의 정답이 화면 글자, 입력칸 안내문과 값, 접근성 라벨, 그 밖의 속성에 나오는지 봤어요.');
  say();
  say('| 검사한 곳 | 횟수 | 노출 |');
  say('| --- | --- | --- |');
  for (const where of [...new Set(leaks.map((l) => l.where))]) {
    const list = leaks.filter((l) => l.where === where);
    say(`| ${where} | ${list.length} | ${count(list, (l) => l.leaks)} |`);
  }
  say();
  say(`대조 검사: "정답 보기"를 눌러 정답을 연 뒤에는 같은 검사기가 노출을 잡아내는지 ${leakControls.length}번 확인했어요(27번 단답형, 15번 5지선다). 검사기가 실제로 작동한다는 뜻이에요.`);
  say();

  say('## 10. 화면 캡처');
  say();
  say(`- docs/screens/light: 밝은 화면 ${shots.light}장 (390x844, 2배 해상도)`);
  say(`- docs/screens/dark: 어두운 화면 ${shots.dark}장 (390x844, 2배 해상도)`);
  say(`- docs/screens/small: 작은 화면 ${shots.small}장 (360x640)`);
  say();
  say('캡처를 사람이 열어 보고 고친 내용은 docs/화면검토기록.md 에 적어요.');
  say();

  say('## 자동으로 확인하지 못하는 것');
  say();
  say('- 실제 아이폰 Safari와 안드로이드 Chrome 기기에서의 동작과 터치 감각.');
  say('- 사람이 답 30개를 넣는 데 걸리는 시간과 남는 오입력. 사용성 테스트에서 재야 해요.');
  say('- 결과 화면을 학생이 바르게 읽는지. 사용성 테스트의 읽기 질문으로 확인해야 해요.');
  say('- 화면 낭독기(VoiceOver, TalkBack)로 실제로 들었을 때의 흐름.');
  say();
  return { text: L.join('\n'), ok: failed.length === 0 && otherFailed.length === 0 };
}

// 7. 금지 문자 파일 검사. 보고서 자신도 검사 대상이므로, 먼저 보고서를 한 번 쓰고 검사한 뒤 결과를 넣어 다시 쓴다.
mkdirSync(join(ROOT, 'docs'), { recursive: true });
const reportPath = join(ROOT, 'docs/검증결과.md');
writeFileSync(reportPath, buildReport(true, text).text + '\n');
const textRun = run('7. 금지 문자(파일과 커밋 메시지)', process.execPath, [join(ROOT, 'scripts/check-text.mjs')]);
const textResult = readJson(join(OUT, 'text.json'));
const report = buildReport(textRun.ok, textResult);
const selfHits = findForbidden(report.text);
writeFileSync(reportPath, report.text + '\n');

const success = report.ok && selfHits.length === 0 && unitRun.ok && buildRun.ok && singleRun.ok && e2eRun.ok && textRun.ok && contrastRun.ok;
console.log(`\n검증 결과를 docs/검증결과.md 에 남겼어요. 전체 ${success ? '통과' : '실패'} (${Math.round((Date.now() - started) / 1000)}초)`);
process.exit(success ? 0 : 1);
