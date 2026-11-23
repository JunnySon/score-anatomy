// 앱용 묶음(아이폰 앱 껍데기에 싣는 단일 HTML 두 가지)을 만드는 도구. scripts/build-app.mjs 와 verify 가 쓴다.
// - 시험용(app-test): 진행자용 화면과 입력 방식 전환을 포함한다. 사용성 테스트를 아이폰에서 할 때 쓴다(Debug 빌드).
// - 배포용(app-release): 진행자용 화면과 그리로 가는 링크, 입력 방식 전환과 5행 방식 화면, "준비 중인 기능" 목록을 뺀다(Release 빌드).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inlineDir } from './inline.mjs';
import { ROOT } from './lib.mjs';

/**
 * 다리 규격 번호 두 가지. 웹 코드와 어긋나지 않게 src/platform/app.ts 한 곳에서 읽는다.
 * 그 파일의 `export const BRIDGE_VERSION = 1;` 모양 줄을 정규식으로 읽으므로 줄 모양을 바꾸면 여기서 멈춘다.
 */
const bridgeNumbers = (() => {
  const src = readFileSync(join(ROOT, 'src/platform/app.ts'), 'utf8');
  const read = (name) => {
    const m = src.match(new RegExp(`^export const ${name} = (\\d+);$`, 'm'));
    if (!m) throw new Error(`src/platform/app.ts 에서 ${name} 줄을 찾지 못했어요.`);
    return Number(m[1]);
  };
  const version = read('BRIDGE_VERSION');
  const max = read('BRIDGE_MAX');
  if (max < version) throw new Error(`src/platform/app.ts 의 BRIDGE_MAX 는 BRIDGE_VERSION 보다 작을 수 없어요(지금 ${max}, ${version}).`);
  return { version, max };
})();
/** 이 묶음이 돌아가는 가장 낮은 다리 규격 번호(src/platform/app.ts 의 BRIDGE_VERSION). manifest.json 의 bridge 에 적는다. */
export const BRIDGE_VERSION = bridgeNumbers.version;
/** 웹이 아는 가장 높은 다리 규격 번호(src/platform/app.ts 의 BRIDGE_MAX). manifest.json 의 bridgeMax 에 적는다. */
export const BRIDGE_MAX = bridgeNumbers.max;
/** 커밋하는 묶음의 자리. 맥에서는 Node 없이 이 파일만 쓴다. */
export const APP_WEB_DIR = join(ROOT, 'ios/ScoreAnatomy/Web');
export const BUNDLES = ['app-test', 'app-release'];

