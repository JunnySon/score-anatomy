import type { KeyObject } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { validateExam } from '../../src/exams/validate.ts';
import type { Exam, ExamItem, LockEntry } from '../../src/types.ts';
import type { Io } from './io.ts';
import { FILES_DIR, INDEX_FILE, SIG_FILE, buildRelease } from './release.ts';
import { keyFingerprint, otherTestOnlyKey, privateKeyPem, publicKeyText, signatureText, testOnlySigningKey } from './sign.ts';
import { checkIndex, finishVerify } from './verify.ts';
import type { Fetched, VerifyResult } from './verify.ts';

// exams:testdata(작업 지시서 3의 6-5): 테스트 전용 키 쌍과 테스트 전용 발행물 네 가지를 <자료 폴더>/testdata(기본 exam-data/testdata)에 만든다.
// 작업 지시서 4(아이폰 껍데기)가 받는 쪽 규칙(6-3)과 서명 확인을 이 자료로 시험한다.
// - 키는 고정된 이름에서 만든 씨앗으로 만든다(sign.ts 의 testOnlySigningKey). Ed25519 서명은 같은 키와 같은 바이트면 같으므로
//   다시 돌려도 모든 파일이 같은 바이트로 나온다.
// - 테스트 전용 비밀 키를 일부러 저장소에 둔다. exams:publish 는 저장소 안의 비밀 키와 테스트 전용 키를 거부하므로,
//   이 명령은 publish 를 거치지 않고 발행물 모양(release.ts)과 서명 함수(sign.ts)를 직접 부른다.
// - 시험은 테스트용으로 지은 시험이다(id test-only-exam, isSample true, 제목 "테스트 전용 시험"). 정답과 배점은 실제 시험의 값이 아니고,
//   날짜와 시각은 작업 지시서의 형식 예시(2030-01-02, 08:40, 17:10, 17:45, 20:10)만 쓴다.
// - 쓰기 전에 발행물마다 exams:verify 와 같은 확인을 해서 뜻한 대로인지(정상은 통과, 서명이 틀린 것은 서명에서, 한 바이트가 바뀐 것은
//   sha256 에서 실패, seq 가 작은 것은 통과하고 seq 가 작음) 본다. 어긋나면 아무것도 쓰지 않는다.

/** 테스트 전용 발행물을 두는 폴더(자료 폴더 안). */
export const TESTDATA_DIR = 'testdata';
export const TEST_ONLY_PRIVATE_KEY_FILE = 'test-only-private-key.pem';
export const TEST_ONLY_PUBLIC_KEY_FILE = 'test-only-public-key.txt';
export const TESTDATA_README = 'README.md';
export const TEST_ONLY_EXAM_ID = 'test-only-exam';

/** 발행물 네 가지의 폴더 이름. */
export const TESTDATA_FOLDERS = {
  valid: 'test-only-valid',
  badSignature: 'test-only-bad-signature',
  changedByte: 'test-only-changed-byte',
  olderSeq: 'test-only-older-seq',
} as const;

/** 테스트 전용 잠금 항목(형식 예시 시각). 받는 쪽이 잠금 달력을 그대로 넘기는지 볼 수 있게 빈 배열 대신 하나를 둔다. */
export const TEST_ONLY_LOCK: LockEntry = {
  id: 'test-only-lock',
  label: '테스트 전용 잠금(형식 예시 시각)',
  start: '2030-01-02T08:40',
  end: '2030-01-02T17:45',
};

/** 문항 구성(테스트용으로 지은 것): 5지선다 3문항과 단답형 1문항, 만점 12점. */
const ITEMS: readonly ExamItem[] = [
  { no: 1, kind: 'mc', choices: 5, points: 2, typeId: 't01' },
  { no: 2, kind: 'mc', choices: 5, points: 3, typeId: 't02' },
  { no: 3, kind: 'mc', choices: 5, points: 3, typeId: 't01' },
  { no: 4, kind: 'short', points: 4, typeId: 't02' },
];

