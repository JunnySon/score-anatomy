// vite 빌드 결과 폴더의 index.html 에 JS와 CSS를 넣어 파일 하나로 만든다.
// 단일 HTML 빌드(scripts/inline-single.mjs)와 앱용 묶음(scripts/app-bundles.mjs)이 함께 쓴다.
// 시스템 글꼴만 쓰는 빌드에만 쓴다(글꼴 파일을 넣지 않는다).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** dir/index.html 에 dir/assets 의 JS와 CSS를 넣은 HTML 글자를 돌려준다. 넣지 못한 자산이 있으면 예외를 던진다. */
export function inlineDir(dir) {
  const htmlPath = join(dir, 'index.html');
  if (!existsSync(htmlPath)) throw new Error(`${htmlPath} 이 없어요. 먼저 vite build 를 실행해 주세요.`);
  let html = readFileSync(htmlPath, 'utf8');
  const readAsset = (ref) => readFileSync(join(dir, ref.replace(/^\.\//, '')), 'utf8');

  // 미리 불러오기 표시는 파일이 없어지므로 지운다.
  html = html.replace(/\s*<link rel="modulepreload"[^>]*>/g, '');

  // 외부 CSS 파일을 style 태그로 바꾼다.
  html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_m, ref) => {
    const css = readAsset(ref).replace(/<\/style/gi, '<\\/style');
    return `<style>${css}</style>`;
  });

  // 외부 JS 파일을 인라인 모듈 스크립트로 바꾼다.
  html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g, (_m, ref) => {
    const js = readAsset(ref).replace(/<\/script/gi, '<\\/script');
    return `<script type="module">${js}</script>`;
  });

  const leftover = html.match(/(?:src|href)="\.\/assets\/[^"]+"/g);
  if (leftover) throw new Error(`파일 안에 넣지 못한 자산이 있어요: ${leftover.join(', ')}`);
  return html;
}
