import { platform } from '#platform';
import type { StorageBackend } from '../platform/types';
import type { AppData, GradedWith, InputMode, RetryRecord, RunPart, Session, TestRun } from '../types';

// 상태 저장소. 기록은 이 기기에만 둔다(브라우저는 localStorage, 아이폰 앱은 다리로 앱 전용 파일. src/platform).
// 읽기와 쓰기를 try/catch로 감싸고, 저장이 안 돼도 화면은 메모리 상태로 동작한다.

export const STORAGE_KEY = 'score-anatomy';
export const STORE_VERSION = 1;

export function defaultData(): AppData {
  return {
    version: STORE_VERSION,
    sessions: [],
    currentId: null,
    inputMode: 'keypad',
    testRuns: [],
    activeRunId: null,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 문항 번호를 열쇠로 하는 기록에서 모양이 맞는 값만 남긴다. */
function cleanRecord<T>(raw: unknown, ok: (v: unknown) => v is T): Record<number, T> {
  const out: Record<number, T> = {};
  if (!isObject(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    const no = Number(k);
    if (Number.isInteger(no) && no > 0 && ok(v)) out[no] = v;
  }
  return out;
}

const isAnswer = (v: unknown): v is Session['answers'][number] => v === 'skip' || (typeof v === 'number' && Number.isInteger(v));
const isMark = (v: unknown): v is Session['marks'][number] => v === 'doubt' || v === 'guess' || v === 'unsure';
const isCause = (v: unknown): v is Session['causes'][number] => v === 'slip' || v === 'blank' || v === 'unknown';
const isTrue = (v: unknown): v is true => v === true;
const isSelfCheck = (v: unknown): v is Session['selfChecks'][number] =>
  isObject(v) && (v.result === 'solved' || v.result === 'stuck') && typeof v.at === 'string';
const isRetryLike = (v: unknown): v is Record<string, unknown> =>
  isObject(v) && typeof v.correct === 'boolean' && typeof v.attempts === 'number' && typeof v.answerKnown === 'boolean' && typeof v.at === 'string';
/** 정답 판 번호(작업 지시서 3의 4-1, 4-2)로 쓸 수 있는 값: 1 이상의 정수. */
const isAnswersRev = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1;
/** 채점 흔적(작업 지시서 3의 4-6)의 모양: 정답 판 번호는 1 이상의 정수, 점수는 0 이상의 정수. */
const isGradedWith = (v: unknown): v is GradedWith =>
  isObject(v) && isAnswersRev(v.answersRev) && typeof v.score === 'number' && Number.isInteger(v.score) && v.score >= 0;

function cleanRetries(raw: unknown): Session['retries'] {
  const out: Session['retries'] = {};
  for (const [k, v] of Object.entries(cleanRecord(raw, isRetryLike))) {
    const rec: RetryRecord = {
      correct: v.correct as boolean,
      attempts: v.attempts as number,
      firstCorrectAttempt: typeof v.firstCorrectAttempt === 'number' ? v.firstCorrectAttempt : v.correct === true ? (v.attempts as number) : null,
      answerKnown: v.answerKnown as boolean,
      at: v.at as string,
    };
    // 작업 지시서 3의 4-6에서 더한 칸. 2 이상일 때만 남긴다(없거나 1이면 정답 판 번호 1, 모양이 틀리면 버리고 1로 본다).
    if (isAnswersRev(v.answersRev) && v.answersRev >= 2) rec.answersRev = v.answersRev;
    out[Number(k)] = rec;
  }
  return out;
}

function cleanSession(raw: unknown): Session | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== 'string' || typeof raw.examId !== 'string') return null;
  const gradedAt = typeof raw.gradedAt === 'string' ? raw.gradedAt : null;
  const session: Session = {
    id: raw.id,
    examId: raw.examId,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    gradedBefore: raw.gradedBefore === 'already' || raw.gradedBefore === 'not_yet' ? raw.gradedBefore : null,
    seenBefore:
      raw.seenBefore === 'first' || raw.seenBefore === 'partial' || raw.seenBefore === 'solved' ? raw.seenBefore : null,
    answers: cleanRecord(raw.answers, isAnswer),
    marks: cleanRecord(raw.marks, isMark),
    marksEditedAfterGrading: raw.marksEditedAfterGrading === true,
    timeFeel: raw.timeFeel === 'enough' || raw.timeFeel === 'tight' || raw.timeFeel === 'missed' ? raw.timeFeel : null,
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : null,
    gradedAt,
    firstGradedAt: typeof raw.firstGradedAt === 'string' ? raw.firstGradedAt : gradedAt,
    answersEditedAfterGrading: Array.isArray(raw.answersEditedAfterGrading)
      ? raw.answersEditedAfterGrading.filter((n): n is number => typeof n === 'number' && Number.isInteger(n))
      : [],
    causes: cleanRecord(raw.causes, isCause),
    answerViewed: cleanRecord(raw.answerViewed, isTrue),
    targetGrade: typeof raw.targetGrade === 'string' ? raw.targetGrade : null,
    retries: cleanRetries(raw.retries),
    // 1.1에서 더한 칸. 없는 옛 기록도 빈 값으로 읽는다(저장 형식의 version 은 그대로 1이다).
    selfChecks: cleanRecord(raw.selfChecks, isSelfCheck),
  };
  // 작업 지시서 3의 4-6에서 더한 칸(채점 흔적). 모양이 맞을 때만 칸을 두고, 없거나 틀리면 칸이 없는 옛 기록으로 읽는다(version 은 그대로 1).
  if (isGradedWith(raw.gradedWith)) session.gradedWith = { answersRev: raw.gradedWith.answersRev, score: raw.gradedWith.score };
  return session;
}

/** 날짜로 쓸 수 있는 시각만 받는다(절댓값 8.64e15 이하). */
function cleanTime(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 8.64e15 ? v : null;
}

/** 측정 기록 가운데 시험 기록 한 건에 딸린 값을 읽는다. 모양이 맞는 값만 남긴다. */
function cleanPart(raw: Record<string, unknown>): RunPart {
  const counts: Record<number, number> = {};
  if (isObject(raw.itemInputs)) {
    for (const [k, v] of Object.entries(raw.itemInputs)) {
      const no = Number(k);
      if (Number.isInteger(no) && no > 0 && typeof v === 'number' && Number.isFinite(v)) counts[no] = v;
    }
  }
  return {
    inputStartAt: cleanTime(raw.inputStartAt),
    firstInputAt: cleanTime(raw.firstInputAt),
    inputDoneAt: cleanTime(raw.inputDoneAt),
    reviewConfirmAt: cleanTime(raw.reviewConfirmAt),
    itemInputs: counts,
    reviewFixed: Array.isArray(raw.reviewFixed) ? raw.reviewFixed.filter((n): n is number => typeof n === 'number') : [],
    marksMs: typeof raw.marksMs === 'number' && Number.isFinite(raw.marksMs) ? raw.marksMs : 0,
    firstScoreAt: cleanTime(raw.firstScoreAt),
    finalAnswers: Array.isArray(raw.finalAnswers) ? raw.finalAnswers.map((v) => (isAnswer(v) ? v : null)) : null,
  };
}

function cleanRun(raw: unknown): TestRun | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== 'string' || typeof raw.participant !== 'string') return null;
  const parts: Record<string, RunPart> = {};
  if (isObject(raw.parts)) {
    for (const [k, v] of Object.entries(raw.parts)) if (isObject(v)) parts[k] = cleanPart(v);
  }
  return {
    id: raw.id,
    participant: raw.participant,
    inputMode: raw.inputMode === 'rows' ? 'rows' : 'keypad',
    plannedExamId: typeof raw.plannedExamId === 'string' ? raw.plannedExamId : '',
    startedAt: cleanTime(raw.startedAt) ?? 0,
    endedAt: cleanTime(raw.endedAt),
    sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : null,
    examId: typeof raw.examId === 'string' ? raw.examId : null,
    screens: Array.isArray(raw.screens)
      ? raw.screens.filter(
          (s): s is { screen: string; at: number } => isObject(s) && typeof s.screen === 'string' && cleanTime(s.at) !== null,
        )
      : [],
    examSelectAt: cleanTime(raw.examSelectAt),
    ...cleanPart(raw),
    examReselects: typeof raw.examReselects === 'number' && Number.isFinite(raw.examReselects) ? raw.examReselects : 0,
    // 1.1에서 더한 칸. 없는 옛 측정 기록은 0으로 읽는다.
    discardedTaps: typeof raw.discardedTaps === 'number' && Number.isInteger(raw.discardedTaps) && raw.discardedTaps >= 0 ? raw.discardedTaps : 0,
    parts,
    answerKeyText: typeof raw.answerKeyText === 'string' ? raw.answerKeyText : '',
  };
}