/** 정답(테스트용으로 지은 값). 판 3은 2번 정답을 정정한 판이다. */
const ANSWERS: Readonly<Record<number, number>> = { 1: 3, 2: 5, 3: 1, 4: 17 };
const CORRECTED_NO = 2;
const CORRECTED_ANSWER = 4;

/**
 * 테스트 전용 시험의 판. 판 1은 정답 공개 전, 판 2는 정답을 공개한 판, 판 3은 2번 정답을 정정한 판(answersRev 2 와 정정 안내)이다.
 * 판을 차례로 내는 것은 발행 도구가 허락하는 변경이다(작업 지시서 3의 6-4).
 */
export function testOnlyExam(rev: 1 | 2 | 3): Exam {
  const released = rev >= 2;
  const items = ITEMS.map((it): ExamItem => {
    if (!released) return { ...it };
    return { ...it, answer: rev === 3 && it.no === CORRECTED_NO ? CORRECTED_ANSWER : ANSWERS[it.no] };
  });
  const exam: Exam = {
    id: TEST_ONLY_EXAM_ID,
    title: '테스트 전용 시험',
    note: '테스트 전용으로 지은 시험이에요.',
    isSample: true,
    isPast: false,
    answerReleased: released,
    rev,
    items,
    types: { t01: { name: '테스트 유형 가' }, t02: { name: '테스트 유형 나' } },
  };
  if (rev === 3) {
    exam.answersRev = 2;
    exam.answersNote = '테스트 전용 정정 안내예요.';
  }
  return exam;
}

/** 발행물 하나의 설명. 명령의 출력과 README 에 쓴다. */
export interface TestdataCase {
  folder: string;
  seq: number;
  issuedAt: string;
  rev: number;
  /** 무엇이 다른지. */
  what: string;
  /** 받는 쪽이 할 일(작업 지시서 3의 6-3). */
  expect: string;
}

/** 만든 파일(testdata 폴더 기준의 / 로 나눈 경로와 바이트), 발행물 설명, 테스트 전용 공개 키의 지문. */
export interface Testdata {
  files: Map<string, Uint8Array>;
  cases: TestdataCase[];
  fingerprint: string;
}

/**
 * 시험 파일에서 1번 문항의 정답 숫자 한 바이트를 바꾼다(3을 4로). 바꾼 파일도 JSON 이고 시험 파일 검사를 통과해서,
 * 받는 쪽은 sha256 으로만 알아챌 수 있다. 바꿀 자리가 하나가 아니면 던진다(도구의 결함).
 */
export function changeOneByte(bytes: Uint8Array): Uint8Array {
  const buf = Buffer.from(bytes);
  const target = Buffer.from(`"answer": ${ANSWERS[1]},`, 'utf8');
  const at = buf.indexOf(target);
  if (at < 0 || buf.indexOf(target, at + 1) >= 0) throw new Error('시험 파일에서 바꿀 자리를 하나로 찾지 못했어요(도구의 결함이에요).');
  const out = Buffer.from(buf);
  out[at + target.length - 2] = 0x34; // 숫자 4
  return out;
}

