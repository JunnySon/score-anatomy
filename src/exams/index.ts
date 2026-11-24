import { useSyncExternalStore } from 'react';
import { platform } from '#platform';
import { mergeLocks } from '../logic/lock';
import type { RemoteMessage } from '../platform/types';
import type { Exam, LockEntry } from '../types';
import rawLocks from './locks.json';
import { mergeExams, parseRemote, sortExams, type MergeWarn } from './merge';
import rawA from './sample-a.json';
import rawB from './sample-b.json';
import rawC from './sample-c.json';
import { checkExam } from './validate';

export { sortExams } from './merge';

// 시험 목록. 묶음 안 시험 파일에, 앱 껍데기(다리 규격 2)가 넘겨준 시험 자료를 합친다(작업 지시서 3의 5-2, 5-3).
// 브라우저와 규격 1 껍데기에서는 넘겨받는 자료가 없어서 묶음 안 시험만 쓴다.
// 시행일(examDate)이 있는 시험은 최근 날짜가 위로 오고, 날짜가 같으면 아래 배열의 순서를 따른다.
// 시행일이 없는 시험은 그 아래에 배열 순서대로 둔다. 예시 시험은 시행일이 없어서(지어낸 날짜를 넣지 않는다) A, B, C 순이다.
const RAW: unknown[] = [rawA, rawB, rawC];

/** 묶음 안 시험(검사를 통과한 것, sortExams 의 순서). 넘겨받은 자료와 상관없이 늘 같다. */
export const BUNDLED_EXAMS: readonly Exam[] = sortExams(
  RAW.flatMap((raw) => {
    const { exam, errors } = checkExam(raw);
    if (exam) return [exam];
    // 묶음 안 시험 파일이 검사를 통과하지 못하는 것은 파일을 넣은 사람의 잘못이다.
    // 목록에서 빼고 개발자 콘솔에 오류로 알린다(화면 테스트가 잡는다). 넘겨받은 시험은 경고로 남긴다(src/exams/merge.ts).
    console.error('시험 데이터 오류', errors);
    return [];
  }),
);

/** 묶음 안 시험에서 찾는다. 예시 결과(src/state/demo.ts)와 시작 화면 미리보기가 써서, 넘겨받은 자료로 검산 예시가 바뀌지 않는다. */
export function findBundledExam(id: string | null | undefined): Exam | null {
  if (!id) return null;
  return BUNDLED_EXAMS.find((e) => e.id === id) ?? null;
}

export const SAMPLE_EXAM_ID = 'sample-a';

/** 지금 쓰는 넘겨받은 자료의 판. 받은 자료 기준 시각(issuedAt)은 시험 선택 화면의 안내가 쓴다(작업 지시서 3의 5-4). */
export interface RemoteInfo {
  seq: number;
  issuedAt: string;
}

/**
 * 지금 쓰는 시험 목록과 풀이 잠금 달력. 넘겨받은 자료가 없으면 remote 는 null 이다.
 * 내용이 바뀔 때만 새 객체가 된다(useSyncExternalStore 가 바뀌지 않은 목록으로 다시 그리지 않게).
 */
export interface Catalog {
  /** 합친 시험 목록(sortExams 의 순서). */
  exams: readonly Exam[];
  /** 합친 풀이 잠금 달력(묶음 안 달력과 넘겨받은 달력, src/logic/lock.ts 의 mergeLocks). */
  locks: readonly LockEntry[];
  remote: RemoteInfo | null;
}

/**
 * "새로 확인"의 결과(작업 지시서 3의 5-4).
 * - new: 지금 자료보다 seq 가 큰 자료를 받아 목록을 바꿨다.
 * - same: seq 가 같거나 작은 자료가 와서 목록은 그대로다.
 * - failed: 받지 못했다(remoteFailed, 쓸 수 없는 모양의 remote, 보내지 못함, 기다리는 시간 안에 응답 없음). 목록은 그대로다.
 */
export type RefreshResult = 'new' | 'same' | 'failed';

/** 새로 확인의 응답을 기다리는 시간(작업 지시서 3의 5-4). 이 동안 아무 응답이 없으면 remoteFailed 와 같게 다룬다. */
export const REMOTE_TIMEOUT_MS = 10_000;

