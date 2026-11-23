import { randomBytes } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { answersRevOf } from '../../src/exams/validate.ts';
import { isValidYmdHm, kstText } from '../../src/logic/dates.ts';
import type { Exam, LockEntry } from '../../src/types.ts';
import { checkData } from './check.ts';
import { STATE_FILE, writeTextFile } from './data.ts';
import type { Io } from './io.ts';
import { FILES_DIR, INDEX_FILE, SIG_FILE, buildRelease } from './release.ts';
import type { ReleaseFile } from './release.ts';
import { KEY_ENV, PUBLIC_KEY_FILE, isInside, keyFingerprint, loadSigningKey, parsePublicKeyText, publicKeyBytes, signatureText } from './sign.ts';
import { locksSha256, ro, stateEntryOf, stateText } from './state.ts';
import type { ExamState } from './state.ts';
import { checkIndex, finishVerify, verifyFolder } from './verify.ts';
import type { Fetched } from './verify.ts';

// exams:publish(작업 지시서 3의 6-2, 6-4): exams:check 와 같은 검사(check.ts 의 checkData)를 통과하면 seq 를 올리고
// 발행 폴더(기본 dist-exams)를 새로 만들고 index.json 에 서명하고 state.json 을 고친다. 매번 원본의 모든 시험을 담는 전체 발행이다.
// - 비밀 키는 환경 변수 SA_EXAM_KEY_FILE 이 가리키는 파일에서만 읽는다(sign.ts). 키 내용은 출력하지 않는다.
// - 발행 폴더는 옆의 임시 폴더에 다 만들고 확인(verify.ts 와 같은 확인)한 뒤 통째로 바꿔 넣는다. 그래서 그 전 발행의 파일이 남지 않고,
//   도중에 실패하면 state.json 과 발행 폴더가 그 전 그대로다(바꿔 넣은 뒤 state.json 쓰기가 실패하면 발행 폴더를 되돌린다).
// - --dry-run 은 파일과 state.json 을 하나도 쓰지 않고 결과만 보여 준다. 비밀 키가 없어도 되고, SA_EXAM_KEY_FILE 이 있으면 그 키도 확인한다.
// - issuedAt 은 --issued-at 으로 주거나 지금의 한국 시각이다. 마지막 발행보다 이르면 거부한다(같은 시각은 받는다).
// - 마지막 발행과 바뀐 것이 하나도 없으면 발행하지 않는다. 같은 내용을 새 seq 로 다시 내야 하면 --allow-same 을 붙인다.
// - 자료 폴더에 public-key.txt 가 있으면 비밀 키와 짝인지 보고, 짝이 아니면 거부한다(앱이 그 서명을 받지 않아서).
//   저장소의 진짜 자료 폴더(exam-data)로 실제 발행할 때는 public-key.txt 가 없어도 거부한다(별도 검토 C6).
// - 발행 폴더(--out)는 통째로 바꿔 넣으므로, 발행물이 아닌 파일이 있거나 저장소, 자료 폴더와 겹치면 거부한다(다른 파일을 지우지 않게).

/** 도중 실패를 흉내 낼 수 있는 단계: 임시 폴더를 다 쓴 뒤, 그 전 발행 폴더를 옮긴 뒤, state.json 을 쓰기 전. */
export type PublishStep = 'files' | 'swap' | 'state';

export interface PublishOptions {
  dataDir: string;
  dataName: string;
  outDir: string;
  outName: string;
  /** --issued-at 으로 준 발행 시각("YYYY-MM-DDTHH:mm", 한국 시간). 없으면 지금의 한국 시각을 쓴다. */
  issuedAt: string | null;
  dryRun: boolean;
  allowSame: boolean;
  /** SA_EXAM_KEY_FILE 을 읽을 환경 변수. */
  env: Readonly<Record<string, string | undefined>>;
  /** 환경 변수에 적은 상대 경로를 풀 기준 폴더(명령을 친 폴더). */
  base: string;
  /** 저장소 폴더. 비밀 키 파일이 이 안에 있으면 거부한다. */
  root: string;
  /** 지금 시각(UTC 밀리초). 테스트가 바꿔 끼운다. */
  now?: () => number;
  /** 테스트가 도중 실패를 흉내 낼 때만 쓴다. 단계 이름을 받고, 던지면 그 단계에서 멈춘다. */
  interrupt?: (step: PublishStep) => void;
}

