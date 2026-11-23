import { useMemo, useSyncExternalStore } from 'react';
import { findExam } from '../exams';
import { findMissing, gradeExam, type Grade } from '../logic/scoring';
import type { AnswerValue, AppData, Exam, GradedBefore, InputMode, SeenBefore, Session, TestRun } from '../types';
import { demoStore } from './demo';
import { fillGradedWith, newSession, setAnswer } from './session';
import { store } from './store';
import { activeRun, bindRun, isMine, isRunDone, logAnswer, logScreen, newRun, screenLogName, withActiveRun, withFinalAnswers } from './testlog';

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
    // 사용성 테스트 도구가 없는 빌드(앱 배포용)에는 측정 기록 코드가 실리지 않는다.
    if (__SA_TOOLS__ && log) nd = withActiveRun(nd, (run) => (run.sessionId === prev.id ? log(run, prev, next) : run));
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
    __SA_TOOLS__ && value !== undefined
      ? (run, prev, next) => logAnswer(run, no, where, prev !== next, findMissing(h.exam, next.answers).length === 0, now)
      : undefined,
  );
}

/**
 * 시험을 골라 기록을 시작한다. 같은 시험의 채점 전 기록이 있으면 그 기록을 이어 쓴다.
 * "채점은 아직인가요?"의 답은 방금 고른 것으로 바꾼다(잘못 눌렀다가 다시 고른 것을 받아 준다).
 * 테스트가 진행 중이면 이번 참가자가 만든 기록(측정을 시작한 뒤에 만든 기록)만 이어 쓰고, 측정 기록을 그 기록에 묶는다.
 * 테스트 기기의 대기 중(참가자를 마친 뒤, 다음 참가자를 시작하기 전)에는 어떤 기록도 이어 쓰지 않고 새 기록을 만든다.
 * 앞 참가자의 채점 전 기록이 열리면 그 답과 점수가 다음 사람에게 보이기 때문이다.
 */
export function startSession(examId: string, gradedBefore: GradedBefore, seenBefore: SeenBefore | null): void {
  const nowIso = new Date().toISOString();
  store.update((d) => {
    const run = __SA_TOOLS__ ? activeRun(d) : null;
    const reusable = isTestDevice(d)
      ? undefined
      : d.sessions.find((s) => s.examId === examId && s.firstGradedAt === null && (!run || isMine(run, s)));
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
    return __SA_TOOLS__ ? rebind(nd, session) : nd;
  });
}

/**
 * 진행 중인 측정을 이 기록에 묶는다(시험을 골랐을 때, 이번 참가자가 만든 채점 전 기록을 다시 열었을 때).
 * 채점까지 마친 측정은 그대로 둔다. 그 뒤에 새로 시작한 기록은 재지 않는다.
 */
function rebind(d: AppData, session: Session): AppData {
  return withActiveRun(d, (r) => {
    if (r.sessionId === session.id) return bindRun(r, session.id, session.examId);
    const bound = d.sessions.find((s) => s.id === r.sessionId) ?? null;
    if (isRunDone(r, bound)) return r;
    return bindRun(r, session.id, session.examId);
  });
}

/**
 * 시작 화면의 "이어서 보기"가 열 기록(지시서 8장 (1): 지난 기록이 있으면 "이어서 보기").
 * 지금 보는 기록이 있으면 그 기록, 없으면 남은 기록 가운데 가장 최근에 만든 것이다.
 * 테스트가 진행 중이면 이번 참가자의 측정에 묶인 기록만 대상으로 한다(앞 참가자의 기록이 열리지 않게).
 */
export function resumeCandidate(d: AppData): { session: Session; exam: Exam } | null {
  // 테스트 기기에서 측정이 진행 중이 아니면(참가자를 마친 뒤, 다음 참가자를 시작하기 전) 어떤 기록도 열지 않는다.
  if (isTestDevice(d)) return null;
  const pick = (s: Session | undefined) => {
    const exam = s ? findExam(s.examId) : null;
    return s && exam ? { session: s, exam } : null;
  };
  const current = pick(d.sessions.find((s) => s.id === d.currentId));
  const run = __SA_TOOLS__ ? activeRun(d) : null;
  if (run) {
    // 테스트 중: 지금 보는 기록이 이번 참가자의 것이면 그 기록, 아니면 측정에 묶인 기록.
    if (current && isMine(run, current.session)) return current;
    const bound = pick(d.sessions.find((s) => s.id === run.sessionId));
    if (bound) return bound;
    // 묶인 기록이 없으면(지워졌거나 아직 묶이지 않음) 이번 참가자가 만든 기록 가운데 가장 최근 것.
    for (const s of d.sessions) {
      const mine = isMine(run, s) ? pick(s) : null;
      if (mine) return mine;
    }
    return null;
  }
  if (current) return current;
  // 새 기록은 목록 맨 앞에 넣으므로, 앞에서부터 처음 만나는 기록이 가장 최근 것이다.
  for (const s of d.sessions) {
    const found = pick(s);
    if (found) return found;
  }
  return null;
}

/**
 * 기록을 연다(기록 화면의 열기, 시작 화면의 "이어서 보기").
 * 테스트 중에 이번 참가자가 만든 채점 전 기록을 다시 열면 측정도 그 기록으로 옮긴다.
 * 남의 기록이나 채점한 기록을 여는 것은 재지 않는다.
 */