/** 목록 저장소가 받는 것. 앱에서는 플랫폼(#platform)의 값이고, 단위 테스트는 바꿔 끼운다. */
export interface CatalogSource {
  /** 묶음 안 시험(검사를 통과한 것). */
  exams: readonly Exam[];
  /** 묶음 안 잠금 달력(src/exams/locks.json, 검사 전). */
  locks: unknown;
  /** 시작할 때 넘겨받은 시험 자료(platform.remoteAtStart, 검사 전). 없으면 null. */
  remoteAtStart: unknown;
  /** 껍데기의 시험 자료 소식(remote, remoteFailed)을 듣는다(platform.onRemote). 그만두는 함수를 돌려준다. */
  onRemote(fn: (msg: RemoteMessage) => void): () => void;
  /** 껍데기에 새로 확인을 보낸다(platform.refreshRemote). 보냈으면 true. */
  refreshRemote(): boolean;
  /** 새로 확인의 응답을 기다리는 시간(밀리초). 없으면 REMOTE_TIMEOUT_MS. */
  timeoutMs?: number;
  /** 버린 자료의 이유를 남기는 곳. 없으면 개발자 콘솔의 경고(console.warn). */
  warn?: MergeWarn;
}

interface Waiting {
  promise: Promise<RefreshResult>;
  resolve: (result: RefreshResult) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * 시험 목록 저장소. 묶음 안 시험과 잠금 달력에 넘겨받은 자료를 합친 목록(스냅샷)을 들고, 바뀌면 구독자에게 알린다.
 * - 넘겨받은 자료는 seq 가 지금 자료의 seq 보다 클 때만 받아들인다. 지금 넘겨받은 자료가 없으면 seq 와 상관없이 받는다.
 *   같거나 작으면 목록을 바꾸지 않는다. 모양이 틀린 자료(parseRemote 가 null)와 remoteFailed 도 목록을 바꾸지 않는다.
 * - 받아들일 때마다 묶음 안 자료와 새로 합친다(이전에 넘겨받은 자료와 합치지 않는다).
 * - 새로 확인(refresh)의 응답을 기다리다 시간이 지나 실패로 끝낸 뒤에 온 remote 도 자료로는 받는다(seq 규칙대로).
 * - 학생이 넣은 답과 표시, 기록은 다루지 않는다. 시험 자료만 다룬다.
 */
export class CatalogStore {
  private snapshot: Catalog;
  private readonly listeners = new Set<() => void>();
  private waiting: Waiting | null = null;
  private readonly bundledExams: readonly Exam[];
  private readonly bundledLocks: LockEntry[];
  private readonly send: () => boolean;
  private readonly timeoutMs: number;
  private readonly warn: MergeWarn;

  constructor(source: CatalogSource) {
    this.warn = source.warn ?? ((message, reasons) => console.warn(message, reasons));
    this.timeoutMs = source.timeoutMs ?? REMOTE_TIMEOUT_MS;
    this.send = () => source.refreshRemote();
    this.bundledExams = sortExams(source.exams);
    // 묶음 안 달력은 처음에 한 번만 검사해 둔다(형식이 틀린 항목은 여기서 버리고 경고로 남긴다).
    this.bundledLocks = mergeLocks(source.locks, null, this.warn);
    this.snapshot = { exams: this.bundledExams, locks: this.bundledLocks, remote: null };
    this.take(source.remoteAtStart);
    source.onRemote((msg) => this.receive(msg));
  }

  get = (): Catalog => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * 넘겨받은 자료를 seq 규칙대로 받아들인다. 받아들였으면 'new', seq 가 같거나 작으면 'same', 쓸 수 없는 모양(null 포함)이면 'failed'.
   * 스냅샷만 바꾸고 구독자에게는 알리지 않는다(부르는 쪽이 알린다).
   */
  private take(raw: unknown): RefreshResult {
    const remote = parseRemote(raw, this.warn);
    if (!remote) return 'failed';
    const now = this.snapshot.remote;
    if (now !== null && remote.seq <= now.seq) return 'same';
    this.snapshot = {
      exams: mergeExams(this.bundledExams, remote.exams, this.warn),
      locks: mergeLocks(this.bundledLocks, remote.locks, this.warn),
      remote: { seq: remote.seq, issuedAt: remote.issuedAt },
    };
    return 'new';
  }

