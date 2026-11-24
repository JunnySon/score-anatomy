import { spawn, spawnSync } from 'node:child_process';
import { createPrivateKey } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkExam } from '../../src/exams/validate.ts';
import { canonicalJson, sha256Hex } from './canonical.ts';
import { LOCKS_FILE, SRC_DIR, STATE_FILE, examPath, sourceJson } from './data.ts';
import type { Io } from './io.ts';
import { runPublish } from './publish.ts';
import type { PublishOptions } from './publish.ts';
import { generateSigningKey, publicKeyText, signatureText } from './sign.ts';
import { initialState, locksSha256, stateEntryOf, stateText } from './state.ts';
import type { ExamState } from './state.ts';
import { runVerify } from './verify.ts';
import type { VerifyTarget } from './verify.ts';

// 발행 도구 테스트의 도우미(테스트 파일이 아님). 모든 쓰기는 os.tmpdir() 아래 임시 폴더에서 하고 테스트가 끝나면 지운다.
// 저장소의 exam-data 는 바꾸지 않는다.
// 시험은 그 자리에서 지은 테스트 전용 시험이다(id 는 예시 시험과 겹치지 않는 test-tool-..., isSample true, 제목에 "테스트 전용").
// 정답, 배점, 컷 값은 실제 시험의 값이 아니다. 날짜와 시각은 작업 지시서의 형식 예시(2030-01-02, 08:40, 17:10, 17:45, 20:10)만 쓴다.
// 서명 키는 테스트마다 os.tmpdir() 아래에 새로 만드는 임시 키다(진짜 키가 아님). 키 내용은 어디에도 출력하지 않는다.

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
export function runTool(
  args: readonly string[],
  nodeArgs: readonly string[] = [],
  extraEnv: Record<string, string> = {},
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [...nodeArgs, 'scripts/exams.mjs', ...args], { cwd: ROOT, encoding: 'utf8', env: toolEnv(extraEnv), timeout: 60000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** 실제 Node 로 돌리는 도구의 환경 변수. 이 컴퓨터에 SA_EXAM_KEY_FILE 이 있어도 지우고(진짜 키를 쓰지 않게), extraEnv 로 준 것만 더한다. */
function toolEnv(extraEnv: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, INIT_CWD: ROOT };
  delete env.NODE_OPTIONS;
  delete env.SA_EXAM_KEY_FILE;
  return { ...env, ...extraEnv };
}

/** 실제 Node 로 도구를 띄운다(끝날 때까지 기다리지 않음). 서버(serve)를 띄우거나, 같은 테스트 안의 서버에 주소로 붙을 때 쓴다. */
export function startTool(args: readonly string[], extraEnv: Record<string, string> = {}) {
  const child = spawn(process.execPath, ['scripts/exams.mjs', ...args], { cwd: ROOT, env: toolEnv(extraEnv) });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (d: string) => {
    stdout += d;
  });
  child.stderr.on('data', (d: string) => {
    stderr += d;
  });
  const done = new Promise<number | null>((resolveDone) => child.on('close', (code) => resolveDone(code)));
  return {
    child,
    done,
    output: () => ({ stdout, stderr }),
    /** 표준 출력에 re 가 나올 때까지 기다린다. 제한 시간이 지나거나 먼저 끝나면 던진다. */
    async waitFor(re: RegExp, timeoutMs = 30000): Promise<RegExpExecArray> {
      const until = Date.now() + timeoutMs;
      for (;;) {
        const m = re.exec(stdout);
        if (m) return m;
        if (child.exitCode !== null || Date.now() > until) throw new Error(`도구 출력에서 기다린 글자가 나오지 않았어요(종료 코드 ${child.exitCode}).`);
        await new Promise((r) => setTimeout(r, 50));
      }
    },
  };
}

/** 실제 Node 로 도구를 돌리고 끝날 때까지 기다린다(spawnSync 와 달리 같은 테스트의 서버가 그동안 응답할 수 있다). */
export async function runToolAsync(args: readonly string[], extraEnv: Record<string, string> = {}): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const t = startTool(args, extraEnv);
  const status = await t.done;
  return { status, ...t.output() };
}

/** 테스트마다 새로 만드는 임시 서명 키(os.tmpdir() 아래). 진짜 발행에 쓰는 키가 아니다. pem 은 출력에 나오는지 볼 때만 쓴다. */
export interface TempKey {
  dir: string;
  keyFile: string;
  publicFile: string;
  key: KeyObject;
  pem: string;
}