/** 테스트 전용 키와 발행물 네 가지를 메모리에 만든다. 같은 코드면 늘 같은 바이트다. */
export function buildTestdata(): Testdata {
  const key = testOnlySigningKey();
  const other = otherTestOnlyKey();
  const files = new Map<string, Uint8Array>();
  const put = (path: string, data: string | Uint8Array) => files.set(path, typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
  put(TEST_ONLY_PRIVATE_KEY_FILE, privateKeyPem(key));
  put(TEST_ONLY_PUBLIC_KEY_FILE, publicKeyText(key));

  // 판: seq 1(정답 공개 전), seq 2(정답 공개), seq 3(정답 정정). 시각은 형식 예시다.
  const older = { seq: 1, issuedAt: '2030-01-02T08:40', rev: 1 as const };
  const valid = { seq: 2, issuedAt: '2030-01-02T17:10', rev: 2 as const };
  const newer = { seq: 3, issuedAt: '2030-01-02T20:10', rev: 3 as const };
  const make = (r: { seq: number; issuedAt: string; rev: 1 | 2 | 3 }) =>
    buildRelease({ seq: r.seq, issuedAt: r.issuedAt, exams: [testOnlyExam(r.rev)], locks: [TEST_ONLY_LOCK] });
  const write = (folder: string, release: ReturnType<typeof buildRelease>, signWith: KeyObject, change?: (bytes: Uint8Array) => Uint8Array) => {
    put(`${folder}/${INDEX_FILE}`, release.indexBytes);
    put(`${folder}/${SIG_FILE}`, signatureText(release.indexBytes, signWith));
    for (const f of release.files) put(`${folder}/${f.path}`, change ? change(f.bytes) : f.bytes);
    return release.files.map((f) => f.path);
  };

  const F = TESTDATA_FOLDERS;
  write(F.valid, make(valid), key);
  const newerRelease = make(newer);
  write(F.badSignature, newerRelease, other);
  const changedFiles = write(F.changedByte, newerRelease, key, changeOneByte);
  write(F.olderSeq, make(older), key);

  const cases: TestdataCase[] = [
    { folder: F.valid, ...valid, what: '정상 발행물이에요. 시험은 정답을 공개한 판이에요.', expect: '받아들여요.' },
    {
      folder: F.badSignature,
      ...newer,
      what: 'index.json 과 시험 파일은 맞는데 서명을 다른 키로 했어요(서명 64바이트의 모양은 맞아요).',
      expect: '서명이 맞지 않아 버리고 가지고 있던 자료를 그대로 써요.',
    },
    {
      folder: F.changedByte,
      ...newer,
      what: `서명은 맞는데 ${changedFiles.join(', ')} 의 한 바이트(1번 문항의 정답 숫자)를 바꿨어요. 바뀐 파일도 JSON 이고 시험 파일 검사를 통과해요.`,
      expect: '시험 파일의 sha256 이 index.json 에 적힌 값과 달라 버리고 가지고 있던 자료를 그대로 써요.',
    },
    {
      folder: F.olderSeq,
      ...older,
      what: `서명과 sha256 은 맞는데 seq 가 ${F.valid} 보다 작아요. 시험은 정답 공개 전 판이에요.`,
      expect: `${F.valid} 를 받은 뒤라면 seq 가 작아 버려요. 아무것도 받지 않은 상태라면 받아들여요.`,
    },
  ];
  const fingerprint = keyFingerprint(key);
  put(TESTDATA_README, readmeText(cases, fingerprint));
  return { files, cases, fingerprint };
}

/** 만든 발행물을 exams:verify 와 같은 확인으로 본다. 뜻한 대로가 아니면 이유를 돌려준다(도구의 결함). */
export function testdataProblems(data: Testdata): string[] {
  const problems: string[] = [];
  const get = (path: string): Fetched => {
    const bytes = data.files.get(path);
    return bytes === undefined ? { bytes: null, error: '파일이 없어요.' } : { bytes, error: null };
  };
  const key = testOnlySigningKey();
  const check = (folder: string, sigFolder: string = folder): VerifyResult => {
    const head = checkIndex(get(`${folder}/${INDEX_FILE}`), get(`${sigFolder}/${SIG_FILE}`), key);
    return finishVerify(head, new Map(head.entries.map((e) => [e.file, get(`${folder}/${e.file}`)] as const)));
  };
  const F = TESTDATA_FOLDERS;
  const valid = check(F.valid);
  if (!valid.ok) problems.push(`${F.valid}: 확인을 통과하지 못했어요.`);
  const bad = check(F.badSignature);
  // 서명에서 멈춰야 하고(seq 를 읽지 않음), 맞는 서명을 붙이면 나머지는 모두 맞아야 한다.
  if (bad.ok || bad.seq !== null || bad.errors.length !== 1) problems.push(`${F.badSignature}: 서명에서 실패하지 않아요.`);
  if (!check(F.badSignature, F.changedByte).ok) problems.push(`${F.badSignature}: 서명 말고도 틀린 곳이 있어요.`);
  const changed = check(F.changedByte);
  if (changed.ok || changed.seq === null || changed.errors.length !== 1 || !changed.errors[0].includes('sha256')) {
    problems.push(`${F.changedByte}: 서명은 맞고 sha256 하나에서만 실패하지 않아요.`);
  }
  const older = check(F.olderSeq);
  if (!older.ok || older.seq === null || valid.seq === null || older.seq >= valid.seq) problems.push(`${F.olderSeq}: 확인을 통과하고 seq 가 더 작은 발행물이 아니에요.`);
  for (const rev of [1, 2, 3] as const) {
    const errors = validateExam(testOnlyExam(rev));
    if (errors.length > 0) problems.push(`시험 판 ${rev}: 시험 파일 검사를 통과하지 못해요(${errors.join(' ')}).`);
  }
  return problems;
}

/** README(테스트 전용이라는 것, 키, 발행물 네 가지와 받는 쪽이 할 일, 시험 순서, 확인 명령). */
function readmeText(cases: readonly TestdataCase[], fingerprint: string): string {
  const F = TESTDATA_FOLDERS;
  const lines = [
    '# 테스트 전용 발행물(작업 지시서 3의 6-5)',
    '',
    '이 폴더의 키와 발행물은 모두 테스트 전용이에요. `npm run exams:testdata`(node scripts/exams.mjs testdata)가 만들어요.',
    '손으로 고치지 않아요. 다시 만들어도 모든 파일이 같은 바이트로 나와요(키는 고정된 씨앗에서 만들고, Ed25519 서명은 같은 키와 같은 바이트면 같아요).',
    '',
    '- 이 키는 진짜 발행에 절대 쓰지 않아요. 비밀 키를 일부러 저장소에 넣어 둬서 누구나 이 키로 서명할 수 있어요.',
    '- `npm run exams:publish` 는 이 키를 받지 않아요. 저장소 안의 비밀 키를 거부하고, 저장소 밖으로 옮겨도 테스트 전용 키라 거부해요.',
    '- 앱의 배포용 빌드에는 이 공개 키를 넣지 않아요. 진짜 공개 키는 키를 맡은 사람이 `npm run exams:keygen` 으로 만들어 exam-data/public-key.txt 에 둬요.',
    `- 시험 ${TEST_ONLY_EXAM_ID} 은 테스트용으로 지은 시험이에요. 예시 시험처럼 isSample 이 true 이고 제목이 "테스트 전용 시험"이에요. 정답과 배점은 실제 시험의 값이 아니에요.`,
    `- 날짜와 시각은 모두 작업 지시서의 형식 예시 값(2030년 1월 2일)이에요. 잠금 달력의 항목 하나(${TEST_ONLY_LOCK.id}, ${TEST_ONLY_LOCK.start}부터 ${TEST_ONLY_LOCK.end}까지)도 형식 예시 시각이에요.`,
    '',
    '## 키',
    '',
    '| 파일 | 내용 |',
    '| --- | --- |',
    `| ${TEST_ONLY_PRIVATE_KEY_FILE} | 테스트 전용 Ed25519 비밀 키(PEM, PKCS#8) |`,
    `| ${TEST_ONLY_PUBLIC_KEY_FILE} | 그 공개 키 32바이트를 표준 base64(패딩 포함)로 적은 한 줄과 LF. 지문(공개 키 32바이트의 SHA-256 앞 16자)은 ${fingerprint} 예요 |`,
    '',
    '## 발행물 네 가지',
    '',
    `폴더마다 발행 폴더(dist-exams)와 같은 모양이에요: ${INDEX_FILE}, ${SIG_FILE}, ${FILES_DIR}/<시험 id>.<rev>.json. 받는 쪽 규칙은 작업 지시서 3의 6-3 이에요.`,
    '',
    '| 폴더 | index.json | 무엇이 다른지 | 받는 쪽이 할 일 |',
    '| --- | --- | --- | --- |',
    ...cases.map((c) => `| ${c.folder} | seq ${c.seq}, issuedAt ${c.issuedAt}, 시험 rev ${c.rev} | ${c.what} | ${c.expect} |`),
    '',
    `시험 ${TEST_ONLY_EXAM_ID} 의 판은 셋이에요. rev 1 은 정답 공개 전, rev 2 는 정답을 공개한 판, rev 3 은 2번 정답을 정정한 판(answersRev 2, 정정 안내 "테스트 전용 정정 안내예요.")이에요.`,
    '세 판 모두 앱의 시험 파일 검사(src/exams/validate.ts)를 통과해요. 받아들인 발행물은 다리 규격 2의 remote 로 웹에 넘길 수 있어요(exams 에는 시험 파일의 내용을, locks 에는 index.json 의 locks 를 넣어요. docs/앱_다리_규격.md 7장).',
    `${F.badSignature} 와 ${F.changedByte} 는 seq 3 이라 ${F.valid}(seq 2)를 받은 뒤에 와도 seq 로는 버려지지 않아요.`,
    '서명이나 sha256 확인을 건너뛰는 결함이 있으면 받아들이게 되고, 그러면 시험이 정답 정정 판(rev 3)으로 바뀌어 화면에서도 알 수 있어요.',
    '',
    '## 받는 쪽 시험 순서(작업 지시서 4)',
    '',
    `1. 아무것도 받지 않은 상태에서 ${F.badSignature} 를 주면 버려요. 받은 자료가 없는 그대로예요.`,
    `2. 아무것도 받지 않은 상태에서 ${F.changedByte} 를 주면 버려요. 받은 자료가 없는 그대로예요.`,
    `3. ${F.valid} 를 주면 받아들여요(seq 2, 시험 ${TEST_ONLY_EXAM_ID} rev 2).`,
    `4. 이어서 ${F.valid} 를 다시 주면 seq 가 같아 그대로 둬요.`,
    `5. 이어서 ${F.olderSeq} 를 주면 seq 가 작아 버려요(seq 2 그대로).`,
    `6. 이어서 ${F.badSignature}, ${F.changedByte} 를 주면 버려요(seq 2 그대로).`,
    `7. 처음 상태에서 ${F.olderSeq} 를 주면 받아들이고(seq 1, 정답 공개 전), 이어서 ${F.valid} 를 주면 받아들여요(seq 2).`,
    '',
    '## 이 도구로 확인하기',
    '',
    '저장소 폴더에서 이렇게 쳐요.',
    '',
    `    node scripts/exams.mjs verify exam-data/testdata/${F.valid} --key exam-data/testdata/${TEST_ONLY_PUBLIC_KEY_FILE}`,
    '',
    `${F.valid} 와 ${F.olderSeq} 는 통과하고(종료 코드 0), ${F.badSignature} 는 서명이, ${F.changedByte} 는 sha256 이 맞지 않아 실패해요(종료 코드 1).`,
    'exams:verify 는 받는 쪽이 가진 seq 를 모르니 seq 비교는 받는 쪽이 해요. `npm run verify` 의 13번 항목이 네 폴더를 이렇게 확인해요.',
    '',
  ];
  return lines.join('\n');
}

/** 폴더 안의 모든 파일과 폴더(하위 포함)를 / 로 나눈 상대 경로로. */
function listEntries(dir: string): string[] {
  const out: string[] = [];
  const visit = (d: string) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, ent.name);
      out.push(relative(dir, full).split('\\').join('/'));
      if (ent.isDirectory()) visit(full);
    }
  };
  visit(dir);
  return out.sort();
}