/** 자료 폴더가 저장소의 진짜 자료 폴더(<저장소>/exam-data)인지. 두 경로가 서로의 안이면 같은 폴더다. */
export function isRepoDataDir(dataDir: string, root: string): boolean {
  const repoData = join(root, 'exam-data');
  return isInside(dataDir, repoData) && isInside(repoData, dataDir);
}

/** 발행 폴더에 둘 수 있는 것: index.json, index.json.sig, files 폴더(안에는 *.json 파일만). 그 밖의 것이 있으면 발행 폴더가 아닌 곳으로 본다. */
export function outDirProblems(outDir: string, dataDir: string, root: string): string[] {
  if (isInside(root, outDir)) return ['발행 폴더(--out)가 저장소 폴더와 같거나 그 위예요. 발행 폴더는 통째로 바꿔 넣으니 따로 둬요.'];
  if (isInside(outDir, dataDir) || isInside(dataDir, outDir)) return ['발행 폴더(--out)가 자료 폴더와 겹쳐요. 발행 폴더는 자료 폴더 밖에 둬요.'];
  if (!existsSync(outDir)) {
    const parent = dirname(outDir);
    return existsSync(parent) && statSync(parent).isDirectory() ? [] : [`발행 폴더(--out)를 둘 폴더가 없어요(${parent}).`];
  }
  const st = lstatSync(outDir);
  if (st.isSymbolicLink()) return ['발행 폴더(--out)가 심볼릭 링크예요. 실제 폴더를 줘요.'];
  if (!st.isDirectory()) return ['발행 폴더(--out)가 폴더가 아니에요.'];
  const strange: string[] = [];
  for (const ent of readdirSync(outDir, { withFileTypes: true })) {
    if ((ent.name === INDEX_FILE || ent.name === SIG_FILE) && ent.isFile()) continue;
    if (ent.name === FILES_DIR && ent.isDirectory()) {
      for (const f of readdirSync(join(outDir, FILES_DIR), { withFileTypes: true })) {
        if (!(f.isFile() && f.name.endsWith('.json'))) strange.push(`${FILES_DIR}/${f.name}`);
      }
      continue;
    }
    strange.push(ent.name);
  }
  if (strange.length === 0) return [];
  return [
    `발행 폴더(--out)에 발행물이 아닌 것이 있어요(${strange.slice(0, 5).join(', ')}${strange.length > 5 ? ' 등' : ''}). 발행 폴더는 통째로 바꿔 넣어서, 다른 파일을 지우지 않으려고 멈췄어요. 다른 폴더를 주거나 그 파일을 옮겨 주세요.`,
  ];
}

/** 발행할 것이 마지막 발행과 같은지: 시험 목록, 시험 파일 바이트(sha256), 잠금 달력이 모두 같으면 true. */
function sameAsPublished(state: ExamState, exams: readonly Exam[], locks: readonly LockEntry[], files: ReadonlyMap<string, string>): boolean {
  if (state.seq === 0 || state.locksSha256 !== locksSha256(locks)) return false;
  if (Object.keys(state.exams).length !== exams.length) return false;
  return exams.every((exam) => {
    const prev = Object.prototype.hasOwnProperty.call(state.exams, exam.id) ? state.exams[exam.id] : undefined;
    return prev !== undefined && prev.sha256 === files.get(exam.id);
  });
}

/** 발행물을 폴더에 쓴다(files 폴더 포함). 서명하고 SHA-256 을 셈한 바이트 그대로 쓴다. */
function writeRelease(dir: string, files: readonly ReleaseFile[], indexBytes: Uint8Array, sig: string): void {
  mkdirSync(join(dir, FILES_DIR));
  for (const f of files) writeFileSync(join(dir, ...f.path.split('/')), f.bytes);
  writeFileSync(join(dir, INDEX_FILE), indexBytes);
  writeFileSync(join(dir, SIG_FILE), sig);
}

/** 메모리에 만든 발행물을 확인한다(--dry-run 에서 키가 있을 때). */
function verifyInMemory(indexBytes: Uint8Array, sig: string, files: readonly ReleaseFile[], publicKey: KeyObject): string[] {
  const got = (bytes: Uint8Array): Fetched => ({ bytes, error: null });
  const head = checkIndex(got(indexBytes), got(Buffer.from(sig, 'utf8')), publicKey);
  return finishVerify(head, new Map(files.map((f) => [f.path, got(f.bytes)] as const))).errors;
}