/**
 * 옛 형식(version 이 STORE_VERSION 보다 작은 값)의 저장 값을 지금 형식으로 옮긴다. 옮기지 못하면 null.
 * 지금은 version 1뿐이라 틀만 있다. 형식을 바꾸면 여기에 옮기는 단계를 더하고 STORE_VERSION 을 올린다.
 */
export function migrateStored(raw: Record<string, unknown>): Record<string, unknown> | null {
  if (raw.version === STORE_VERSION) return raw;
  return null;
}

/**
 * 저장된 값을 현재 형식으로 읽는다. 읽을 수 없으면 null.
 * 통째로 읽을 수 없거나(JSON이 아님, 객체가 아님, version 이 숫자가 아님) version 이 이 앱이 아는 값보다 크면 null이다.
 * version 이 작으면 migrateStored 를 거친다.
 */
export function parseStored(text: string | null): AppData | null {
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(parsed)) return null;
  // 저장 형식의 version 필드.
  if (typeof parsed.version !== 'number' || parsed.version > STORE_VERSION) return null;
  const raw = migrateStored(parsed);
  if (!raw) return null;
  const sessions = Array.isArray(raw.sessions) ? raw.sessions.map(cleanSession).filter((s): s is Session => s !== null) : [];
  const testRuns = Array.isArray(raw.testRuns) ? raw.testRuns.map(cleanRun).filter((r): r is TestRun => r !== null) : [];
  const currentId = typeof raw.currentId === 'string' && sessions.some((s) => s.id === raw.currentId) ? raw.currentId : null;
  // 사용성 테스트 도구가 없는 빌드(앱 배포용)에서는 남아 있던 측정을 이어 가지 않는다. 측정 기록 자체는 지우지 않고 둔다.
  const activeRunId =
    __SA_TOOLS__ && typeof raw.activeRunId === 'string' && testRuns.some((r) => r.id === raw.activeRunId) ? raw.activeRunId : null;
  const inputMode: InputMode = raw.inputMode === 'rows' ? 'rows' : 'keypad';
  const data: AppData = { version: STORE_VERSION, sessions, currentId, inputMode, testRuns, activeRunId };
  if (raw.archiveNotice === true) data.archiveNotice = true;
  return data;
}