export interface TestdataOptions {
  dataDir: string;
  /** 출력에 쓰는 자료 폴더 이름. */
  dataName: string;
}

/** exams:testdata 를 돌린다. 만들었거나 이미 같으면 0, 거부하거나 쓰지 못했으면 1을 돌려준다. */
export function runTestdata(opts: TestdataOptions, io: Io): number {
  const fail = (messages: readonly string[], tail = '아무것도 쓰지 않았어요.') => {
    for (const m of messages) io.err(m);
    io.err(tail);
    return 1;
  };
  const dir = join(opts.dataDir, TESTDATA_DIR);
  // 출력에 쓰는 이름: 자료 폴더 이름이 상대 경로면 / 로, 절대 경로면 운영체제의 구분자로 잇는다(keygen.ts 와 같은 모양).
  const inside = (parent: string, child: string) => (parent === '.' ? child : isAbsolute(parent) ? join(parent, child) : `${parent}/${child}`);
  const name = inside(opts.dataName, TESTDATA_DIR);
  io.out(`테스트 전용 발행물을 만들어요: ${name}`);
  io.out('이 키와 발행물은 테스트 전용이에요. 진짜 발행에는 쓰지 않아요.');
  if (!existsSync(opts.dataDir) || !statSync(opts.dataDir).isDirectory()) return fail([`자료 폴더가 없어요(${opts.dataName}).`]);

  const data = buildTestdata();
  const problems = testdataProblems(data);
  if (problems.length > 0) return fail(['만든 발행물이 뜻한 대로가 아니에요(도구의 결함이에요).', ...problems.map((p) => `  - ${p}`)]);

  // 이 폴더는 이 명령이 통째로 만든다. 만들지 않는 것이 있으면 지우지도 덮지도 않고 멈춘다.
  const expected = new Set<string>();
  for (const path of data.files.keys()) {
    const parts = path.split('/');
    for (let i = 1; i <= parts.length; i += 1) expected.add(parts.slice(0, i).join('/'));
  }
  if (existsSync(dir)) {
    if (!statSync(dir).isDirectory()) return fail([`${name} 가 폴더가 아니에요.`]);
    const strange = listEntries(dir).filter((p) => !expected.has(p));
    if (strange.length > 0) {
      return fail([
        `${name} 에 이 명령이 만들지 않는 것이 있어요(${strange.slice(0, 5).join(', ')}${strange.length > 5 ? ' 등' : ''}). 이 폴더는 이 명령이 통째로 만들어요. 그 파일을 옮기고 다시 해 주세요.`,
      ]);
    }
  }

  io.out(`테스트 전용 키: ${TEST_ONLY_PRIVATE_KEY_FILE}, ${TEST_ONLY_PUBLIC_KEY_FILE}(공개 키 지문 ${data.fingerprint}).`);
  io.out(`발행물 네 가지(시험 ${TEST_ONLY_EXAM_ID}, 날짜와 시각은 형식 예시):`);
  for (const c of data.cases) io.out(`  ${c.folder}: seq ${c.seq}, issuedAt ${c.issuedAt}, 시험 rev ${c.rev}. ${c.what} 받는 쪽: ${c.expect}`);

  let created = 0;
  let changed = 0;
  let same = 0;
  for (const [path, bytes] of data.files) {
    const full = join(dir, ...path.split('/'));
    let before: Buffer | null = null;
    try {
      before = readFileSync(full);
    } catch {
      before = null;
    }
    if (before !== null && before.equals(bytes)) {
      same += 1;
      continue;
    }
    try {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, bytes);
    } catch {
      return fail([`${path} 를 쓰지 못했어요.`], `앞의 파일은 썼을 수 있어요. 다시 돌리면 같은 바이트로 다시 써요(쓴 것 ${created + changed}개).`);
    }
    if (before === null) created += 1;
    else changed += 1;
  }
  io.out(`파일 ${data.files.size}개: 새로 쓴 것 ${created}개, 바꾼 것 ${changed}개, 그대로인 것 ${same}개.`);
  io.out(
    `결과: 테스트 전용 발행물을 만들었어요. 쓰기 전에 발행물마다 exams:verify 와 같은 확인을 해서 뜻한 대로인 것을 봤어요. 확인 명령: node scripts/exams.mjs verify ${inside(name, TESTDATA_FOLDERS.valid)} --key ${inside(name, TEST_ONLY_PUBLIC_KEY_FILE)}`,
  );
  return 0;
}