export function makeTempKey(): TempKey {
  const dir = mkdtempSync(join(tmpdir(), 'sa-exams-key-'));
  const { key, pem } = generateSigningKey();
  const keyFile = join(dir, 'test-only-private-key.pem');
  writeFileSync(keyFile, pem, { mode: 0o600 });
  const publicFile = join(dir, 'test-only-public-key.txt');
  writeFileSync(publicFile, publicKeyText(key));
  return { dir, keyFile, publicFile, key, pem };
}

/** 출력에 나오면 안 되는 비밀 키의 글자: PEM 본문 줄, JWK 의 d(base64url), 같은 바이트의 표준 base64 와 16진수. */
export function keySecrets(pem: string): string[] {
  const body = pem.split(/\r?\n/).filter((line) => line !== '' && !line.startsWith('-----'));
  const d = createPrivateKey(pem).export({ format: 'jwk' }).d;
  if (typeof d !== 'string' || body.length === 0) throw new Error('비밀 키의 글자를 찾지 못했어요.');
  const raw = Buffer.from(d, 'base64url');
  return [...body, d, raw.toString('base64'), raw.toString('hex')];
}

/** 글자 안에 든 비밀의 수. 실패해도 비밀 자체가 테스트 출력에 찍히지 않게 수만 견준다. */
export function leakCount(text: string, secrets: readonly string[]): number {
  return secrets.filter((s) => text.includes(s)).length;
}

/** 임시 상위 폴더 안의 발행 폴더 경로(아직 만들지 않음). 상위 폴더도 함께 돌려준다(남은 임시 폴더가 없는지 볼 때). */
export function makeOutDir(): { parent: string; out: string } {
  const parent = mkdtempSync(join(tmpdir(), 'sa-exams-out-'));
  return { parent, out: join(parent, 'dist-exams') };
}

/** 발행한다(runPublish). 비밀 키는 SA_EXAM_KEY_FILE 로만 준다. issuedAt 의 기본은 형식 예시 시각이다. */
export function publishTo(dataDir: string, outDir: string, keyFile: string | null, more: Partial<PublishOptions> = {}) {
  const c = collectIo();
  const code = runPublish(
    {
      dataDir,
      dataName: 'data',
      outDir,
      outName: 'out',
      issuedAt: ISSUED_AT,
      dryRun: false,
      allowSame: false,
      env: keyFile === null ? {} : { SA_EXAM_KEY_FILE: keyFile },
      base: ROOT,
      root: ROOT,
      ...more,
    },
    c.io,
  );
  return { code, out: c.out, err: c.err };
}

/** 발행물을 확인한다(runVerify). target 이 글자면 폴더다. */
export async function verifyWith(target: string | VerifyTarget, keyFile: string, dataDir: string, timeoutMs?: number) {
  const c = collectIo();
  const t: VerifyTarget = typeof target === 'string' ? { kind: 'folder', path: target } : target;
  const code = await runVerify({ target: t, targetName: 'target', keyFile, keyName: 'key', dataDir, timeoutMs }, c.io);
  return { code, out: c.out, err: c.err };
}

/** 폴더 안의 모든 파일(하위 폴더 포함)을 / 로 나눈 상대 경로로. */
export function listFiles(dir: string): string[] {
  return Object.keys(snapshot(dir)).sort();
}

/** 서명한 발행물을 손으로 만든다. verify 의 검사를 보려고 틀린 내용에도 맞는 서명을 붙인다. index 가 글자가 아니면 키를 정렬한 JSON 으로 적는다. */
export function writeSignedRelease(dir: string, index: unknown, files: Record<string, string | Uint8Array>, key: KeyObject): void {
  mkdirSync(dir, { recursive: true });
  for (const [path, data] of Object.entries(files)) {
    const full = join(dir, ...path.split('/'));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
  }
  const text = typeof index === 'string' ? index : canonicalJson(index);
  writeFileSync(join(dir, 'index.json'), text);
  writeFileSync(join(dir, 'index.json.sig'), signatureText(Buffer.from(text, 'utf8'), key));
}

/** 테스트 전용 잠금 항목(형식 예시 시각). */
export const TEST_LOCK = { id: 'test-lock-a', label: '테스트 전용 잠금', start: '2030-01-02T08:40', end: '2030-01-02T17:45' };