export type StorageLike = StorageBackend;

/** 저장소의 상태. 화면(기록 화면, 앱의 저장 실패 알림)이 안내문을 고를 때 쓴다. 바뀔 때마다 새 객체가 된다. */
export interface StoreStatus {
  /** 마지막 저장이 성공했는지(앱은 껍데기가 storeFailed 를 알리면 false, 다음 저장을 보내면 다시 true). */
  ok: boolean;
}

export class Store {
  private data: AppData;
  private listeners = new Set<() => void>();
  private statusListeners = new Set<() => void>();
  private storage: StorageLike | null;
  private status: StoreStatus = { ok: true };
  /** 앱: 받은 기록을 읽지 못해 보관을 요청했다. 새로 시작한 기록을 곧바로 저장한다(보관 안내 표시를 남기려고). */
  private archivedOnRead = false;

  constructor(storage: StorageLike | null = platform.storage(), onFailed: (fn: () => void) => () => void = platform.onStoreFailed) {
    this.storage = storage;
    this.data = this.read() ?? defaultData();
    onFailed(() => this.setStatus({ ok: false }));
    if (this.archivedOnRead) this.write();
  }

  /** 마지막 저장이 성공했는지. 실패해도 화면은 메모리 상태로 동작한다. */
  get storageOk(): boolean {
    return this.status.ok;
  }

  private setStatus(change: Partial<StoreStatus>): void {
    const next = { ...this.status, ...change };
    if (next.ok === this.status.ok) return;
    this.status = next;
    for (const l of this.statusListeners) l();
  }

  private read(): AppData | null {
    if (!this.storage) {
      this.setStatus({ ok: false });
      return null;
    }
    let text: string | null;
    try {
      text = this.storage.getItem(STORAGE_KEY);
    } catch {
      this.setStatus({ ok: false });
      return null;
    }
    if (text === null) return null;
    const parsed = parseStored(text);
    if (parsed === null && this.storage.archive) {
      // 앱: 받은 기록을 통째로 읽지 못했거나 더 새 형식이면 덮어쓰지 않는다. 따로 보관해 달라고 한 뒤 새로 시작한다.
      // (브라우저는 지금처럼 처음 상태로 열고, 다음 저장이 그 자리를 쓴다.)
      let sent = false;
      try {
        sent = this.storage.archive();
      } catch {
        sent = false;
      }
      if (!sent) {
        // 보관 요청을 보내지 못했으면 읽지 못한 기록을 덮어쓰지 않게 이 실행 동안 저장하지 않는다(화면은 처음 상태로 쓴다).
        this.storage = null;
        this.setStatus({ ok: false });
        return null;
      }
      // 기록 화면이 보관 안내를 보여 줄 때까지 안내 표시를 새 기록에 남긴다(앱을 끄고 다시 켜도 한 번은 보이게).
      this.archivedOnRead = true;
      return { ...defaultData(), archiveNotice: true };
    }
    return parsed;
  }

  private write(): void {
    if (!this.storage) {
      this.setStatus({ ok: false });
      return;
    }
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      this.setStatus({ ok: true });
    } catch {
      this.setStatus({ ok: false });
    }
  }

  getStatus = (): StoreStatus => this.status;

  subscribeStatus = (listener: () => void): (() => void) => {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  };

  get = (): AppData => this.data;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  update(fn: (data: AppData) => AppData): void {
    const next = fn(this.data);
    if (next === this.data) return;
    this.data = next;
    this.write();
    for (const l of this.listeners) l();
  }
}

export const store = new Store();

export function newId(prefix: string): string {
  let rand = '';
  try {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    rand = Array.from(buf, (n) => n.toString(36)).join('');
  } catch {
    rand = Math.random().toString(36).slice(2, 12);
  }
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}
