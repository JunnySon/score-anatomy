import { createPrivateKey, createPublicKey } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runKeygen } from './keygen.ts';
import { keyFingerprint, loadSigningKey, parsePublicKeyText, publicKeyBytes } from './sign.ts';
import { ROOT, collectIo, keySecrets, leakCount, makeDataDir, makeOutDir, publishTo, removeDir, runTool, snapshot, testExam, writeExam } from './testkit.ts';

// exams:keygen(작업 지시서 3의 6-4): 키 쌍을 만든다. 비밀 키는 인자로 받은 저장소 밖 경로에, 공개 키는 <자료 폴더>/public-key.txt 에 쓴다.
// 이번 작업에서는 테스트 안에서 임시 폴더로만 돌린다. 저장소의 exam-data/public-key.txt(진짜 공개 키 자리)는 만들지 않는다.
// 저장소 안 경로를 거부하는지 볼 때도 그 경로에는 아무것도 쓰지 않는다(거부하는지만 본다).

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) removeDir(dir);
});
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
function dataDir(): string {
  const dir = makeDataDir();
  dirs.push(dir);
  return dir;
}

function keygen(keyPath: string, data: string) {
  const c = collectIo();
  const code = runKeygen({ keyPath, keyName: 'key', dataDir: data, dataName: 'data', root: ROOT }, c.io);
  return { code, out: c.out, err: c.err };
}