function removeQuietly(path: string): boolean {
  try {
    rmSync(path, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/** exams:publish 를 돌린다. 발행했거나(--dry-run 이면 보여 줬거나) 0, 거부하거나 실패하면 1을 돌려준다. */
export function runPublish(opts: PublishOptions, io: Io): number {
  const untouched = opts.dryRun ? '아무것도 쓰지 않았어요.' : '발행하지 않았어요. state.json 과 발행 폴더는 그 전 그대로예요.';
  const fail = (messages: readonly string[], tail = untouched) => {
    for (const m of messages) io.err(m);
    io.err(tail);
    return 1;
  };
  io.out(
    opts.dryRun
      ? `쓰지 않고 결과만 보여 줘요(--dry-run): 자료 폴더 ${opts.dataName}, 발행 폴더 ${opts.outName}. 파일과 state.json 을 하나도 쓰지 않아요.`
      : `시험 자료를 발행해요: 자료 폴더 ${opts.dataName}, 발행 폴더 ${opts.outName}`,
  );

  // 1. exams:check 와 같은 검사
  const report = checkData(opts.dataDir);
  if (!report.ok || report.state === null || report.locks === null) {
    return fail([`검사(npm run exams:check 와 같은 검사)를 통과하지 못했어요. 거부 ${report.errors.length}개:`, ...report.errors.map((e) => `  - ${e}`)]);
  }
  const state = report.state;
  const exams = report.exams.map((c) => c.exam);
  const locks = report.locks;
  io.out(`검사를 통과했어요. 알림 ${report.warnings.length}개${report.warnings.length > 0 ? ':' : '.'}`);
  for (const w of report.warnings) io.out(`  - ${w}`);

  // 2. 발행 시각
  const issuedAt = opts.issuedAt ?? kstText((opts.now ?? Date.now)());
  if (issuedAt === null || !isValidYmdHm(issuedAt)) return fail(['지금 시각을 한국 시간으로 적지 못했어요. --issued-at YYYY-MM-DDTHH:mm 으로 주세요.']);
  if (state.issuedAt !== null && issuedAt < state.issuedAt) {
    return fail([
      `issuedAt(${issuedAt})이 마지막 발행의 issuedAt(${state.issuedAt}, seq ${state.seq})보다 앞서요. 받은 자료 기준 시각이 거꾸로 가지 않게 같거나 늦은 시각으로 발행해요(--issued-at).`,
    ]);
  }

  // 3. 만들 발행물
  const seq = state.seq + 1;
  const release = buildRelease({ seq, issuedAt, exams, locks });
  const shaById = new Map(release.index.exams.map((e) => [e.id, e.sha256] as const));
  if (sameAsPublished(state, exams, locks, shaById) && !opts.allowSame) {
    return fail([
      `마지막 발행(seq ${state.seq}, issuedAt ${state.issuedAt ?? '없음'})과 바뀐 것이 없어요. 시험 파일과 잠금 달력이 모두 같아요.`,
      '같은 내용을 새 seq 로 다시 내야 하면(발행 폴더를 잃어버렸거나 키를 바꿨을 때) --allow-same 을 붙여요.',
    ]);
  }

  // 4. 발행 폴더
  const outProblems = outDirProblems(opts.outDir, opts.dataDir, opts.root);
  if (outProblems.length > 0) return fail(outProblems);

  // 5. 비밀 키
  const places = [
    { dir: opts.root, name: '저장소 폴더' },
    { dir: opts.dataDir, name: '자료 폴더' },
    { dir: opts.outDir, name: '발행 폴더' },
  ];
  let key: KeyObject | null = null;
  let keyNote: string;
  if (opts.dryRun && (opts.env[KEY_ENV] ?? '').trim() === '') {
    keyNote = `서명: 비밀 키를 확인하지 않았어요(${KEY_ENV} 이 없어요). 실제 발행에는 필요해요.`;
  } else {
    const loaded = loadSigningKey(opts.env, opts.base, places);
    if (loaded.key === null) return fail(loaded.errors);
    key = loaded.key;
    keyNote = `서명: Ed25519, 공개 키 지문 ${keyFingerprint(key)}.`;
    // 자료 폴더에 공개 키가 있으면 짝인지 본다(짝이 아니면 앱이 서명을 받지 않는다).
    const publicPath = join(opts.dataDir, PUBLIC_KEY_FILE);
    if (existsSync(publicPath)) {
      let text = '';
      try {
        text = readFileSync(publicPath, 'utf8');
      } catch {
        text = '';
      }
      const pub = parsePublicKeyText(text);
      if (pub.key === null) return fail([`${PUBLIC_KEY_FILE}: ${pub.error ?? '공개 키로 읽지 못했어요.'}`]);
      if (!publicKeyBytes(pub.key).equals(publicKeyBytes(key))) {
        return fail([
          `비밀 키가 자료 폴더의 공개 키(${PUBLIC_KEY_FILE}, 지문 ${keyFingerprint(pub.key)})와 짝이 아니에요(비밀 키의 공개 키 지문 ${keyFingerprint(key)}). 이 키로 서명하면 앱이 받지 않아요.`,
        ]);
      }
      keyNote += ` 자료 폴더의 ${PUBLIC_KEY_FILE} 와 짝이에요.`;
    } else if (!opts.dryRun && isRepoDataDir(opts.dataDir, opts.root)) {
      // 진짜 자료 폴더(저장소의 exam-data)로 실제 발행할 때는 공개 키가 있어야 한다(별도 검토 C6). 짝을 보지 않고 발행하면
      // 다른 키로 서명한 발행물을 앱이 모두 버리는데도 state.json 의 seq 와 발행 기록이 올라간다. 리허설과 테스트의 임시 자료 폴더는 그대로다.
      return fail([
        `자료 폴더(저장소의 exam-data)에 ${PUBLIC_KEY_FILE} 가 없어요. 진짜 발행은 비밀 키와 짝인 공개 키가 자료 폴더에 있어야 해요(앱은 그 공개 키로 서명을 확인해요). 키를 맡은 사람이 npm run exams:keygen 으로 만든 공개 키를 먼저 커밋해요.`,
      ]);
    } else {
      keyNote += ` 자료 폴더에 ${PUBLIC_KEY_FILE} 가 없어서 짝인지는 보지 않았어요.`;
    }
  }

  // 서명은 index.json 으로 쓸 바이트 그대로에 한다(crypto.sign(null, 바이트, 키)).
  const sig = key === null ? null : signatureText(release.indexBytes, key);
  const nextState: ExamState = {
    format: 1,
    seq,
    issuedAt,
    locksSha256: locksSha256(locks),
    exams: Object.fromEntries(release.index.exams.map((e) => [e.id, stateEntryOf(exams.find((x) => x.id === e.id) as Exam, e.file)])),
  };

  // 6. 요약(키 내용은 없다)
  io.out(`seq ${seq}(마지막 발행 ${state.seq}), issuedAt ${issuedAt}(한국 시간${opts.issuedAt === null ? ', 지금 시각' : ''}), 시험 ${exams.length}개.`);
  for (const e of release.index.exams) {
    const exam = exams.find((x) => x.id === e.id) as Exam;
    const prev = Object.prototype.hasOwnProperty.call(state.exams, e.id) ? state.exams[e.id] : undefined;
    const status = prev === undefined ? '새 시험' : prev.sha256 === e.sha256 ? '발행한 판과 같아요' : prev.rev === e.rev ? '바뀌었어요' : `rev ${prev.rev}에서 ${ro(e.rev)} 바뀌었어요`;
    io.out(`  ${e.id}: rev ${e.rev}, answersRev ${answersRevOf(exam)}, sha256 ${e.sha256.slice(0, 12)}, ${e.file}(${status})`);
  }
  if (exams.length === 0) io.out('  발행할 시험이 없어요. 잠금 달력만 담아요.');
  const locksStatus = state.locksSha256 === null ? '처음 발행해요' : state.locksSha256 === nextState.locksSha256 ? '발행한 것과 같아요' : '바뀌었어요';
  io.out(`잠금 달력: 항목 ${locks.length}개(${locksStatus}).`);
  io.out(keyNote);

  if (opts.dryRun) {
    if (key !== null && sig !== null) {
      const problems = verifyInMemory(release.indexBytes, sig, release.files, key);
      if (problems.length > 0) return fail(['만든 발행물이 확인을 통과하지 못했어요(도구의 결함이에요).', ...problems.map((p) => `  - ${p}`)]);
      io.out('메모리에서 서명하고 확인했어요(exams:verify 와 같은 확인).');
    }
    io.out('결과: 발행하면 위와 같아요. 발행 폴더와 state.json 을 쓰지 않았어요.');
    return 0;
  }
  if (key === null || sig === null) return fail(['비밀 키가 없어요.']);

  // 7. 옆의 임시 폴더에 다 만들고 확인한 뒤 통째로 바꿔 넣는다.
  const parent = dirname(opts.outDir);
  const tag = `${process.pid}-${randomBytes(4).toString('hex')}`;
  const temp = join(parent, `${basename(opts.outDir)}.new-${tag}`);
  const backup = join(parent, `${basename(opts.outDir)}.old-${tag}`);
  try {
    mkdirSync(temp);
    writeRelease(temp, release.files, release.indexBytes, sig);
    opts.interrupt?.('files');
    const checked = verifyFolder(temp, key);
    if (!checked.ok || checked.warnings.length > 0) {
      removeQuietly(temp);
      return fail(['만든 발행물이 확인을 통과하지 못했어요(도구의 결함이에요).', ...[...checked.errors, ...checked.warnings].map((p) => `  - ${p}`)]);
    }
  } catch {
    removeQuietly(temp);
    return fail(['발행 폴더를 만들지 못했어요(임시 폴더를 쓰다가 멈췄어요).']);
  }

  let movedOld = false;
  try {
    if (existsSync(opts.outDir)) {
      renameSync(opts.outDir, backup);
      movedOld = true;
    }
    opts.interrupt?.('swap');
    renameSync(temp, opts.outDir);
  } catch {
    let restored = true;
    if (movedOld && !existsSync(opts.outDir)) {
      try {
        renameSync(backup, opts.outDir);
      } catch {
        restored = false;
      }
    }
    removeQuietly(temp);
    if (!restored) {
      return fail(
        [`발행 폴더를 바꿔 넣지 못했고, 그 전 발행 폴더도 제자리로 돌리지 못했어요. ${backup} 를 ${opts.outName} 로 이름을 바꿔 돌려 주세요.`],
        'state.json 은 그 전 그대로예요.',
      );
    }
    return fail(['발행 폴더를 바꿔 넣지 못했어요. 다른 프로그램이 그 폴더의 파일을 열고 있으면 닫고 다시 해 주세요.']);
  }

  try {
    opts.interrupt?.('state');
    writeTextFile(join(opts.dataDir, STATE_FILE), stateText(nextState));
  } catch {
    // state.json 은 한 번에 바꿔 쓰므로 그 전 그대로다. 발행 폴더도 그 전으로 되돌린다.
    let restored = removeQuietly(opts.outDir);
    if (restored && movedOld) {
      try {
        renameSync(backup, opts.outDir);
      } catch {
        restored = false;
      }
    }
    if (!restored) {
      return fail(
        [`state.json 을 쓰지 못했어요. 발행 폴더도 되돌리지 못했어요. ${opts.outName} 를 지우고 ${backup} 를 ${opts.outName} 로 이름을 바꿔 돌려 주세요.`],
        'state.json 은 그 전 그대로예요.',
      );
    }
    return fail(['state.json 을 쓰지 못했어요. 발행 폴더를 그 전으로 되돌렸어요.']);
  }

  const leftover = movedOld && !removeQuietly(backup);
  io.out(`발행 폴더를 새로 만들었어요: ${opts.outName}(${INDEX_FILE}, ${SIG_FILE}, 시험 파일 ${release.files.length}개). 그 전 발행의 파일은 남기지 않았어요.`);
  if (leftover) io.out(`  그 전 발행 폴더(${backup})를 지우지 못했어요. 확인한 뒤 지워 주세요.`);
  io.out(`state.json 을 고쳤어요(seq ${state.seq}에서 ${ro(seq)}).`);
  io.out('다음 차례: npm run exams:verify 로 발행 폴더를 확인하고, 정해진 주소에 올린 뒤 그 주소로 한 번 더 확인해요.');
  return 0;
}
