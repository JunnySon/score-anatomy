import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkExam } from '../../src/exams/validate.ts';
import type { Exam } from '../../src/types.ts';
import { canonicalJson, sha256Hex } from './canonical.ts';
import { keyFingerprint, publicKeyText } from './sign.ts';
import { examFileText, locksSha256, parseState, stateEntryOf } from './state.ts';
import {
  FORBIDDEN_CHANGES,
  ISSUED_AT,
  ROOT,
  TEST_LOCK,
  keySecrets,
  leakCount,
  listFiles,
  makeDataDir,
  makeOutDir,
  makeTempKey,
  publishTo,
  releasedExam,
  removeDir,
  runTool,
  snapshot,
  testExam,
  verifyWith,
  withItem,
  writeExam,
  writeLocks,
} from './testkit.ts';
import type { TempKey } from './testkit.ts';

// exams:publish(작업 지시서 3의 6-2, 6-4): exams:check 와 같은 검사를 통과하면 seq 를 올리고 발행 폴더를 새로 만들고 서명하고 state.json 을 고친다.
// 시험은 그 자리에서 지은 테스트 전용 시험(testkit.ts)이고, 자료 폴더, 발행 폴더, 서명 키는 모두 os.tmpdir() 아래 임시 폴더다.
// 비밀 키가 저장소 안이면 거부하는지 볼 때만 .gitignore 된 verify-out 아래에 임시 키를 잠깐 두고 지운다. 키 내용은 출력하지 않는다.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) removeDir(dir);
});
function dataDir(): string {
  const dir = makeDataDir();
  dirs.push(dir);
  return dir;
}
function outDir(): { parent: string; out: string } {
  const o = makeOutDir();
  dirs.push(o.parent);
  return o;
}
function tempKey(): TempKey {
  const k = makeTempKey();
  dirs.push(k.dir);
  return k;
}
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

const LATER = '2030-01-02T20:10';
const ESTIMATE = { source: '기관 가, 기관 나의 추정 가운데 가장 낮은 값과 가장 높은 값', asOf: '2030-01-02T20:10', confirmed: false, grades: { 1: [17, 18], 2: [14, 15] } };

function checked(raw: Record<string, unknown>): Exam {
  const exam = checkExam(raw).exam;
  if (exam === null) throw new Error('테스트 시험이 검사를 통과하지 못해요.');
  return exam;
}

