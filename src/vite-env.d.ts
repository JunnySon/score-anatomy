/// <reference types="vite/client" />

declare module '#font';

/**
 * 사용성 테스트 도구(진행자용 화면, 입력 방식 전환, 측정 기록)를 쓰는 빌드인지. 빌드할 때 상수로 바뀐다(vite.config.ts).
 * 앱 배포용 묶음에서만 false다.
 */
declare const __SA_TOOLS__: boolean;
