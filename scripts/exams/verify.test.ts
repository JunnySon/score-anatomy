import { createPublicKey } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkExam } from '../../src/exams/validate.ts';
import type { Exam } from '../../src/types.ts';
import { canonicalJson, sha256Hex } from './canonical.ts';
import { keyFingerprint, publicKeyText, signatureText } from './sign.ts';
import { examFileText } from './state.ts';
import { parseTarget } from './verify.ts';
import {
  ISSUED_AT,
  TEST_LOCK,
  makeDataDir,
  makeOutDir,
  makeTempKey,
  publishTo,
  releasedExam,
  removeDir,
  runTool,
  testExam,
  verifyWith,
  writeExam,
  writeSignedRelease,
} from './testkit.ts';
import type { TempKey } from './testkit.ts';

// exams:verify(작업 지시서 3의 6-2, 6-4): 발행물을 받은 바이트 그대로 공개 키로 확인한다. 서명, format, seq, issuedAt, 시험 파일 경로,
// 시험 파일마다 sha256, 시험 파일 검사(src/exams/validate.ts), id 와 rev, 잠금 달력. 하나라도 틀리면 이유와 함께 실패한다.
// 발행물은 임시 키로 실제 publish 한 것이거나, 검사를 보려고 손으로 만들어 그 임시 키로 서명한 것이다(모두 os.tmpdir() 아래).

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) removeDir(dir);
});
function dataDir(): string {
  const dir = makeDataDir();
  dirs.push(dir);
  return dir;
}
function outDir(): string {
  const o = makeOutDir();
  dirs.push(o.parent);
  return o.out;
}
function tempKey(): TempKey {
  const k = makeTempKey();
  dirs.push(k.dir);
  return k;
}

const SIGNATURE_WRONG = '서명이 맞지 않아요(index.json.sig). index.json 이 바뀌었거나 다른 키로 서명했어요.';

/** 시험 하나를 실제로 발행한 자료 폴더와 발행 폴더. */
function published(key: TempKey, exam: Record<string, unknown> = releasedExam()): { dir: string; out: string } {
  const dir = dataDir();
  const out = outDir();
  writeExam(dir, exam);
  const r = publishTo(dir, out, key.keyFile);
  if (r.code !== 0) throw new Error('테스트 발행이 실패했어요.');
  return { dir, out };
}

/** 발행 폴더를 새 임시 폴더로 복사한다. */
function copyOf(out: string): string {
  const copy = outDir();
  cpSync(out, copy, { recursive: true });
  return copy;
}

/** 파일의 바이트 하나(at 번째)를 바꾼다(아래 비트 하나를 뒤집음). */
function flipByte(path: string, at: number): void {
  const bytes = readFileSync(path);
  bytes[at] ^= 0x01;
  writeFileSync(path, bytes);
}

/** 실패 이유(결과 줄 다음의 "  - " 줄)만. */
function reasons(err: readonly string[]): string[] {
  return err.filter((line) => line.startsWith('  - ')).map((line) => line.slice(4));
}

function checked(raw: Record<string, unknown>): Exam {
  const exam = checkExam(raw).exam;
  if (exam === null) throw new Error('테스트 시험이 검사를 통과하지 못해요.');
  return exam;
}

/** 손으로 만들 발행물의 바탕: 시험 하나(테스트 전용)와 잠금 항목 하나. */
function baseRelease(): { index: Record<string, unknown>; files: Record<string, string> } {
  const text = examFileText(checked(releasedExam()));
  return {
    index: { format: 1, seq: 3, issuedAt: ISSUED_AT, exams: [{ id: 'test-tool-a', rev: 1, file: 'files/test-tool-a.1.json', sha256: sha256Hex(text) }], locks: [TEST_LOCK] },
    files: { 'files/test-tool-a.1.json': text },
  };
}

