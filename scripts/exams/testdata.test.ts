import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateExam } from '../../src/exams/validate.ts';
import { sha256Hex } from './canonical.ts';
import { INDEX_FILE, SIG_FILE } from './release.ts';
import { KEY_ENV, keyFingerprint, otherTestOnlyKey, parsePublicKeyText, privateKeyPem } from './sign.ts';
import { ROOT, collectIo, keySecrets, leakCount, listFiles, makeDataDir, makeOutDir, publishTo, removeDir, runTool, snapshot, testExam, verifyWith, writeExam } from './testkit.ts';
import { TESTDATA_FOLDERS, TEST_ONLY_EXAM_ID, TEST_ONLY_PRIVATE_KEY_FILE, TEST_ONLY_PUBLIC_KEY_FILE, buildTestdata, runTestdata } from './testdata.ts';
import { checkIndex, finishVerify, readLocal } from './verify.ts';

// 테스트 전용 발행물(작업 지시서 3의 6-5): 커밋된 exam-data/testdata 를 읽어서 본다(이 테스트는 저장소의 파일을 쓰지 않는다).
// 정상은 verify 를 통과하고, 서명이 틀린 것과 시험 파일 한 바이트가 바뀐 것은 각각 그 이유로 실패하고, seq 가 작은 것은 서명과 sha256 이 맞고
// seq 가 정상보다 작다. 명령(exams:testdata)을 임시 폴더로 다시 돌리면 커밋된 것과 바이트가 같다.
// 비밀 키는 커밋된 테스트 전용 키를 읽기만 하고, 출력에 키 내용이 있는지는 수만 견준다(키 글자를 테스트 출력에 찍지 않음).

const TESTDATA = join(ROOT, 'exam-data', 'testdata');
const PUBLIC_KEY = join(TESTDATA, TEST_ONLY_PUBLIC_KEY_FILE);
const PRIVATE_KEY = join(TESTDATA, TEST_ONLY_PRIVATE_KEY_FILE);
const F = TESTDATA_FOLDERS;
const SIGNATURE_WRONG = '서명이 맞지 않아요(index.json.sig). index.json 이 바뀌었거나 다른 키로 서명했어요.';
const TEST_KEY_NOTE = '  이 공개 키는 테스트 전용 키예요(exam-data/testdata, 작업 지시서 3의 6-5). 진짜 발행물은 이 키로 확인하지 않아요.';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) removeDir(dir);
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sa-exams-'));
  dirs.push(dir);
  return dir;
}
function dataDir(): string {
  const dir = makeDataDir();
  dirs.push(dir);
  return dir;
}

const folder = (name: string) => join(TESTDATA, name);
const bytesOf = (name: string, path: string) => readFileSync(join(folder(name), ...path.split('/')));
interface IndexJson {
  seq: number;
  issuedAt: string;
  exams: { id: string; rev: number; file: string; sha256: string }[];
  locks: { id: string; label: string; start: string; end: string }[];
}
const indexOf = (name: string) => JSON.parse(bytesOf(name, INDEX_FILE).toString('utf8')) as IndexJson;
function testPublicKey() {
  const parsed = parsePublicKeyText(readFileSync(PUBLIC_KEY, 'utf8'));
  if (parsed.key === null) throw new Error('커밋된 테스트 전용 공개 키를 읽지 못했어요.');
  return parsed.key;
}

