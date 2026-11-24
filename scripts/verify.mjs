// npm run verify
// 작업 지시서 10장의 자동 검증(1~10번), 작업 지시서 1의 앱용 묶음 검증(11, 12번), 작업 지시서 3의 발행 도구 검증(13번)을
// 전부 실행하고 결과를 docs/검증결과.md 에 남긴다.
// 12번에는 작업 지시서 3의 넘겨받기 화면 테스트(가짜 다리 규격 2, e2e/appRemote.spec.ts)와
// 배포용 묶음과 시험용 묶음의 모양 비교 화면 테스트(e2e/appStyle.spec.ts)도 들어 있다.
// 2번에는 작업 지시서 3-1의 빠진 누름 채우기 화면 테스트(e2e/fill.spec.ts)와 아이폰에서 찾은 보기 문제 화면 테스트(e2e/iosweb.spec.ts)도 들어 있다.
// 13번은 발행 도구(scripts/exams)의 단위 테스트와, 커밋된 테스트 전용 발행물(exam-data/testdata)을 실제 Node 의 exams:verify 로 확인한 결과다.
// 실행해서 확인한 수치만 적는다.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { APP_WEB_DIR, BRIDGE_MAX, BRIDGE_VERSION, BUNDLES, buildAll, INPUTS as APP_INPUTS } from './app-bundles.mjs';
import { findForbidden, OUT, rel, ROOT } from './lib.mjs';

const require = createRequire(import.meta.url);
const isWin = process.platform === 'win32';
const npx = isWin ? 'npx.cmd' : 'npx';
const npm = isWin ? 'npm.cmd' : 'npm';
const started = Date.now();

/**
 * 명령을 실행한다. 윈도우의 npm.cmd 와 npx.cmd 는 셸 없이 실행할 수 없어서(Node 18.20.2, 20.12.2 이후의 보안 수정)
 * 윈도우에서는 인자를 따옴표로 감싼 명령 한 줄을 셸로 실행한다.
 */
function spawnTool(cmd, args, options) {
  if (!isWin || !/\.(cmd|bat)$/i.test(cmd)) return spawnSync(cmd, args, options);
  const quote = (a) => (/[\s"&|<>^%]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
  return spawnSync([cmd, ...args].map(quote).join(' '), { ...options, shell: true });
}

function run(label, cmd, args) {
  console.log(`\n=== ${label} ===`);
  const t = Date.now();
  // verify 는 늘 지금 폴더의 빌드로 서버를 새로 띄워서 잰다. 떠 있는 서버를 다시 쓰는 스위치(SA_REUSE_SERVER)가
  // 셸에 켜져 있어도 따르지 않는다(보고서가 "새로 띄워요"라고 적으므로).
  const r = spawnTool(cmd, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, FORCE_COLOR: '0', SA_REUSE_SERVER: '' } });
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

// 1번 항목에서 반드시 있어야 하고 통과해야 하는 단위 테스트(7장 검산 예시의 기대값과 추가 경우, 작업 지시서 1과 3의 꼭 넣을 테스트).
// 이름은 vitest 결과의 fullName(describe 와 it 을 공백으로 이은 것)이다. 테스트가 지워지거나 이름이 바뀌면 이 항목은 실패한다.
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
  // 작업 지시서 1(1.1)의 3-5: 찍기 운 평균을 보기 수로 정수 계산한다(손으로 계산해 고정한 기대값).
  '찍기 운 평균의 보기 수 보기 수 섞임: 58.2, 약 58점',
  '찍기 운 평균의 보기 수 딱 0.5는 올라간다: 70.5, 약 71점',
  '찍기 운 평균의 보기 수 반올림 값이 실제 점수와 같으면 둘째 줄을 보여 주지 않는다: 63.5, 약 64점',
  // 작업 지시서 1(1.1)의 3-2: 키패드 답 입력의 흐름(꼭 넣을 테스트 a~j).
  '키패드 답 입력의 흐름(3-2) (a) 1번부터 차례로 30문항을 넣으면 잠금 없이 다음 번호로 가고 입력 확인으로 넘어간다',
  '키패드 답 입력의 흐름(3-2) (b) 12번을 넣을 차례에 9번을 고치면 9번에 머물고 잠기며, 이어 누른 답 키는 어디에도 들어가지 않는다',
  '키패드 답 입력의 흐름(3-2) (c) 잠금에서 "10번도 고치기"를 누르면 10번을 한 번 고칠 수 있고 다시 잠긴다',
  '키패드 답 입력의 흐름(3-2) (d) 5번과 7번이 비어 있을 때 5번을 눌러 채우면 잠기고, 버튼은 "6번도 고치기"와 "7번부터 이어서 넣기"다',
  '키패드 답 입력의 흐름(3-2) (e) 5번만 비워 둔 채 30번을 넣으면 입력 확인으로 가고 5번은 미입력으로 남는다',
  '키패드 답 입력의 흐름(3-2) (f) 다 찬 상태에서 9번을 고치면 입력 확인으로 간다(이어 누른 것이 9번을 바꾸지 않는 것은 화면 테스트가 본다)',
  '키패드 답 입력의 흐름(3-2) (g) 답이 든 칸을 눌러 바로 고친 경우와 지우기로 비운 뒤 다시 넣은 경우의 결과가 같다',
  '키패드 답 입력의 흐름(3-2) (h) 6번을 넣고 7번으로 넘어온 직후 지우기를 누르면 6번이 지워지고 6번에 머문다. 다시 넣으면 7번으로 간다',
  '키패드 답 입력의 흐름(3-2) (i) 빈칸을 직접 눌러 들어온 직후의 지우기는 아무것도 지우지 않는다',
  '키패드 답 입력의 흐름(3-2) (j) 무작위 누름 열 1만 개에서 규칙이 한 번도 깨지지 않는다',
  // 작업 지시서 3의 4-2: 복수 정답과 모두 정답 처리의 채점, 찍기 운 평균(꼭 넣을 테스트, 손으로 계산해 고정한 기대값).
  '정답 정정과 복수 정답(4-2) 복수 정답 문항은 answer 도 altAnswers 의 답도 정답이고 그 밖의 답은 오답이다',
  '정답 정정과 복수 정답(4-2) 모두 정답 처리 문항은 오답을 넣어도 안 풂이어도 배점을 받는다',
  '정답 정정과 복수 정답(4-2) 실제 60점, 찍음 표시 4점 문항 하나(보기 5개, 인정하는 답 2개, 오답): 61.6, 약 62점',
  '정답 정정과 복수 정답(4-2) 같은 문항을 맞혔고 실제 60점: 57.6, 약 58점',
  '정답 정정과 복수 정답(4-2) 실제 60점, 찍음 표시가 모두 정답 처리 문항 하나뿐이면 둘째 줄을 보여 주지 않는다',
  // 작업 지시서 3의 4-5: 풀이 잠금 판정과 두 달력 합치기(꼭 넣을 테스트).
  '풀이 잠금(4-5) 시작 1분 전은 열림',
  '풀이 잠금(4-5) 시작 시각은 잠김',
  '풀이 잠금(4-5) 종료 1분 전은 잠김',
  '풀이 잠금(4-5) 종료 시각은 열림',
  '풀이 잠금(4-5) 달력이 비면 늘 열림',
  '풀이 잠금(4-5) 같은 UTC 시각이면 기기 시간대가 달라도 결과가 같고 판정 코드는 지역 시각을 읽는 Date 메서드를 쓰지 않는다',
  '풀이 잠금(4-5) id 가 겹치면 넘겨받은 항목이 이긴다',
  '풀이 잠금(4-5) 형식이 틀린 항목은 버린다',
  // 작업 지시서 3의 4-6: 채점 흔적과 정답 정정 알림(꼭 넣을 테스트).
  '정답 정정 알림(4-6) 정정 전후로 answers 와 marks 가 한 글자도 바뀌지 않는다',
  '정답 정정 알림(4-6) 점수가 오르는 정정',
  '정답 정정 알림(4-6) 점수가 내리는 정정',
  '정답 정정 알림(4-6) 점수가 그대로인 정정',
  '정답 정정 알림(4-6) 확인 전에는 기록 화면에 정정 표시가 붙고 확인한 뒤에는 없다',
  '정답 정정 알림(4-6) 옛 기록: answersRev 가 1이면 조용히 채운다',
  '정답 정정 알림(4-6) 옛 기록: answersRev 가 2 이상이면 지금 정답으로 채점했다고 알린다',
  '정답 정정 알림(4-6) 정정 뒤 오답 원인 화면과 계단이 지금 정답 기준으로 나온다',
];

