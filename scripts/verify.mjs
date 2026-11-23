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

// 1번 항목에서 반드시 있어야 하고 통과해야 하는 단위 테스트(7장 검산 예시의 기대값과 추가 경우).
// 테스트가 지워지거나 이름이 바뀌면 이 항목은 실패한다.
const REQUIRED_UNIT_TESTS = [
  '7장 검산 예시 틀린 문항 6개와 배점',
  '7장 검산 예시 실제 78점, 맞힌 문항 24개',
  '7장 검산 예시 추측 표시 정답 7점, 찍음 전체 배점 18점',
  '7장 검산 예시 찍기 운을 평균으로 본 점수 74.6, 화면에는 약 75점',
  '7장 검산 예시 실수 표시 오답 8점, 그 외 오답 14점',
  '7장 검산 예시 목표 2등급(컷 81~85): 첫 줄 3~7점, 둘째 줄 6~10점',
  '7장 검산 예시 목표 1등급(컷 88~92): 10~14점, 13~17점',
  '7장 검산 예시 목표 3등급(컷 72~76): 컷 범위보다 위',
  '7장 검산 예시 계단: 적분 12점, 수열 8점, 확률 6점 순으로 3개',
  '추가 경우 표시 없음: 추정 점수를 보여 주지 않는다',
  '추가 경우 전부 정답: 100점, 계단 없음',
  '추가 경우 전부 안 풂: 0점으로 채점하고 미입력과 구분한다',
  '추가 경우 컷 범위 안인 실제 점수',
  '추가 경우 컷 범위 안, 컷 범위 위, 컷 범위 아래',
  '추가 경우 컷 자료 없음',
  '추가 경우 확정 컷: 범위 대신 한 숫자',
  '추가 경우 섞인 배열 시험 B: 채점, 확정 컷, 계단',
  '추가 경우 미입력이 남아 있으면 채점하지 않는다',
];

// 0. 이전 결과를 지운다.
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
rmSync(join(ROOT, 'docs/screens'), { recursive: true, force: true });

// 1. 단위 테스트
const unitRun = run('1. 단위 테스트', npx, ['vitest', 'run', '--reporter=default', '--reporter=json', `--outputFile.json=${join(OUT, 'unit.json')}`]);

// 빌드(타입 검사 포함), 단일 HTML, 검증용 변형 빌드, 아티팩트용 파일
const buildRun = run('빌드', npm, ['run', 'build']);
const singleRun = run('단일 HTML 빌드', npm, ['run', 'build:single']);
const variantRun = run('검증용 변형 빌드(정답만 다른 시험 A, 등급컷이 없는 시험 B)', npm, ['run', 'build:variant']);
const artifactRun = run('아티팩트용 파일', process.execPath, [join(ROOT, 'scripts/make-artifact.mjs')]);
const buildsOk = buildRun.ok && singleRun.ok && variantRun.ok && artifactRun.ok;

// 8. 색 대비 계산
const contrastRun = run('8. 색 대비 계산', process.execPath, [join(ROOT, 'scripts/check-contrast.mjs')]);

// 2, 3, 4, 5, 6, 7(화면), 8(그려진 색), 9, 10. 브라우저로 화면 검사
const e2eRun = buildsOk ? run('2~10. 화면 검사', npx, ['playwright', 'test', '--trace', 'off']) : { ok: false, seconds: 0 };

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

const unitTests = unit ? unit.testResults.flatMap((f) => f.assertionResults) : [];
const missingUnit = REQUIRED_UNIT_TESTS.filter((name) => !unitTests.some((t) => t.fullName === name && t.status === 'passed'));
// 통과도 실패도 아닌 단위 테스트(건너뜀, 나중에 할 일로 표시)는 통과로 세지 않는다.
const skippedUnit = unitTests.filter((t) => t.status !== 'passed' && t.status !== 'failed');

