// npm run build:app
// 아이폰 앱 껍데기에 싣는 묶음 두 가지(시험용, 배포용)를 만들고 manifest.json 을 쓴다(scripts/app-bundles.mjs).
// 결과: ios/ScoreAnatomy/Web/app-test/index.html, ios/ScoreAnatomy/Web/app-release/index.html, ios/ScoreAnatomy/Web/manifest.json
// 셋 다 커밋한다. 소스를 고쳤으면 먼저 커밋한 뒤 이 명령을 돌려서, manifest 의 커밋이 묶음을 만든 코드를 가리키게 한다.

import { APP_WEB_DIR, buildAll, writeManifest } from './app-bundles.mjs';

const files = buildAll(APP_WEB_DIR);
const manifest = writeManifest(APP_WEB_DIR, files);
for (const [name, f] of Object.entries(files)) console.log(`${name}: ${Math.round(f.bytes / 1024)} KB, SHA-256 ${f.sha256}`);
console.log(
  `manifest.json: 커밋 ${manifest.commit ?? '확인 못 함'}${manifest.dirty ? '(커밋하지 않은 바뀜이 있었음)' : ''}, 버전 ${manifest.version}, 다리 규격 bridge ${manifest.bridge}(이 묶음이 돌아가는 가장 낮은 규격), bridgeMax ${manifest.bridgeMax}(웹이 아는 가장 높은 규격)`,
);
