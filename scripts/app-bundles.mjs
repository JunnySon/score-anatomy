// 앱용 묶음(아이폰 앱 껍데기에 싣는 단일 HTML 두 가지)을 만드는 도구. scripts/build-app.mjs 와 verify 가 쓴다.
// - 시험용(app-test): 진행자용 화면과 입력 방식 전환을 포함한다. 사용성 테스트를 아이폰에서 할 때 쓴다(Debug 빌드).
// - 배포용(app-release): 진행자용 화면과 그리로 가는 링크, 입력 방식 전환과 5행 방식 화면, "준비 중인 기능" 목록을 뺀다(Release 빌드).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inlineDir } from './inline.mjs';
import { ROOT } from './lib.mjs';

/** 다리 규격 번호. docs/앱_다리_규격.md 와 src/platform/app.ts 의 BRIDGE_VERSION 과 같아야 한다. */
export const BRIDGE_VERSION = 1;
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

/** 묶음 하나를 만들어 outRoot/<mode>/index.html 에 쓴다. 만든 파일의 경로를 돌려준다. */
export function buildBundle(mode, outRoot) {
  const work = join(ROOT, 'verify-out', 'app-build', `${mode}-${process.pid}`);
  rmSync(work, { recursive: true, force: true });
  try {
    viteBuild(mode, work);
    const html = inlineDir(work);
    mkdirSync(join(outRoot, mode), { recursive: true });
    const dest = join(outRoot, mode, 'index.html');
    writeFileSync(dest, html);
    return dest;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** 두 묶음을 모두 만든다. 파일별 SHA-256 과 크기를 돌려준다. */
export function buildAll(outRoot) {
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

/** 묶음에 들어가는 것(이 가운데 커밋하지 않은 바뀜이 있으면 manifest 에 dirty 로 적는다). */
const INPUTS = ['src', 'index.html', 'vite.config.ts', 'package.json', 'package-lock.json', 'scripts/inline.mjs', 'scripts/app-bundles.mjs'];

/** manifest.json: 묶음을 만든 때의 커밋, package.json 의 버전, 다리 규격 번호, 파일별 SHA-256. */
export function writeManifest(outRoot, files) {
  const status = git(['status', '--porcelain', '--', ...INPUTS]);
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const manifest = {
    name: 'score-anatomy',
    commit: git(['rev-parse', 'HEAD']),
    dirty: status === null ? null : status !== '',
    version: pkg.version,
    bridge: BRIDGE_VERSION,
    files,
  };
  writeFileSync(join(outRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