// 13번 항목에서 반드시 있어야 하고 통과해야 하는 발행 도구(scripts/exams)의 단위 테스트. 이름은 vitest 결과의 fullName 이다.
// 작업 지시서 3의 8장이 정한 발행 도구 테스트, 6-1 과 6-4 의 명령이 지켜야 하는 것, 6-5 의 테스트 전용 발행물이다.
// 테스트가 지워지거나 이름이 바뀌면 13번 항목이 실패한다.
const FORBIDDEN_CHANGE_NAMES = [
  '발행했던 시험 id 가 사라짐',
  '내용이 바뀌었는데 rev 가 그대로이거나 rev 가 내려감',
  'answerReleased 가 true 에서 false 로 돌아감',
  '문항의 no, kind, choices 가 바뀜',
  '채점에 영향을 주는 값이 바뀌었는데 answersRev 를 올리지 않았거나 answersNote 가 없음',
  'confirmed 가 true 인데 두 값이 다름',
  '잠금 달력 항목의 형식이 틀림',
];
const REQUIRED_TOOL_TESTS = [
  // 8장: 임시 키로 발행한 것이 verify 를 통과한다. index.json 한 바이트, 시험 파일 한 바이트, 다른 키로 한 서명은 각각 실패한다.
  '발행 도구 exams:publish(작업 지시서 3의 6-2, 6-4) 임시 키로 발행한 것이 verify 를 통과한다(index.json, index.json.sig, files/<id>.<rev>.json 의 모양과 요약 출력)',
  '발행 도구 exams:verify(작업 지시서 3의 6-2, 6-4) index.json 한 바이트, 시험 파일 한 바이트, 다른 키로 한 서명은 각각 실패하고 이유가 맞다',
  // 8장: 6-4 의 거부해야 하는 변경 일곱 가지를 하나씩 만들어 publish 와 check 가 모두 거부한다.
  ...FORBIDDEN_CHANGE_NAMES.map((n) => `발행 도구 exams:publish 금지된 변경(작업 지시서 3의 6-4) ${n}: publish 가 거부하고 state.json 과 발행 폴더가 그대로다`),
  ...FORBIDDEN_CHANGE_NAMES.map((n) => `발행 도구 exams:check 금지된 변경(작업 지시서 3의 6-4) ${n}: check 가 거부한다`),
  // 8장: 이어서 두 번 발행하면 seq 가 커진다. 비밀 키 파일이 저장소 안에 있으면 거부한다. 도구의 출력에 키 내용이 없다.
  '발행 도구 exams:publish(작업 지시서 3의 6-2, 6-4) 이어서 두 번 발행하면 seq 가 커지고 state.json 이 맞게 바뀌고, 발행 폴더에 그 전 발행의 파일이 남지 않는다',
  '발행 도구 비밀 키(작업 지시서 3의 6-4) 비밀 키 파일이 저장소 안이면 거부한다(상대 경로, 대소문자, .. 과 연결 지점을 풀어서)',
  '발행 도구 비밀 키(작업 지시서 3의 6-4) 도구의 출력(stdout, stderr)에 키 내용이 없다(실제 Node 실행, PEM 본문 줄과 JWK 의 d)',
  // 8장: answers 는 같으면 쓰고 다르면 쓰지 않는다. cuts 는 범위, 한 값, 거부 경우(6-4 의 세 가지).
  '발행 도구 exams:answers(작업 지시서 3의 6-4) 두 파일이 같으면 정답을 넣고 answerReleased 를 true 로 한다(줄 차례, 빈 줄, # 줄, 쉼표 둘레 빈칸은 상관없음)',
  '발행 도구 exams:answers(작업 지시서 3의 6-4) 두 파일이 다르면 원본 파일을 바이트 그대로 두고 다른 문항 번호만 보여 준다(답 값은 보여 주지 않음, 실제 Node 실행)',
  '발행 도구 exams:cuts(작업 지시서 3의 6-4) 기관이 둘 이상이면 등급마다 가장 낮은 값과 가장 높은 값으로 범위를 쓴다(source, asOf, confirmed false)',
  '발행 도구 exams:cuts(작업 지시서 3의 6-4) 기관이 한 곳이면 한 값([v, v])으로 쓴다',
  '발행 도구 exams:cuts(작업 지시서 3의 6-4) 거부한다: 값이 0보다 작음(원본 파일은 바이트 그대로)',
  '발행 도구 exams:cuts(작업 지시서 3의 6-4) 거부한다: 값이 만점보다 큼(원본 파일은 바이트 그대로)',
  '발행 도구 exams:cuts(작업 지시서 3의 6-4) 거부한다: 높은 등급의 컷이 낮은 등급의 컷보다 낮음(원본 파일은 바이트 그대로)',
  // 6-1 과 6-4: 자료 폴더의 처음 모양, 검사 규칙은 src/exams/validate.ts 를 그대로 씀, check 와 --dry-run 은 쓰지 않음, issuedAt,
  // keygen, serve 와 주소 verify(캐시를 쓰지 않고 기기나 사용자를 가리키는 값을 붙이지 않음).
  '발행 도구 폴더와 바탕(작업 지시서 3의 6-1, 6-4) 자료 폴더 exam-data 의 처음 모양: src(자리 파일), locks.json(검사 통과), state.json(처음 값의 정렬한 JSON), 발행 결과물은 커밋하지 않음',
  '발행 도구 폴더와 바탕(작업 지시서 3의 6-1, 6-4) 도구가 닿는 TypeScript 파일은 상대 경로를 .ts 까지 적고, 타입만 가져올 때는 import type 문을 쓰고, Node 의 타입 지우기로 읽힌다',
  '발행 도구 exams:check(작업 지시서 3의 6-4) 시험 파일의 검사는 src/exams/validate.ts 의 규칙을 그대로 쓴다',
  '발행 도구 exams:check(작업 지시서 3의 6-4) check 는 통과하든 거부하든 아무 파일도 쓰지 않는다(함수와 실제 Node 실행 모두)',
  '발행 도구 exams:publish(작업 지시서 3의 6-2, 6-4) 쓰지 않고 보여 주기(--dry-run)는 비밀 키가 있든 없든 아무것도 쓰지 않는다(함수와 실제 Node 실행)',
  '발행 도구 exams:publish(작업 지시서 3의 6-2, 6-4) issuedAt 은 --issued-at 이나 지금의 한국 시각이고, 마지막 발행보다 이르면 거부한다',
  '발행 도구 exams:keygen(작업 지시서 3의 6-4) 키 쌍을 만들고 만든 키로 서명한 발행물을 verify 가 통과한다(실제 Node 실행, 공개 키는 --data 의 public-key.txt)',
  '발행 도구 exams:keygen(작업 지시서 3의 6-4) 저장소 안 경로, 자료 폴더 안 경로, 이미 있는 비밀 키 파일과 공개 키 파일을 거부하고 아무것도 쓰지 않는다',
  '발행 도구 exams:serve(작업 지시서 3의 6-4) 실제 Node 로 띄운 exams:serve 의 주소로 exams:verify 가 통과한다(리허설 안내를 출력)',
  '발행 도구 exams:serve(작업 지시서 3의 6-4) verify 는 주소에서 캐시를 쓰지 않고, 기기나 사용자를 가리키는 값을 붙이지 않고 받는다',
  // 6-5: 테스트 전용 발행물(커밋된 exam-data/testdata 와 exams:testdata 명령).
  '발행 도구 테스트 전용 발행물(작업 지시서 3의 6-5) 커밋된 정상 발행물(test-only-valid)은 테스트 전용 공개 키로 verify 를 통과하고, 파일 이름과 시험 내용에 테스트 전용이라고 적혀 있다',
  '발행 도구 테스트 전용 발행물(작업 지시서 3의 6-5) 커밋된 서명이 틀린 발행물(test-only-bad-signature)은 서명 때문에 실패하고, 서명 말고는 모두 맞다',
  '발행 도구 테스트 전용 발행물(작업 지시서 3의 6-5) 커밋된 시험 파일 한 바이트가 바뀐 발행물(test-only-changed-byte)은 sha256 때문에 실패하고, 서명은 맞고 바뀐 바이트는 하나다',
  '발행 도구 테스트 전용 발행물(작업 지시서 3의 6-5) 커밋된 seq 가 작은 발행물(test-only-older-seq)은 서명과 sha256 이 맞고 seq 가 정상 발행물보다 작다',
  '발행 도구 테스트 전용 발행물(작업 지시서 3의 6-5) 명령을 임시 폴더로 다시 돌리면 커밋된 것과 바이트가 같고, 출력에 비밀 키의 내용이 없다(실제 Node 실행)',
  '발행 도구 테스트 전용 발행물(작업 지시서 3의 6-5) 테스트 전용 키로는 진짜 발행을 하지 못한다: 커밋된 비밀 키는 저장소 안이라 거부하고, 저장소 밖으로 옮겨도 테스트 전용 키라 거부한다',
  '발행 도구 테스트 전용 발행물(작업 지시서 3의 6-5) testdata 폴더에 이 명령이 만들지 않는 것이 있으면 아무것도 쓰지 않고 거부하고, 바뀐 파일만 다시 쓴다',
  '발행 도구 테스트 전용 발행물(작업 지시서 3의 6-5) README 에 테스트 전용이고 진짜 발행에 쓰지 않는다는 것과, 폴더마다 무엇이고 받는 쪽이 할 일이 적혀 있다',
];

