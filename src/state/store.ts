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

function cleanSession(raw: unknown): Session | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== 'string' || typeof raw.examId !== 'string') return null;
  return {
    id: raw.id,
    examId: raw.examId,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    gradedBefore: raw.gradedBefore === 'already' || raw.gradedBefore === 'not_yet' ? raw.gradedBefore : null,
    seenBefore:
      raw.seenBefore === 'first' || raw.seenBefore === 'partial' || raw.seenBefore === 'solved' ? raw.seenBefore : null,
    answers: isObject(raw.answers) ? (raw.answers as Session['answers']) : {},
    marks: isObject(raw.marks) ? (raw.marks as Session['marks']) : {},
    marksEditedAfterGrading: raw.marksEditedAfterGrading === true,
    timeFeel: raw.timeFeel === 'enough' || raw.timeFeel === 'tight' || raw.timeFeel === 'missed' ? raw.timeFeel : null,
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : null,
    gradedAt: typeof raw.gradedAt === 'string' ? raw.gradedAt : null,
    causes: isObject(raw.causes) ? (raw.causes as Session['causes']) : {},
    answerViewed: isObject(raw.answerViewed) ? (raw.answerViewed as Session['answerViewed']) : {},
    targetGrade: typeof raw.targetGrade === 'string' ? raw.targetGrade : null,
    retries: isObject(raw.retries) ? (raw.retries as Session['retries']) : {},
  };
}

function cleanRun(raw: unknown): TestRun | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== 'string' || typeof raw.participant !== 'string') return null;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
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
    itemInputs: isObject(raw.itemInputs) ? (raw.itemInputs as Record<number, number>) : {},
    reviewFixed: Array.isArray(raw.reviewFixed) ? raw.reviewFixed.filter((n): n is number => typeof n === 'number') : [],
    marksMs: num(raw.marksMs) ?? 0,
    firstScoreAt: num(raw.firstScoreAt),
    answerKeyText: typeof raw.answerKeyText === 'string' ? raw.answerKeyText : '',
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
