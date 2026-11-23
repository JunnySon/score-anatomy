import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkExam } from '../../src/exams/validate.ts';
import { sha256Hex } from './canonical.ts';
import { LOCKS_FILE, SRC_DIR, STATE_FILE, examPath, sourceJson } from './data.ts';
import type { Io } from './io.ts';
import { initialState, locksSha256, stateEntryOf, stateText } from './state.ts';
import type { ExamState } from './state.ts';

// 발행 도구 테스트의 도우미(테스트 파일이 아님). 모든 쓰기는 os.tmpdir() 아래 임시 폴더에서 하고 테스트가 끝나면 지운다.
// 저장소의 exam-data 는 바꾸지 않는다.
// 시험은 그 자리에서 지은 테스트 전용 시험이다(id 는 예시 시험과 겹치지 않는 test-tool-..., isSample true, 제목에 "테스트 전용").
// 정답, 배점, 컷 값은 실제 시험의 값이 아니다. 날짜와 시각은 작업 지시서의 형식 예시(2030-01-02, 17:10, 20:10)만 쓴다.

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TEST_ID = 'test-tool-a';
export const ISSUED_AT = '2030-01-02T17:10';

/** 테스트 전용 시험(정답 공개 전). 5지선다 4문항(3번은 보기 4개), 단답형 2문항, 만점 20점. */
export function testExam(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: TEST_ID,
    title: '테스트 전용 시험(발행 도구)',
    note: '테스트 전용으로 지은 시험이에요.',
    isSample: true,
    isPast: false,
    answerReleased: false,
    rev: 1,
    items: [
      { no: 1, kind: 'mc', choices: 5, points: 2, typeId: 't01' },
      { no: 2, kind: 'mc', choices: 5, points: 3, typeId: 't01' },
      { no: 3, kind: 'mc', choices: 4, points: 3, typeId: 't02' },
      { no: 4, kind: 'mc', choices: 5, points: 4, typeId: 't02' },
      { no: 5, kind: 'short', points: 4, typeId: 't01' },
      { no: 6, kind: 'short', points: 4, typeId: 't02' },
    ],
    types: { t01: { name: '테스트 유형 가' }, t02: { name: '테스트 유형 나' } },
    ...over,
  };
}

/** 정답 파일 SHEET 와 같은 정답을 넣은 테스트 전용 시험(3번은 복수 정답, 4번은 모두 정답 처리). */
export function releasedExam(over: Record<string, unknown> = {}): Record<string, unknown> {
  const base = testExam();
  const answers: Record<number, Record<string, unknown>> = {
    1: { answer: 3 },
    2: { answer: 5 },
    3: { answer: 2, altAnswers: [4] },
    4: { allCorrect: true },
    5: { answer: 608 },
    6: { answer: 42 },
  };
  const items = (base.items as Record<string, unknown>[]).map((it) => {
    const { typeId, ...rest } = it;
    return { ...rest, ...answers[it.no as number], typeId };
  });
  return { ...base, answerReleased: true, items, ...over };
}

/** releasedExam 과 같은 정답을 적은 정답 파일. */
export const SHEET = ['시험 test-tool-a', '1 3', '2 5', '3 2,4', '4 *', '5 608', '6 42', ''].join('\n');

/** 임시 자료 폴더를 만든다: src/, locks.json(빈 배열), state.json(처음 값). */
export function makeDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sa-exams-'));
  mkdirSync(join(dir, SRC_DIR));
  writeFileSync(join(dir, LOCKS_FILE), '[]\n');
  writeFileSync(join(dir, STATE_FILE), stateText(initialState()));
  return dir;
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** 원본 시험 파일을 원본 모양으로 쓴다(src/<id>.json). */
export function writeExam(dataDir: string, exam: Record<string, unknown>): string {
  const path = examPath(dataDir, String(exam.id));
  writeFileSync(path, sourceJson(exam));
  return path;
}

export function readExam(dataDir: string, id = TEST_ID): Record<string, unknown> {
  return JSON.parse(readFileSync(examPath(dataDir, id), 'utf8')) as Record<string, unknown>;
}

export function writeLocks(dataDir: string, locks: unknown): void {
  writeFileSync(join(dataDir, LOCKS_FILE), `${JSON.stringify(locks, null, 2)}\n`);
}

/**
 * 앞서 이 시험들을 발행한 것처럼 state.json 을 쓴다. exams:publish 는 다음 단계에서 만들어서,
 * 발행 기록은 publish 가 쓸 함수(state.ts 의 stateEntryOf, locksSha256)로 만든다.
 */
export function markPublished(dataDir: string, exams: readonly Record<string, unknown>[], locks: unknown = []): ExamState {
  const state = initialState();
  state.seq = 1;
  state.issuedAt = ISSUED_AT;
  state.locksSha256 = locksSha256(locks);
  for (const raw of exams) {
    const { exam, errors } = checkExam(raw);
    if (exam === null) throw new Error(`발행해 둘 테스트 시험이 검사를 통과하지 못해요: ${errors.join(' ')}`);
    state.exams[exam.id] = stateEntryOf(exam, `files/${exam.id}.${exam.rev ?? 1}.json`);
  }
  writeFileSync(join(dataDir, STATE_FILE), stateText(state));
  return state;
}

/** 폴더 안 모든 파일의 내용 SHA-256, 크기, 고친 시각. 파일을 쓰지 않았는지 볼 때 쓴다. */
export function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) visit(full);
      else out[relative(dir, full).split('\\').join('/')] = `${sha256Hex(readFileSync(full))} ${st.size} ${st.mtimeMs}`;
    }
  };
  visit(dir);
  return out;
}

/** 출력을 모으는 Io. */
export function collectIo(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (line) => out.push(line), err: (line) => err.push(line) }, out, err };
}

/**
 * 실제 Node 로 도구를 돌린다(npm run exams:<명령> 과 같은 진입점 scripts/exams.mjs, Node 의 타입 지우기로 TypeScript 를 읽는 길).
 * nodeArgs 는 node 에 주는 선택지다. 상대 경로가 저장소 기준이 되도록 INIT_CWD 를 저장소 폴더로 둔다.
 */
export function runTool(args: readonly string[], nodeArgs: readonly string[] = []): { status: number | null; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, INIT_CWD: ROOT };
  delete env.NODE_OPTIONS;
  const r = spawnSync(process.execPath, [...nodeArgs, 'scripts/exams.mjs', ...args], { cwd: ROOT, encoding: 'utf8', env, timeout: 60000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
