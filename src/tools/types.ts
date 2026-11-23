import type { ComponentType } from 'react';
import type { SessionHandle } from '../state/hooks';

/**
 * 사용성 테스트에만 쓰는 화면과 부품. 일반 웹 빌드와 앱 시험용 묶음은 모두 싣고(full.ts),
 * 앱 배포용 묶음은 하나도 싣지 않는다(none.ts). 빌드 설정(vite.config.ts)의 #tools 별칭이 둘 가운데 하나를 고른다.
 * 숨기는 것이 아니라 묶음 안의 코드와 글자에서 빠지게 하려는 것이다.
 */
export interface Tools {
  /** 진행자용 화면, 입력 방식 전환, 측정 기록을 쓰는 빌드인지. */
  enabled: boolean;
  /** 테스트 진행자용 화면(#/test). */
  TestAdmin: ComponentType | null;
  /** 5행 방식 답 입력 화면. */
  InputRows: ComponentType<{ h: SessionHandle }> | null;
  /** 기록 화면의 "준비 중인 기능" 목록과 "테스트 진행자용" 링크. */
  HistoryExtras: ComponentType | null;
}