/** 단위 테스트 결과의 파일 이름을 저장소 기준의 / 로 나눈 경로로. vitest 는 윈도우에서도 / 로 적고 ROOT 는 역슬래시라 글자로 빼지 않는다. */
const unitFileName = (name) => rel(name);

// 0. 이전 결과를 지운다. 보고서는 "끝나지 않음"으로 바꿔 둔다(도중에 멈춰도 앞 실행의 "통과"가 남지 않게).
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
rmSync(join(ROOT, 'docs/screens'), { recursive: true, force: true });
mkdirSync(join(ROOT, 'docs'), { recursive: true });
const reportPath = join(ROOT, 'docs/검증결과.md');
const failureReport = (why) =>
  [
    '# 검증 결과',
    '',
    `결론: 검증이 끝나지 않았어요. ${why}`,
    '',
    '이 문서는 `npm run verify`가 실행할 때마다 새로 써요. 손으로 고치지 않아요.',
    '지금 내용은 통과를 뜻하지 않아요. `npm run verify`를 다시 실행해 주세요.',
    '',
  ].join('\n');
writeFileSync(reportPath, failureReport('실행 중이거나 도중에 멈췄어요.'));

// 1. 단위 테스트
const unitRun = run('1. 단위 테스트', npx, ['vitest', 'run', '--reporter=default', '--reporter=json', `--outputFile.json=${join(OUT, 'unit.json')}`]);

// 13. 발행 도구: 커밋된 테스트 전용 발행물(exam-data/testdata, 작업 지시서 3의 6-5)을 실제 Node 로 exams:verify 해 본다.
// 정상(test-only-valid)은 통과, 서명이 틀린 것은 서명에서 실패, 시험 파일 한 바이트가 바뀐 것은 서명은 맞고 sha256 에서 실패해야 한다.
// seq 가 작은 것은 서명과 sha256 이 맞아 통과하고 seq 가 정상보다 작아야 한다(exams:verify 는 받는 쪽이 가진 seq 를 모르니 seq 는 여기서 견준다).
console.log('\n=== 13. 발행 도구: 테스트 전용 발행물을 실제 Node 의 exams:verify 로 확인 ===');
const TESTDATA_DIR = join(ROOT, 'exam-data', 'testdata');
const TESTDATA_CASES = [
  { folder: 'test-only-valid', expect: 'pass', receiver: '받아들임', want: '통과' },
  { folder: 'test-only-bad-signature', expect: 'signature', receiver: '서명이 맞지 않아 버림', want: '서명에서 실패' },
  { folder: 'test-only-changed-byte', expect: 'sha256', receiver: 'sha256 이 맞지 않아 버림', want: '서명은 맞고 sha256 에서 실패' },
  { folder: 'test-only-older-seq', expect: 'older', receiver: '정상을 받은 뒤라면 seq 가 작아 버림', want: '통과하고 seq 가 test-only-valid 보다 작음' },
];
const testdataRows = TESTDATA_CASES.map((c) => {
  const r = spawnSync(
    process.execPath,
    [join(ROOT, 'scripts/exams.mjs'), 'verify', join(TESTDATA_DIR, c.folder), '--key', join(TESTDATA_DIR, 'test-only-public-key.txt')],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, INIT_CWD: ROOT }, timeout: 60000 },
  );
  const stdout = r.stdout ?? '';
  const stderr = r.stderr ?? '';
  const seq = /^seq (\d+), issuedAt /m.exec(stdout);
  const reasons = /이유 (\d+)개/.exec(stderr);
  return {
    ...c,
    status: r.status,
    signed: stdout.includes('서명이 맞아요(index.json.sig).'),
    signatureWrong: stderr.includes('서명이 맞지 않아요(index.json.sig)'),
    shaWrong: stderr.includes('sha256 이 index.json 에 적힌 값과 달라요'),
    reasons: reasons ? Number(reasons[1]) : 0,
    seq: seq ? Number(seq[1]) : null,
    ok: false,
  };
});
const validSeq = testdataRows.find((r) => r.expect === 'pass')?.seq ?? null;
for (const row of testdataRows) {
  if (row.expect === 'pass') row.ok = row.status === 0 && row.signed && !row.shaWrong && row.seq !== null;
  else if (row.expect === 'signature') row.ok = row.status === 1 && row.signatureWrong && !row.signed && row.reasons === 1;
  else if (row.expect === 'sha256') row.ok = row.status === 1 && row.signed && row.shaWrong && row.reasons === 1;
  else row.ok = row.status === 0 && row.signed && !row.shaWrong && row.seq !== null && validSeq !== null && row.seq < validSeq;
  console.log(`${row.folder}: 종료 코드 ${row.status}, 서명 ${row.signed ? '맞음' : '맞지 않거나 보지 못함'}, seq ${row.seq ?? '읽지 못함'}. 기대(${row.want})${row.ok ? '대로예요' : '와 달라요'}.`);
}
// 도구를 돌리지 못한 것(종료 코드가 없음: 제한 시간, 실행 실패)은 실행 단계의 실패로도 적는다.
const testdataRan = testdataRows.every((r) => r.status === 0 || r.status === 1);
const testdataOk = testdataRows.length === TESTDATA_CASES.length && testdataRows.every((r) => r.ok);

// 빌드(타입 검사 포함), 단일 HTML, 검증용 변형 빌드, 아티팩트용 파일
const buildRun = run('빌드', npm, ['run', 'build']);
const singleRun = run('단일 HTML 빌드', npm, ['run', 'build:single']);
const variantRun = run('검증용 변형 빌드(정답만 다른 시험 A, 등급컷이 없는 시험 B)', npm, ['run', 'build:variant']);
const artifactRun = run('아티팩트용 파일', process.execPath, [join(ROOT, 'scripts/make-artifact.mjs')]);
const buildsOk = buildRun.ok && singleRun.ok && variantRun.ok && artifactRun.ok;

// 8. 색 대비 계산
const contrastRun = run('8. 색 대비 계산', process.execPath, [join(ROOT, 'scripts/check-contrast.mjs')]);

// 2, 3, 4, 5, 6, 7(화면), 8(그려진 색), 9, 10. 브라우저로 화면 검사
const e2eRun = buildsOk ? run('2~10, 12. 화면 검사(앱용 묶음 포함)', npx, ['playwright', 'test', '--trace', 'off']) : { ok: false, seconds: 0 };