describe('발행 도구 테스트 전용 발행물(작업 지시서 3의 6-5)', () => {
  it('커밋된 정상 발행물(test-only-valid)은 테스트 전용 공개 키로 verify 를 통과하고, 파일 이름과 시험 내용에 테스트 전용이라고 적혀 있다', async () => {
    const r = await verifyWith(folder(F.valid), PUBLIC_KEY, dataDir());
    expect(r.err).toEqual([]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(TEST_KEY_NOTE);
    expect(r.out).toContain('서명이 맞아요(index.json.sig).');
    expect(r.out).toContain('seq 2, issuedAt 2030-01-02T17:10(한국 시간), 시험 1개, 잠금 달력 항목 1개.');
    // 파일 이름: README 말고는 모두 test-only 로 시작하는 파일이나 폴더 안에 있고, 시험 파일 이름에도 test-only 가 있다.
    const names = listFiles(TESTDATA);
    expect(names.length).toBe(15);
    for (const name of names) if (name !== 'README.md') expect(name.split('/')[0], name).toMatch(/^test-only-/);
    expect(Object.values(F).every((f) => f.startsWith('test-only-'))).toBe(true);
    // 내용: 시험은 예시 시험처럼 isSample 이 true 이고 제목과 안내에 테스트 전용이라고 적혀 있다. 판마다 시험 파일 검사를 통과한다.
    for (const name of Object.values(F)) {
      const index = indexOf(name);
      expect(index.exams.map((e) => e.id)).toEqual([TEST_ONLY_EXAM_ID]);
      expect(index.locks.map((l) => l.label)).toEqual(['테스트 전용 잠금(형식 예시 시각)']);
      const exam = JSON.parse(bytesOf(name, index.exams[0].file).toString('utf8')) as Record<string, unknown>;
      expect(index.exams[0].file).toBe(`files/${TEST_ONLY_EXAM_ID}.${index.exams[0].rev}.json`);
      expect(exam).toMatchObject({ id: TEST_ONLY_EXAM_ID, title: '테스트 전용 시험', note: '테스트 전용으로 지은 시험이에요.', isSample: true });
      expect(validateExam(exam), name).toEqual([]);
    }
  });

  it('커밋된 서명이 틀린 발행물(test-only-bad-signature)은 서명 때문에 실패하고, 서명 말고는 모두 맞다', async () => {
    const r = await verifyWith(folder(F.badSignature), PUBLIC_KEY, dataDir());
    expect(r.code).toBe(1);
    expect(r.err).toEqual(['결과: 발행물이 맞지 않아요. 이유 1개:', `  - ${SIGNATURE_WRONG}`]);
    expect(r.out).not.toContain('서명이 맞아요(index.json.sig).');
    // 서명 파일의 모양(64바이트의 표준 base64 한 줄과 LF)은 맞아서, 모양이 아니라 서명 확인에서 실패한다.
    expect(bytesOf(F.badSignature, SIG_FILE).toString('utf8')).toMatch(/^[A-Za-z0-9+/]{86}==\n$/);
    // index.json 은 서명이 맞는 test-only-changed-byte 의 것과 바이트가 같다. 그 서명을 붙이면 시험 파일까지 모두 통과한다.
    expect(bytesOf(F.badSignature, INDEX_FILE).equals(bytesOf(F.changedByte, INDEX_FILE))).toBe(true);
    expect(bytesOf(F.badSignature, SIG_FILE).equals(bytesOf(F.changedByte, SIG_FILE))).toBe(false);
    const head = checkIndex(readLocal(folder(F.badSignature), INDEX_FILE), readLocal(folder(F.changedByte), SIG_FILE), testPublicKey());
    const files = new Map(head.entries.map((e) => [e.file, readLocal(folder(F.badSignature), e.file)] as const));
    const withRightSignature = finishVerify(head, files);
    expect(withRightSignature.errors).toEqual([]);
    expect(withRightSignature.ok).toBe(true);
  });

  it('커밋된 시험 파일 한 바이트가 바뀐 발행물(test-only-changed-byte)은 sha256 때문에 실패하고, 서명은 맞고 바뀐 바이트는 하나다', async () => {
    const r = await verifyWith(folder(F.changedByte), PUBLIC_KEY, dataDir());
    expect(r.code).toBe(1);
    expect(r.out).toContain('서명이 맞아요(index.json.sig).');
    expect(r.err).toEqual([
      '결과: 발행물이 맞지 않아요. 이유 1개:',
      `  - files/${TEST_ONLY_EXAM_ID}.3.json(${TEST_ONLY_EXAM_ID}): sha256 이 index.json 에 적힌 값과 달라요. 파일이 바뀌었거나 다른 파일이에요.`,
    ]);
    const entry = indexOf(F.changedByte).exams[0];
    const changed = bytesOf(F.changedByte, entry.file);
    const original = bytesOf(F.badSignature, entry.file);
    expect(sha256Hex(original)).toBe(entry.sha256);
    expect(sha256Hex(changed)).not.toBe(entry.sha256);
    expect(changed.length).toBe(original.length);
    const differ = [...changed.keys()].filter((i) => changed[i] !== original[i]);
    expect(differ.length).toBe(1);
    // 바뀐 파일도 JSON 이고 시험 파일 검사를 통과한다. 받는 쪽은 sha256 으로만 알아챌 수 있다.
    expect(validateExam(JSON.parse(changed.toString('utf8')))).toEqual([]);
  });

  it('커밋된 seq 가 작은 발행물(test-only-older-seq)은 서명과 sha256 이 맞고 seq 가 정상 발행물보다 작다', async () => {
    const r = await verifyWith(folder(F.olderSeq), PUBLIC_KEY, dataDir());
    expect(r.err).toEqual([]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('서명이 맞아요(index.json.sig).');
    const older = indexOf(F.olderSeq);
    const valid = indexOf(F.valid);
    expect(older.seq).toBeLessThan(valid.seq);
    expect(older.issuedAt < valid.issuedAt).toBe(true);
    expect(older.exams[0].rev).toBeLessThan(valid.exams[0].rev);
    // 서명이 틀린 것과 한 바이트가 바뀐 것은 정상보다 seq 가 커서, 정상을 받은 뒤에 와도 seq 로는 버려지지 않는다.
    expect(indexOf(F.badSignature).seq).toBeGreaterThan(valid.seq);
    expect(indexOf(F.changedByte).seq).toBeGreaterThan(valid.seq);
  });

  it('명령을 임시 폴더로 다시 돌리면 커밋된 것과 바이트가 같고, 출력에 비밀 키의 내용이 없다(실제 Node 실행)', () => {
    const dir = tempDir();
    const run = runTool(['testdata', '--data', dir]);
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('파일 15개: 새로 쓴 것 15개, 바꾼 것 0개, 그대로인 것 0개.');
    const made = join(dir, 'testdata');
    const names = listFiles(TESTDATA);
    expect(listFiles(made)).toEqual(names);
    // 바이트 비교는 SHA-256 으로 한다(달라도 키 글자가 테스트 출력에 찍히지 않게).
    for (const name of names) expect(sha256Hex(readFileSync(join(made, ...name.split('/')))), name).toBe(sha256Hex(readFileSync(join(TESTDATA, ...name.split('/')))));
    const secrets = keySecrets(readFileSync(PRIVATE_KEY, 'utf8'));
    expect(leakCount(run.stdout + run.stderr, secrets)).toBe(0);
    // 한 번 더 돌리면 모두 그대로라 파일을 쓰지 않는다.
    const before = snapshot(made);
    const again = runTool(['testdata', '--data', dir]);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain('파일 15개: 새로 쓴 것 0개, 바꾼 것 0개, 그대로인 것 15개.');
    expect(snapshot(made)).toEqual(before);
    expect(leakCount(again.stdout + again.stderr, secrets)).toBe(0);
  });

  it('테스트 전용 키로는 진짜 발행을 하지 못한다: 커밋된 비밀 키는 저장소 안이라 거부하고, 저장소 밖으로 옮겨도 테스트 전용 키라 거부한다', () => {
    const data = dataDir();
    writeExam(data, testExam());
    const o = makeOutDir();
    dirs.push(o.parent);
    const before = snapshot(data);
    const secrets = keySecrets(readFileSync(PRIVATE_KEY, 'utf8'));
    const inRepo = publishTo(data, o.out, PRIVATE_KEY);
    expect(inRepo.code).toBe(1);
    expect(inRepo.err.join('\n')).toContain('비밀 키 파일이 저장소 폴더 안에 있어요');
    // 저장소 밖으로 옮긴 사본, 서명이 틀린 발행물에 쓴 다른 테스트 전용 키도 거부한다(--dry-run 이어도 키를 주면 거부).
    const outside = tempDir();
    const copied = join(outside, 'copied-key.pem');
    copyFileSync(PRIVATE_KEY, copied);
    const other = join(outside, 'other-key.pem');
    writeFileSync(other, privateKeyPem(otherTestOnlyKey()));
    const refused = `${KEY_ENV} 이 가리키는 비밀 키가 테스트 전용 키예요(exam-data/testdata 의 test-only-private-key.pem 과 같은 키). 이 키는 저장소에 들어 있어 누구나 가질 수 있어서 진짜 발행에는 쓰지 않아요.`;
    for (const [keyFile, dryRun] of [
      [copied, false],
      [copied, true],
      [other, false],
    ] as const) {
      const r = publishTo(data, o.out, keyFile, { dryRun });
      expect(r.code).toBe(1);
      expect(r.err[0]).toBe(refused);
      expect(leakCount([...r.out, ...r.err].join('\n'), secrets)).toBe(0);
    }
    expect(leakCount([...inRepo.out, ...inRepo.err].join('\n'), secrets)).toBe(0);
    expect(existsSync(o.out)).toBe(false);
    expect(snapshot(data)).toEqual(before);
  });

  it('testdata 폴더에 이 명령이 만들지 않는 것이 있으면 아무것도 쓰지 않고 거부하고, 바뀐 파일만 다시 쓴다', () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'testdata'));
    writeFileSync(join(dir, 'testdata', 'note.txt'), '테스트 전용 메모\n');
    const before = snapshot(dir);
    const strange = collectIo();
    expect(runTestdata({ dataDir: dir, dataName: 'data' }, strange.io)).toBe(1);
    expect(strange.err).toEqual([
      'data/testdata 에 이 명령이 만들지 않는 것이 있어요(note.txt). 이 폴더는 이 명령이 통째로 만들어요. 그 파일을 옮기고 다시 해 주세요.',
      '아무것도 쓰지 않았어요.',
    ]);
    expect(snapshot(dir)).toEqual(before);
    const missing = collectIo();
    expect(runTestdata({ dataDir: join(dir, 'nope'), dataName: 'nope' }, missing.io)).toBe(1);
    expect(missing.err).toEqual(['자료 폴더가 없어요(nope).', '아무것도 쓰지 않았어요.']);
    expect(existsSync(join(dir, 'nope'))).toBe(false);

    rmSync(join(dir, 'testdata', 'note.txt'));
    const first = collectIo();
    expect(runTestdata({ dataDir: dir, dataName: 'data' }, first.io)).toBe(0);
    expect(first.out).toContain('파일 15개: 새로 쓴 것 15개, 바꾼 것 0개, 그대로인 것 0개.');
    writeFileSync(join(dir, 'testdata', F.valid, SIG_FILE), 'x\n');
    const second = collectIo();
    expect(runTestdata({ dataDir: dir, dataName: 'data' }, second.io)).toBe(0);
    expect(second.out).toContain('파일 15개: 새로 쓴 것 0개, 바꾼 것 1개, 그대로인 것 14개.');
    expect(sha256Hex(readFileSync(join(dir, 'testdata', F.valid, SIG_FILE)))).toBe(sha256Hex(bytesOf(F.valid, SIG_FILE)));
  });

  it('README 에 테스트 전용이고 진짜 발행에 쓰지 않는다는 것과, 폴더마다 무엇이고 받는 쪽이 할 일이 적혀 있다', () => {
    const text = readFileSync(join(TESTDATA, 'README.md'), 'utf8');
    expect(text).toContain('이 폴더의 키와 발행물은 모두 테스트 전용이에요.');
    expect(text).toContain('이 키는 진짜 발행에 절대 쓰지 않아요.');
    expect(text).toContain('형식 예시');
    const data = buildTestdata();
    expect(data.cases.map((c) => c.folder)).toEqual([F.valid, F.badSignature, F.changedByte, F.olderSeq]);
    for (const c of data.cases) expect(text).toContain(`| ${c.folder} | seq ${c.seq}, issuedAt ${c.issuedAt}, 시험 rev ${c.rev} | ${c.what} | ${c.expect} |`);
    const expects = Object.fromEntries(data.cases.map((c) => [c.folder, c.expect]));
    expect(expects[F.valid]).toBe('받아들여요.');
    expect(expects[F.badSignature]).toContain('서명이 맞지 않아 버리고');
    expect(expects[F.changedByte]).toContain('sha256 이 index.json 에 적힌 값과 달라 버리고');
    expect(expects[F.olderSeq]).toContain('seq 가 작아 버려요');
    // 공개 키의 지문이 README 에 적힌 것과 같다.
    expect(text).toContain(`지문(공개 키 32바이트의 SHA-256 앞 16자)은 ${keyFingerprint(testPublicKey())} 예요`);
    // 문서에도 문구 규칙: 느낌표와 금지 문자가 없다.
    expect(text).not.toMatch(new RegExp(`[!${[0x2014, 0x2013, 0x00b7, 0x318d, 0x30fb, 0x2027].map((c) => String.fromCodePoint(c)).join('')}]`));
  });
});