export function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function viteBuild(mode, outDir) {
  const cli = join(ROOT, 'node_modules/vite/bin/vite.js');
  const r = spawnSync(process.execPath, [cli, 'build', '--mode', mode, '--outDir', outDir, '--emptyOutDir', '--logLevel', 'warn'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  if (r.status !== 0) throw new Error(`vite build --mode ${mode} 이 실패했어요.`);
}

/** dir 아래 파일의 상대 경로(/ 로 나눔). */
function listFiles(dir, base = '') {
  return readdirSync(join(dir, base), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(dir, `${base}${e.name}/`) : [`${base}${e.name}`],
  );
}

/** 묶음 하나를 만들어 outRoot/<mode>/index.html 에 쓴다. 만든 파일의 경로를 돌려준다. */
export function buildBundle(mode, outRoot) {
  const work = join(ROOT, 'verify-out', 'app-build', `${mode}-${process.pid}`);
  rmSync(work, { recursive: true, force: true });
  try {
    viteBuild(mode, work);
    // 앱에는 index.html 하나만 실린다. 파일 안에 넣을 수 없는 자산(그림, 글꼴 등)이 따로 나오면 실패로 본다.
    const extra = listFiles(work).filter((f) => f !== 'index.html' && !/^assets\/[^/]+\.(?:js|css)$/.test(f));
    if (extra.length > 0) throw new Error(`묶음 파일 하나에 넣지 못하는 자산이 있어요: ${extra.join(', ')}`);
    const html = inlineDir(work);
    mkdirSync(join(outRoot, mode), { recursive: true });
    const dest = join(outRoot, mode, 'index.html');
    writeFileSync(dest, html);
    return dest;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** JSON 파일을 읽는다. 없거나 읽지 못하면 null. */
function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

/**
 * 묶음 안 시험(examsDir 의 *.json, 잠금 달력 locks.json 은 빼고)과 발행한 시험(stateFile 의 exams)에 함께 있는 id(작업 지시서 3의 별도 검토 B1).
 * 같은 id 의 두 판은 앱에서 판 번호(rev)로만 갈려서, 정답 정정 전인 판이 판 번호가 크면 학생 기기의 점수가 바뀔 수 있다.
 * 발행 도구(exams:check)는 묶음 안 시험과 같은 id 의 발행을 거부하고, 여기서는 발행한 시험을 묶음에 넣은 것을 찾는다.
 * state.json 이 없거나 읽지 못하면 발행한 적이 없는 것으로 보고 빈 배열이다(state.json 의 모양은 발행 도구가 검사한다).
 */
export function overlappingExamIds(examsDir = join(ROOT, 'src/exams'), stateFile = join(ROOT, 'exam-data/state.json')) {
  const state = readJson(stateFile);
  const published = state && typeof state.exams === 'object' && state.exams !== null && !Array.isArray(state.exams) ? Object.keys(state.exams) : [];
  if (published.length === 0 || !existsSync(examsDir)) return [];
  const bundled = readdirSync(examsDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json') && e.name !== 'locks.json')
    .map((e) => readJson(join(examsDir, e.name)))
    .filter((exam) => exam && typeof exam.id === 'string')
    .map((exam) => exam.id);
  return [...new Set(bundled.filter((id) => published.includes(id)))].sort();
}

/** 묶음 안 시험과 발행한 시험의 id 가 겹치면 묶음을 만들지 않고 멈춘다. */
export function assertNoPublishedBundled() {
  const overlap = overlappingExamIds();
  if (overlap.length > 0) {
    throw new Error(
      `묶음 안 시험(src/exams)과 발행한 시험(exam-data/state.json)의 id 가 겹쳐요: ${overlap.join(', ')}. 같은 id 의 두 판은 앱에서 판 번호(rev)로만 갈려서 학생 기기의 점수가 알림 없이 바뀔 수 있어요. 발행한 시험은 묶음에 넣지 않아요.`,
    );
  }
}

/** 두 묶음을 모두 만든다. 파일별 SHA-256 과 크기를 돌려준다. 묶음 안 시험과 발행한 시험의 id 가 겹치면 만들지 않는다. */
export function buildAll(outRoot) {
  assertNoPublishedBundled();
  const files = {};
  for (const mode of BUNDLES) {
    const dest = buildBundle(mode, outRoot);
    files[`${mode}/index.html`] = { sha256: sha256(dest), bytes: statSync(dest).size };
  }
  return files;
}

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** 묶음에 들어가는 것(이 가운데 커밋하지 않은 바뀜이 있으면 manifest 에 dirty 로 적는다. verify 11번도 쓴다). */
export const INPUTS = ['src', 'index.html', 'vite.config.ts', 'tsconfig.json', 'package.json', 'package-lock.json', 'scripts/inline.mjs', 'scripts/app-bundles.mjs'];

/**
 * manifest.json: 묶음을 만든 때의 커밋, package.json 의 버전, 다리 규격 번호(bridge 는 이 묶음이 돌아가는 가장 낮은 규격,
 * bridgeMax 는 웹이 아는 가장 높은 규격), 파일별 SHA-256. 칸은 docs/앱_다리_규격.md 7장의 표에 있다.
 */
export function writeManifest(outRoot, files) {
  const status = git(['status', '--porcelain', '--', ...INPUTS]);
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const manifest = {
    name: 'score-anatomy',
    commit: git(['rev-parse', 'HEAD']),
    dirty: status === null ? null : status !== '',
    version: pkg.version,
    bridge: BRIDGE_VERSION,
    bridgeMax: BRIDGE_MAX,
    files,
  };
  writeFileSync(join(outRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