export function openSession(id: string): void {
  store.update((d) => {
    const session = d.sessions.find((s) => s.id === id);
    if (!session) return d;
    const nd: AppData = { ...d, currentId: id };
    const run = __SA_TOOLS__ ? activeRun(d) : null;
    if (run && isMine(run, session) && session.firstGradedAt === null) return rebind(nd, session);
    return nd;
  });
}

/** 시험 기록이 사라지기 전에, 그 기록에 묶인 측정 기록에 최종 답을 옮겨 둔다. 이미 끝난 측정은 건드리지 않는다. */
function keepFinalAnswers(d: AppData, ids: Set<string> | null): TestRun[] {
  if (!__SA_TOOLS__) return d.testRuns;
  return d.testRuns.map((r) => {
    if (r.endedAt !== null || r.sessionId === null || (ids !== null && !ids.has(r.sessionId))) return r;
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

/**
 * 채점 흔적(gradedWith)이 없는 옛 채점 기록 가운데 시험의 정답 판 번호가 1인 기록에 지금 값을 조용히 채운다(작업 지시서 3의 4-6).
 * 앱이 시작할 때(src/main.tsx) 부른다. 시험 목록이 바뀌면(넘겨받은 시험, 작업 지시서 3의 5부) 그때도 불러야 한다.
 * 채울 것이 없으면 기록을 바꾸지 않아서 저장도 하지 않는다.
 */
export function fillOldGradedRecords(): void {
  store.update((d) => fillGradedWith(d, findExam));
}

/** 앱: 기록 화면이 보관 안내를 보여 줬으면 기록에 남은 표시를 지운다. */
export function clearArchiveNotice(): void {
  store.update((d) => {
    if (!d.archiveNotice) return d;
    const next = { ...d };
    delete next.archiveNotice;
    return next;
  });
}

export function setInputMode(mode: InputMode): void {
  store.update((d) => (d.inputMode === mode ? d : { ...d, inputMode: mode }));
}

/** 화면 진입 시각을 남긴다. 테스트가 진행 중일 때만 기록된다. */
export function logScreenEvent(name: string): void {
  if (!__SA_TOOLS__ || !store.get().activeRunId) return;
  const now = Date.now();
  store.update((d) =>
    withActiveRun(d, (run) => {
      // 측정에 묶인 기록이 아닌 기록(앞 참가자의 기록 등)의 화면은 이름을 달리 적고 시각 측정에 쓰지 않는다.
      const logged = screenLogName(name, d.currentId !== null && d.currentId === run.sessionId);
      let next = logScreen(run, logged, now);
      // 답 입력 화면을 떠나 입력 확인으로 올 때 모든 문항이 차 있으면 입력 완료 시각을 남긴다.
      // (마지막 단답형을 "다음" 없이 "전체 보기"로 넘긴 경우에도 남게 한다.)
      if (logged === 'review' && next.inputDoneAt === null) {
        const session = d.sessions.find((s) => s.id === run.sessionId) ?? null;
        const exam = session ? findExam(session.examId) : null;
        if (session && exam && findMissing(exam, session.answers).length === 0) next = { ...next, inputDoneAt: now };
      }
      return next;
    }),
  );
}

export function logReviewConfirm(): void {
  if (!__SA_TOOLS__ || !store.get().activeRunId) return;
  const now = Date.now();
  // 측정에 묶인 기록의 입력 확인만 적는다.
  store.update((d) =>
    withActiveRun(d, (run) => (run.sessionId === d.currentId && run.reviewConfirmAt === null ? { ...run, reviewConfirmAt: now } : run)),
  );
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

/**
 * 참가자를 마친다. 다음 참가자가 앞 참가자의 기록을 열지 않게 지금 보는 기록도 비운다.
 */
export function finishTestRun(): void {
  const now = Date.now();
  store.update((d) => (d.activeRunId ? { ...d, testRuns: closeActiveRun(d, now), activeRunId: null, currentId: null } : d));
}

/**
 * 테스트 기기인지: 측정 기록이 남아 있는데 진행 중인 측정이 없다(참가자를 마친 뒤, 다음 참가자를 시작하기 전).
 * 이때는 기록 화면과 "이어서 보기"에 어떤 기록도 보여 주지 않는다. 진행자가 측정 기록을 모두 지우면 평소대로 돌아간다.
 */
export function isTestDevice(d: AppData): boolean {
  return __SA_TOOLS__ && d.activeRunId === null && d.testRuns.length > 0;
}

/**
 * 연달아 누르기 보호가 버린 누름을 측정 기록에 센다. counted 는 지금 화면이 측정에 묶인 화면인지다
 * (진행자용 화면, 예시 결과, 측정에 묶이지 않은 기록의 화면에서는 세지 않는다).
 */
export function countDiscardedTap(screen: string, isDemo: boolean): void {
  if (!__SA_TOOLS__ || !store.get().activeRunId) return;
  store.update((d) =>
    withActiveRun(d, (run) => {
      if (isDemo || screen === 'test' || screen === 'unknown') return run;
      if (screenLogName(screen, d.currentId !== null && d.currentId === run.sessionId) !== screen) return run;
      return { ...run, discardedTaps: run.discardedTaps + 1 };
    }),
  );
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