const tests = [];
function walk(suite, path) {
  for (const s of suite.suites ?? []) walk(s, s.title && !s.title.endsWith('.ts') ? [...path, s.title] : path);
  for (const spec of suite.specs ?? []) {
    const results = spec.tests.flatMap((t) => t.results);
    // 통과는 실제로 돌아서 통과한 것만 센다. Playwright 는 건너뛴 테스트도 ok 로 적으므로 spec.ok 를 그대로 쓰지 않는다.
    const ran = spec.tests.length > 0 && spec.tests.every((t) => t.status === 'expected' && t.results.length > 0 && t.results.every((r) => r.status === 'passed'));
    const skipped = spec.tests.length === 0 || spec.tests.some((t) => t.status === 'skipped' || t.results.length === 0 || t.results.some((r) => r.status === 'skipped'));
    tests.push({
      file: spec.file,
      title: [...path, spec.title].join(' > '),
      ok: ran,
      skipped,
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
const leakDiff = metrics.find((m) => m.kind === 'leak-diff') ?? null;
const flows = metrics.filter((m) => m.kind === 'flow');
const small = metrics.filter((m) => m.kind === 'small');
const tours = metrics.filter((m) => m.kind === 'tour');
const conditions = metrics.filter((m) => m.kind === 'condition');
const single = metrics.find((m) => m.kind === 'single') ?? null;
const artifact = metrics.find((m) => m.kind === 'artifact') ?? null;

const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);
const min = (list, f) => (list.length > 0 ? Math.min(...list.map(f)) : null);
const max = (list, f) => (list.length > 0 ? Math.max(...list.map(f)) : null);
const count = (list, f) => sum(list, (x) => (f(x) ?? []).length);
const withTargets = audits.filter((a) => a.targetCount > 0);
const withGap = audits.filter((a) => a.minGap !== null);
const withText = audits.filter((a) => a.contrastCount > 0);
const withEdges = audits.filter((a) => a.edgeCount > 0);
const smallAudits = audits.filter((a) => a.run === 'light-360x640' || a.run === 'small-keypad' || a.run === 'small-rows');
const fitAudits = smallAudits.filter((a) => a.mustFit);

// 화면 검사가 줄거나 빠졌는데도 통과로 적히는 일을 막으려고, 꼭 있어야 하는 양을 따로 정해 둔다.
// 화면 코스(e2e/tour.ts)나 테스트를 일부러 바꿨다면 이 값도 함께 고친다.
const REQUIRED = {
  shots: 64, // 화면 코스의 캡처 장수(밝은 화면, 어두운 화면, 작은 화면 묶음마다)
  auditStates: 300, // 화면 검사를 거친 화면 상태 수의 최소
  smallStates: 100, // 작은 화면(360x640)에서 검사한 화면 상태 수의 최소
  e2eTests: 78, // 실제로 돈 화면 테스트 수의 최소(건너뛴 것은 세지 않는다)
  unitTests: 149, // 통과한 단위 테스트 수의 최소
  leakChecks: 44, // 화면 글자와 속성을 읽는 정답 노출 검사 횟수의 최소
  leakCompared: 25, // 정답만 다른 두 빌드의 화면을 통째로 견준 곳의 최소
  leakControls: 4, // 정답을 연 뒤에는 노출을 잡아내는지 보는 대조 검사 횟수의 최소
  fitStates: 64, // 작은 화면에서 스크롤 없이 들어와야 하는 답 입력 상태 수의 최소
};
// 검사 기록에 결과 칸이 빠져 있으면 0건으로 세지 않는다(칸이 없는 것과 찾은 것이 없는 것은 다르다).
const AUDIT_LISTS = [
  'smallText',
  'smallInputs',
  'smallTargets',
  'overlaps',
  'tightGaps',
  'obscured',
  'outside',
  'clippedSide',
  'clippedText',
  'forbidden',
  'exclamation',
  'emoji',
  'lowContrast',
  'lowEdges',
  'semanticMisuse',
];
const AUDIT_NUMBERS = ['textCount', 'minFont', 'targetCount', 'contrastCount', 'edgeCount', 'accentRatio', 'heroCount', 'primaryCount'];
const AUDIT_FLAGS = ['mustFit', 'scrolls'];
const auditsComplete = audits.every(
  (a) =>
    AUDIT_LISTS.every((k) => Array.isArray(a[k])) &&
    AUDIT_NUMBERS.every((k) => typeof a[k] === 'number' && Number.isFinite(a[k])) &&
    AUDIT_FLAGS.every((k) => typeof a[k] === 'boolean'),
);
const leaksComplete =
  leaks.every((l) => Array.isArray(l.leaks)) &&
  leakControls.every((c) => Number.isInteger(c.caught27) && Number.isInteger(c.caught15)) &&
  (leakDiff === null || (Number.isInteger(leakDiff.compared) && Array.isArray(leakDiff.differences)));
const auditsEnough = audits.length >= REQUIRED.auditStates && auditsComplete;
const smallEnough = smallAudits.length >= REQUIRED.smallStates;
const fitEnough = fitAudits.length >= REQUIRED.fitStates;
/** 최소 기준에 못 미쳤을 때 그 줄에 덧붙이는 말. */
const short = (what, n, min, unit = '개') => (n >= min ? '' : `. ${what} ${n}${unit}${unit === '개' ? '가' : '이'} 최소 ${min}${unit}에 못 미침`);
const incomplete = (ok, what) => (ok ? '' : `. ${what}에 결과 칸이 빠진 것이 있음`);
// 건너뛴 테스트는 수에 넣지 않는다.
const ranTests = tests.filter((t) => !t.skipped);
const e2eEnough = ranTests.length >= REQUIRED.e2eTests;
// 요청 기록은 실제로 돈 화면 테스트마다 하나씩 남는다. 기록이 빠졌거나 칸이 비어 있으면 0건이라고 적지 않는다.
const isCount = (v) => Number.isInteger(v) && v >= 0;
const netComplete =
  net.length === ranTests.length && net.every((n) => isCount(n.total) && Array.isArray(n.external) && isCount(n.serviceWorkers) && isCount(n.permissionAsks));

// ---------- 항목별 판정 ----------
const unitOk =
  unitRun.ok &&
  unit !== null &&
  unit.numFailedTests === 0 &&
  unit.numPassedTests === unit.numTotalTests &&
  skippedUnit.length === 0 &&
  unit.numPassedTests >= REQUIRED.unitTests &&
  missingUnit.length === 0;
const flowTests = byFile('flow.spec.ts');
const flowOk = allOk(flowTests) && flowTests.length === 4 && flows.length === 4;
const smallTests = [...byFile('small.spec.ts'), ...tests.filter((t) => t.title.includes('360x640'))];
const smallOk =
  allOk(smallTests) &&
  smallEnough &&
  fitEnough &&
  auditsComplete &&
  count(smallAudits, (a) => a.overlaps) === 0 &&
  count(smallAudits, (a) => a.obscured) === 0 &&
  count(smallAudits, (a) => a.clippedSide) === 0 &&
  count(fitAudits, (a) => a.outside) === 0 &&
  fitAudits.every((a) => !a.scrolls);
const fontOk =
  auditsEnough && count(audits, (a) => a.smallText) === 0 && count(audits, (a) => a.smallInputs) === 0 && min(audits, (a) => a.minFont) >= 13;
const targetOk = auditsEnough && withTargets.length > 0 && count(audits, (a) => a.smallTargets) === 0 && min(withTargets, (a) => Math.min(a.minTargetW, a.minTargetH)) >= 47.5;
const netOk =
  net.length > 0 &&
  netComplete &&
  e2eEnough &&
  count(net, (n) => n.external) === 0 &&
  sum(net, (n) => n.serviceWorkers ?? 0) === 0 &&
  sum(net, (n) => n.permissionAsks ?? 0) === 0 &&
  (single ? single.external === 0 : false);
const screenTextOk = auditsEnough && count(audits, (a) => a.forbidden) === 0 && count(audits, (a) => a.exclamation) === 0 && count(audits, (a) => a.emoji) === 0;
const renderedContrastOk = auditsEnough && count(audits, (a) => a.lowContrast) === 0 && count(audits, (a) => a.lowEdges) === 0;
const contrastOk = contrastRun.ok && contrast !== null && contrast.ok && renderedContrastOk;
const leakOk =
  leaksComplete &&
  leaks.length >= REQUIRED.leakChecks &&
  count(leaks, (l) => l.leaks) === 0 &&
  leakControls.length >= REQUIRED.leakControls &&
  leakControls.every((c) => c.caught27 > 0 && c.caught15 > 0) &&
  leakDiff !== null &&
  leakDiff.compared >= REQUIRED.leakCompared &&
  leakDiff.differences.length === 0 &&
  leakDiff.controlShort === true &&
  leakDiff.controlMc === true;
const shots = { light: pngCount('light'), dark: pngCount('dark'), small: pngCount('small') };
// 기대 장수는 같은 실행의 기록이 아니라 위에 정해 둔 값이다. 화면 코스가 기록한 장수도 그 값과 같아야 한다.
const expectedShots = REQUIRED.shots;
const tourShots = tours.find((t) => t.shots > 0)?.shots ?? 0;
const shotsOk = tourShots === expectedShots && shots.light === expectedShots && shots.dark === expectedShots && shots.small === expectedShots;

// ---------- 보고서 ----------
// 실행 자체가 실패로 끝난 단계. 항목이 모두 통과로 보여도 이 가운데 하나라도 있으면 전체는 실패다.
const failedSteps = [
  ['단위 테스트 실행', unitRun.ok],
  ['빌드', buildRun.ok],
  ['단일 HTML 빌드', singleRun.ok],
  ['검증용 변형 빌드', variantRun.ok],
  ['아티팩트용 파일 만들기', artifactRun.ok],
  ['색 대비 계산 실행', contrastRun.ok],
  ['화면 검사 실행', e2eRun.ok],
]
  .filter(([, ok]) => !ok)
  .map(([name]) => name);

// 여러 항목이 함께 쓰는 화면 검사 기록이 모자라거나 비어 있을 때 그 줄들에 덧붙이는 말.
const stateNote = `${short('화면 상태', audits.length, REQUIRED.auditStates)}${incomplete(auditsComplete, '화면 검사 기록')}`;
// 통과도 실패도 못 한 테스트 파일(읽다가 오류가 난 파일 등).
const failedUnitFiles = unit ? (unit.numFailedTestSuites ?? unit.testResults.filter((f) => f.status === 'failed').length) : 0;

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
    [
      '1',
      '단위 테스트',
      unitOk,
      unit
        ? `${unit.numTotalTests}개 가운데 ${unit.numPassedTests}개 통과, 실패 ${unit.numFailedTests}개, 건너뛴 것 ${skippedUnit.length}개, 읽지 못했거나 실패한 테스트 파일 ${failedUnitFiles}개. 꼭 있어야 하는 검산 예시와 추가 경우 테스트 ${REQUIRED_UNIT_TESTS.length}개 가운데 ${REQUIRED_UNIT_TESTS.length - missingUnit.length}개 확인${short('통과한 단위 테스트', unit.numPassedTests, REQUIRED.unitTests)}${unitRun.ok ? '' : '. 단위 테스트 실행이 실패로 끝남'}`
        : '결과 파일 없음',
    ],
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
      `화면 상태 ${smallAudits.length}개 검사(스크롤 없이 들어와야 하는 답 입력 상태 ${fitAudits.length}개 포함). 겹침 ${count(smallAudits, (a) => a.overlaps)}곳, 가려짐 ${count(smallAudits, (a) => a.obscured)}곳, 옆으로 잘림 ${count(smallAudits, (a) => a.clippedSide)}곳, 답 입력 화면에서 화면 밖 ${count(fitAudits, (a) => a.outside)}곳, 스크롤 생김 ${fitAudits.filter((a) => a.scrolls).length}곳${short('작은 화면 상태', smallAudits.length, REQUIRED.smallStates)}${short('스크롤 없이 들어와야 하는 상태', fitAudits.length, REQUIRED.fitStates)}${incomplete(auditsComplete, '화면 검사 기록')}`,
    ],
    [
      '4',
      '글자 크기 13px 이상',
      fontOk,
      `화면 상태 ${audits.length}개에서 보이는 글자 ${sum(audits, (a) => a.textCount)}개 검사. 가장 작은 글자 ${min(audits, (a) => a.minFont)}px, 13px 미만 ${count(audits, (a) => a.smallText)}개, 16px 미만인 입력 칸 ${count(audits, (a) => a.smallInputs)}개${stateNote}`,
    ],
    [
      '5',
      '터치 영역 48x48px 이상',
      targetOk,
      `조작 요소 ${sum(audits, (a) => a.targetCount)}개 검사. 가장 작은 폭 ${min(withTargets, (a) => a.minTargetW)}px, 가장 작은 높이 ${min(withTargets, (a) => a.minTargetH)}px, 48px 미만 ${count(audits, (a) => a.smallTargets)}개. 예외 없음(폭 360px 미만은 지원 범위 밖이라 검사 대상이 아님)${stateNote}`,
    ],
    [
      '6',
      '외부 요청 0건',
      netOk,
      `테스트 ${net.length}개에서 요청 ${sum(net, (n) => n.total)}건 관찰, 자기 주소 밖 ${count(net, (n) => n.external)}건, 서비스 워커 ${sum(net, (n) => n.serviceWorkers ?? 0)}개${netComplete ? '' : `. 요청 기록이 빠졌거나 비어 있음(실제로 돈 화면 테스트 ${ranTests.length}개, 기록 ${net.length}개)`}${short('실제로 돈 화면 테스트', ranTests.length, REQUIRED.e2eTests)}. 단일 HTML은 요청 ${single ? single.requests : '?'}건(파일 자신뿐), 밖으로 ${single ? single.external : '?'}건`,
    ],
    [
      '7',
      '금지 문자, 느낌표, 이모지',
      textOk && screenTextOk,
      textResult
        ? `${textResult.groups.map((g) => `${g.name} ${g.files}개에서 ${g.hits.length}곳`).join(', ')}, 커밋 메시지 ${textResult.commits.checked ? `${textResult.commits.count}개에서 ${textResult.commits.hits.length}곳` : '읽지 못함'}. 그려진 화면 상태 ${audits.length}개에서 금지 문자 ${count(audits, (a) => a.forbidden)}, 느낌표 ${count(audits, (a) => a.exclamation)}, 이모지 ${count(audits, (a) => a.emoji)}${stateNote}`
        : '결과 파일 없음',
    ],
    [
      '8',
      '색 대비',
      contrastOk,
      contrast
        ? `색 값 계산: 글자 조합 최저 ${min(contrast.rows.filter((r) => r.min === 4.5), (r) => r.ratio).toFixed(2)}:1(기준 4.5:1), 테두리와 윤곽 최저 ${min(contrast.rows.filter((r) => r.min === 3), (r) => r.ratio).toFixed(2)}:1(기준 3:1), 조합 ${contrast.rows.length}개 가운데 실패 ${contrast.rows.filter((r) => !r.pass).length}개. 그려진 글자 ${sum(audits, (a) => a.contrastCount)}개의 실제 대비 최저 ${min(withText, (a) => a.minContrast)}:1(4.5:1 미만 ${count(audits, (a) => a.lowContrast)}개), 그려진 입력 테두리와 그래프 윤곽 ${sum(audits, (a) => a.edgeCount)}개의 실제 대비 최저 ${min(withEdges, (a) => a.minEdgeContrast)}:1(3:1 미만 ${count(audits, (a) => a.lowEdges)}개)${stateNote}`
        : '결과 파일 없음',
    ],
    [
      '9',
      '정답 노출',
      leakOk,
      `정답만 다른 두 빌드의 화면 ${leakDiff ? leakDiff.compared : 0}곳을 통째로 견줌: 다른 곳 ${leakDiff ? leakDiff.differences.length : '?'}곳. 화면 글자와 속성을 읽는 검사 ${leaks.length}번: 노출 ${count(leaks, (l) => l.leaks)}건. 대조 검사에서 "정답 보기"를 누른 뒤에는 두 검사 모두 노출을 잡아냄${short('화면을 읽는 검사', leaks.length, REQUIRED.leakChecks, '번')}${short('두 빌드를 견준 화면', leakDiff ? leakDiff.compared : 0, REQUIRED.leakCompared, '곳')}${short('대조 검사', leakControls.length, REQUIRED.leakControls, '번')}${incomplete(leaksComplete, '정답 노출 검사 기록')}`,
    ],
    ['10', '화면 캡처', shotsOk, `밝은 화면 ${shots.light}장, 어두운 화면 ${shots.dark}장(390x844, 2배 해상도), 작은 화면 ${shots.small}장(360x640). 기대한 장수는 묶음마다 ${expectedShots}장`],
  ];
  const failed = items.filter((i) => !i[2]);
  const otherFailed = tests.filter((t) => !t.ok);

  say('# 검증 결과');
  say();
  const skippedTests = tests.filter((t) => t.skipped);
  say(
    failed.length === 0 && otherFailed.length === 0 && failedSteps.length === 0 && skippedUnit.length === 0
      ? '결론: 10장의 자동 검증 10개 항목이 모두 통과했어요.'
      : `결론: 실패한 항목이 있어요. 항목 ${failed.length}개, 화면 테스트 ${otherFailed.length}개(건너뛴 것 ${skippedTests.length}개 포함), 건너뛴 단위 테스트 ${skippedUnit.length}개, 실패로 끝난 실행 단계 ${failedSteps.length}개.`,
  );
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
  if (failed.length > 0 || otherFailed.length > 0 || missingUnit.length > 0 || skippedUnit.length > 0 || failedSteps.length > 0) {
    say('## 실패한 것');
    say();
    for (const [no, name] of failed) say(`- ${no}번 ${name}`);
    for (const t of otherFailed) say(`- 테스트${t.skipped ? '(건너뜀)' : ''}: ${t.title}`);
    for (const name of missingUnit) say(`- 없거나 통과하지 못한 단위 테스트: ${name}`);
    for (const t of skippedUnit) say(`- 건너뛴 단위 테스트: ${t.fullName}`);
    if (unit) for (const f of unit.testResults.filter((x) => x.status === 'failed' && x.assertionResults.length === 0)) say(`- 읽지 못한 단위 테스트 파일: ${f.name.replace(ROOT, '').replace(/^[\\/]/, '')}`);
    for (const name of failedSteps) say(`- 실패로 끝난 실행 단계: ${name}`);
    say();
  }

  say('## 1. 단위 테스트');
  say();
  if (unit) {
    say('| 파일 | 테스트 수 | 실패 | 건너뜀 |');
    say('| --- | --- | --- | --- |');
    for (const f of unit.testResults) {
      const name = f.name.replace(ROOT, '').replace(/^[\\/]/, '').split('\\').join('/');
      say(`| ${name} | ${f.assertionResults.length} | ${f.assertionResults.filter((a) => a.status === 'failed').length} | ${f.assertionResults.filter((a) => a.status !== 'passed' && a.status !== 'failed').length} |`);
    }
    say();
    say('7장 검산 예시의 기대값(실제 78점, 맞힌 문항 24개, 추측 표시 정답 7점, 찍음 전체 배점 18점, 찍기 운을 평균으로 본 점수 74.6, 실수 표시 오답 8점, 그 외 오답 14점, 등급별 남은 점수, 계단 3개)과');
    say('추가 경우(표시 없음, 전부 정답, 전부 안 풂, 컷 범위 안, 컷 범위 위, 컷 자료 없음, 확정 컷, 섞인 배열 시험 B)는 src/logic/scoring.test.ts 에 있어요.');
    say(`이 테스트들이 지워지거나 이름이 바뀌어 빠지면 1번 항목이 실패하도록, 꼭 있어야 하는 테스트 ${REQUIRED_UNIT_TESTS.length}개의 이름을 따로 확인해요.`);
    say();
  }

  say('## 2. 화면 흐름과 그 밖의 화면 테스트');
  say();
  say('| 테스트 | 결과 | 걸린 시간 |');
  say('| --- | --- | --- |');
  for (const t of tests) say(`| ${t.title} | ${t.skipped ? '건너뜀' : mark(t.ok)} | ${(t.ms / 1000).toFixed(1)}초 |`);
  say();
  say(`테스트 ${tests.length}개 가운데 ${tests.filter((t) => t.ok).length}개 통과, 건너뛴 것 ${tests.filter((t) => t.skipped).length}개. 건너뛴 테스트는 통과로 세지 않아요.`);
  say();

  say('## 3, 4, 5. 화면 상태별 검사');
  say();
  say('화면 상태마다 브라우저가 실제로 그린 결과를 읽어서 검사했어요.');
  say();
  say('| 검사 묶음 | 화면 상태 | 가장 작은 글자 | 가장 작은 터치 영역 | 요소 사이 최소 간격 | 겹침 | 가려짐 | 옆으로 잘림 | 진한 색 면적 최대 |');
  say('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  const runs = [...new Set(audits.map((a) => a.run))];
  for (const id of runs) {
    const list = audits.filter((a) => a.run === id);
    const wt = list.filter((a) => a.targetCount > 0);
    const wg = list.filter((a) => a.minGap !== null);
    say(
      `| ${id} | ${list.length}개 | ${min(list, (a) => a.minFont)}px | ${wt.length ? `${min(wt, (a) => a.minTargetW)}x${min(wt, (a) => a.minTargetH)}px` : '없음'} | ${wg.length ? `${min(wg, (a) => a.minGap)}px` : '없음'} | ${count(list, (a) => a.overlaps)} | ${count(list, (a) => a.obscured)} | ${count(list, (a) => a.clippedSide)} | ${(max(list, (a) => a.accentRatio) * 100).toFixed(1)}% |`,
    );
  }
  say();
  say('- 가려짐은 조작 요소마다 보이는 부분의 가운데와 네 귀퉁이를 눌러 봐서 그 요소가 눌리는지로 봤어요.');
  say(`- 요소 사이 간격: 같은 스크롤 영역 안에서 온전히 보이는 조작 요소끼리 쟀어요. 8px 미만 ${count(audits, (a) => a.tightGaps)}곳, 전체 최소 ${withGap.length ? min(withGap, (a) => a.minGap) : '없음'}px.`);
  say(`- 상자에 잘린 글자 ${count(audits, (a) => a.clippedText)}곳, 칼럼 밖으로 나가 잘린 요소 ${count(audits, (a) => a.clippedSide)}곳.`);
  say(`- 주 숫자(계산된 크기 40px 이상인 글자)는 화면마다 최대 ${max(audits, (a) => a.heroCount)}개, 주 버튼(포인트색으로 칠한 큰 조작 요소)은 화면마다 최대 ${max(audits, (a) => a.primaryCount)}개였어요.`);
  say(`- 진한 색 면적은 포인트색으로 칠한 면의 넓이를 화면 넓이로 나눈 값이에요. 가장 큰 화면이 ${(max(audits, (a) => a.accentRatio) * 100).toFixed(1)}%였어요(기준 10% 이하).`);
  say(`- 정답색, 오답색, 경고색을 넓은 면이나 큰 글자에 쓴 곳: ${count(audits, (a) => a.semanticMisuse)}곳.`);
  say(`- 작은 화면 답 입력: 키패드 방식 ${small.find((s) => s.mode === 'keypad')?.checked ?? 0}개 상태, 5행 방식 ${small.find((s) => s.mode === 'rows')?.checked ?? 0}개 상태를 따로 검사했어요.`);
  say();
  if (conditions.length > 0) {
    say('지시서 범위 밖의 조건에서도 답 입력 화면을 끝까지 쓸 수 있는지 봤어요(키패드의 모든 키와 안내문이 화면 안에 있고, 지금 칸으로 스크롤되는지).');
    say();
    say('| 조건 | 확인한 상태 | 내용이 넘쳐 스크롤이 생긴 높이(최대) |');
    say('| --- | --- | --- |');
    for (const name of [...new Set(conditions.map((c) => c.name))]) {
      const list = conditions.filter((c) => c.name === name);
      say(`| ${name} | ${list.length}개 | ${max(list, (c) => c.overflowPx)}px |`);
    }
    say();
  }

  say('## 6. 외부 요청');
  say();
  say(`테스트마다 브라우저 묶음(탭, 새 창, 워커 포함)에서 나간 요청을 모두 기록했어요. 요청 ${sum(net, (n) => n.total)}건이 전부 앱을 연 주소 안으로 갔고, 밖으로 나간 요청은 ${count(net, (n) => n.external)}건이에요. 등록된 서비스 워커는 ${sum(net, (n) => n.serviceWorkers ?? 0)}개, 알림 권한을 요청한 횟수는 ${sum(net, (n) => n.permissionAsks ?? 0)}번이에요.`);
  say('글꼴(Pretendard dynamic subset)과 스크립트는 프로젝트 안에 실려 있어요.');
  if (single) say(`단일 HTML 파일(${Math.round(single.bytes / 1024)} KB)은 파일 자신 말고는 아무것도 읽지 않았어요(요청 ${single.requests}건).`);
  if (artifact) say(`아티팩트용 파일(${Math.round(artifact.bytes / 1024)} KB)도 뼈대에 넣어 열었을 때 파일 자신 말고는 요청이 없었어요(밖으로 ${artifact.external}건). 실제 뷰어 안에서는 확인하지 못했어요.`);
  say();

  say('## 7. 금지 문자');
  say();
  say('찾는 문자: U+2014, U+2013, U+00B7, U+318D, U+30FB, U+2027. 화면 문구에서는 느낌표와 이모지도 찾아요.');
  say();
  if (textResult) {
    say('| 대상 | 검사한 수 | 찾은 곳 |');
    say('| --- | --- | --- |');
    for (const g of textResult.groups) say(`| ${g.name} | 파일 ${g.files}개 | ${g.hits.length} |`);
    say(`| 커밋 메시지 | ${textResult.commits.checked ? `${textResult.commits.count}개` : '읽지 못함'} | ${textResult.commits.hits.length} |`);
    say(`| 화면에 그려진 글자, 접힌 글자, 접근성 라벨, 입력 칸 값, 가상 요소 글자 | 화면 상태 ${audits.length}개 | ${count(audits, (a) => a.forbidden)} |`);
    say(`| 화면의 느낌표 | 화면 상태 ${audits.length}개 | ${count(audits, (a) => a.exclamation)} |`);
    say(`| 화면의 이모지 | 화면 상태 ${audits.length}개 | ${count(audits, (a) => a.emoji)} |`);
    say();
    say('커밋 메시지는 이 검증을 돌린 때까지의 커밋만 셌어요. 이 문서를 담은 커밋과 그 뒤의 커밋은 여기에 들어가지 않아요(node scripts/check-text.mjs 로 다시 확인할 수 있어요).');
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
  say(`브라우저가 실제로 그린 글자 ${sum(audits, (a) => a.contrastCount)}개도 계산된 글자색과 바탕색(투명도 포함)으로 다시 쟀어요. 가장 낮은 대비는 ${min(withText, (a) => a.minContrast)}:1, 4.5:1에 못 미친 글자는 ${count(audits, (a) => a.lowContrast)}개예요.`);
  say(`그려진 입력 테두리와 그래프 윤곽(칸, 키, 고르는 줄, 칩, 막대 구간, 진행 막대 등) ${sum(audits, (a) => a.edgeCount)}개도 테두리색(테두리가 없으면 채운 색)과 바깥 바탕색으로 쟀어요. 가장 낮은 대비는 ${min(withEdges, (a) => a.minEdgeContrast)}:1, 3:1에 못 미친 것은 ${count(audits, (a) => a.lowEdges)}개예요.`);
  say();

  say('## 9. 정답 노출');
  say();
  say('두 가지 방법으로 봤어요.');
  say();
  say('첫째, 차분 검사(e2e/leak.spec.ts). 배포하는 빌드와, 검산 예시에서 틀리는 6문항(11, 15, 20, 21, 27, 29번)의 정답만 다른 값으로 바꾼 검증용 빌드에 똑같은 조작을 했어요.');
  say('화면마다 보이는 글자, 숨은 글자, 모든 속성, 입력 칸 값, 가상 요소 글자를 통째로 견줘서, 한 글자라도 다르면 정답이 드러난 것으로 봐요.');
  if (leakDiff) {
    say(`"정답 보기"를 누르기 전의 화면 ${leakDiff.compared}곳을 견줬고 다른 곳은 ${leakDiff.differences.length}곳이에요.`);
    say(`대조: "정답 보기"를 누른 뒤에는 두 빌드의 화면이 달라졌어요(단답형 27번 ${leakDiff.controlShort ? '달라짐' : '같음'}, 5지선다 15번 ${leakDiff.controlMc ? '달라짐' : '같음'}). 이 검사가 노출을 실제로 잡아낸다는 뜻이에요.`);
    for (const d of leakDiff.differences) say(`- 다른 곳: ${d}`);
  }
  say();
  say('둘째, 화면을 읽는 검사(e2e/audit.ts 의 findAnswerLeaks). 화면 글자, 입력칸 안내문과 값, 접근성 라벨, 그 밖의 속성에 틀린 문항의 정답이 나오는지 봤어요.');
  say();
  say('| 검사한 곳 | 횟수 | 노출 |');
  say('| --- | --- | --- |');
  for (const where of [...new Set(leaks.map((l) => l.where))]) {
    const list = leaks.filter((l) => l.where === where);
    say(`| ${where} | ${list.length} | ${count(list, (l) => l.leaks)} |`);
  }
  say();
  say(`대조 검사: "정답 보기"를 눌러 정답을 연 뒤에는 같은 검사기가 노출을 잡아내는지 ${leakControls.length}번 확인했어요(27번 단답형, 15번 5지선다).`);
  say();

  say('## 10. 화면 캡처');
  say();
  say(`- docs/screens/light: 밝은 화면 ${shots.light}장 (390x844, 2배 해상도)`);
  say(`- docs/screens/dark: 어두운 화면 ${shots.dark}장 (390x844, 2배 해상도)`);
  say(`- docs/screens/small: 작은 화면 ${shots.small}장 (360x640)`);
  say();
  say('만든 쪽이 캡처를 열어 보고 고친 내용과 별도 검토 단계가 찾은 것은 docs/화면검토기록.md 에 적어요.');
  say();
  say(`판정에 쓰는 최소 기준: 통과한 단위 테스트 ${REQUIRED.unitTests}개 이상(이번 ${unit ? unit.numPassedTests : 0}개, 건너뛴 것은 없어야 함), 화면 상태 ${REQUIRED.auditStates}개 이상(이번 ${audits.length}개), 작은 화면 상태 ${REQUIRED.smallStates}개 이상(이번 ${smallAudits.length}개), 실제로 돈 화면 테스트 ${REQUIRED.e2eTests}개 이상(이번 ${ranTests.length}개), 요청 기록은 실제로 돈 화면 테스트마다 하나(이번 ${net.length}개), 정답 노출은 화면을 읽는 검사 ${REQUIRED.leakChecks}번 이상(이번 ${leaks.length}번)과 두 빌드를 견준 화면 ${REQUIRED.leakCompared}곳 이상(이번 ${leakDiff ? leakDiff.compared : 0}곳)과 대조 검사 ${REQUIRED.leakControls}번 이상(이번 ${leakControls.length}번), 작은 화면에서 스크롤 없이 들어와야 하는 상태 ${REQUIRED.fitStates}개 이상(이번 ${fitAudits.length}개), 캡처는 묶음마다 ${REQUIRED.shots}장. 검사가 줄거나 빠지거나 검사 기록에 결과 칸이 비어 있으면 해당 항목이 실패로 적혀요.`);
  say();
  say('화면 검사는 실행할 때마다 지금 폴더의 빌드로 서버를 새로 띄워요. 쓰려는 포트(기본 4173, 4174)에 이미 떠 있는 서버가 있으면 그 서버를 다시 쓰지 않고 실패로 끝나요.');
  say();

  say('## 자동으로 확인하지 못하는 것');
  say();
  say('- 실제 아이폰 Safari와 안드로이드 Chrome 기기에서의 동작과 터치 감각.');
  say('- 사람이 답 30개를 넣는 데 걸리는 시간과 남는 오입력. 사용성 테스트에서 재야 해요.');
  say('- 결과 화면을 학생이 바르게 읽는지. 사용성 테스트의 읽기 질문으로 확인해야 해요.');
  say('- 화면 낭독기(VoiceOver, TalkBack)로 실제로 들었을 때의 흐름.');
  say('- 아티팩트 뷰어 안에서의 동작. 뼈대와 비슷한 틀에 넣어 여는 것까지만 확인했어요.');
  say();
  return {
    text: L.join('\n'),
    ok: failed.length === 0 && otherFailed.length === 0 && missingUnit.length === 0 && skippedUnit.length === 0 && failedSteps.length === 0,
  };
}

// 7. 금지 문자 파일 검사. 보고서 자신도 검사 대상이므로, 먼저 보고서를 한 번 쓰고 검사한 뒤 결과를 넣어 다시 쓴다.
mkdirSync(join(ROOT, 'docs'), { recursive: true });
const reportPath = join(ROOT, 'docs/검증결과.md');
writeFileSync(reportPath, buildReport(true, readJson(join(OUT, 'text.json'))).text + '\n');
const textRun = run('7. 금지 문자(파일과 커밋 메시지)', process.execPath, [join(ROOT, 'scripts/check-text.mjs')]);
const textResult = readJson(join(OUT, 'text.json'));
const report = buildReport(textRun.ok, textResult);
const selfHits = findForbidden(report.text);
writeFileSync(reportPath, report.text + '\n');

const success = report.ok && selfHits.length === 0 && unitRun.ok && buildsOk && e2eRun.ok && textRun.ok && contrastRun.ok;
console.log(`\n검증 결과를 docs/검증결과.md 에 남겼어요. 전체 ${success ? '통과' : '실패'} (${Math.round((Date.now() - started) / 1000)}초)`);
process.exit(success ? 0 : 1);