describe('발행 도구 exams:keygen(작업 지시서 3의 6-4)', () => {
  it('키 쌍을 만들고 만든 키로 서명한 발행물을 verify 가 통과한다(실제 Node 실행, 공개 키는 --data 의 public-key.txt)', () => {
    const repoData = snapshot(join(ROOT, 'exam-data'));
    const dir = dataDir();
    const keyDir = tempDir('sa-exams-gen-key-');
    const keyFile = join(keyDir, 'test-only-private-key.pem');
    const run = runTool(['keygen', keyFile, '--data', dir]);
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);

    // 비밀 키: PEM(PKCS#8) 한 덩어리, Ed25519. 윈도우가 아니면 권한 600.
    const pem = readFileSync(keyFile, 'utf8');
    expect(pem).toMatch(/^-----BEGIN PRIVATE KEY-----\n[A-Za-z0-9+/=\n]+-----END PRIVATE KEY-----\n$/);
    const loaded = loadSigningKey({ SA_EXAM_KEY_FILE: keyFile }, ROOT, [{ dir: ROOT, name: '저장소 폴더' }]);
    expect(loaded.errors).toEqual([]);
    expect(loaded.key?.asymmetricKeyType).toBe('ed25519');
    if (process.platform !== 'win32') expect(statSync(keyFile).mode & 0o777).toBe(0o600);

    // 공개 키: 32바이트의 표준 base64 한 줄과 LF, 비밀 키의 짝.
    const pub = readFileSync(join(dir, 'public-key.txt'), 'utf8');
    expect(pub).toMatch(/^[A-Za-z0-9+/]{43}=\n$/);
    expect(Buffer.from(pub.trim(), 'base64')).toHaveLength(32);
    const parsed = parsePublicKeyText(pub);
    expect(parsed.error).toBeNull();
    expect(Buffer.from(pub.trim(), 'base64').equals(publicKeyBytes(createPublicKey(createPrivateKey(pem))))).toBe(true);

    // 출력에는 키 내용이 없고 공개 키의 지문만 있다.
    expect(leakCount(`${run.stdout}\n${run.stderr}`, keySecrets(pem))).toBe(0);
    const fp = keyFingerprint(createPrivateKey(pem));
    expect(run.stdout).toContain(`공개 키를 썼어요: ${join(dir, 'public-key.txt')}(지문 ${fp}). 이 파일은 커밋하고 앱 껍데기에 넣어요.`);
    expect(run.stdout).toContain(`비밀 키를 썼어요: ${keyFile}. 이 파일은 저장소 밖에 두고 다른 사람과 나누지 않아요. 발행할 때 SA_EXAM_KEY_FILE 에 이 경로를 넣어요.`);

    // 그 키로 발행하면 자료 폴더의 공개 키와 짝인지 확인하고, verify 는 --key 없이 <자료 폴더>/public-key.txt 로 통과한다.
    writeExam(dir, testExam());
    const o = makeOutDir();
    dirs.push(o.parent);
    const published = runTool(['publish', '--data', dir, '--out', o.out, '--issued-at', '2030-01-02T17:10'], [], { SA_EXAM_KEY_FILE: keyFile });
    expect(published.stderr).toBe('');
    expect(published.status).toBe(0);
    expect(published.stdout).toContain(`서명: Ed25519, 공개 키 지문 ${fp}. 자료 폴더의 public-key.txt 와 짝이에요.`);
    const verified = runTool(['verify', o.out, '--data', dir]);
    expect(verified.stderr).toBe('');
    expect(verified.status).toBe(0);
    expect(verified.stdout).toContain(`공개 키: ${join(dir, 'public-key.txt')}(지문 ${fp}).`);
    expect(verified.stdout).toContain('결과: 발행물이 맞아요. 서명, 시험 파일의 SHA-256 과 검사, 잠금 달력이 모두 맞아요.');
    expect(leakCount(`${published.stdout}${published.stderr}${verified.stdout}${verified.stderr}`, keySecrets(pem))).toBe(0);
    // 저장소의 exam-data 는 그대로다(진짜 공개 키 자리를 만들지 않음).
    expect(snapshot(join(ROOT, 'exam-data'))).toEqual(repoData);
  }, 60000);

  it('저장소 안 경로, 자료 폴더 안 경로, 이미 있는 비밀 키 파일과 공개 키 파일을 거부하고 아무것도 쓰지 않는다', () => {
    const repoData = snapshot(join(ROOT, 'exam-data'));
    const dir = dataDir();
    const keyDir = tempDir('sa-exams-gen-key-');
    const fresh = join(keyDir, 'test-only-private-key.pem');

    // 저장소 안(.gitignore 된 verify-out 아래와 exam-data 아래, 상대 경로 포함). 거부하므로 그 경로에 아무것도 생기지 않는다.
    // 실행마다 다른 이름을 쓰고, 틀린 구현이 그 경로에 키를 써 버렸으면 테스트가 끝날 때 지운다(저장소 안에 키가 남지 않게).
    const name = `test-only-private-key-${process.pid}-${Date.now()}.pem`;
    const inRepo = [
      join(ROOT, 'verify-out', name),
      join(ROOT, 'exam-data', name),
      join(ROOT, 'src', '..', 'verify-out', 'none', name),
    ];
    try {
      for (const path of inRepo) {
        const r = keygen(path, dir);
        expect(r.code, path).toBe(1);
        expect(r.err[0], path).toContain('비밀 키 파일이 저장소 폴더 안에 있어요(실제 경로 ');
        expect(r.err[r.err.length - 1]).toBe('아무것도 쓰지 않았어요.');
        expect(existsSync(path), path).toBe(false);
      }
      const rel = runTool(['keygen', relative(ROOT, inRepo[0]), '--data', dir]);
      expect(rel.status).toBe(1);
      expect(rel.stderr).toContain('비밀 키 파일이 저장소 폴더 안에 있어요');
      expect(existsSync(inRepo[0])).toBe(false);
      expect(existsSync(join(dir, 'public-key.txt'))).toBe(false);
    } finally {
      for (const path of inRepo) rmSync(path, { force: true });
    }

    // 자료 폴더 안
    const inData = keygen(join(dir, 'test-only-private-key.pem'), dir);
    expect(inData.code).toBe(1);
    expect(inData.err[0]).toContain('비밀 키 파일이 자료 폴더 안에 있어요');

    // 이미 있는 비밀 키 파일은 덮어쓰지 않는다.
    const existing = join(keyDir, 'existing.pem');
    writeFileSync(existing, '테스트 전용 자리 파일\n');
    const r1 = keygen(existing, dir);
    expect(r1.code).toBe(1);
    expect(r1.err[0]).toBe('비밀 키를 쓸 곳에 이미 파일이 있어요(key). 덮어쓰지 않아요.');
    expect(readFileSync(existing, 'utf8')).toBe('테스트 전용 자리 파일\n');

    // 비밀 키를 쓸 폴더가 없음, 자료 폴더가 없음
    const r2 = keygen(join(keyDir, 'no-such-folder', 'k.pem'), dir);
    expect(r2.code).toBe(1);
    expect(r2.err[0]).toContain('비밀 키를 쓸 폴더가 없어요');
    const r3 = keygen(fresh, join(keyDir, 'no-such-data'));
    expect(r3.code).toBe(1);
    expect(r3.err[0]).toBe('자료 폴더가 없어요(data).');
    expect(existsSync(fresh)).toBe(false);
    expect(existsSync(join(dir, 'public-key.txt'))).toBe(false);

    // 공개 키 파일이 이미 있으면 비밀 키도 쓰지 않는다(진짜 공개 키를 지우는 사고를 막으려고).
    writeFileSync(join(dir, 'public-key.txt'), '테스트 전용 자리 파일\n');
    const r4 = keygen(fresh, dir);
    expect(r4.code).toBe(1);
    expect(r4.err[0]).toBe(
      '공개 키 파일이 이미 있어요(data/public-key.txt). 덮어쓰지 않아요(진짜 공개 키를 지우는 사고를 막으려고). 키를 바꾸려면 사람이 지금 키를 확인하고 그 파일을 옮긴 뒤 다시 해요.',
    );
    expect(existsSync(fresh)).toBe(false);
    expect(readFileSync(join(dir, 'public-key.txt'), 'utf8')).toBe('테스트 전용 자리 파일\n');

    // 같은 자리에 두 번: 처음은 만들고, 두 번째는 거부하고 처음 만든 키를 그대로 둔다.
    const second = dataDir();
    expect(keygen(fresh, second).code).toBe(0);
    const firstKey = readFileSync(fresh, 'utf8');
    const firstPub = readFileSync(join(second, 'public-key.txt'), 'utf8');
    const third = dataDir();
    expect(keygen(fresh, third).code).toBe(1);
    expect(readFileSync(fresh, 'utf8')).toBe(firstKey);
    expect(existsSync(join(third, 'public-key.txt'))).toBe(false);
    mkdirSync(join(keyDir, 'other'));
    expect(keygen(join(keyDir, 'other', 'k.pem'), second).code).toBe(1);
    expect(readFileSync(join(second, 'public-key.txt'), 'utf8')).toBe(firstPub);

    // 만든 키로 발행할 수 있다(자료 폴더의 공개 키와 짝).
    writeExam(second, testExam());
    const o = makeOutDir();
    dirs.push(o.parent);
    expect(publishTo(second, o.out, fresh).code).toBe(0);
    expect(snapshot(join(ROOT, 'exam-data'))).toEqual(repoData);
  }, 60000);
});