// 11. 앱용 묶음: 커밋된 묶음이 지금 코드로 다시 만든 것과 같은지. 두 번 만들어 같은 코드에서 같은 묶음이 나오는지도 본다.
console.log('\n=== 11. 앱용 묶음 다시 만들어 견주기 ===');
// "커밋된 묶음"은 작업 폴더의 파일이 아니라 HEAD 에 든 파일이다. 세 파일이 추적되고 작업 폴더와 같아야 하고,
// manifest 의 commit 은 HEAD 의 조상이면서 그 뒤로 묶음에 들어가는 파일(APP_INPUTS)이 바뀌지 않았어야 한다.
const APP_WEB_REL = 'ios/ScoreAnatomy/Web';
const gitRun = (args, encoding = 'utf8') => spawnSync('git', args, { cwd: ROOT, encoding, maxBuffer: 64 * 1024 * 1024 });
const gitOk = (args) => gitRun(args).status === 0;
const appCheck = {
  ran: false,
  error: null,
  rows: [],
  manifest: null,
  pkgVersion: null,
  tracked: false,
  clean: false,
  dirtyFlag: null,
  ancestor: false,
  inputsSame: false,
  // 작업 지시서 4의 2-4: 커밋된 앱용 묶음의 내용이 origin/main 의 것과 다르면 manifest 의 version 도 달라야 한다.
  // status 는 'ok'(규칙을 지킴), 'fail'(같은 version 인데 SHA-256 이 다름), 'unchecked'(origin/main 을 읽지 못함, 실패로 치지 않음).
  mainRule: { status: 'unchecked', mainCommit: null, mainVersion: null, changed: [], reason: '' },
};
try {
  const first = buildAll(join(OUT, 'app-check-1'));
  const second = buildAll(join(OUT, 'app-check-2'));
  appCheck.manifest = readJson(join(APP_WEB_DIR, 'manifest.json'));
  appCheck.pkgVersion = readJson(join(ROOT, 'package.json'))?.version ?? null;
  const committedFiles = [...BUNDLES.map((m) => `${m}/index.html`), 'manifest.json'];
  appCheck.tracked = committedFiles.every((f) => gitOk(['ls-files', '--error-unmatch', `${APP_WEB_REL}/${f}`]));
  const status = gitRun(['status', '--porcelain', '--', APP_WEB_REL]);
  appCheck.clean = status.status === 0 && status.stdout.trim() === '';
  appCheck.dirtyFlag = appCheck.manifest?.dirty ?? null;
  const commit = appCheck.manifest?.commit;
  appCheck.ancestor = typeof commit === 'string' && /^[0-9a-f]{40}$/.test(commit) && gitOk(['merge-base', '--is-ancestor', commit, 'HEAD']);
  appCheck.inputsSame = appCheck.ancestor && gitOk(['diff', '--quiet', commit, 'HEAD', '--', ...APP_INPUTS]);
  for (const mode of BUNDLES) {
    const key = `${mode}/index.html`;
    const shown = gitRun(['show', `HEAD:${APP_WEB_REL}/${key}`], 'buffer');
    const committed = shown.status === 0 ? shown.stdout : null;
    appCheck.rows.push({
      key,
      committed: committed ? createHash('sha256').update(committed).digest('hex') : null,
      committedBytes: committed ? committed.length : null,
      rebuilt: first[key]?.sha256 ?? null,
      again: second[key]?.sha256 ?? null,
      manifest: appCheck.manifest?.files?.[key]?.sha256 ?? null,
    });
  }
  // origin/main 은 마지막으로 git fetch 한 때의 것이다(verify 는 통신하지 않는다). 읽지 못하면 확인하지 못함으로 둔다.
  const mainHead = gitRun(['rev-parse', '--verify', '--quiet', 'origin/main^{commit}']);
  const mainManifestRaw = mainHead.status === 0 ? gitRun(['show', `origin/main:${APP_WEB_REL}/manifest.json`]) : null;
  let mainManifest = null;
  try {
    mainManifest = mainManifestRaw && mainManifestRaw.status === 0 ? JSON.parse(mainManifestRaw.stdout) : null;
  } catch {
    mainManifest = null;
  }
  if (mainHead.status !== 0) appCheck.mainRule.reason = 'origin/main 을 찾지 못했어요';
  else if (mainManifest === null) appCheck.mainRule.reason = 'origin/main 의 manifest.json 을 읽지 못했어요';
  else {
    appCheck.mainRule.mainCommit = mainHead.stdout.trim();
    appCheck.mainRule.mainVersion = typeof mainManifest.version === 'string' ? mainManifest.version : null;
    let unreadable = false;
    for (const mode of BUNDLES) {
      const key = `${mode}/index.html`;
      const shown = gitRun(['show', `origin/main:${APP_WEB_REL}/${key}`], 'buffer');
      if (shown.status !== 0) {
        unreadable = true;
        continue;
      }
      const mainSha = createHash('sha256').update(shown.stdout).digest('hex');
      const mine = appCheck.rows.find((r) => r.key === key)?.committed ?? null;
      if (mine !== mainSha) appCheck.mainRule.changed.push(key);
    }
    if (unreadable) appCheck.mainRule.reason = 'origin/main 의 묶음 파일을 읽지 못했어요';
    else
      appCheck.mainRule.status =
        appCheck.mainRule.changed.length > 0 && appCheck.manifest?.version === appCheck.mainRule.mainVersion ? 'fail' : 'ok';
  }
  appCheck.ran = true;
  for (const r of appCheck.rows) console.log(`${r.key}: 커밋된 것 ${r.committed}, 다시 만든 것 ${r.rebuilt}, 한 번 더 ${r.again}, manifest ${r.manifest}`);
  console.log(
    `origin/main 과 견줌: ${appCheck.mainRule.status === 'unchecked' ? `확인하지 못함(${appCheck.mainRule.reason})` : `커밋 ${appCheck.mainRule.mainCommit.slice(0, 7)}, 버전 ${appCheck.mainRule.mainVersion} 에서 ${appCheck.manifest?.version}, 내용이 다른 묶음 ${appCheck.mainRule.changed.length}개, ${appCheck.mainRule.status === 'ok' ? '규칙을 지킴' : '같은 버전인데 내용이 달라요'}`}`,
  );
  console.log(
    `추적됨 ${appCheck.tracked}, 작업 폴더와 같음 ${appCheck.clean}, manifest dirty ${appCheck.dirtyFlag}, manifest 커밋이 HEAD 의 조상 ${appCheck.ancestor}, 그 뒤로 묶음 재료가 그대로 ${appCheck.inputsSame}`,
  );
} catch (e) {
  appCheck.error = e instanceof Error ? e.message : String(e);
  console.log(`앱용 묶음을 만들지 못했어요: ${appCheck.error}`);
}

// 12번 가운데 WebKit: Playwright 의 WebKit 이 설치돼 있을 때만 앱 시험용 묶음의 흐름을 한 번 돌린다.
let webkitPath = '';
try {
  webkitPath = require('@playwright/test').webkit.executablePath();
} catch {
  webkitPath = '';
}
const webkitInstalled = webkitPath !== '' && existsSync(webkitPath);
let webkitRun = { ok: false, seconds: 0 };
if (webkitInstalled) {
  console.log('\n=== 12. WebKit 으로 앱 시험용 묶음 흐름 ===');
  const t = Date.now();
  const r = spawnTool(npx, ['playwright', 'test', '--project=webkit', '--trace', 'off', '--reporter=list,json'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '0', SA_REUSE_SERVER: '', SA_WEBKIT: '1', PLAYWRIGHT_JSON_OUTPUT_NAME: join(OUT, 'webkit.json') },
  });
  webkitRun = { ok: r.status === 0, seconds: (Date.now() - t) / 1000 };
  console.log(`--- WebKit: ${webkitRun.ok ? '통과' : '실패'}`);
} else {
  console.log('\nWebKit 이 설치돼 있지 않아 앱 묶음의 WebKit 흐름은 확인하지 못했어요(npx playwright install webkit).');
}

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
// 13번: 발행 도구(scripts/exams 아래 파일)의 단위 테스트만 고른다.
const toolFiles = unit ? unit.testResults.filter((f) => unitFileName(f.name).startsWith('scripts/exams/')) : [];
const toolTests = toolFiles.flatMap((f) => f.assertionResults);
const toolPassed = toolTests.filter((t) => t.status === 'passed');
const toolFailed = toolTests.filter((t) => t.status === 'failed');
const toolSkipped = toolTests.filter((t) => t.status !== 'passed' && t.status !== 'failed');
// 통과도 실패도 못 한 파일(읽다가 오류가 난 파일 등)도 실패로 센다.
const toolBadFiles = toolFiles.filter((f) => f.status !== 'passed');
const missingTool = REQUIRED_TOOL_TESTS.filter((name) => !toolTests.some((t) => t.fullName === name && t.status === 'passed'));
// 작업 지시서 1의 5장: 기다리지 않는 좌표 누름 테스트와 3-2 (f)의 뒷부분(화면 테스트가 맡는다, 결정기록 97번).
// 채점한 기록의 표시 화면에서 처음 바꾸는 칸의 두 번 누름(별도 검토 C10, 결정기록 7.7)도 여기에 둔다.
// 지워지거나 이름이 바뀌어 빠지면 2번 항목이 실패한다.
const REQUIRED_E2E_TESTS = [
  '표시가 0개일 때 같은 칸을 0.2초 간격으로 두 번 누르면 "찍음"이 된다(채점 버튼 라벨이 바뀌어도 둘째 누름을 버리지 않는다)',
  '채점한 기록에서 표시를 처음 바꿀 때 같은 칸을 0.2초 간격으로 두 번 누르면 "찍음"이 되고 다른 칸은 눌리지 않는다(안내 줄이 생겨도 칸 격자가 밀리지 않는다)',
  '잠금 뒤에 0.3초 간격으로 이어 누른 답 키는 어디에도 들어가지 않는다',
  '마지막 문항 뒤에 이어 누른 키가 입력 확인의 버튼을 누르지 않는다',
  '다 찬 상태에서 9번을 고친 뒤 이어 누른 키는 9번을 다시 바꾸지 않고 입력 확인의 버튼도 누르지 않는다',
];
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
// 요청 기록: 화면 검사(Chromium)와 WebKit 흐름을 따로 센다. 밖으로 나간 요청은 둘 다 0건이어야 한다.
const net = metrics.filter((m) => m.kind === 'network' && m.project !== 'webkit');
const netWebkit = metrics.filter((m) => m.kind === 'network' && m.project === 'webkit');
const leaks = metrics.filter((m) => m.kind === 'leak');
const leakControls = metrics.filter((m) => m.kind === 'leak-control');
const leakDiffRaw = metrics.find((m) => m.kind === 'leak-diff') ?? null;
// 보고서가 읽는 칸의 모양을 맞춘다. 칸이 빠졌는지는 아래 leaksComplete 가 원래 기록으로 따로 본다.
const leakDiff = leakDiffRaw
  ? {
      ...leakDiffRaw,
      compared: Number.isInteger(leakDiffRaw.compared) ? leakDiffRaw.compared : 0,
      differences: Array.isArray(leakDiffRaw.differences) ? leakDiffRaw.differences : [],
    }
  : null;
const flows = metrics.filter((m) => m.kind === 'flow');
const small = metrics.filter((m) => m.kind === 'small');
const tours = metrics.filter((m) => m.kind === 'tour');
const conditions = metrics.filter((m) => m.kind === 'condition');
const single = metrics.find((m) => m.kind === 'single') ?? null;
const appFlows = metrics.filter((m) => m.kind === 'app');
const appFonts = metrics.filter((m) => m.kind === 'app-font');
const appReleaseText = metrics.find((m) => m.kind === 'app-release-text') ?? null;
const webkitMetric = metrics.find((m) => m.kind === 'webkit') ?? null;
const artifact = metrics.find((m) => m.kind === 'artifact') ?? null;

