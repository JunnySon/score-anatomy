import type { S_APP } from '../strings';

/**
 * 앱이 돌아가는 곳(브라우저 또는 아이폰 앱 껍데기)에 따라 달라지는 일.
 * 일반 웹 빌드는 web.ts, 앱용 묶음은 app.ts 를 싣는다(vite.config.ts 의 #platform 별칭).
 * app.ts 도 window.__SA_APP__ 가 없으면(브라우저에서 열면) web.ts 와 똑같이 동작한다.
 * 껍데기가 받아 온 시험 자료를 넘겨받는 일(remoteAtStart, remoteBridge, onRemote, refreshRemote)은 다리 규격 2 이상의 껍데기 안에서만 한다
 * (docs/앱_다리_규격.md 7장).
 */

/**
 * 껍데기가 window.__saFromApp 로 알리는 시험 자료 소식(다리 규격 2).
 * - remote: 껍데기가 받아들인 시험 자료. 값은 null 이거나 { seq, issuedAt, exams, locks } 인데, 플랫폼은 모양을 보지 않고 넘긴다.
 *   검사와 합치기는 시험 목록 쪽이 한다. 알림에 remote 칸이 없으면 null 로 넘긴다.
 * - remoteFailed: 새 시험 자료를 받지 못했다.
 */
export type RemoteMessage = { type: 'remote'; remote: unknown } | { type: 'remoteFailed' };

/** 기록을 읽고 쓰는 곳. 읽기는 앱이 시작될 때 한 번만 한다. */
export interface StorageBackend {
  /** 저장된 글자. 없으면 null. */
  getItem(key: string): string | null;
  /** 저장한다. 실패하면 예외를 던지거나(브라우저) 나중에 알린다(앱의 storeFailed). */
  setItem(key: string, value: string): void;
  /** 읽지 못한 파일을 지우지 않고 따로 보관해 달라고 한다. 요청을 보냈으면 true. 앱에만 있다. */
  archive?(): boolean;
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
  /**
   * 시작할 때 껍데기가 넣어 준 시험 자료(__SA_APP__.remote). 껍데기 안이고 다리를 쓸 수 있고 다리 규격이 2 이상일 때만 그 값이고
   * (칸이 없으면 null), 그 밖(브라우저, 규격 1 껍데기, 다리를 쓸 수 없는 껍데기)은 늘 null 이다. 검사하기 전의 값이다.
   */
  remoteAtStart: unknown;
  /** 껍데기가 시험 자료를 넘겨주는지: 껍데기 안이고 다리를 쓸 수 있고 다리 규격이 2 이상일 때만 true. */
  remoteBridge: boolean;
  /** 껍데기가 알리는 시험 자료 소식(remote, remoteFailed)을 받는다. remoteBridge 가 false 면 오지 않는다. 되돌려 주는 함수로 듣기를 그만둔다. */
  onRemote(fn: (msg: RemoteMessage) => void): () => void;
  /** 껍데기에 시험 자료를 새로 확인해 달라고 한다(saRemote 로 { op: 'refresh' }). 보냈으면 true. 응답을 기다리는 일은 부르는 쪽이 한다. */
  refreshRemote(): boolean;
}
