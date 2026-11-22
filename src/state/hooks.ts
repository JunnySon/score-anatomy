import { useMemo, useSyncExternalStore } from 'react';
import { findExam } from '../exams';
import { findMissing, gradeExam, type Grade } from '../logic/scoring';
import type { AnswerValue, AppData, Exam, GradedBefore, InputMode, SeenBefore, Session, TestRun } from '../types';
import { demoStore } from './demo';
import { newSession, setAnswer } from './session';
import { store } from './store';
import { activeRun, logAnswer, logScreen, newRun, withActiveRun, withFinalAnswers } from './testlog';

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
 * 답을 넣거나 지운다. 테스트가 진행 중이면 문항별 입력 횟수도 남긴다(지우는 것은 세지 않는다).
 * 단답형은 "다음"이나 "넣기"로 확정할 때 한 번 불린다.
 */
export function putAnswer(h: SessionHandle, no: number, value: AnswerValue | undefined, where: 'input' | 'review'): void {
  if (h.isDemo) {
    h.update((s) => setAnswer(s, no, value));
    return;
  }
  const now = Date.now();
  updateCurrent(
    (s) => setAnswer(s, no, value),
    value !== undefined
      ? (run, prev, next) => logAnswer(run, no, where, prev !== next, findMissing(h.exam, next.answers).length === 0, now)
      : undefined,
  );
}

/**
 * 시험을 골라 기록을 시작한다. 같은 시험의 채점 전 기록이 있으면 그 기록을 이어 쓴다.
 * 테스트가 진행 중이면 이번 참가자가 만든 기록만 이어 쓰고, 측정 기록을 그 기록에 묶는다.
 */
export function startSession(examId: string, gradedBefore: GradedBefore, seenBefore: SeenBefore | null): void {
  const nowIso = new Date().toISOString();
  store.update((d) => {
    const run = activeRun(d);
    const reusable = d.sessions.find(
      (s) => s.examId === examId && s.firstGradedAt === null && (run ? s.id === run.sessionId : true),
    );
    let sessions = d.sessions;
    let session: Session;
    if (reusable) {
      // "이미 했어요"라고 한 번 답한 기록은 다시 골라도 그대로 둔다.
      session = { ...reusable, gradedBefore: reusable.gradedBefore === 'already' ? 'already' : gradedBefore, seenBefore };
      sessions = sessions.map((s) => (s.id === reusable.id ? session : s));
    } else {
      session = newSession(examId, gradedBefore, seenBefore, nowIso);
      sessions = [session, ...sessions];
    }
    const nd: AppData = { ...d, sessions, currentId: session.id };
    return withActiveRun(nd, (r) => (r.sessionId === session.id && r.examId === examId ? r : { ...r, sessionId: session.id, examId }));
  });
}

export function openSession(id: string): void {
  store.update((d) => (d.sessions.some((s) => s.id === id) ? { ...d, currentId: id } : d));
}

/** 시험 기록이 사라지기 전에, 그 기록에 묶인 측정 기록에 최종 답을 옮겨 둔다. */
function keepFinalAnswers(d: AppData, ids: Set<string> | null): TestRun[] {
  return d.testRuns.map((r) => {
    if (r.sessionId === null || (ids !== null && !ids.has(r.sessionId))) return r;
    const session = d.sessions.find((s) => s.id === r.sessionId) ?? null;
    return withFinalAnswers(r, session, session ? findExam(session.examId) : null);
  });
}

export function deleteSession(id: string): void {
  store.update((d) => {
    const testRuns = keepFinalAnswers(d, new Set([id]));
    const sessions = d.sessions.filter((s) => s.id !== id);
    // 지금 보던 기록을 지웠으면 다른 기록으로 옮겨 가지 않고 비워 둔다.
    const currentId = d.currentId === id ? null : d.currentId;
    return { ...d, sessions, currentId, testRuns };
  });
}

/** 시험 기록을 모두 지운다. 테스트 측정 기록은 테스트 진행자용 화면에서 따로 지운다. */
export function deleteAllSessions(): void {
  store.update((d) => ({ ...d, testRuns: keepFinalAnswers(d, null), sessions: [], currentId: null }));
}

export function setInputMode(mode: InputMode): void {
  store.update((d) => (d.inputMode === mode ? d : { ...d, inputMode: mode }));
}

/** 화면 진입 시각을 남긴다. 테스트가 진행 중일 때만 기록된다. */
export function logScreenEvent(name: string): void {
  if (!store.get().activeRunId) return;
  const now = Date.now();
  store.update((d) =>
    withActiveRun(d, (run) => {
      let next = logScreen(run, name, now);
      // 답 입력 화면을 떠나 입력 확인으로 올 때 모든 문항이 차 있으면 입력 완료 시각을 남긴다.
      // (마지막 단답형을 "다음" 없이 "전체 보기"로 넘긴 경우에도 남게 한다.)
      if (name === 'review' && next.inputDoneAt === null) {
        const session = d.sessions.find((s) => s.id === run.sessionId) ?? null;
        const exam = session ? findExam(session.examId) : null;
        if (session && exam && findMissing(exam, session.answers).length === 0) next = { ...next, inputDoneAt: now };
      }
      return next;
    }),
  );
}

export function logReviewConfirm(): void {
  if (!store.get().activeRunId) return;
  const now = Date.now();
  store.update((d) => withActiveRun(d, (run) => (run.reviewConfirmAt === null ? { ...run, reviewConfirmAt: now } : run)));
}

/** 진행 중이던 측정을 닫는다. 최종 답을 옮겨 두고 끝난 시각을 남긴다. */
function closeActiveRun(d: AppData, now: number): TestRun[] {
  if (!d.activeRunId) return d.testRuns;
  const kept = keepFinalAnswers(d, null);
  return kept.map((r) => (r.id === d.activeRunId && r.endedAt === null ? { ...r, endedAt: now } : r));
}

/**
 * 새 참가자의 측정을 시작한다. 앞 참가자의 기록이 "이어서 보기"로 열리지 않게 현재 기록을 비운다.
 */
export function startTestRun(participant: string, inputMode: InputMode, plannedExamId: string): void {
  const now = Date.now();
  store.update((d) => {
    const run = newRun(participant, inputMode, plannedExamId, now);
    return { ...d, inputMode, testRuns: [...closeActiveRun(d, now), run], activeRunId: run.id, currentId: null };
  });
}

export function finishTestRun(): void {
  const now = Date.now();
  store.update((d) => (d.activeRunId ? { ...d, testRuns: closeActiveRun(d, now), activeRunId: null } : d));
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