/** 보고서에 적을 값. 잰 값이 없으면(null, NaN) "없음"으로 적는다. */
const shown = (v) => (v === null || v === undefined || Number.isNaN(v) ? '없음' : v);
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
  shots: 79, // 화면 코스의 캡처 장수(밝은 화면, 어두운 화면, 작은 화면 묶음마다)
  auditStates: 374, // 화면 검사를 거친 화면 상태 수의 최소
  smallStates: 133, // 작은 화면(360x640)에서 검사한 화면 상태 수의 최소
  e2eTests: 208, // 실제로 돈 화면 테스트 수의 최소(건너뛴 것은 세지 않는다). 작업 지시서 3-1에서 56개 늘었다(fill 34, iosweb 22). 표시 화면의 자리 밀림(별도 검토 C10)에서 2개 늘었다(rhythm 1, fill 1).
  unitTests: 461, // 통과한 단위 테스트 수의 최소. 작업 지시서 3-1에서 1개 늘었다(채운 누름 세기).
  toolTests: 104, // 통과한 발행 도구(scripts/exams) 단위 테스트 수의 최소(13번)
  leakChecks: 64, // 화면 글자와 속성을 읽는 정답 노출 검사 횟수의 최소
  leakCompared: 25, // 정답만 다른 두 빌드의 화면을 통째로 견준 곳의 최소
  leakControls: 4, // 정답을 연 뒤에는 노출을 잡아내는지 보는 대조 검사 횟수의 최소
  fitStates: 68, // 작은 화면에서 스크롤 없이 들어와야 하는 답 입력 상태 수의 최소
  appTests: 40, // 앱용 묶음 화면 테스트(e2e/app.spec.ts) 수
  appRemoteTests: 21, // 넘겨받기 화면 테스트(e2e/appRemote.spec.ts, 가짜 다리 규격 2, 작업 지시서 3의 8장과 별도 검토) 수
  appStyleTests: 3, // 배포용 묶음과 시험용 묶음의 모양 비교 화면 테스트(e2e/appStyle.spec.ts) 수
  // 빠진 누름 채우기 화면 테스트(e2e/fill.spec.ts, 작업 지시서 3-1의 3-1) 수. 별도 검토 C10 에서 1개 늘었다(채점한 기록에서 처음 바꾸는 표시 칸).
  // 작업 지시서 4의 2-2(누르는 동안 온 dblclick 으로 채우기)에서 27개 늘었다(같은 결과 14, 채우는 경우와 채우지 않는 경우 10, 세 번 누름 2, 측정 1).
  fillTests: 62,
  iosWebTests: 22, // 아이폰에서 찾은 보기 문제 화면 테스트(e2e/iosweb.spec.ts, 작업 지시서 3-1의 3-2 ~ 3-5) 수
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
const AUDIT_FLAGS = ['mustFit', 'scrolls', 'horizontalOverflow'];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const auditsComplete = audits.every(
  (a) =>
    typeof a.name === 'string' &&
    typeof a.run === 'string' &&
    AUDIT_LISTS.every((k) => Array.isArray(a[k])) &&
    AUDIT_NUMBERS.every((k) => isNum(a[k])) &&
    AUDIT_FLAGS.every((k) => typeof a[k] === 'boolean') &&
    // 최저값 칸: 검사한 것이 있으면 숫자여야 한다. 검사한 것이 없는 화면에서는 비어 있어도 된다.
    (a.targetCount === 0 || (isNum(a.minTargetW) && isNum(a.minTargetH))) &&
    (a.contrastCount === 0 || isNum(a.minContrast)) &&
    (a.edgeCount === 0 || isNum(a.minEdgeContrast)) &&
    (a.minGap === null || isNum(a.minGap)),
);
const leaksComplete =
  leaks.every((l) => Array.isArray(l.leaks)) &&
  leakControls.every((c) => Number.isInteger(c.caught27) && Number.isInteger(c.caught15)) &&
  (leakDiffRaw === null ||
    (Number.isInteger(leakDiffRaw.compared) &&
      Array.isArray(leakDiffRaw.differences) &&
      typeof leakDiffRaw.controlShort === 'boolean' &&
      typeof leakDiffRaw.controlMc === 'boolean'));
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
const missingE2e = REQUIRED_E2E_TESTS.filter((title) => !tests.some((t) => t.file.endsWith('rhythm.spec.ts') && t.title === title && t.ok));
// 작업 지시서 3-1: 빠진 누름 채우기(3-1)와 아이폰에서 찾은 보기 문제(3-2 ~ 3-5)의 화면 테스트. 줄거나 실패하면 2번 항목이 실패한다.
const fillTests = byFile('fill.spec.ts');
const iosWebTests = byFile('iosweb.spec.ts');
const fillOk = allOk(fillTests) && fillTests.length === REQUIRED.fillTests;
const iosWebOk = allOk(iosWebTests) && iosWebTests.length === REQUIRED.iosWebTests;
const flowOk = allOk(flowTests) && flowTests.length === 4 && flows.length === 4 && missingE2e.length === 0 && fillOk && iosWebOk;
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
const appRowsOk =
  appCheck.ran &&
  appCheck.rows.length === BUNDLES.length &&
  appCheck.rows.every((r) => r.committed !== null && r.committed === r.rebuilt && r.rebuilt === r.again && r.manifest === r.committed);
const manifestOk =
  appCheck.manifest !== null &&
  appCheck.manifest.version === appCheck.pkgVersion &&
  appCheck.manifest.bridge === BRIDGE_VERSION &&
  appCheck.manifest.bridgeMax === BRIDGE_MAX &&
  appCheck.dirtyFlag === false &&
  appCheck.tracked &&
  appCheck.clean &&
  appCheck.ancestor &&
  appCheck.inputsSame &&
  appCheck.mainRule.status !== 'fail';
const appBuildOk = appRowsOk && manifestOk;
const appTests = byFile('app.spec.ts');
const appTestsOk = allOk(appTests) && appTests.length === REQUIRED.appTests;
// 넘겨받기 화면 테스트도 정해 둔 수와 같아야 한다(파일 이름이 app.spec.ts 로 끝나지 않아 위의 수에는 들지 않는다).
const appRemoteTests = byFile('appRemote.spec.ts');
const appRemoteOk = allOk(appRemoteTests) && appRemoteTests.length === REQUIRED.appRemoteTests;
// 배포용 묶음의 모양 비교 화면 테스트도 정해 둔 수와 같아야 한다. 일반 화면이 쓰는 CSS 규칙이 도구 모듈 옆 파일에 들어가
// 배포용 묶음에서만 빠지는 일(작업 지시서 3의 3부 앞에서 고친 결함)을 화면에서 잡는다.
const appStyleTests = byFile('appStyle.spec.ts');
const appStyleOk = allOk(appStyleTests) && appStyleTests.length === REQUIRED.appStyleTests;
const appMetricsOk =
  appFlows.length === 2 &&
  appFlows.every((m) => m.score === 78 && m.steps === 3) &&
  appFonts.length === 6 &&
  BUNDLES.every((b) => appFonts.filter((m) => m.bundle === b).length === 3) &&
  appReleaseText !== null &&
  appReleaseText.found === 0 &&
  appReleaseText.checked > 0;
const webkitOk =
  !webkitInstalled ||
  (webkitRun.ok && webkitMetric !== null && webkitMetric.score === 78 && netWebkit.length === 1 && netWebkit.every((n) => Array.isArray(n.external) && n.external.length === 0));
