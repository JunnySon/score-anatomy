import type { S_APP } from '../strings';

/**
 * 앱이 돌아가는 곳(브라우저 또는 아이폰 앱 껍데기)에 따라 달라지는 일.
 * 일반 웹 빌드는 web.ts, 앱용 묶음은 app.ts 를 싣는다(vite.config.ts 의 #platform 별칭).
 * app.ts 도 window.__SA_APP__ 가 없으면(브라우저에서 열면) web.ts 와 똑같이 동작한다.
 */

/** 기록을 읽고 쓰는 곳. 읽기는 앱이 시작될 때 한 번만 한다. */
export interface StorageBackend {
  /** 저장된 글자. 없으면 null. */
  getItem(key: string): string | null;
  /** 저장한다. 실패하면 예외를 던지거나(브라우저) 나중에 알린다(앱의 storeFailed). */
  setItem(key: string, value: string): void;
  /** 읽지 못한 파일을 지우지 않고 따로 보관해 달라고 한다. 앱에만 있다. */
  archive?(): void;
}

export interface Platform {
  /** 아이폰 앱 껍데기 안에서 열렸는지(window.__SA_APP__ 가 있는지). */
  isApp: boolean;
  /** 기록 저장소. 쓸 수 없으면 null. */
  storage(): StorageBackend | null;
  /** 글자를 이 기기의 클립보드에 넣는다. 성공하면 true. */
  copy(text: string): Promise<boolean>;
  /** 받아들인 키패드 누름 한 번에 한 번 부른다(앱에서는 가벼운 햅틱). */
  haptic(): void;
  /** 앱 안에서만 바꿔 쓰는 문구. 브라우저면 null. */
  appText: typeof S_APP | null;
  /** 파일로 저장할 수 있는지(진행자용 화면의 "파일 저장"). 앱에서는 복사만 둔다. */
  canSaveFile: boolean;
  /** 저장에 실패했다는 알림을 받는다(앱의 storeFailed). 되돌려 주는 함수로 듣기를 그만둔다. */
  onStoreFailed(fn: () => void): () => void;
}
