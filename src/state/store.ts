import type { AppData, InputMode, Session, TestRun } from '../types';

// 상태 저장소. 기록은 이 기기의 localStorage에만 둔다.
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
const isRetryLike = (v: unknown): v is Record<string, unknown> =>
  isObject(v) && typeof v.correct === 'boolean' && typeof v.attempts === 'number' && typeof v.answerKnown === 'boolean' && typeof v.at === 'string';

function cleanRetries(raw: unknown): Session['retries'] {
  const out: Session['retries'] = {};
  for (const [k, v] of Object.entries(cleanRecord(raw, isRetryLike))) {
    out[Number(k)] = {
      correct: v.correct as boolean,
      attempts: v.attempts as number,
      firstCorrectAttempt: typeof v.firstCorrectAttempt === 'number' ? v.firstCorrectAttempt : v.correct === true ? (v.attempts as number) : null,
      answerKnown: v.answerKnown as boolean,
      at: v.at as string,
    };
  }
  return out;
}

function cleanSession(raw: unknown): Session | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== 'string' || typeof raw.examId !== 'string') return null;
  const gradedAt = typeof raw.gradedAt === 'string' ? raw.gradedAt : null;
  return {
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
  };
}

function cleanRun(raw: unknown): TestRun | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== 'string' || typeof raw.participant !== 'string') return null;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const counts: Record<number, number> = {};
  if (isObject(raw.itemInputs)) {
    for (const [k, v] of Object.entries(raw.itemInputs)) {
      const no = Number(k);
      if (Number.isInteger(no) && no > 0 && typeof v === 'number' && Number.isFinite(v)) counts[no] = v;
    }
  }
  return {
    id: raw.id,
    participant: raw.participant,
    inputMode: raw.inputMode === 'rows' ? 'rows' : 'keypad',
    plannedExamId: typeof raw.plannedExamId === 'string' ? raw.plannedExamId : '',
    startedAt: num(raw.startedAt) ?? 0,
    endedAt: num(raw.endedAt),
    sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : null,
    examId: typeof raw.examId === 'string' ? raw.examId : null,
    screens: Array.isArray(raw.screens)
      ? raw.screens.filter((s): s is { screen: string; at: number } => isObject(s) && typeof s.screen === 'string' && typeof s.at === 'number')
      : [],
    examSelectAt: num(raw.examSelectAt),
    inputStartAt: num(raw.inputStartAt),
    firstInputAt: num(raw.firstInputAt),
    inputDoneAt: num(raw.inputDoneAt),
    reviewConfirmAt: num(raw.reviewConfirmAt),
    itemInputs: counts,
    reviewFixed: Array.isArray(raw.reviewFixed) ? raw.reviewFixed.filter((n): n is number => typeof n === 'number') : [],
    marksMs: num(raw.marksMs) ?? 0,
    firstScoreAt: num(raw.firstScoreAt),
    answerKeyText: typeof raw.answerKeyText === 'string' ? raw.answerKeyText : '',
    finalAnswers: Array.isArray(raw.finalAnswers) ? raw.finalAnswers.map((v) => (isAnswer(v) ? v : null)) : null,
  };
}

/** 저장된 값을 현재 형식으로 읽는다. 읽을 수 없으면 null. */
export function parseStored(text: string | null): AppData | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(raw)) return null;
  // 저장 형식의 version 필드. 형식이 바뀌면 여기서 옛 형식을 새 형식으로 옮긴다.
  if (raw.version !== STORE_VERSION) return null;
  const sessions = Array.isArray(raw.sessions) ? raw.sessions.map(cleanSession).filter((s): s is Session => s !== null) : [];
  const testRuns = Array.isArray(raw.testRuns) ? raw.testRuns.map(cleanRun).filter((r): r is TestRun => r !== null) : [];
  const currentId = typeof raw.currentId === 'string' && sessions.some((s) => s.id === raw.currentId) ? raw.currentId : null;
  const activeRunId = typeof raw.activeRunId === 'string' && testRuns.some((r) => r.id === raw.activeRunId) ? raw.activeRunId : null;
  const inputMode: InputMode = raw.inputMode === 'rows' ? 'rows' : 'keypad';
  return { version: STORE_VERSION, sessions, currentId, inputMode, testRuns, activeRunId };
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export class Store {
  private data: AppData;
  private listeners = new Set<() => void>();
  private storage: StorageLike | null;
  /** 마지막 저장이 성공했는지. 실패해도 화면은 메모리 상태로 동작한다. */
  storageOk = true;

  constructor(storage: StorageLike | null = browserStorage()) {
    this.storage = storage;
    this.data = this.read() ?? defaultData();
  }

  private read(): AppData | null {
    if (!this.storage) {
      this.storageOk = false;
      return null;
    }
    try {
      return parseStored(this.storage.getItem(STORAGE_KEY));
    } catch {
      this.storageOk = false;
      return null;
    }
  }

  private write(): void {
    if (!this.storage) {
      this.storageOk = false;
      return;
    }
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      this.storageOk = true;
    } catch {
      this.storageOk = false;
    }
  }

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