const appOk = appTestsOk && appRemoteOk && appStyleOk && appMetricsOk && webkitOk;
// 13번: 발행 도구의 단위 테스트가 모두 통과하고(건너뛴 것 없음), 꼭 있어야 하는 테스트가 모두 있고, 테스트 전용 발행물 네 가지가 기대대로다.
const toolOk =
  unit !== null &&
  toolFiles.length > 0 &&
  toolBadFiles.length === 0 &&
  toolFailed.length === 0 &&
  toolSkipped.length === 0 &&
  toolPassed.length >= REQUIRED.toolTests &&
  missingTool.length === 0 &&
  testdataOk;

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
  ['앱용 묶음 다시 만들기', appCheck.ran],
  ...(webkitInstalled ? [['WebKit 흐름 실행', webkitRun.ok]] : []),
  ['테스트 전용 발행물 확인 실행(exams:verify)', testdataRan],
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
  // 화면 검사(playwright.config.ts)와 같은 브라우저를 띄운다. Playwright 브라우저가 없으면 시스템 크롬을 쓴다.
  const launch = [
    "const { chromium } = require('@playwright/test');",
    "const { existsSync } = require('node:fs');",
    'let o = {};',
    'if (process.env.SA_CHROMIUM_PATH) o = { executablePath: process.env.SA_CHROMIUM_PATH };',
    'else if (process.env.SA_BROWSER_CHANNEL) o = { channel: process.env.SA_BROWSER_CHANNEL };',
    "else { let p = ''; try { p = chromium.executablePath(); } catch {} if (!p || !existsSync(p)) o = { channel: 'chrome' }; }",
    'chromium.launch(o).then(async (b) => { console.log(b.version()); await b.close(); });',
  ].join('\n');
  const out = spawnSync(process.execPath, ['-e', launch], {
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
        ? `${unit.numTotalTests}개 가운데 ${unit.numPassedTests}개 통과, 실패 ${unit.numFailedTests}개, 건너뛴 것 ${skippedUnit.length}개, 읽지 못했거나 실패한 테스트 파일 ${failedUnitFiles}개. 꼭 있어야 하는 테스트(검산 예시, 추가 경우, 작업 지시서 1과 3의 꼭 넣을 테스트) ${REQUIRED_UNIT_TESTS.length}개 가운데 ${REQUIRED_UNIT_TESTS.length - missingUnit.length}개 확인${short('통과한 단위 테스트', unit.numPassedTests, REQUIRED.unitTests)}${unitRun.ok ? '' : '. 단위 테스트 실행이 실패로 끝남'}`
        : '결과 파일 없음',
    ],
    [
      '2',
      '화면 흐름(390x844)',
      flowOk,
      `흐름 ${flowTests.length}개 가운데 ${flowTests.filter((t) => t.ok).length}개 통과(시험 A 키패드, 시험 A 5행, 시험 B, 시험 C). 점수 해부의 78, 7점, 8점, 3~7점, 약 75점, 6~10점 확인. 꼭 있어야 하는 기다리지 않는 좌표 누름 테스트 ${REQUIRED_E2E_TESTS.length}개 가운데 ${REQUIRED_E2E_TESTS.length - missingE2e.length}개 통과. 빠진 누름 채우기 테스트(e2e/fill.spec.ts) ${fillTests.length}개 가운데 ${fillTests.filter((t) => t.ok).length}개 통과(기대 ${REQUIRED.fillTests}개). 아이폰에서 찾은 보기 문제 테스트(e2e/iosweb.spec.ts) ${iosWebTests.length}개 가운데 ${iosWebTests.filter((t) => t.ok).length}개 통과(기대 ${REQUIRED.iosWebTests}개)`,
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
      `화면 상태 ${audits.length}개에서 보이는 글자 ${sum(audits, (a) => a.textCount)}개 검사. 가장 작은 글자 ${shown(min(audits, (a) => a.minFont))}px, 13px 미만 ${count(audits, (a) => a.smallText)}개, 16px 미만인 입력 칸 ${count(audits, (a) => a.smallInputs)}개${stateNote}`,
    ],
    [
      '5',
      '터치 영역 48x48px 이상',
      targetOk,
      `조작 요소 ${sum(audits, (a) => a.targetCount)}개 검사. 가장 작은 폭 ${shown(min(withTargets, (a) => a.minTargetW))}px, 가장 작은 높이 ${shown(min(withTargets, (a) => a.minTargetH))}px, 48px 미만 ${count(audits, (a) => a.smallTargets)}개. 예외 없음(폭 360px 미만은 지원 범위 밖이라 검사 대상이 아님)${stateNote}`,
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
        ? `색 값 계산: 글자 조합 최저 ${min(contrast.rows.filter((r) => r.min === 4.5), (r) => r.ratio).toFixed(2)}:1(기준 4.5:1), 테두리와 윤곽 최저 ${min(contrast.rows.filter((r) => r.min === 3), (r) => r.ratio).toFixed(2)}:1(기준 3:1), 조합 ${contrast.rows.length}개 가운데 실패 ${contrast.rows.filter((r) => !r.pass).length}개. 그려진 글자 ${sum(audits, (a) => a.contrastCount)}개의 실제 대비 최저 ${shown(min(withText, (a) => a.minContrast))}:1(4.5:1 미만 ${count(audits, (a) => a.lowContrast)}개), 그려진 입력 테두리와 그래프 윤곽 ${sum(audits, (a) => a.edgeCount)}개의 실제 대비 최저 ${shown(min(withEdges, (a) => a.minEdgeContrast))}:1(3:1 미만 ${count(audits, (a) => a.lowEdges)}개)${stateNote}`
        : '결과 파일 없음',
    ],
    [
      '9',
      '정답 노출',
      leakOk,
      `정답만 다른 두 빌드의 화면 ${leakDiff ? leakDiff.compared : 0}곳을 통째로 견줌: 다른 곳 ${leakDiff ? leakDiff.differences.length : '?'}곳. 화면 글자와 속성을 읽는 검사 ${leaks.length}번: 노출 ${count(leaks, (l) => l.leaks)}건. 대조 검사에서 "정답 보기"를 누른 뒤에는 두 검사 모두 노출을 잡아냄${short('화면을 읽는 검사', leaks.length, REQUIRED.leakChecks, '번')}${short('두 빌드를 견준 화면', leakDiff ? leakDiff.compared : 0, REQUIRED.leakCompared, '곳')}${short('대조 검사', leakControls.length, REQUIRED.leakControls, '번')}${incomplete(leaksComplete, '정답 노출 검사 기록')}`,
    ],
    ['10', '화면 캡처', shotsOk, `밝은 화면 ${shots.light}장, 어두운 화면 ${shots.dark}장(390x844, 2배 해상도), 작은 화면 ${shots.small}장(360x640). 기대한 장수는 묶음마다 ${expectedShots}장`],
    [
      '11',
      '앱용 묶음이 지금 코드로 다시 만든 것과 같음',
      appBuildOk,
      appCheck.ran
        ? `HEAD 에 커밋된 ${appCheck.rows.map((r) => `${r.key} ${r.committed === r.rebuilt ? '같음' : '다름'}(두 번 만든 것끼리 ${r.rebuilt === r.again ? '같음' : '다름'}, manifest 와 ${r.manifest === r.committed ? '같음' : '다름'}, ${r.committedBytes === null ? '커밋에 없음' : `${Math.round(r.committedBytes / 1024)} KB`})`).join(', ')}. 세 파일 추적 ${appCheck.tracked ? '됨' : '안 됨'}, 작업 폴더와 ${appCheck.clean ? '같음' : '다름'}. manifest: 버전 ${appCheck.manifest?.version ?? '없음'}(package.json ${appCheck.pkgVersion}), 다리 규격 bridge ${appCheck.manifest?.bridge ?? '없음'}(src/platform/app.ts 의 BRIDGE_VERSION ${BRIDGE_VERSION}), bridgeMax ${appCheck.manifest?.bridgeMax ?? '없음'}(BRIDGE_MAX ${BRIDGE_MAX}), 커밋 ${appCheck.manifest?.commit ? appCheck.manifest.commit.slice(0, 7) : '없음'}(dirty ${appCheck.dirtyFlag}, HEAD 의 조상 ${appCheck.ancestor ? '맞음' : '아님'}, 그 뒤로 묶음 재료 ${appCheck.inputsSame ? '그대로' : '바뀜'}). 묶음 내용이 바뀌면 버전도 바뀌어야 함(origin/main 과 견줌): ${appCheck.mainRule.status === 'unchecked' ? `확인하지 못함(${appCheck.mainRule.reason})` : `origin/main ${appCheck.mainRule.mainCommit.slice(0, 7)} 의 버전 ${appCheck.mainRule.mainVersion}, 내용이 다른 묶음 ${appCheck.mainRule.changed.length}개, ${appCheck.mainRule.status === 'ok' ? '지킴' : '같은 버전인데 내용이 다름'}`}`
        : `만들지 못함: ${appCheck.error ?? '알 수 없음'}`,
    ],
    [
      '12',
      '앱용 묶음 검사(가짜 다리)',
      appOk,
      `앱 묶음 화면 테스트 ${appTests.length}개 가운데 ${appTests.filter((t) => t.ok).length}개 통과(기대 ${REQUIRED.appTests}개). 넘겨받기 화면 테스트(가짜 다리 규격 2, e2e/appRemote.spec.ts) ${appRemoteTests.length}개 가운데 ${appRemoteTests.filter((t) => t.ok).length}개 통과(기대 ${REQUIRED.appRemoteTests}개). 모양 비교 화면 테스트(배포용 묶음과 시험용 묶음을 같은 기록, 같은 화면 상태로 열어 계산된 모양을 견줌, e2e/appStyle.spec.ts) ${appStyleTests.length}개 가운데 ${appStyleTests.filter((t) => t.ok).length}개 통과(기대 ${REQUIRED.appStyleTests}개). 예시 시험 A 흐름 ${appFlows.length}개(${appFlows.map((m) => `${m.bundle} ${m.score}점, 계단 ${m.steps}개, 저장 ${m.saves}번`).join(', ')}). 글자 크기 ${BUNDLES.map((b) => `${b} ${appFonts.filter((m) => m.bundle === b).map((m) => `${m.scale}배`).join(', ')}`).join(', ')}에서 답 입력 끝까지. 배포용 묶음에서 찾은 시험용 글자 ${appReleaseText ? `${appReleaseText.checked}개 가운데 ${appReleaseText.found}개` : '없음'}. WebKit: ${webkitInstalled ? (webkitRun.ok ? `통과(${webkitMetric?.version ?? '버전 확인 못 함'})` : '실패') : '확인하지 못함(설치돼 있지 않음)'}`,
    ],
    [
      '13',
      '발행 도구',
      toolOk,
      unit
        ? `발행 도구(scripts/exams)의 단위 테스트 파일 ${toolFiles.length}개, 테스트 ${toolTests.length}개 가운데 ${toolPassed.length}개 통과, 실패 ${toolFailed.length}개, 건너뛴 것 ${toolSkipped.length}개, 읽지 못했거나 실패한 파일 ${toolBadFiles.length}개. 꼭 있어야 하는 테스트(작업 지시서 3의 8장 발행 도구 테스트, 6-1 과 6-4 의 명령, 6-5 테스트 전용 발행물) ${REQUIRED_TOOL_TESTS.length}개 가운데 ${REQUIRED_TOOL_TESTS.length - missingTool.length}개 확인. 테스트 전용 발행물(exam-data/testdata)을 실제 Node 의 exams:verify 로 확인: ${testdataRows.map((r) => `${r.folder} 종료 코드 ${r.status ?? '없음'}, seq ${r.seq ?? '읽지 못함'}(기대 ${r.want}, ${r.ok ? '맞음' : '다름'})`).join(', ')}${short('통과한 발행 도구 단위 테스트', toolPassed.length, REQUIRED.toolTests)}`
        : '결과 파일 없음',
    ],
  ];
  const failed = items.filter((i) => !i[2]);
  const otherFailed = tests.filter((t) => !t.ok);

  say('# 검증 결과');
  say();
  const skippedTests = tests.filter((t) => t.skipped);
  say(
    failed.length === 0 && otherFailed.length === 0 && failedSteps.length === 0 && skippedUnit.length === 0
      ? '결론: 자동 검증 13개 항목(10장의 10개, 작업 지시서 1의 앱용 묶음 2개, 작업 지시서 3의 발행 도구 1개)이 모두 통과했어요.'
      : `결론: 실패한 항목이 있어요. 항목 ${failed.length}개, 화면 테스트 ${otherFailed.length}개(건너뛴 것 ${skippedTests.length}개 포함), 건너뛴 단위 테스트 ${skippedUnit.length}개, 실패로 끝난 실행 단계 ${failedSteps.length}개.`,
  );
  say();
  say('이 문서는 `npm run verify`가 실행할 때마다 새로 써요. 손으로 고치지 않아요.');
  say('수치는 모두 이번 실행에서 실제로 잰 값이에요.');
  say();
  say(`- 실행 시각: ${stamp}`);
  say(`- 걸린 시간: ${Math.round((Date.now() - started) / 1000)}초`);
  say(`- 환경: Node ${process.version}, Vite ${ver('vite')}, React ${ver('react')}, Vitest ${ver('vitest')}, Playwright ${ver('@playwright/test')}, Chromium ${browserVersion}(화면 없이 실행), ${process.platform}`);
  say(
    `- 브라우저: 화면 검사는 Chromium 으로 했어요. 앱 시험용 묶음의 흐름은 WebKit 으로도 ${webkitInstalled ? '한 번 돌렸어요(윈도우용 WebKit 이라 아이폰의 WKWebView 와 같지 않아요)' : '돌리지 못했어요(확인하지 못함)'}. 실제 아이폰 Safari, 아이폰 앱, 안드로이드 Chrome 기기에서는 확인하지 못했어요.`,
  );
  say();
  say('## 항목별 결과');
  say();
  say('| 번호 | 항목 | 결과 | 실제 수치 |');
  say('| --- | --- | --- | --- |');
  for (const [no, name, ok, detail] of items) say(`| ${no} | ${name} | ${mark(ok)} | ${detail} |`);
  say();
  if (failed.length > 0 || otherFailed.length > 0 || missingUnit.length > 0 || skippedUnit.length > 0 || failedSteps.length > 0 || missingTool.length > 0 || !testdataOk) {
    say('## 실패한 것');
    say();
    for (const [no, name] of failed) say(`- ${no}번 ${name}`);
    for (const t of otherFailed) say(`- 테스트${t.skipped ? '(건너뜀)' : ''}: ${t.title}`);
    for (const name of missingUnit) say(`- 없거나 통과하지 못한 단위 테스트: ${name}`);
    for (const t of skippedUnit) say(`- 건너뛴 단위 테스트: ${t.fullName}`);
    if (unit) for (const f of unit.testResults.filter((x) => x.status === 'failed' && x.assertionResults.length === 0)) say(`- 읽지 못한 단위 테스트 파일: ${unitFileName(f.name)}`);
    for (const name of missingTool) say(`- 없거나 통과하지 못한 발행 도구 테스트: ${name}`);
    for (const r of testdataRows.filter((x) => !x.ok)) say(`- 테스트 전용 발행물 확인이 기대와 다름: ${r.folder}(기대 ${r.want}, 종료 코드 ${r.status ?? '없음'})`);
    for (const name of failedSteps) say(`- 실패로 끝난 실행 단계: ${name}`);
    say();
  }

  say('## 1. 단위 테스트');
  say();
  if (unit) {
    say('| 파일 | 테스트 수 | 실패 | 건너뜀 |');
    say('| --- | --- | --- | --- |');
    for (const f of unit.testResults) {
      say(`| ${unitFileName(f.name)} | ${f.assertionResults.length} | ${f.assertionResults.filter((a) => a.status === 'failed').length} | ${f.assertionResults.filter((a) => a.status !== 'passed' && a.status !== 'failed').length} |`);
    }
    say();
    say('7장 검산 예시의 기대값(실제 78점, 맞힌 문항 24개, 추측 표시 정답 7점, 찍음 전체 배점 18점, 찍기 운을 평균으로 본 점수 74.6, 실수 표시 오답 8점, 그 외 오답 14점, 등급별 남은 점수, 계단 3개)과');
    say('추가 경우(표시 없음, 전부 정답, 전부 안 풂, 컷 범위 안, 컷 범위 위, 컷 자료 없음, 확정 컷, 섞인 배열 시험 B)는 src/logic/scoring.test.ts 에 있어요.');
    say('작업 지시서 3의 꼭 넣을 테스트는 src/logic/scoring.test.ts(4-2 복수 정답과 모두 정답 처리), src/logic/lock.test.ts(4-5 풀이 잠금), src/screens/correction.test.tsx(4-6 정답 정정 알림)에 있어요.');
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
    say('1.1의 고치는 중과 잠금 상태는 가로 화면(지원 범위 밖)에서 키패드가 화면 아래로 나간 높이를 재서 적기만 했어요(결정기록 98번).');
    say();
    say('| 조건 | 확인한 상태 | 내용이 넘쳐 스크롤이 생긴 높이(최대) | 키패드가 화면 아래로 나간 높이(최대, 결과만 적은 상태) |');
    say('| --- | --- | --- | --- |');
    for (const name of [...new Set(conditions.map((c) => c.name))]) {
      const list = conditions.filter((c) => c.name === name);
      const loose = list.filter((c) => c.strict === false);
      say(
        `| ${name} | ${list.length}개 | ${max(list, (c) => c.overflowPx)}px | ${loose.length > 0 ? `${max(loose, (c) => c.keysCutPx ?? 0)}px(${loose.map((c) => `${c.label} ${c.keysCutPx ?? 0}px`).join(', ')})` : '0px(모든 상태에서 키패드가 화면 안)'} |`,
      );
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
  say(`브라우저가 실제로 그린 글자 ${sum(audits, (a) => a.contrastCount)}개도 계산된 글자색과 바탕색(투명도 포함)으로 다시 쟀어요. 가장 낮은 대비는 ${shown(min(withText, (a) => a.minContrast))}:1, 4.5:1에 못 미친 글자는 ${count(audits, (a) => a.lowContrast)}개예요.`);
  say(`그려진 입력 테두리와 그래프 윤곽(칸, 키, 고르는 줄, 칩, 막대 구간, 진행 막대 등) ${sum(audits, (a) => a.edgeCount)}개도 테두리색(테두리가 없으면 채운 색)과 바깥 바탕색으로 쟀어요. 가장 낮은 대비는 ${shown(min(withEdges, (a) => a.minEdgeContrast))}:1, 3:1에 못 미친 것은 ${count(audits, (a) => a.lowEdges)}개예요.`);
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
  say('"앱 묶음"으로 시작하는 곳은 앱 시험용 묶음에 넘겨받은 테스트 전용 시험의 화면이에요(작업 지시서 3의 5장). 그 시험 파일에서 틀린 문항의 인정하는 답(answer 와 복수 정답 altAnswers)을 모두 찾고, 정답 정정 알림처럼 "정답 보기" 전에 보이는 정정 안내도 함께 봐요. 화면 코스가 "정답 보기"를 누른 뒤에 같은 검사기가 복수 정답을 잡아내는지도 확인해요.');
  say();

  say('## 10. 화면 캡처');
  say();
  say(`- docs/screens/light: 밝은 화면 ${shots.light}장 (390x844, 2배 해상도)`);
  say(`- docs/screens/dark: 어두운 화면 ${shots.dark}장 (390x844, 2배 해상도)`);
  say(`- docs/screens/small: 작은 화면 ${shots.small}장 (360x640)`);
  say();
  say('만든 쪽이 캡처를 열어 보고 고친 내용과 별도 검토 단계가 찾은 것은 docs/화면검토기록.md 에 적어요.');
  say();
  say(`판정에 쓰는 최소 기준: 통과한 단위 테스트 ${REQUIRED.unitTests}개 이상(이번 ${unit ? unit.numPassedTests : 0}개, 건너뛴 것은 없어야 함), 화면 상태 ${REQUIRED.auditStates}개 이상(이번 ${audits.length}개), 작은 화면 상태 ${REQUIRED.smallStates}개 이상(이번 ${smallAudits.length}개), 실제로 돈 화면 테스트 ${REQUIRED.e2eTests}개 이상(이번 ${ranTests.length}개), 요청 기록은 실제로 돈 화면 테스트마다 하나(이번 ${net.length}개), 정답 노출은 화면을 읽는 검사 ${REQUIRED.leakChecks}번 이상(이번 ${leaks.length}번)과 두 빌드를 견준 화면 ${REQUIRED.leakCompared}곳 이상(이번 ${leakDiff ? leakDiff.compared : 0}곳)과 대조 검사 ${REQUIRED.leakControls}번 이상(이번 ${leakControls.length}번), 작은 화면에서 스크롤 없이 들어와야 하는 상태 ${REQUIRED.fitStates}개 이상(이번 ${fitAudits.length}개), 앱용 묶음 화면 테스트는 꼭 ${REQUIRED.appTests}개(이번 ${appTests.length}개), 넘겨받기 화면 테스트는 꼭 ${REQUIRED.appRemoteTests}개(이번 ${appRemoteTests.length}개)와 모양 비교 화면 테스트는 꼭 ${REQUIRED.appStyleTests}개(이번 ${appStyleTests.length}개), 캡처는 묶음마다 ${REQUIRED.shots}장, 통과한 발행 도구 단위 테스트 ${REQUIRED.toolTests}개 이상(이번 ${toolPassed.length}개)과 꼭 있어야 하는 발행 도구 테스트 ${REQUIRED_TOOL_TESTS.length}개, 테스트 전용 발행물 ${TESTDATA_CASES.length}가지(이번 기대대로 ${testdataRows.filter((r) => r.ok).length}가지). 검사가 줄거나 빠지거나 검사 기록에 결과 칸이 비어 있으면 해당 항목이 실패로 적혀요.`);
  say();
  say('화면 검사는 실행할 때마다 지금 폴더의 빌드로 서버를 새로 띄워요. 쓰려는 포트(기본 4173, 4174)에 이미 떠 있는 서버가 있으면 그 서버를 다시 쓰지 않고 실패로 끝나요(떠 있는 서버를 다시 쓰는 스위치 SA_REUSE_SERVER 는 verify 에서는 따르지 않아요).');
  if (!e2eRun.ok) say('이번 실행은 화면 검사가 실패로 끝났어요. 포트가 이미 쓰이고 있어서 서버를 띄우지 못한 것일 수 있어요. 콘솔 출력의 오류를 확인해 주세요.');
  say();

  say('## 13. 발행 도구');
  say();
  say('발행 도구(scripts/exams, 작업 지시서 3의 6장)의 단위 테스트와, 커밋된 테스트 전용 발행물(exam-data/testdata, 6-5)을 실제 Node 의 exams:verify 로 확인한 결과예요.');
  say();
  if (unit) {
    say('| 파일 | 테스트 수 | 통과 | 실패 | 건너뜀 |');
    say('| --- | --- | --- | --- | --- |');
    for (const f of toolFiles) {
      const list = f.assertionResults;
      say(`| ${unitFileName(f.name)} | ${list.length} | ${list.filter((a) => a.status === 'passed').length} | ${list.filter((a) => a.status === 'failed').length} | ${list.filter((a) => a.status !== 'passed' && a.status !== 'failed').length} |`);
    }
    say();
  }
  say(`꼭 있어야 하는 발행 도구 테스트 ${REQUIRED_TOOL_TESTS.length}개(8장의 발행 도구 테스트, 6-1 과 6-4 의 명령이 지켜야 하는 것, 6-5 의 테스트 전용 발행물)의 이름을 따로 확인해요. 지워지거나 이름이 바뀌어 빠지면 13번 항목이 실패해요. 이번에 확인한 것은 ${REQUIRED_TOOL_TESTS.length - missingTool.length}개예요.`);
  say();
  say('| 발행물 | 받는 쪽이 할 일(6-3) | exams:verify 에서 기대한 것 | 종료 코드 | 서명 | seq | 결과 |');
  say('| --- | --- | --- | --- | --- | --- | --- |');
  for (const r of testdataRows) {
    say(`| ${r.folder} | ${r.receiver} | ${r.want} | ${r.status ?? '없음'} | ${r.signed ? '맞음' : r.signatureWrong ? '맞지 않음' : '보지 못함'} | ${r.seq ?? '읽지 못함'} | ${r.ok ? '기대대로' : '기대와 다름'} |`);
  }
  say();
  say('exams:verify 는 받는 쪽이 가진 seq 를 모르니, test-only-older-seq 는 서명과 sha256 이 맞아 통과하는 것과 seq 가 test-only-valid 보다 작은 것을 함께 봐요. 아이폰 껍데기가 이 자료로 받는 쪽 규칙을 지키는지는 작업 지시서 4에서 확인해요.');
  say();

  say('## 자동으로 확인하지 못하는 것');
  say();
  say('- 실제 아이폰 Safari와 안드로이드 Chrome 기기에서의 동작과 터치 감각.');
  say('- 사람이 답 30개를 넣는 데 걸리는 시간과 남는 오입력. 사용성 테스트에서 재야 해요.');
  say('- 결과 화면을 학생이 바르게 읽는지. 사용성 테스트의 읽기 질문으로 확인해야 해요.');
  say('- 화면 낭독기(VoiceOver, TalkBack)로 실제로 들었을 때의 흐름.');
  say('- 아티팩트 뷰어 안에서의 동작. 뼈대와 비슷한 틀에 넣어 여는 것까지만 확인했어요.');
  say('- 아이폰 앱 껍데기(WKWebView) 안에서의 동작: 실제 다리, 햅틱의 느낌, 기기 글자 크기 설정, 길게 누르기와 화면 당김이 실제로 막히는지. 이 검증은 앱용 묶음을 가짜 다리를 넣은 Chromium(과 윈도우용 WebKit)에서만 확인해요. 아이폰 시뮬레이터의 확인은 맥의 ios/scripts/verify.sh 가 하고 결과는 docs/ios_검증결과.md 에 있어요.');
  say('- 아이폰 껍데기가 정해진 주소에서 시험 자료를 받아 서명과 sha256 을 확인하고 받는 쪽 규칙을 지키는지(작업 지시서 4). 이 검증은 발행 도구의 확인(exams:verify)과 테스트 전용 발행물까지만 봐요.');
  say();
  return {
    text: L.join('\n'),
    ok: failed.length === 0 && otherFailed.length === 0 && missingUnit.length === 0 && skippedUnit.length === 0 && failedSteps.length === 0,
  };
}

// 7. 금지 문자 파일 검사. 보고서 자신도 검사 대상이므로, 먼저 보고서를 한 번 쓰고 검사한 뒤 결과를 넣어 다시 쓴다.
// 보고서를 만들다 오류가 나면(검사 기록의 모양이 예상과 다른 경우 등) 통과로 남기지 않고 실패 보고서를 쓴다.
let report;
let textRun;
try {
  writeFileSync(reportPath, buildReport(true, readJson(join(OUT, 'text.json'))).text + '\n');
  textRun = run('7. 금지 문자(파일과 커밋 메시지)', process.execPath, [join(ROOT, 'scripts/check-text.mjs')]);
  const textResult = readJson(join(OUT, 'text.json'));
  report = buildReport(textRun.ok, textResult);
} catch (e) {
  const why = e instanceof Error ? e.message : String(e);
  writeFileSync(reportPath, failureReport(`보고서를 만들다가 오류가 났어요: ${why}`));
  console.error(e);
  console.log(`\n검증 보고서를 만들지 못했어요. 전체 실패 (${Math.round((Date.now() - started) / 1000)}초)`);
  process.exit(1);
}
const selfHits = findForbidden(report.text);
writeFileSync(reportPath, report.text + '\n');

const success = report.ok && selfHits.length === 0 && unitRun.ok && buildsOk && e2eRun.ok && textRun.ok && contrastRun.ok;
console.log(`\n검증 결과를 docs/검증결과.md 에 남겼어요. 전체 ${success ? '통과' : '실패'} (${Math.round((Date.now() - started) / 1000)}초)`);
process.exit(success ? 0 : 1);
