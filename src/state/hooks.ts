import { useMemo, useSyncExternalStore } from 'react';
import { findExam } from '../exams';
import { findMissing, gradeExam, type Grade } from '../logic/scoring';
import type { AnswerValue, AppData, Exam, GradedBefore, InputMode, SeenBefore, Session, TestRun } from '../types';
import { demoStore } from './demo';
import { newSession, setAnswer } from './session';
import { store } from './store';
import { activeRun, logAnswer, logScreen, newRun, withActiveRun } from './testlog';

export function useAppData(): AppData {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** 기록 한 건과 그 시험을 화면에 건네는 손잡이. 예시 결과(demo)와 내 기록을 같은 방식으로 다룬다. */
export interface SessionHandle {
  isDemo: boolean;
  session: Session;
  exam: Exam;
  update(fn: (s: Session) => Session): void;
  /** 예시 결과 안에서는 주소 앞에 /demo를 붙인다. */
  path(p: string): string;
}

function updateCurrent(fn: (s: Session) => Session, log?: (run: TestRun, prev: Session, next: Session) => TestRun): void {
  store.update((d) => {
    const idx = d.sessions.findIndex((s) => s.id === d.currentId);
    if (idx < 0) return d;
    const prev = d.sessions[idx]!;
    const next = fn(prev);
    let nd: AppData = d;
    if (next !== prev) {
      const sessions = d.sessions.slice();
      sessions[idx] = next;
      nd = { ...d, sessions };
    }
    if (log) nd = withActiveRun(nd, (run) => (run.sessionId === prev.id ? log(run, prev, next) : run));
    return nd;
  });
}

export function useCurrentHandle(): SessionHandle | null {
  const data = useAppData();
  const session = data.sessions.find((s) => s.id === data.currentId) ?? null;
  return useMemo(() => {
    if (!session) return null;
    const exam = findExam(session.examId);
    if (!exam) return null;
    return { isDemo: false, session, exam, update: (fn) => updateCurrent(fn), path: (p) => p };
  }, [session]);
}

export function useDemoHandle(): SessionHandle | null {
  const session = useSyncExternalStore(demoStore.subscribe, demoStore.get, demoStore.get);
  return useMemo(() => {
    if (!session) return null;
    const exam = findExam(session.examId);
    if (!exam) return null;
    return { isDemo: true, session, exam, update: (fn) => demoStore.update(fn), path: (p) => `/demo${p}` };
  }, [session]);
}

/**
 * 답을 넣거나 지운다. 테스트가 진행 중이면 문항별 입력 횟수도 남긴다.
 * log가 false면 횟수는 세지 않는다(단답형 숫자를 한 자리씩 누르는 동안).
 */
export function putAnswer(h: SessionHandle, no: number, value: AnswerValue | undefined, where: 'input' | 'review', log = true): void {
  if (h.isDemo) {
    h.update((s) => setAnswer(s, no, value));
    return;
  }
  const now = Date.now();
  updateCurrent(
    (s) => setAnswer(s, no, value),
    log && value !== undefined
      ? (run, prev, next) => logAnswer(run, no, where, prev !== next, findMissing(h.exam, next.answers).length === 0, now)
      : undefined,
  );
}

/** 단답형 답을 "다음"으로 확정했을 때 입력 횟수 한 번을 남긴다. */
export function logAnswerCommit(h: SessionHandle, no: number): void {
  if (h.isDemo) return;
  const now = Date.now();
  updateCurrent(
    (s) => s,
    (run, _prev, next) => logAnswer(run, no, 'input', false, findMissing(h.exam, next.answers).length === 0, now),
  );
}

/**
 * 시험을 골라 기록을 시작한다. 같은 시험의 채점 전 기록이 있으면 그 기록을 이어 쓴다.
 * 테스트가 진행 중이면 측정 기록을 이 기록에 묶는다.
 */
export function startSession(examId: string, gradedBefore: GradedBefore, seenBefore: SeenBefore | null): void {
  const nowIso = new Date().toISOString();
  store.update((d) => {
    const run = activeRun(d);
    // 테스트 중에는 참가자마다 빈 기록에서 시작한다.
    const reusable = run ? undefined : d.sessions.find((s) => s.examId === examId && s.gradedAt === null);
    let sessions = d.sessions;
    let session: Session;
    if (reusable) {
      session = { ...reusable, gradedBefore, seenBefore };
      sessions = sessions.map((s) => (s.id === reusable.id ? session : s));
    } else {
      session = newSession(examId, gradedBefore, seenBefore, nowIso);
      sessions = [session, ...sessions];
    }
    const nd: AppData = { ...d, sessions, currentId: session.id };
    return withActiveRun(nd, (r) => (r.sessionId === null ? { ...r, sessionId: session.id, examId } : r));
  });
}

export function openSession(id: string): void {
  store.update((d) => (d.sessions.some((s) => s.id === id) ? { ...d, currentId: id } : d));
}

export function deleteSession(id: string): void {
  store.update((d) => {
    const sessions = d.sessions.filter((s) => s.id !== id);
    const currentId = d.currentId === id ? (sessions[0]?.id ?? null) : d.currentId;
    return { ...d, sessions, currentId };
  });
}

export function deleteAllSessions(): void {
  store.update((d) => ({ ...d, sessions: [], currentId: null }));
}

export function setInputMode(mode: InputMode): void {
  store.update((d) => (d.inputMode === mode ? d : { ...d, inputMode: mode }));
}

/** 화면 진입 시각을 남긴다. 테스트가 진행 중일 때만 기록된다. */
export function logScreenEvent(name: string): void {
  if (!store.get().activeRunId) return;
  const now = Date.now();
  store.update((d) => withActiveRun(d, (run) => logScreen(run, name, now)));
}

export function logReviewConfirm(): void {
  if (!store.get().activeRunId) return;
  const now = Date.now();
  store.update((d) => withActiveRun(d, (run) => (run.reviewConfirmAt === null ? { ...run, reviewConfirmAt: now } : run)));
}

export function startTestRun(participant: string, inputMode: InputMode, plannedExamId: string): void {
  const now = Date.now();
  store.update((d) => {
    const run = newRun(participant, inputMode, plannedExamId, now);
    const testRuns = d.testRuns.map((r) => (r.id === d.activeRunId && r.endedAt === null ? { ...r, endedAt: now } : r));
    return { ...d, inputMode, testRuns: [...testRuns, run], activeRunId: run.id };
  });
}

export function finishTestRun(): void {
  const now = Date.now();
  store.update((d) => {
    if (!d.activeRunId) return d;
    const testRuns = d.testRuns.map((r) => (r.id === d.activeRunId && r.endedAt === null ? { ...r, endedAt: now } : r));
    return { ...d, testRuns, activeRunId: null };
  });
}

export function setRunAnswerKey(runId: string, text: string): void {
  store.update((d) => ({ ...d, testRuns: d.testRuns.map((r) => (r.id === runId ? { ...r, answerKeyText: text } : r)) }));
}

export function resetTestRuns(): void {
  store.update((d) => ({ ...d, testRuns: [], activeRunId: null }));
}

/** 지금 기록의 채점 결과. 미입력이 있거나 정답 공개 전이면 null. */
export function useGrade(h: SessionHandle): Grade | null {
  return useMemo(() => {
    try {
      return gradeExam(h.exam, h.session);
    } catch {
      return null;
    }
  }, [h.exam, h.session]);
}