export interface ForbiddenScenario {
  /** 어떤 변경인지. */
  label: string;
  /** 발행해 둘 시험. */
  published: Record<string, unknown>;
  /** 발행 뒤에 원본을 바꾼다. */
  change(dir: string): void;
  /** 거부 문장에 들어 있어야 하는 글자. */
  expected: string;
}

// 지시서 6-4 의 "publish 가 거부해야 하는 변경" 일곱 가지. 이름은 지시서의 문장 그대로이고, exams:check 와 exams:publish 의 테스트가 함께 쓰고
// verify 가 이름으로 확인한다. 시나리오마다 published 를 발행해 둔 뒤 change 로 원본을 바꾸면 거부 문장에 expected 가 들어 있어야 한다.
export const FORBIDDEN_CHANGES: { name: string; scenarios: ForbiddenScenario[] }[] = [
  {
    name: '발행했던 시험 id 가 사라짐',
    scenarios: [
      { label: '원본 파일을 지움', published: testExam(), change: (dir) => rmSync(examPath(dir, 'test-tool-a')), expected: '발행했던 시험 test-tool-a 의 원본 파일이 없어요' },
      {
        label: '파일 이름과 id 를 바꿈',
        published: testExam(),
        change: (dir) => {
          rmSync(examPath(dir, 'test-tool-a'));
          writeExam(dir, testExam({ id: 'test-tool-c' }));
        },
        expected: '발행했던 시험 test-tool-a 의 원본 파일이 없어요',
      },
    ],
  },
  {
    name: '내용이 바뀌었는데 rev 가 그대로이거나 rev 가 내려감',
    scenarios: [
      {
        label: '제목을 고치고 rev 그대로',
        published: testExam(),
        change: (dir) => writeExam(dir, testExam({ title: '테스트 전용 시험(제목을 고침)' })),
        expected: '내용이 발행한 판과 다른데 rev 가 그대로예요(1)',
      },
      { label: 'rev 를 내림', published: testExam({ rev: 2 }), change: (dir) => writeExam(dir, testExam({ rev: 1 })), expected: 'rev 가 발행한 판(2)보다 작아요(지금 1)' },
    ],
  },
  {
    name: 'answerReleased 가 true 에서 false 로 돌아감',
    scenarios: [
      {
        label: '정답을 두고 공개만 거둠',
        published: releasedExam(),
        change: (dir) => writeExam(dir, releasedExam({ rev: 2, answerReleased: false })),
        expected: 'answerReleased 가 false 로 돌아갔어요',
      },
      {
        label: '정답 칸을 모두 빼고 공개 전으로 되돌림',
        published: releasedExam(),
        change: (dir) => writeExam(dir, testExam({ rev: 2 })),
        expected: 'answerReleased 가 false 로 돌아갔어요',
      },
    ],
  },
  {
    name: '문항의 no, kind, choices 가 바뀜',
    scenarios: [
      { label: '보기 수', published: testExam(), change: (dir) => writeExam(dir, withItem(testExam({ rev: 2 }), 3, { choices: 5 })), expected: '3번의 choices(발행한 판 4, 지금 5)' },
      {
        label: '문항 종류',
        published: testExam(),
        change: (dir) => writeExam(dir, withItem(testExam({ rev: 2 }), 6, { kind: 'mc', choices: 5 })),
        expected: '6번의 kind(발행한 판 short, 지금 mc)',
      },
      { label: '문항 번호', published: testExam(), change: (dir) => writeExam(dir, withItem(testExam({ rev: 2 }), 6, { no: 7 })), expected: '6번째 문항의 번호(발행한 판 6, 지금 7)' },
      {
        label: '문항 수',
        published: testExam(),
        change: (dir) => {
          const exam = testExam({ rev: 2 });
          writeExam(dir, { ...exam, items: (exam.items as unknown[]).slice(0, 5) });
        },
        expected: '문항 수(발행한 판 6개, 지금 5개)',
      },
    ],
  },
  {
    name: '채점에 영향을 주는 값이 바뀌었는데 answersRev 를 올리지 않았거나 answersNote 가 없음',
    scenarios: [
      {
        label: '정답을 바꾸고 answersRev 그대로',
        published: releasedExam(),
        change: (dir) => writeExam(dir, withItem(releasedExam({ rev: 2 }), 2, { answer: 1 })),
        expected: '공개한 정답이나 배점이 바뀌었는데(2번(정답)) answersRev 를 올리지 않았어요(1)',
      },
      {
        label: '배점을 바꾸고 answersRev 그대로',
        published: releasedExam(),
        change: (dir) => writeExam(dir, withItem(releasedExam({ rev: 2 }), 1, { points: 3 })),
        expected: '공개한 정답이나 배점이 바뀌었는데(1번(배점)) answersRev 를 올리지 않았어요(1)',
      },
      {
        label: '모두 정답 처리를 더하고 answersRev 그대로',
        published: releasedExam(),
        change: (dir) => writeExam(dir, withItem(releasedExam({ rev: 2 }), 6, { answer: undefined, allCorrect: true })),
        expected: '6번(정답, 모두 정답 처리)',
      },
      {
        label: '복수 정답을 더하고 answersRev 는 올렸지만 answersNote 가 없음',
        published: releasedExam(),
        change: (dir) => writeExam(dir, withItem(releasedExam({ rev: 2, answersRev: 2 }), 1, { altAnswers: [4] })),
        // 정답 판 번호가 2 이상인데 정정 안내가 없는 것은 시험 파일 검사(validate.ts)가 먼저 거부한다.
        expected: 'answersRev가 2 이상이면 answersNote에 정정 안내를 적어야 해요.',
      },
      {
        label: '정답을 바꾸고 answersRev 도 answersNote 도 그대로',
        published: releasedExam(),
        change: (dir) => writeExam(dir, withItem(releasedExam({ rev: 2 }), 5, { answer: 7 })),
        expected: '공개한 정답이나 배점이 바뀌었는데(5번(정답)) answersNote 에 정정 안내가 없어요.',
      },
    ],
  },
  {
    name: 'confirmed 가 true 인데 두 값이 다름',
    scenarios: [
      {
        label: '발행한 시험에 확정 컷을 범위로 넣음',
        published: releasedExam(),
        change: (dir) => writeExam(dir, releasedExam({ rev: 2, cuts: { source: '예시 값', asOf: '2030-01-02T20:10', confirmed: true, grades: { 1: [17, 18] } } })),
        expected: '확정 컷은 두 값이 같아야 해요',
      },
      {
        label: '새 시험에 확정 컷을 범위로 넣음',
        published: releasedExam(),
        change: (dir) =>
          writeExam(dir, releasedExam({ id: 'test-tool-b', cuts: { source: '예시 값', asOf: '2030-01-02', confirmed: true, grades: { 1: [18, 18], 2: [14, 15] } } })),
        expected: '2등급: 확정 컷은 두 값이 같아야 해요',
      },
    ],
  },
  {
    name: '잠금 달력 항목의 형식이 틀림',
    scenarios: [
      {
        label: 'start 가 end 보다 늦음',
        published: testExam(),
        change: (dir) => writeLocks(dir, [{ id: 'test-lock-a', label: '테스트 전용 잠금', start: '2030-01-02T17:45', end: '2030-01-02T08:40' }]),
        expected: '1번째 항목: start가 end보다 앞서야 해요',
      },
      {
        label: '시각 모양이 틀림',
        published: testExam(),
        change: (dir) => writeLocks(dir, [{ id: 'test-lock-a', label: '테스트 전용 잠금', start: '2030-01-02T8:40', end: '2030-01-02T17:45' }]),
        expected: 'start는 2030-01-02T08:40 같은',
      },
      {
        label: 'id 가 겹침',
        published: testExam(),
        change: (dir) =>
          writeLocks(dir, [
            { id: 'test-lock-a', label: '테스트 전용 잠금', start: '2030-01-02T08:40', end: '2030-01-02T17:45' },
            { id: 'test-lock-a', label: '테스트 전용 잠금 둘', start: '2030-01-02T08:40', end: '2030-01-02T17:10' },
          ]),
        expected: '앞의 항목과 id가 겹쳐요',
      },
    ],
  },
];

/** no 번 문항의 칸을 바꾼 시험. undefined 인 칸은 뺀다. */
export function withItem(exam: Record<string, unknown>, no: number, patch: Record<string, unknown>): Record<string, unknown> {
  const items = (exam.items as Record<string, unknown>[]).map((it) => {
    if (it.no !== no) return it;
    const next: Record<string, unknown> = { ...it, ...patch };
    for (const [k, v] of Object.entries(next)) if (v === undefined) delete next[k];
    return next;
  });
  return { ...exam, items };
}