function stateOf(dir: string) {
  return parseState(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')));
}

/** 발행 폴더와 state.json 과 그 상위 폴더의 목록(남은 임시 폴더가 없는지)을 한 번에 찍는다. */
function picture(dir: string, o: { parent: string; out: string }) {
  return {
    state: readFileSync(join(dir, 'state.json'), 'utf8'),
    data: snapshot(dir),
    out: existsSync(o.out) ? snapshot(o.out) : null,
    parent: readdirSync(o.parent).sort(),
  };
}

describe('발행 도구 exams:publish(작업 지시서 3의 6-2, 6-4)', () => {
  it('임시 키로 발행한 것이 verify 를 통과한다(index.json, index.json.sig, files/<id>.<rev>.json 의 모양과 요약 출력)', async () => {
    const dir = dataDir();
    const o = outDir();
    const key = tempKey();
    writeExam(dir, releasedExam({ cuts: ESTIMATE }));
    writeExam(dir, testExam({ id: 'test-tool-b', title: '테스트 전용 시험(둘째)' }));
    writeLocks(dir, [TEST_LOCK]);
    const r = publishTo(dir, o.out, key.keyFile);
    expect(r.err).toEqual([]);
    expect(r.code).toBe(0);

    // 발행 폴더: index.json, index.json.sig, 시험마다 files/<id>.<rev>.json
    expect(listFiles(o.out)).toEqual(['files/test-tool-a.1.json', 'files/test-tool-b.1.json', 'index.json', 'index.json.sig']);
    const a = checked(releasedExam({ cuts: ESTIMATE }));
    const b = checked(testExam({ id: 'test-tool-b', title: '테스트 전용 시험(둘째)' }));
    const fileA = readFileSync(join(o.out, 'files/test-tool-a.1.json'));
    const fileB = readFileSync(join(o.out, 'files/test-tool-b.1.json'));
    // 시험 파일은 검사를 통과한 시험을 키를 정렬한 JSON 으로 적은 바이트다.
    expect(fileA.toString('utf8')).toBe(examFileText(a));
    expect(fileB.toString('utf8')).toBe(examFileText(b));
    const indexBytes = readFileSync(join(o.out, 'index.json'));
    const index = JSON.parse(indexBytes.toString('utf8')) as unknown;
    expect(index).toEqual({
      format: 1,
      seq: 1,
      issuedAt: ISSUED_AT,
      exams: [
        { id: 'test-tool-a', rev: 1, file: 'files/test-tool-a.1.json', sha256: sha256Hex(fileA) },
        { id: 'test-tool-b', rev: 1, file: 'files/test-tool-b.1.json', sha256: sha256Hex(fileB) },
      ],
      locks: [TEST_LOCK],
    });
    expect(indexBytes.toString('utf8')).toBe(canonicalJson(index));
    // 서명: Ed25519 서명 64바이트의 표준 base64 한 줄과 LF. node:crypto 로 따로 확인한다.
    const sig = readFileSync(join(o.out, 'index.json.sig'), 'utf8');
    expect(sig).toMatch(/^[A-Za-z0-9+/]{86}==\n$/);
    expect(Buffer.from(sig.trim(), 'base64')).toHaveLength(64);
    expect(verify(null, indexBytes, createPublicKey(key.key), Buffer.from(sig.trim(), 'base64'))).toBe(true);

    // state.json: seq, issuedAt, 잠금 달력의 SHA-256, 시험마다 발행 기록(sha256 은 발행 파일의 SHA-256)
    const { state } = stateOf(dir);
    expect(state).toEqual({
      format: 1,
      seq: 1,
      issuedAt: ISSUED_AT,
      locksSha256: locksSha256([TEST_LOCK]),
      exams: { 'test-tool-a': stateEntryOf(a, 'files/test-tool-a.1.json'), 'test-tool-b': stateEntryOf(b, 'files/test-tool-b.1.json') },
    });
    expect(state?.exams['test-tool-a'].sha256).toBe(sha256Hex(fileA));

    // 요약 출력(키 내용은 없고 공개 키 지문만)
    const fp = keyFingerprint(key.key);
    expect(r.out).toEqual([
      '시험 자료를 발행해요: 자료 폴더 data, 발행 폴더 out',
      '검사를 통과했어요. 알림 2개:',
      '  - src/test-tool-a.json: isSample 이 true 라 앱에서 예시 시험으로 보여요. 실제 시험이면 false 로 적어요.',
      '  - src/test-tool-b.json: isSample 이 true 라 앱에서 예시 시험으로 보여요. 실제 시험이면 false 로 적어요.',
      'seq 1(마지막 발행 0), issuedAt 2030-01-02T17:10(한국 시간), 시험 2개.',
      `  test-tool-a: rev 1, answersRev 1, sha256 ${sha256Hex(fileA).slice(0, 12)}, files/test-tool-a.1.json(새 시험)`,
      `  test-tool-b: rev 1, answersRev 1, sha256 ${sha256Hex(fileB).slice(0, 12)}, files/test-tool-b.1.json(새 시험)`,
      '잠금 달력: 항목 1개(처음 발행해요).',
      `서명: Ed25519, 공개 키 지문 ${fp}. 자료 폴더에 public-key.txt 가 없어서 짝인지는 보지 않았어요.`,
      '발행 폴더를 새로 만들었어요: out(index.json, index.json.sig, 시험 파일 2개). 그 전 발행의 파일은 남기지 않았어요.',
      'state.json 을 고쳤어요(seq 0에서 1로).',
      '다음 차례: npm run exams:verify 로 발행 폴더를 확인하고, 정해진 주소에 올린 뒤 그 주소로 한 번 더 확인해요.',
    ]);

    // verify 가 통과한다(그 키의 공개 키로).
    const v = await verifyWith(o.out, key.publicFile, dir);
    expect(v.err).toEqual([]);
    expect(v.code).toBe(0);
    expect(v.out).toEqual([
      '발행물을 확인해요: target',
      `공개 키: key(지문 ${fp}).`,
      '서명이 맞아요(index.json.sig).',
      'seq 1, issuedAt 2030-01-02T17:10(한국 시간), 시험 2개, 잠금 달력 항목 1개.',
      `  test-tool-a: rev 1, sha256 ${sha256Hex(fileA).slice(0, 12)}, files/test-tool-a.1.json, 맞아요.`,
      `  test-tool-b: rev 1, sha256 ${sha256Hex(fileB).slice(0, 12)}, files/test-tool-b.1.json, 맞아요.`,
      '자료 폴더의 마지막 발행(seq 1, issuedAt 2030-01-02T17:10)과 같아요.',
      '결과: 발행물이 맞아요. 서명, 시험 파일의 SHA-256 과 검사, 잠금 달력이 모두 맞아요.',
    ]);
  });

  it('이어서 두 번 발행하면 seq 가 커지고 state.json 이 맞게 바뀌고, 발행 폴더에 그 전 발행의 파일이 남지 않는다', async () => {
    const dir = dataDir();
    const o = outDir();
    const key = tempKey();
    writeExam(dir, testExam());
    expect(publishTo(dir, o.out, key.keyFile, { issuedAt: '2030-01-02T08:40' }).code).toBe(0);
    expect(stateOf(dir).state?.seq).toBe(1);
    expect(listFiles(o.out)).toEqual(['files/test-tool-a.1.json', 'index.json', 'index.json.sig']);

    // 정답을 넣고(rev 2) 잠금 달력을 바꿔 다시 발행한다.
    writeExam(dir, releasedExam({ rev: 2 }));
    writeLocks(dir, [TEST_LOCK]);
    const r = publishTo(dir, o.out, key.keyFile, { issuedAt: ISSUED_AT });
    expect(r.err).toEqual([]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('seq 2(마지막 발행 1), issuedAt 2030-01-02T17:10(한국 시간), 시험 1개.');
    expect(r.out.some((line) => line.startsWith('  test-tool-a: rev 2, answersRev 1, sha256 ') && line.endsWith('files/test-tool-a.2.json(rev 1에서 2로 바뀌었어요)'))).toBe(true);
    expect(r.out).toContain('잠금 달력: 항목 1개(바뀌었어요).');
    expect(r.out).toContain('state.json 을 고쳤어요(seq 1에서 2로).');
    // 그 전 발행의 파일(files/test-tool-a.1.json)은 남지 않는다. 상위 폴더에 임시 폴더도 남지 않는다.
    expect(listFiles(o.out)).toEqual(['files/test-tool-a.2.json', 'index.json', 'index.json.sig']);
    expect(readdirSync(o.parent)).toEqual(['dist-exams']);
    const index = JSON.parse(readFileSync(join(o.out, 'index.json'), 'utf8')) as { seq: number; issuedAt: string; locks: unknown[] };
    expect(index.seq).toBe(2);
    expect(index.issuedAt).toBe(ISSUED_AT);
    expect(index.locks).toEqual([TEST_LOCK]);
    const { state } = stateOf(dir);
    const file = readFileSync(join(o.out, 'files/test-tool-a.2.json'));
    expect(state).toEqual({
      format: 1,
      seq: 2,
      issuedAt: ISSUED_AT,
      locksSha256: locksSha256([TEST_LOCK]),
      exams: { 'test-tool-a': stateEntryOf(checked(releasedExam({ rev: 2 })), 'files/test-tool-a.2.json') },
    });
    expect(state?.exams['test-tool-a']).toMatchObject({ rev: 2, answersRev: 1, answerReleased: true, file: 'files/test-tool-a.2.json', sha256: sha256Hex(file) });
    // 문항 요약에는 유형(typeId)도 적는다(변경 요약에 유형이 바뀐 문항을 적으려고, 별도 검토 B2).
    expect(state?.exams['test-tool-a'].items[2]).toEqual({ no: 3, kind: 'mc', choices: 4, points: 3, answer: 2, altAnswers: [4], typeId: 't02' });
    expect(state?.exams['test-tool-a'].types).toEqual({ t01: '테스트 유형 가', t02: '테스트 유형 나' });
    expect((await verifyWith(o.out, key.publicFile, dir)).code).toBe(0);

    // 세 번째: 공개한 정답을 정정한다(answersRev 와 정정 안내). seq 3.
    writeExam(dir, withItem(releasedExam({ rev: 3, answersRev: 2, answersNote: '테스트 전용 정정 안내예요.' }), 2, { answer: 1 }));
    expect(publishTo(dir, o.out, key.keyFile, { issuedAt: LATER }).code).toBe(0);
    expect(stateOf(dir).state).toMatchObject({ seq: 3, issuedAt: LATER });
    expect(stateOf(dir).state?.exams['test-tool-a']).toMatchObject({ rev: 3, answersRev: 2, answersNote: '테스트 전용 정정 안내예요.' });
    expect(listFiles(o.out)).toEqual(['files/test-tool-a.3.json', 'index.json', 'index.json.sig']);
  });

  it('issuedAt 은 --issued-at 이나 지금의 한국 시각이고, 마지막 발행보다 이르면 거부한다', () => {
    const dir = dataDir();
    const o = outDir();
    const key = tempKey();
    writeExam(dir, testExam());
    // --issued-at 이 없으면 지금 시각(UTC 2030-01-02 08:10)을 한국 시간(17:10)으로 적는다. 기기의 시간대 설정은 쓰지 않는다.
    const r = publishTo(dir, o.out, key.keyFile, { issuedAt: null, now: () => Date.UTC(2030, 0, 2, 8, 10) });
    expect(r.code).toBe(0);
    expect(r.out).toContain('seq 1(마지막 발행 0), issuedAt 2030-01-02T17:10(한국 시간, 지금 시각), 시험 1개.');
    expect(stateOf(dir).state?.issuedAt).toBe('2030-01-02T17:10');

    // 마지막 발행보다 이르면 거부하고 아무것도 바꾸지 않는다.
    writeExam(dir, testExam({ rev: 2, title: '테스트 전용 시험(제목을 고침)' }));
    const before = picture(dir, o);
    const early = publishTo(dir, o.out, key.keyFile, { issuedAt: '2030-01-02T08:40' });
    expect(early.code).toBe(1);
    expect(early.err).toEqual([
      'issuedAt(2030-01-02T08:40)이 마지막 발행의 issuedAt(2030-01-02T17:10, seq 1)보다 앞서요. 받은 자료 기준 시각이 거꾸로 가지 않게 같거나 늦은 시각으로 발행해요(--issued-at).',
      '발행하지 않았어요. state.json 과 발행 폴더는 그 전 그대로예요.',
    ]);
    expect(picture(dir, o)).toEqual(before);
    // 지금 시각이 마지막 발행보다 이르게 나와도 같다.
    expect(publishTo(dir, o.out, key.keyFile, { issuedAt: null, now: () => Date.UTC(2030, 0, 1, 23, 40) }).code).toBe(1);
    expect(picture(dir, o)).toEqual(before);
    // 같은 시각은 받는다(같은 분에 고쳐 내는 경우).
    expect(publishTo(dir, o.out, key.keyFile, { issuedAt: '2030-01-02T17:10' }).code).toBe(0);
    expect(stateOf(dir).state).toMatchObject({ seq: 2, issuedAt: '2030-01-02T17:10' });
  });

  it('바뀐 것이 하나도 없으면 발행하지 않고, --allow-same 이면 새 seq 로 다시 발행한다', async () => {
    const dir = dataDir();
    const o = outDir();
    const key = tempKey();
    writeExam(dir, releasedExam());
    expect(publishTo(dir, o.out, key.keyFile).code).toBe(0);
    const before = picture(dir, o);
    const same = publishTo(dir, o.out, key.keyFile, { issuedAt: LATER });
    expect(same.code).toBe(1);
    expect(same.err).toEqual([
      '마지막 발행(seq 1, issuedAt 2030-01-02T17:10)과 바뀐 것이 없어요. 시험 파일과 잠금 달력이 모두 같아요.',
      '같은 내용을 새 seq 로 다시 내야 하면(발행 폴더를 잃어버렸거나 키를 바꿨을 때) --allow-same 을 붙여요.',
      '발행하지 않았어요. state.json 과 발행 폴더는 그 전 그대로예요.',
    ]);
    expect(picture(dir, o)).toEqual(before);
    // 원본 파일의 모양(줄바꿈, 키 차례)만 바뀐 것도 바뀐 것이 아니다(발행 파일은 키를 정렬한 JSON).
    writeFileSync(join(dir, 'src', 'test-tool-a.json'), `${JSON.stringify(releasedExam())}\n`);
    expect(publishTo(dir, o.out, key.keyFile, { issuedAt: LATER }).code).toBe(1);

    // 발행 폴더를 잃어버렸을 때: --allow-same 으로 같은 내용을 새 seq 로 낸다.
    rmSync(o.out, { recursive: true });
    const again = publishTo(dir, o.out, key.keyFile, { issuedAt: LATER, allowSame: true });
    expect(again.code).toBe(0);
    expect(again.out.some((line) => line.endsWith('files/test-tool-a.1.json(발행한 판과 같아요)'))).toBe(true);
    expect(again.out).toContain('잠금 달력: 항목 0개(발행한 것과 같아요).');
    expect(stateOf(dir).state).toMatchObject({ seq: 2, issuedAt: LATER });
    expect((await verifyWith(o.out, key.publicFile, dir)).code).toBe(0);
    // 잠금 달력만 바뀌어도 바뀐 것이다.
    writeLocks(dir, [TEST_LOCK]);
    expect(publishTo(dir, o.out, key.keyFile, { issuedAt: LATER }).code).toBe(0);
    expect(stateOf(dir).state?.seq).toBe(3);
  });

  it('쓰지 않고 보여 주기(--dry-run)는 비밀 키가 있든 없든 아무것도 쓰지 않는다(함수와 실제 Node 실행)', () => {
    const dir = dataDir();
    const o = outDir();
    const key = tempKey();
    writeExam(dir, testExam());
    expect(publishTo(dir, o.out, key.keyFile, { issuedAt: '2030-01-02T08:40' }).code).toBe(0);
    writeExam(dir, releasedExam({ rev: 2 }));
    writeLocks(dir, [TEST_LOCK]);
    const before = picture(dir, o);
    const keyBefore = snapshot(key.dir);

    // 키 없이: 결과만 보여 주고 0
    const plain = publishTo(dir, o.out, null, { dryRun: true });
    expect(plain.err).toEqual([]);
    expect(plain.code).toBe(0);
    expect(plain.out[0]).toBe('쓰지 않고 결과만 보여 줘요(--dry-run): 자료 폴더 data, 발행 폴더 out. 파일과 state.json 을 하나도 쓰지 않아요.');
    expect(plain.out).toContain('seq 2(마지막 발행 1), issuedAt 2030-01-02T17:10(한국 시간), 시험 1개.');
    expect(plain.out).toContain('서명: 비밀 키를 확인하지 않았어요(SA_EXAM_KEY_FILE 이 없어요). 실제 발행에는 필요해요.');
    expect(plain.out[plain.out.length - 1]).toBe('결과: 발행하면 위와 같아요. 발행 폴더와 state.json 을 쓰지 않았어요.');
    expect(picture(dir, o)).toEqual(before);

    // 키가 있으면 그 키도 확인하고 메모리에서 서명과 확인을 해 본다.
    const signed = publishTo(dir, o.out, key.keyFile, { dryRun: true });
    expect(signed.code).toBe(0);
    expect(signed.out).toContain('메모리에서 서명하고 확인했어요(exams:verify 와 같은 확인).');
    expect(picture(dir, o)).toEqual(before);

    // 키가 틀리면 1이지만 역시 아무것도 쓰지 않는다.
    const badKey = join(key.dir, 'not-a-key.pem');
    writeFileSync(badKey, 'test-only text, not a key\n');
    const bad = publishTo(dir, o.out, badKey, { dryRun: true });
    expect(bad.code).toBe(1);
    expect(bad.err[bad.err.length - 1]).toBe('아무것도 쓰지 않았어요.');
    rmSync(badKey);
    expect(picture(dir, o)).toEqual(before);

    // 처음 발행이라 발행 폴더가 없을 때도 만들지 않는다.
    const fresh = dataDir();
    const freshOut = outDir();
    writeExam(fresh, testExam());
    const freshBefore = picture(fresh, freshOut);
    expect(publishTo(fresh, freshOut.out, key.keyFile, { dryRun: true }).code).toBe(0);
    expect(picture(fresh, freshOut)).toEqual(freshBefore);
    expect(existsSync(freshOut.out)).toBe(false);

    // 실제 Node 로 돌려도 같다(npm run exams:publish -- --dry-run 과 같은 길).
    const run = runTool(['publish', '--dry-run', '--data', dir, '--out', o.out, '--issued-at', LATER], [], { SA_EXAM_KEY_FILE: key.keyFile });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('결과: 발행하면 위와 같아요. 발행 폴더와 state.json 을 쓰지 않았어요.');
    expect(picture(dir, o)).toEqual(before);
    expect(snapshot(key.dir)).toEqual(keyBefore);
  }, 60000);

  it('도중에 실패하면 state.json 과 발행 폴더가 그 전 그대로다(임시 폴더를 쓴 뒤, 폴더를 바꿔 넣는 중, state.json 을 쓰기 전)', async () => {
    for (const step of ['files', 'swap', 'state'] as const) {
      for (const first of [true, false]) {
        const dir = dataDir();
        const o = outDir();
        const key = tempKey();
        writeExam(dir, testExam());
        // first 면 처음 발행(발행 폴더가 없음), 아니면 한 번 발행해 둔 뒤 바꿔서 다시 발행한다.
        if (!first) {
          expect(publishTo(dir, o.out, key.keyFile, { issuedAt: '2030-01-02T08:40' }).code).toBe(0);
          writeExam(dir, releasedExam({ rev: 2 }));
        }
        const before = picture(dir, o);
        const r = publishTo(dir, o.out, key.keyFile, {
          interrupt: (s) => {
            if (s === step) throw new Error('테스트가 흉내 낸 실패');
          },
        });
        expect(r.code, `${step} ${first}`).toBe(1);
        expect(r.err[r.err.length - 1], `${step} ${first}`).toBe('발행하지 않았어요. state.json 과 발행 폴더는 그 전 그대로예요.');
        expect(picture(dir, o), `${step} ${first}`).toEqual(before);
        if (!first) expect((await verifyWith(o.out, key.publicFile, dir)).code).toBe(0);
        // 실패한 뒤 다시 하면 발행한다.
        expect(publishTo(dir, o.out, key.keyFile).code).toBe(0);
        expect(readdirSync(o.parent)).toEqual(['dist-exams']);
      }
    }
  });

  it('발행 폴더(--out)에 발행물이 아닌 것이 있거나 저장소나 자료 폴더와 겹치면 거부한다', () => {
    const dir = dataDir();
    const key = tempKey();
    writeExam(dir, testExam());
    const cases: { out: string; expected: string }[] = [];
    // 다른 파일이 든 폴더(통째로 바꿔 넣으면 지워지는 파일)
    const busy = tempDir('sa-exams-busy-');
    writeFileSync(join(busy, 'memo.txt'), '테스트 전용 메모\n');
    cases.push({ out: busy, expected: '발행 폴더(--out)에 발행물이 아닌 것이 있어요(memo.txt)' });
    const nested = tempDir('sa-exams-busy-');
    mkdirSync(join(nested, 'files', 'deeper'), { recursive: true });
    cases.push({ out: nested, expected: '발행물이 아닌 것이 있어요(files/deeper)' });
    // 저장소 폴더 자체와 그 위, 자료 폴더와 그 안
    cases.push({ out: ROOT, expected: '발행 폴더(--out)가 저장소 폴더와 같거나 그 위예요' });
    cases.push({ out: join(ROOT, '..'), expected: '발행 폴더(--out)가 저장소 폴더와 같거나 그 위예요' });
    cases.push({ out: dir, expected: '발행 폴더(--out)가 자료 폴더와 겹쳐요' });
    cases.push({ out: join(dir, 'dist-exams'), expected: '발행 폴더(--out)가 자료 폴더와 겹쳐요' });
    // 상위 폴더가 없는 곳, 파일
    cases.push({ out: join(tempDir('sa-exams-none-'), 'no', 'dist-exams'), expected: '발행 폴더(--out)를 둘 폴더가 없어요' });
    const file = join(tempDir('sa-exams-file-'), 'dist-exams');
    writeFileSync(file, 'x');
    cases.push({ out: file, expected: '발행 폴더(--out)가 폴더가 아니에요' });
    for (const c of cases) {
      const before = readFileSync(join(dir, 'state.json'), 'utf8');
      const r = publishTo(dir, c.out, key.keyFile);
      expect(r.code, c.out).toBe(1);
      expect(r.err.join('\n'), c.out).toContain(c.expected);
      expect(readFileSync(join(dir, 'state.json'), 'utf8')).toBe(before);
    }
    expect(readFileSync(join(busy, 'memo.txt'), 'utf8')).toBe('테스트 전용 메모\n');
    expect(existsSync(join(dir, 'dist-exams'))).toBe(false);
  });

  it('자료 폴더에 공개 키(public-key.txt)가 있으면 비밀 키와 짝인지 보고, 짝이 아니면 거부한다', () => {
    const dir = dataDir();
    const o = outDir();
    const key = tempKey();
    const other = tempKey();
    writeExam(dir, testExam());
    writeFileSync(join(dir, 'public-key.txt'), publicKeyText(other.key));
    const before = picture(dir, o);
    const r = publishTo(dir, o.out, key.keyFile);
    expect(r.code).toBe(1);
    expect(r.err[0]).toBe(
      `비밀 키가 자료 폴더의 공개 키(public-key.txt, 지문 ${keyFingerprint(other.key)})와 짝이 아니에요(비밀 키의 공개 키 지문 ${keyFingerprint(key.key)}). 이 키로 서명하면 앱이 받지 않아요.`,
    );
    expect(picture(dir, o)).toEqual(before);
    writeFileSync(join(dir, 'public-key.txt'), publicKeyText(key.key));
    const ok = publishTo(dir, o.out, key.keyFile);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain(`서명: Ed25519, 공개 키 지문 ${keyFingerprint(key.key)}. 자료 폴더의 public-key.txt 와 짝이에요.`);
  });
});

describe('발행 도구 exams:publish 금지된 변경(작업 지시서 3의 6-4)', () => {
  // exams:check 의 테스트와 같은 시나리오(testkit.ts 의 FORBIDDEN_CHANGES)다. 앞의 발행은 실제 publish 로 하고, 바꾼 뒤의 publish 가 거부해야 한다.
  // 이름이 길어도 줄이지 않게 $name 대신 %s 로 넣는다.
  it.each(FORBIDDEN_CHANGES.map((c) => [c.name, c.scenarios] as const))('%s: publish 가 거부하고 state.json 과 발행 폴더가 그대로다', (_name, scenarios) => {
    for (const s of scenarios) {
      const dir = dataDir();
      const o = outDir();
      const key = tempKey();
      writeExam(dir, s.published);
      expect(publishTo(dir, o.out, key.keyFile, { issuedAt: '2030-01-02T08:40' }).code, s.label).toBe(0);
      s.change(dir);
      const before = picture(dir, o);
      const r = publishTo(dir, o.out, key.keyFile, { issuedAt: LATER });
      expect(r.code, s.label).toBe(1);
      expect(r.err.join('\n'), s.label).toContain(s.expected);
      expect(r.err[r.err.length - 1], s.label).toBe('발행하지 않았어요. state.json 과 발행 폴더는 그 전 그대로예요.');
      expect(picture(dir, o), s.label).toEqual(before);
    }
  });
});

/** 저장소 안(.gitignore 된 verify-out)에 잠깐 두는 임시 폴더. 테스트가 끝나면 지운다. */
function repoTempDir(): string {
  mkdirSync(join(ROOT, 'verify-out'), { recursive: true });
  const dir = mkdtempSync(join(ROOT, 'verify-out', 'sa-exams-key-'));
  dirs.push(dir);
  return dir;
}

describe('발행 도구 비밀 키(작업 지시서 3의 6-4)', () => {
  it('비밀 키 파일이 저장소 안이면 거부한다(상대 경로, 대소문자, .. 과 연결 지점을 풀어서)', () => {
    const key = tempKey();
    const inRepo = repoTempDir();
    const inside = join(inRepo, 'test-only-private-key.pem');
    copyFileSync(key.keyFile, inside);
    const rel = relative(ROOT, inside);
    // 연결 지점(junction): os.tmpdir() 아래의 폴더가 저장소 안 폴더를 가리킨다. 관리자 권한 없이 만들 수 있다.
    const holder = tempDir('sa-exams-link-');
    symlinkSync(inRepo, join(holder, 'link'), 'junction');
    const cases = [
      inside,
      rel,
      `./${rel.split('\\').join('/')}`,
      join(ROOT, 'src', '..', rel),
      join(holder, 'link', 'test-only-private-key.pem'),
      process.platform === 'win32' ? inside.toUpperCase() : inside,
    ];
    for (const path of cases) {
      const dir = dataDir();
      const o = outDir();
      writeExam(dir, testExam());
      const before = picture(dir, o);
      const r = publishTo(dir, o.out, path);
      expect(r.code, path).toBe(1);
      expect(r.err[0], path).toContain('비밀 키 파일이 저장소 폴더 안에 있어요(실제 경로 ');
      expect(picture(dir, o), path).toEqual(before);
      expect(leakCount([...r.out, ...r.err].join('\n'), keySecrets(key.pem))).toBe(0);
    }
    // 실제 Node 로 돌려도 거부한다(상대 경로는 명령을 친 폴더 기준).
    const dir = dataDir();
    writeExam(dir, testExam());
    const o = outDir();
    const run = runTool(['publish', '--data', dir, '--out', o.out, '--issued-at', ISSUED_AT], [], { SA_EXAM_KEY_FILE: rel });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('비밀 키 파일이 저장소 폴더 안에 있어요');
    expect(existsSync(o.out)).toBe(false);
    // 같은 키를 저장소 밖에 두면 발행한다(거부가 키 내용 때문이 아님).
    expect(publishTo(dir, o.out, key.keyFile).code).toBe(0);
  }, 60000);

  it('비밀 키 파일이 자료 폴더나 발행 폴더 안이어도 거부한다', () => {
    const key = tempKey();
    const dir = dataDir();
    const o = outDir();
    writeExam(dir, testExam());
    const inData = join(dir, 'test-only-private-key.pem');
    copyFileSync(key.keyFile, inData);
    const r = publishTo(dir, o.out, inData);
    expect(r.code).toBe(1);
    expect(r.err[0]).toContain('비밀 키 파일이 자료 폴더 안에 있어요');
    rmSync(inData);
    expect(publishTo(dir, o.out, key.keyFile, { issuedAt: '2030-01-02T08:40' }).code).toBe(0);
    // 발행 폴더 안(files 아래의 .json 이름이면 발행 폴더 검사를 지나므로 비밀 키 검사가 막는다)
    const inOut = join(o.out, 'files', 'test-only-private-key.json');
    copyFileSync(key.keyFile, inOut);
    writeExam(dir, releasedExam({ rev: 2 }));
    const r2 = publishTo(dir, o.out, inOut);
    expect(r2.code).toBe(1);
    expect(r2.err[0]).toContain('비밀 키 파일이 발행 폴더 안에 있어요');
    expect(existsSync(inOut)).toBe(true);
  });

  it('SA_EXAM_KEY_FILE 이 없거나 비었거나, 파일이 없거나, Ed25519 PKCS#8 PEM 이 아니면 거부한다', () => {
    const keys = tempDir('sa-exams-badkey-');
    const write = (name: string, text: string) => {
      const path = join(keys, name);
      writeFileSync(path, text);
      return path;
    };
    const pem = (k: KeyObject, type: 'pkcs1' | 'pkcs8' | 'spki') => String(k.export({ type, format: 'pem' }));
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const x25519 = generateKeyPairSync('x25519');
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 });
    const ed = generateKeyPairSync('ed25519');
    const encrypted = String(ed.privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'test-only-passphrase' }));
    const good = String(ed.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    // 모양은 PKCS#8 PEM 인데 본문이 키가 아님(본문 글자를 한 자 바꿈).
    const broken = good.replace(/^(-----BEGIN PRIVATE KEY-----\r?\n)(.)/, (_m, head: string, ch: string) => `${head}${ch === 'A' ? 'B' : 'A'}`);
    const marker = 'TEST-ONLY-NOT-A-KEY-MARKER';
    const cases: { name: string; env: Record<string, string>; expected: string; secrets: string[] }[] = [
      { name: '환경 변수 없음', env: {}, expected: 'SA_EXAM_KEY_FILE 이 없어요.', secrets: [] },
      { name: '빈 값', env: { SA_EXAM_KEY_FILE: '' }, expected: 'SA_EXAM_KEY_FILE 이 없어요.', secrets: [] },
      { name: '빈칸뿐', env: { SA_EXAM_KEY_FILE: '   ' }, expected: 'SA_EXAM_KEY_FILE 이 없어요.', secrets: [] },
      { name: '없는 파일', env: { SA_EXAM_KEY_FILE: join(keys, 'none.pem') }, expected: 'SA_EXAM_KEY_FILE 이 가리키는 비밀 키 파일이 없어요', secrets: [] },
      { name: '폴더', env: { SA_EXAM_KEY_FILE: keys }, expected: 'SA_EXAM_KEY_FILE 이 가리키는 곳이 파일이 아니에요', secrets: [] },
      { name: '빈 파일', env: { SA_EXAM_KEY_FILE: write('empty.pem', '') }, expected: '비밀 키 파일이 비어 있어요.', secrets: [] },
      { name: 'PEM 이 아닌 글자', env: { SA_EXAM_KEY_FILE: write('text.pem', `${marker}\n`) }, expected: 'PEM 모양의 PKCS#8 비밀 키', secrets: [marker] },
      { name: '공개 키 PEM', env: { SA_EXAM_KEY_FILE: write('public.pem', pem(ed.publicKey, 'spki')) }, expected: 'PEM 모양의 PKCS#8 비밀 키', secrets: [] },
      { name: 'PKCS#1 RSA', env: { SA_EXAM_KEY_FILE: write('rsa1.pem', pem(rsa.privateKey, 'pkcs1')) }, expected: 'PEM 모양의 PKCS#8 비밀 키', secrets: [] },
      { name: '암호를 건 PKCS#8', env: { SA_EXAM_KEY_FILE: write('enc.pem', encrypted) }, expected: '암호를 건 비밀 키(ENCRYPTED PRIVATE KEY)는 받지 않아요', secrets: [] },
      { name: '본문이 틀린 PKCS#8', env: { SA_EXAM_KEY_FILE: write('broken.pem', broken) }, expected: '비밀 키 파일을 비밀 키로 읽지 못했어요.', secrets: [] },
      { name: 'EC P-256', env: { SA_EXAM_KEY_FILE: write('ec.pem', pem(ec.privateKey, 'pkcs8')) }, expected: '비밀 키가 Ed25519 가 아니에요(지금 키의 종류: ec).', secrets: keySecrets(pem(ec.privateKey, 'pkcs8')) },
      {
        name: 'X25519',
        env: { SA_EXAM_KEY_FILE: write('x25519.pem', pem(x25519.privateKey, 'pkcs8')) },
        expected: '비밀 키가 Ed25519 가 아니에요(지금 키의 종류: x25519).',
        secrets: keySecrets(pem(x25519.privateKey, 'pkcs8')),
      },
      { name: 'RSA PKCS#8', env: { SA_EXAM_KEY_FILE: write('rsa8.pem', pem(rsa.privateKey, 'pkcs8')) }, expected: '비밀 키가 Ed25519 가 아니에요(지금 키의 종류: rsa).', secrets: [] },
    ];
    for (const c of cases) {
      const dir = dataDir();
      const o = outDir();
      writeExam(dir, testExam());
      const before = picture(dir, o);
      const r = publishTo(dir, o.out, null, { env: c.env });
      expect(r.code, c.name).toBe(1);
      expect(r.err[0], c.name).toContain(c.expected);
      expect(r.err[r.err.length - 1], c.name).toBe('발행하지 않았어요. state.json 과 발행 폴더는 그 전 그대로예요.');
      expect(picture(dir, o), c.name).toEqual(before);
      expect(leakCount([...r.out, ...r.err].join('\n'), c.secrets), c.name).toBe(0);
    }
    // 같은 자료로 맞는 Ed25519 키를 주면 발행한다(거부가 자료 때문이 아님).
    const dir = dataDir();
    writeExam(dir, testExam());
    expect(publishTo(dir, outDir().out, write('good.pem', good)).code).toBe(0);
  });

  it('도구의 출력(stdout, stderr)에 키 내용이 없다(실제 Node 실행, PEM 본문 줄과 JWK 의 d)', async () => {
    const key = tempKey();
    const secrets = keySecrets(key.pem);
    const dir = dataDir();
    const o = outDir();
    writeExam(dir, testExam());
    const env = { SA_EXAM_KEY_FILE: key.keyFile };
    const runs = [
      runTool(['publish', '--dry-run', '--data', dir, '--out', o.out, '--issued-at', '2030-01-02T08:40'], [], env),
      runTool(['publish', '--data', dir, '--out', o.out, '--issued-at', '2030-01-02T08:40'], [], env),
      runTool(['verify', o.out, '--data', dir, '--key', key.publicFile]),
      // 바뀐 것이 없어서 거부하는 길
      runTool(['publish', '--data', dir, '--out', o.out, '--issued-at', ISSUED_AT], [], env),
    ];
    expect(runs.map((r) => r.status)).toEqual([0, 0, 0, 1]);
    // 실패하는 길: 다른 종류의 키(EC)와 키가 아닌 글자
    const ec = String(generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const ecFile = join(key.dir, 'test-only-ec.pem');
    writeFileSync(ecFile, ec);
    const marker = 'TEST-ONLY-NOT-A-KEY-MARKER';
    const textFile = join(key.dir, 'test-only-text.pem');
    writeFileSync(textFile, `-----BEGIN PRIVATE KEY-----\n${marker}\n-----END PRIVATE KEY-----\n`);
    writeExam(dir, releasedExam({ rev: 2 }));
    const failing = [
      runTool(['publish', '--data', dir, '--out', o.out, '--issued-at', ISSUED_AT], [], { SA_EXAM_KEY_FILE: ecFile }),
      runTool(['publish', '--data', dir, '--out', o.out, '--issued-at', ISSUED_AT], [], { SA_EXAM_KEY_FILE: textFile }),
    ];
    expect(failing.map((r) => r.status)).toEqual([1, 1]);
    // keygen 이 만든 키도 출력에 없다(자료 폴더와 비밀 키 모두 임시 폴더).
    const genData = tempDir('sa-exams-gen-data-');
    const genKey = join(tempDir('sa-exams-gen-key-'), 'test-only-private-key.pem');
    const gen = runTool(['keygen', genKey, '--data', genData]);
    expect(gen.status).toBe(0);
    const genSecrets = keySecrets(readFileSync(genKey, 'utf8'));
    const all = [...runs, ...failing, gen].map((r) => `${r.stdout}\n${r.stderr}`).join('\n');
    // 비밀 자체가 테스트 출력에 찍히지 않게 수만 견준다.
    expect(leakCount(all, secrets)).toBe(0);
    expect(leakCount(all, keySecrets(ec))).toBe(0);
    expect(leakCount(all, genSecrets)).toBe(0);
    expect(leakCount(all, [marker])).toBe(0);
    // 그 대신 공개 키의 지문은 적는다(비밀이 아님).
    expect(runs[1].stdout).toContain(`공개 키 지문 ${keyFingerprint(key.key)}`);
    expect((await verifyWith(o.out, key.publicFile, dir)).code).toBe(0);
  }, 120000);
});
