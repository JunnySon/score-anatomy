import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * 검증에만 쓰는 변형 빌드(mode variant)의 시험 데이터를 바꾼다. 배포하는 빌드에는 쓰지 않는다.
 * - 예시 시험 A: 검산 예시에서 틀리는 6문항의 정답만 다른 값으로 바꾼다(바꾼 뒤에도 그 응답은 틀린 답이다).
 *   정답만 다른 두 빌드에 같은 조작을 하고 화면을 견주면, "정답 보기" 전에 정답이 새는 곳을 모두 찾을 수 있다.
 * - 예시 시험 B: 등급컷을 뺀다. "등급컷 자료 없음" 상태의 화면을 캡처하는 데 쓴다.
 */
function variantExams(): Plugin {
  const swap: Record<number, number> = { 11: 5, 15: 2, 20: 1, 21: 3, 27: 731, 29: 608 };
  return {
    name: 'score-anatomy-variant-exams',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0] ?? id;
      if (file.endsWith('/src/exams/sample-a.json')) {
        const exam = JSON.parse(code) as { items: { no: number; answer?: number }[] };
        for (const it of exam.items) {
          const v = swap[it.no];
          if (v !== undefined) it.answer = v;
        }
        return { code: JSON.stringify(exam), map: null };
      }
      if (file.endsWith('/src/exams/sample-b.json')) {
        const exam = JSON.parse(code) as { cuts?: unknown };
        delete exam.cuts;
        return { code: JSON.stringify(exam), map: null };
      }
      return null;
    },
  };
}

// 일반 빌드는 Pretendard dynamic subset을 프로젝트 안에 싣고,
// 단일 HTML 빌드(mode single)와 앱용 묶음(mode app-test, app-release)은 시스템 글꼴만 쓴다.
// 앱용 묶음은 scripts/app-bundles.mjs 가 이 두 모드로 빌드한 뒤 파일 하나로 묶는다.
export default defineConfig(({ mode }) => {
  const app = mode === 'app-test' || mode === 'app-release';
  const single = mode === 'single' || app;
  const variant = mode === 'variant';
  const fontFile = single ? './src/styles/font-system.css' : './src/styles/font-pretendard.css';
  // 사용성 테스트 도구(진행자용 화면, 5행 방식, 준비 중 목록)를 싣는지. 앱 배포용 묶음만 싣지 않는다(src/tools).
  const withTools = mode !== 'app-release';
  const toolsFile = withTools ? './src/tools/full.ts' : './src/tools/none.ts';
  // 앱 껍데기와의 다리(src/platform/app.ts)는 앱용 묶음에만 싣는다. 일반 웹 빌드는 브라우저용(web.ts)이다.
  const platformFile = app ? './src/platform/app.ts' : './src/platform/web.ts';
  return {
    base: './',
    plugins: [react(), ...(variant ? [variantExams()] : [])],
    define: {
      __SA_TOOLS__: JSON.stringify(withTools),
    },
    resolve: {
      alias: {
        '#font': fileURLToPath(new URL(fontFile, import.meta.url)),
        '#tools': fileURLToPath(new URL(toolsFile, import.meta.url)),
        '#platform': fileURLToPath(new URL(platformFile, import.meta.url)),
      },
    },
    build: {
      outDir: app ? `verify-out/build-${mode}` : single ? 'dist-single' : variant ? 'verify-out/dist-variant' : 'dist',
      assetsInlineLimit: 0,
      sourcemap: false,
      emptyOutDir: true,
    },
    server: { host: true },
    preview: { host: true },
    test: {
      environment: 'node',
      // 발행 도구(scripts/exams)의 테스트도 함께 돌린다(작업 지시서 3의 6-4).
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
    },
  };
});
