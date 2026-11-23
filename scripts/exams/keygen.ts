import { existsSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import type { Io } from './io.ts';
import { KEY_ENV, PUBLIC_KEY_FILE, generateSigningKey, keyFingerprint, keyPlaceProblem, publicKeyText } from './sign.ts';

// exams:keygen(작업 지시서 3의 6-4): Ed25519 키 쌍을 만든다. 진짜 키는 사람이 만든다(이번 작업에서는 테스트 안에서 임시 폴더로만 돌린다).
// - 비밀 키(PEM, PKCS#8)는 인자로 받은 경로에만 쓴다. 그 경로가 저장소 폴더나 자료 폴더 안이면 거부하고, 이미 파일이 있으면 덮어쓰지 않는다.
//   되도록 본인만 읽게 만든다(윈도우가 아니면 권한 600).
// - 공개 키는 <자료 폴더>/public-key.txt 에 쓴다. 이미 있으면 덮어쓰지 않고 거부한다(진짜 공개 키를 지우는 사고를 막으려고).
// - 키 내용은 출력하지 않는다. 공개 키의 지문(SHA-256 앞 16자)만 적는다.

export interface KeygenOptions {
  /** 비밀 키를 쓸 경로와 출력에 쓰는 이름. */
  keyPath: string;
  keyName: string;
  dataDir: string;
  dataName: string;
  /** 저장소 폴더. 비밀 키 경로가 이 안이면 거부한다. */
  root: string;
}

/** exams:keygen 을 돌린다. 키 쌍을 썼으면 0, 거부하거나 쓰지 못했으면 1을 돌려준다. */
export function runKeygen(opts: KeygenOptions, io: Io): number {
  const fail = (messages: readonly string[]) => {
    for (const m of messages) io.err(m);
    io.err('아무것도 쓰지 않았어요.');
    return 1;
  };
  if (!existsSync(opts.dataDir) || !statSync(opts.dataDir).isDirectory()) return fail([`자료 폴더가 없어요(${opts.dataName}).`]);
  const publicPath = join(opts.dataDir, PUBLIC_KEY_FILE);
  // 출력에 쓰는 이름: 자료 폴더 이름이 상대 경로면 / 로, 절대 경로면 운영체제의 구분자로 잇는다(data.ts 의 displayPath 와 같은 모양).
  const publicName = opts.dataName === '.' ? PUBLIC_KEY_FILE : isAbsolute(opts.dataName) ? join(opts.dataName, PUBLIC_KEY_FILE) : `${opts.dataName}/${PUBLIC_KEY_FILE}`;
  if (existsSync(publicPath)) {
    return fail([
      `공개 키 파일이 이미 있어요(${publicName}). 덮어쓰지 않아요(진짜 공개 키를 지우는 사고를 막으려고). 키를 바꾸려면 사람이 지금 키를 확인하고 그 파일을 옮긴 뒤 다시 해요.`,
    ]);
  }
  const place = keyPlaceProblem(opts.keyPath, [
    { dir: opts.root, name: '저장소 폴더' },
    { dir: opts.dataDir, name: '자료 폴더' },
  ]);
  if (place !== null) return fail([place]);
  if (existsSync(opts.keyPath)) return fail([`비밀 키를 쓸 곳에 이미 파일이 있어요(${opts.keyName}). 덮어쓰지 않아요.`]);
  const parent = dirname(opts.keyPath);
  if (!existsSync(parent) || !statSync(parent).isDirectory()) return fail([`비밀 키를 쓸 폴더가 없어요(${parent}). 폴더를 먼저 만들어 주세요.`]);

  const { key, pem } = generateSigningKey();
  try {
    // wx: 그 사이에 파일이 생겼으면 쓰지 않는다. 권한 600 은 윈도우가 아닌 곳에서 본인만 읽고 쓰게 한다.
    writeFileSync(opts.keyPath, pem, { flag: 'wx', mode: 0o600 });
  } catch {
    return fail([`비밀 키 파일을 쓰지 못했어요(${opts.keyName}).`]);
  }
  try {
    writeFileSync(publicPath, publicKeyText(key), { flag: 'wx' });
  } catch {
    let removed = true;
    try {
      rmSync(opts.keyPath, { force: true });
    } catch {
      removed = false;
    }
    if (!removed) {
      io.err(`공개 키 파일을 쓰지 못했어요(${publicName}). 방금 쓴 비밀 키 파일(${opts.keyName})을 지우지 못했으니 지워 주세요.`);
      return 1;
    }
    return fail([`공개 키 파일을 쓰지 못했어요(${publicName}). 방금 쓴 비밀 키 파일도 지웠어요.`]);
  }
  io.out(`비밀 키를 썼어요: ${opts.keyName}. 이 파일은 저장소 밖에 두고 다른 사람과 나누지 않아요. 발행할 때 ${KEY_ENV} 에 이 경로를 넣어요.`);
  io.out(
    process.platform === 'win32'
      ? '  윈도우에서는 이 도구가 파일 권한을 바꾸지 못해요. 비밀 키는 본인만 열 수 있는 폴더에 둬요.'
      : '  비밀 키 파일은 본인만 읽고 쓸 수 있게(권한 600) 만들었어요.',
  );
  io.out(`공개 키를 썼어요: ${publicName}(지문 ${keyFingerprint(key)}). 이 파일은 커밋하고 앱 껍데기에 넣어요.`);
  return 0;
}
