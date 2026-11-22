// npm run package
// 전달용 파일을 release 폴더에 모은다.
// - release/score-anatomy.html: 단일 HTML(dist-single/index.html)의 사본. 폰으로 보내 브라우저로 연다.
// - release/score-anatomy-artifact.html: 아티팩트 뷰어용 파일(scripts/make-artifact.mjs 가 만든다).
// - release/score-anatomy-project.zip: 프로젝트 전체(코드, 문서, 화면 캡처, 빌드 결과, 커밋 기록).
//   node_modules, 테스트 산출물, release 폴더는 넣지 않는다.
//
// 먼저 npm run build 와 npm run build:single 을 실행해 둔다(npm run verify 가 둘 다 실행한다).

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { ROOT } from './lib.mjs';

const single = join(ROOT, 'dist-single/index.html');
if (!existsSync(single) || !existsSync(join(ROOT, 'dist/index.html'))) {
  console.error('빌드 결과가 없어요. 먼저 npm run build 와 npm run build:single 을 실행해 주세요.');
  process.exit(1);
}

const release = join(ROOT, 'release');
mkdirSync(release, { recursive: true });

const kb = (path) => `${Math.round(statSync(path).size / 1024)} KB`;

// 1. 단일 HTML 사본
const singleCopy = join(release, 'score-anatomy.html');
copyFileSync(single, singleCopy);
console.log(`단일 HTML: release/score-anatomy.html (${kb(singleCopy)})`);

// 2. 아티팩트 뷰어용 파일
const artifact = spawnSync(process.execPath, [join(ROOT, 'scripts/make-artifact.mjs')], { cwd: ROOT, stdio: 'inherit' });
if (artifact.status !== 0) process.exit(1);

// 3. 프로젝트 전체 압축 파일
const zipPath = join(release, 'score-anatomy-project.zip');
rmSync(zipPath, { force: true });
const folder = basename(ROOT);
const skip = ['node_modules', 'test-results', 'playwright-report', 'verify-out', 'release'];
const zip = spawnSync(
  'zip',
  ['-r', '-q', zipPath, folder, '-x', ...skip.map((d) => `${folder}/${d}/*`), `${folder}/*.log`],
  { cwd: dirname(ROOT), stdio: 'inherit' },
);
if (zip.status !== 0) {
  console.error('zip 명령을 실행하지 못했어요. zip 이 설치돼 있는지 확인해 주세요.');
  process.exit(1);
}
console.log(`프로젝트 압축 파일: release/score-anatomy-project.zip (${kb(zipPath)})`);