describe('발행 도구 exams:verify(작업 지시서 3의 6-2, 6-4)', () => {
  it('index.json 한 바이트, 시험 파일 한 바이트, 다른 키로 한 서명은 각각 실패하고 이유가 맞다', async () => {
    const key = tempKey();
    const { dir, out } = published(key);
    expect((await verifyWith(out, key.publicFile, dir)).code).toBe(0);

    // index.json 의 바이트 하나(seq 숫자)를 바꾸면 서명이 맞지 않는다. 서명이 틀리면 다른 것은 보지 않는다.
    const a = copyOf(out);
    const indexText = readFileSync(join(a, 'index.json'), 'utf8');
    flipByte(join(a, 'index.json'), Buffer.byteLength(indexText.slice(0, indexText.indexOf('"seq": 1') + '"seq": '.length)));
    expect(readFileSync(join(a, 'index.json'), 'utf8')).toContain('"seq": 0');
    const ra = await verifyWith(a, key.publicFile, dir);
    expect(ra.code).toBe(1);
    expect(reasons(ra.err)).toEqual([SIGNATURE_WRONG]);
    expect(ra.out).not.toContain('서명이 맞아요(index.json.sig).');
    // 서명 파일의 바이트 하나(base64 글자 하나를 다른 base64 글자로)만 바뀌어도 실패한다.
    const a2 = copyOf(out);
    const sigBytes = readFileSync(join(a2, 'index.json.sig'));
    sigBytes[10] = sigBytes[10] === 0x41 ? 0x42 : 0x41;
    writeFileSync(join(a2, 'index.json.sig'), sigBytes);
    expect(reasons((await verifyWith(a2, key.publicFile, dir)).err)).toEqual([SIGNATURE_WRONG]);

    // 시험 파일의 바이트 하나를 바꾸면 서명은 맞지만 그 파일의 sha256 이 맞지 않는다.
    const b = copyOf(out);
    const examText = readFileSync(join(b, 'files/test-tool-a.1.json'), 'utf8');
    flipByte(join(b, 'files/test-tool-a.1.json'), Buffer.byteLength(examText.slice(0, examText.indexOf('"points": 2') + '"points": '.length)));
    const rb = await verifyWith(b, key.publicFile, dir);
    expect(rb.code).toBe(1);
    expect(rb.out).toContain('서명이 맞아요(index.json.sig).');
    expect(reasons(rb.err)).toEqual(['files/test-tool-a.1.json(test-tool-a): sha256 이 index.json 에 적힌 값과 달라요. 파일이 바뀌었거나 다른 파일이에요.']);

    // 다른 키로 한 서명: index.json 은 그대로 두고 다른 임시 키로 서명하면, 발행에 쓴 키의 공개 키로는 맞지 않는다.
    const other = tempKey();
    const c = copyOf(out);
    writeFileSync(join(c, 'index.json.sig'), signatureText(readFileSync(join(c, 'index.json')), other.key));
    const rc = await verifyWith(c, key.publicFile, dir);
    expect(rc.code).toBe(1);
    expect(reasons(rc.err)).toEqual([SIGNATURE_WRONG]);
    // 그 다른 키의 공개 키로는 맞다(서명 파일의 모양은 맞음).
    expect((await verifyWith(c, other.publicFile, dir)).code).toBe(0);
    // 다른 키로 발행한 것도 마찬가지다.
    const otherRelease = published(other);
    expect(reasons((await verifyWith(otherRelease.out, key.publicFile, otherRelease.dir)).err)).toEqual([SIGNATURE_WRONG]);

    // 서명 파일이 없거나 모양이 틀림
    const d = copyOf(out);
    rmSync(join(d, 'index.json.sig'));
    expect(reasons((await verifyWith(d, key.publicFile, dir)).err)).toEqual(['index.json.sig: 파일이 없어요.']);
    writeFileSync(join(d, 'index.json.sig'), 'test-only\n');
    expect(reasons((await verifyWith(d, key.publicFile, dir)).err)).toEqual([
      'index.json.sig 는 Ed25519 서명 64바이트를 표준 base64(패딩 포함)로 적은 한 줄이어야 해요.',
    ]);
    // 시험 파일이 없음
    const e = copyOf(out);
    rmSync(join(e, 'files/test-tool-a.1.json'));
    expect(reasons((await verifyWith(e, key.publicFile, dir)).err)).toEqual(['files/test-tool-a.1.json(test-tool-a): 파일이 없어요.']);
  });

  it('서명이 맞아도 format, seq, issuedAt, id 와 rev, 시험 파일 검사, 잠금 달력이 틀리면 실패한다', async () => {
    const key = tempKey();
    const dir = dataDir();
    const base = baseRelease();
    // 바탕 그대로면 통과한다.
    const ok = outDir();
    writeSignedRelease(ok, base.index, base.files, key.key);
    const rOk = await verifyWith(ok, key.publicFile, dir);
    expect(rOk.err).toEqual([]);
    expect(rOk.code).toBe(0);

    const entry = (base.index.exams as Record<string, unknown>[])[0];
    const bad = JSON.stringify({ ...JSON.parse(base.files['files/test-tool-a.1.json']), items: [] });
    const cases: { name: string; index: unknown; files?: Record<string, string>; expected: string[] }[] = [
      { name: 'format 2', index: { ...base.index, format: 2 }, expected: ['index.json: format 이 아는 값(1)이 아니에요.'] },
      { name: 'format 없음', index: { ...base.index, format: undefined }, expected: ['index.json: format 이 아는 값(1)이 아니에요.'] },
      { name: 'seq 글자', index: { ...base.index, seq: '3' }, expected: ['index.json: seq 는 1 이상의 정수여야 해요.'] },
      { name: 'seq 0', index: { ...base.index, seq: 0 }, expected: ['index.json: seq 는 1 이상의 정수여야 해요.'] },
      { name: 'seq 소수', index: { ...base.index, seq: 1.5 }, expected: ['index.json: seq 는 1 이상의 정수여야 해요.'] },
      {
        name: 'issuedAt 24시',
        index: { ...base.index, issuedAt: '2030-01-02T24:00' },
        expected: ['index.json: issuedAt 은 2030-01-02T17:10 같은, 실제로 있는 날짜와 시각(한국 시간)이어야 해요.'],
      },
      {
        name: 'issuedAt 날짜만',
        index: { ...base.index, issuedAt: '2030-01-02' },
        expected: ['index.json: issuedAt 은 2030-01-02T17:10 같은, 실제로 있는 날짜와 시각(한국 시간)이어야 해요.'],
      },
      { name: 'exams 가 배열이 아님', index: { ...base.index, exams: {} }, expected: ['index.json: exams 는 시험 목록의 배열이어야 해요.'] },
      {
        name: 'sha256 대문자',
        index: { ...base.index, exams: [{ ...entry, sha256: (entry.sha256 as string).toUpperCase() }] },
        expected: ['index.json 의 exams 1번째: sha256 은 SHA-256(16진수 소문자 64자)이어야 해요.'],
      },
      { name: 'rev 0', index: { ...base.index, exams: [{ ...entry, rev: 0 }] }, expected: ['index.json 의 exams 1번째: rev 는 1 이상의 정수여야 해요.'] },
      {
        name: '목록의 rev 와 파일의 rev 가 다름',
        index: { ...base.index, exams: [{ ...entry, rev: 2 }] },
        expected: ['files/test-tool-a.1.json(test-tool-a): 파일 안의 rev(1)가 index.json 의 rev(2)와 달라요.'],
      },
      {
        name: '목록의 id 와 파일의 id 가 다름',
        index: { ...base.index, exams: [{ ...entry, id: 'test-tool-z' }] },
        expected: ['files/test-tool-a.1.json(test-tool-z): 파일 안의 id(test-tool-a)가 index.json 의 id 와 달라요.'],
      },
      {
        name: 'id 가 겹침',
        index: { ...base.index, exams: [entry, { ...entry, file: 'files/test-tool-a.1b.json' }] },
        files: { ...base.files, 'files/test-tool-a.1b.json': base.files['files/test-tool-a.1.json'] },
        expected: ['index.json 의 exams 2번째: id 가 앞의 항목과 겹쳐요(test-tool-a).'],
      },
      {
        name: '시험 파일 검사를 통과하지 못함(sha256 은 맞음)',
        index: { ...base.index, exams: [{ ...entry, sha256: sha256Hex(bad) }] },
        files: { 'files/test-tool-a.1.json': bad },
        expected: ['files/test-tool-a.1.json(test-tool-a): 시험 파일 검사를 통과하지 못했어요: items가 비어 있어요.'],
      },
      {
        name: '시험 파일이 JSON 이 아님(sha256 은 맞음)',
        index: { ...base.index, exams: [{ ...entry, sha256: sha256Hex('test-only\n') }] },
        files: { 'files/test-tool-a.1.json': 'test-only\n' },
        expected: ['files/test-tool-a.1.json(test-tool-a): JSON 으로 읽지 못했어요.'],
      },
      {
        name: '잠금 항목의 형식이 틀림',
        index: { ...base.index, locks: [{ ...TEST_LOCK, start: '2030-01-02T17:45', end: '2030-01-02T08:40' }] },
        expected: ['index.json 의 잠금 달력(locks): 1번째 항목: start가 end보다 앞서야 해요.'],
      },
      {
        name: '잠금 달력이 배열이 아님',
        index: { ...base.index, locks: null },
        expected: ['index.json 의 잠금 달력(locks): 잠금 달력은 항목의 배열이어야 해요. 항목이 없으면 빈 배열([])로 둬요.'],
      },
      { name: 'JSON 이 아님', index: 'test-only, not JSON\n', expected: ['index.json: JSON 객체로 읽지 못했어요(UTF-8 글자의 JSON 객체여야 해요).'] },
      { name: '맨 앞의 BOM', index: `\uFEFF${canonicalJson(base.index)}`, expected: ['index.json: JSON 객체로 읽지 못했어요(UTF-8 글자의 JSON 객체여야 해요).'] },
    ];
    for (const c of cases) {
      const out = outDir();
      writeSignedRelease(out, c.index, c.files ?? base.files, key.key);
      const r = await verifyWith(out, key.publicFile, dir);
      expect(r.code, c.name).toBe(1);
      expect(r.out, c.name).toContain('서명이 맞아요(index.json.sig).');
      expect(reasons(r.err), c.name).toEqual(c.expected);
    }
  });

  it('경로가 안전하지 않은 시험 파일(.., 절대 경로, 역슬래시, 숨은 파일 등)은 읽지 않고 거부한다', async () => {
    const key = tempKey();
    const dir = dataDir();
    const base = baseRelease();
    const text = base.files['files/test-tool-a.1.json'];
    const entry = (base.index.exams as Record<string, unknown>[])[0];
    const message = "file 은 index.json 이 있는 곳 기준의 안전한 상대 경로여야 해요('..', 절대 경로, 역슬래시, 숨은 파일, 영어 글자와 숫자와 . _ - / 밖의 글자는 받지 않아요).";
    const paths = [
      '../outside.json',
      'files/../../outside.json',
      '/outside.json',
      'C:/outside.json',
      'files\\test-tool-a.1.json',
      '.hidden.json',
      'files/./test-tool-a.1.json',
      'files//test-tool-a.1.json',
      '%2e%2e/outside.json',
      'files/test-tool-a.1.json?x=1',
      'index.json',
      '',
    ];
    for (const file of paths) {
      const o = makeOutDir();
      dirs.push(o.parent);
      // 발행 폴더 밖(상위 폴더)과 안(숨은 파일)에 sha256 이 맞는 시험 파일을 둔다. 경로 검사를 건너뛰면 그 파일을 읽어 통과하게 된다.
      writeSignedRelease(o.out, { ...base.index, exams: [{ ...entry, file }] }, base.files, key.key);
      writeFileSync(join(o.parent, 'outside.json'), text);
      writeFileSync(join(o.out, '.hidden.json'), text);
      const r = await verifyWith(o.out, key.publicFile, dir);
      expect(r.code, file).toBe(1);
      expect(reasons(r.err), file).toEqual([file === '' ? 'index.json 의 exams 1번째: file 이 비어 있어요.' : `index.json 의 exams 1번째: ${message}`]);
      expect(r.out.some((line) => line.endsWith('맞아요.') && line.startsWith('  ')), file).toBe(false);
    }
  });

  it('공개 키 파일이 없거나 모양이 틀리면 알아듣게 알리고 실패한다', async () => {
    const key = tempKey();
    const { dir, out } = published(key);
    const keys = outDir();
    mkdirSync(keys);
    const missing = await verifyWith(out, join(keys, 'public-key.txt'), dir);
    expect(missing.code).toBe(1);
    expect(missing.err).toEqual([
      '공개 키 파일이 없어요(key). 진짜 공개 키는 키를 맡은 사람이 npm run exams:keygen 으로 만들어 자료 폴더에 둬요. 다른 공개 키로 확인하려면 --key <공개 키 파일> 을 줘요.',
      '확인하지 못했어요.',
    ]);
    const good = publicKeyText(key.key).trim();
    const shapes = [
      `${good}\n${good}\n`,
      ` ${good}\n`,
      `${good} \n`,
      `${good.slice(0, -2)}==\n`,
      `${good.slice(1)}\n`,
      // PEM 모양의 공개 키(SPKI)는 받지 않는다(32바이트의 base64 한 줄이어야 함).
      String(createPublicKey(key.key).export({ type: 'spki', format: 'pem' })),
      '',
    ];
    for (const text of shapes) {
      writeFileSync(join(keys, 'public-key.txt'), text);
      const r = await verifyWith(out, join(keys, 'public-key.txt'), dir);
      expect(r.code).toBe(1);
      expect(r.err).toEqual(['key: 공개 키 파일은 Ed25519 공개 키 32바이트를 표준 base64(패딩 포함)로 적은 한 줄이어야 해요.', '확인하지 못했어요.']);
    }
    // 끝의 줄바꿈이 CRLF 이거나 없어도 받는다.
    for (const text of [`${good}\r\n`, good]) {
      writeFileSync(join(keys, 'public-key.txt'), text);
      expect((await verifyWith(out, join(keys, 'public-key.txt'), dir)).code).toBe(0);
    }
    // 실제 Node: --key 를 주지 않으면 <자료 폴더>/public-key.txt 를 찾고, 없으면 그 경로를 알려 준다.
    const run = runTool(['verify', out, '--data', dir]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`공개 키 파일이 없어요(${join(dir, 'public-key.txt')}).`);
    writeFileSync(join(dir, 'public-key.txt'), publicKeyText(key.key));
    const ok = runTool(['verify', out, '--data', dir]);
    expect(ok.stderr).toBe('');
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain(`(지문 ${keyFingerprint(key.key)}).`);
    expect(ok.stdout).toContain('결과: 발행물이 맞아요. 서명, 시험 파일의 SHA-256 과 검사, 잠금 달력이 모두 맞아요.');
  }, 60000);

  it('목록에 없는 파일이 있거나 자료 폴더의 마지막 발행과 다르면 알린다(실패는 아님)', async () => {
    const key = tempKey();
    const { dir, out } = published(key, testExam());
    const older = copyOf(out);
    // 다시 발행하면 자료 폴더의 마지막 발행은 seq 2 가 된다. 복사해 둔 seq 1 발행물은 맞지만 마지막 발행과 다르다.
    writeExam(dir, releasedExam({ rev: 2 }));
    expect(publishTo(dir, out, key.keyFile, { issuedAt: '2030-01-02T20:10' }).code).toBe(0);
    writeFileSync(join(older, 'files', 'test-tool-a.0.json'), '{}\n');
    const r = await verifyWith(older, key.publicFile, dir);
    expect(r.code).toBe(0);
    expect(r.out).toContain('알림 2개');
    expect(r.out).toContain('  - files/test-tool-a.0.json: index.json 의 목록에 없는 파일이에요. 발행 폴더를 통째로 올리면 함께 올라가요.');
    expect(r.out).toContain(
      '  - 이 발행물(seq 1, issuedAt 2030-01-02T17:10)은 자료 폴더의 마지막 발행(seq 2, issuedAt 2030-01-02T20:10)과 달라요. 올린 뒤라면 새 발행물이 아직 올라가지 않았거나 캐시가 남아 있을 수 있어요.',
    );
    const now = await verifyWith(out, key.publicFile, dir);
    expect(now.out).toContain('자료 폴더의 마지막 발행(seq 2, issuedAt 2030-01-02T20:10)과 같아요.');
    expect(now.out.some((line) => line.startsWith('알림'))).toBe(false);
  });

  it('확인할 곳의 인자: 폴더, http(s) 주소, 끝이 index.json 인 주소, 계정이나 쿼리가 든 주소', () => {
    const base = makeOutDir();
    dirs.push(base.parent);
    expect(parseTarget('dist-exams', base.parent)).toEqual({ target: { kind: 'folder', path: join(base.parent, 'dist-exams') }, error: null });
    const url = (arg: string) => {
      const t = parseTarget(arg, base.parent).target;
      return t?.kind === 'url' ? t.url.href : null;
    };
    expect(url('http://127.0.0.1:4180')).toBe('http://127.0.0.1:4180/');
    expect(url('http://127.0.0.1:4180/')).toBe('http://127.0.0.1:4180/');
    expect(url('https://exams.invalid/data')).toBe('https://exams.invalid/data/');
    expect(url('https://exams.invalid/data/index.json')).toBe('https://exams.invalid/data/');
    expect(parseTarget('ftp://exams.invalid/', base.parent).error).toBe('주소는 http:// 나 https:// 로 시작해야 해요.');
    expect(parseTarget('https://user:pw@exams.invalid/', base.parent).error).toBe('주소에 사용자 이름이나 암호를 넣지 않아요.');
    expect(parseTarget('https://exams.invalid/?device=1', base.parent).error).toBe('주소에 ? 나 # 뒤의 값을 붙이지 않아요. 발행물이 있는 폴더의 주소만 줘요.');
    expect(parseTarget('https://exams.invalid/#x', base.parent).error).toBe('주소에 ? 나 # 뒤의 값을 붙이지 않아요. 발행물이 있는 폴더의 주소만 줘요.');
  });
});