  /**
   * 껍데기의 시험 자료 소식을 받는다(앱에서는 platform.onRemote 가 부른다). 자료를 다루는 동안 던지지 않는다.
   * remote 는 seq 규칙대로 받아들이고, remoteFailed 는 목록을 바꾸지 않는다.
   * 기다리던 새로 확인이 있으면 이 소식의 결과로 끝내고, 목록이 바뀌었으면 구독자에게 알린다.
   */
  receive(msg: RemoteMessage): void {
    const before = this.snapshot;
    const type = typeof msg === 'object' && msg !== null ? msg.type : null;
    let result: RefreshResult = 'failed';
    if (type === 'remote') {
      try {
        result = this.take((msg as { remote?: unknown }).remote);
      } catch {
        // 위 검사가 미처 막지 못한 모양에서 멈추면 목록을 바꾸지 않는다.
        this.snapshot = before;
        result = 'failed';
      }
    }
    if (this.waiting) this.finish(this.waiting, result);
    if (this.snapshot !== before) this.emit();
  }

  /**
   * 껍데기에 새로 확인을 보내고(saRemote 로 { op: 'refresh' }) 응답을 기다린다. 보내지 못하면 곧바로 'failed' 다.
   * 응답(remote 나 remoteFailed)이 오면 그 결과로 끝나고, 기다리는 시간 동안 아무 응답이 없으면 'failed' 로 끝난다.
   * 이미 기다리는 중이면 또 보내지 않고 기다리던 결과를 함께 기다린다.
   */
  refresh(): Promise<RefreshResult> {
    if (this.waiting) return this.waiting.promise;
    let resolve!: (result: RefreshResult) => void;
    const promise = new Promise<RefreshResult>((r) => {
      resolve = r;
    });
    const waiting: Waiting = { promise, resolve, timer: null };
    this.waiting = waiting;
    waiting.timer = setTimeout(() => this.finish(waiting, 'failed'), this.timeoutMs);
    // 껍데기가 받자마자 답해도 놓치지 않게, 기다릴 준비를 마친 뒤에 보낸다.
    let sent: boolean;
    try {
      sent = this.send();
    } catch {
      sent = false;
    }
    if (!sent) this.finish(waiting, 'failed');
    return promise;
  }

  private finish(waiting: Waiting, result: RefreshResult): void {
    if (this.waiting !== waiting) return;
    this.waiting = null;
    if (waiting.timer !== null) clearTimeout(waiting.timer);
    waiting.resolve(result);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

/** 이 앱의 시험 목록 저장소. 묶음 안 자료에, 시작할 때와 켜져 있는 동안 껍데기가 넘겨준 자료를 합친다. */
export const catalog = new CatalogStore({
  exams: BUNDLED_EXAMS,
  locks: rawLocks,
  remoteAtStart: platform.remoteAtStart,
  onRemote: (fn) => platform.onRemote(fn),
  refreshRemote: () => platform.refreshRemote(),
});

/** 지금 쓰는 시험 목록과 잠금 달력. 넘겨받은 새 자료로 바뀌면 다시 그린다. */
export function useCatalog(): Catalog {
  return useSyncExternalStore(catalog.subscribe, catalog.get, catalog.get);
}

/** 지금 쓰는 시험 목록(시험 선택 화면, 진행자용 화면). */
export function useExams(): readonly Exam[] {
  return useCatalog().exams;
}

/**
 * 합친 풀이 잠금 달력(작업 지시서 3의 4-5). 풀이 계열 기능은 이 달력으로 판정한다
 * (화면에서는 src/components/LockNotice.tsx 의 useLockState(useLocks())).
 */
export function useLocks(): readonly LockEntry[] {
  return useCatalog().locks;
}

/** 지금 쓰는 시험 목록에서 찾는다. 화면은 useCatalog(또는 useExams)로 목록을 구독해서, 목록이 바뀌면 다시 찾는다. */
export function findExam(id: string | null | undefined): Exam | null {
  if (!id) return null;
  return catalog.get().exams.find((e) => e.id === id) ?? null;
}
