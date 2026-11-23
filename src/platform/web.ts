import { browserCopy, browserStorage, noListen } from './common';
import type { Platform } from './types';

// 일반 웹 빌드와 단일 HTML: 브라우저 저장소와 클립보드를 쓴다. 앱 껍데기와의 다리 코드는 싣지 않는다.
// 시험 자료를 넘겨받을 곳이 없어서 묶음 안 시험만 쓴다.

export const platform: Platform = {
  isApp: false,
  storage: browserStorage,
  copy: browserCopy,
  haptic: () => undefined,
  appText: null,
  canSaveFile: true,
  onStoreFailed: noListen,
  remoteAtStart: null,
  remoteBridge: false,
  onRemote: noListen,
  refreshRemote: () => false,
};
