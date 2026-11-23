import { browserCopy, browserStorage, noListen } from './common';
import type { Platform } from './types';

// 일반 웹 빌드와 단일 HTML: 브라우저 저장소와 클립보드를 쓴다. 앱 껍데기와의 다리 코드는 싣지 않는다.

export const platform: Platform = {
  isApp: false,
  storage: browserStorage,
  copy: browserCopy,
  haptic: () => undefined,
  appText: null,
  canSaveFile: true,
  onStoreFailed: noListen,
};
