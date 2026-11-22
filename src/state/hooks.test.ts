import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findExam } from '../exams';
import { exampleAnswers } from '../logic/example';
import type { Answers, Exam } from '../types';
import {
  deleteAllSessions,
  deleteSession,
  finishTestRun,
  logScreenEvent,
  openSession,
  putAnswer,
  resumeCandidate,
  setRunAnswerKey,
  startSession,
  startTestRun,
  type SessionHandle,
} from './hooks';
import { markGraded } from './session';
import { defaultData, store } from './store';
import { activeRun, exportCsv, exportJson, finalAnswersOf, runMetrics } from './testlog';

// 저장소를 거치는 동작: 시험 고르기, 테스트 측정의 묶임, 기록 삭제.

const examA = findExam('sample-a') as Exam;
const answersA = exampleAnswers(examA);

function current() {
  const d = store.get();
  return d.sessions.find((s) => s.id === d.currentId) ?? null;
}

function handle(): SessionHandle {
  const session = current()!;
  return { isDemo: false, session, exam: findExam(session.examId)!, update: () => undefined, path: (p) => p };
}

function enter(answers: Answers, nos: number[]) {
  for (const no of nos) putAnswer(handle(), no, answers[no], 'input');
}

const ALL = examA.items.map((it) => it.no);
const keyText = ALL.map((no) => answersA[no]).join(',');

beforeEach(() => {
  // 시각은 멈춰 두고 tick으로만 흐르게 한다. 측정을 시작한 뒤에 만든 기록인지를 시각으로 가르기 때문이다.
  vi.useFakeTimers({ toFake: ['Date'] });
  store.update(() => defaultData());
});

function tick(ms: number) {
  vi.setSystemTime(new Date(Date.now() + ms));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('시험 고르기', () => {
  it('같은 시험을 다시 고르면 채점 전 기록을 이어 쓴다', () => {
    startSession('sample-a', 'not_yet', null);
    enter(answersA, [1, 2, 3]);
    const id = current()!.id;
    startSession('sample-a', 'not_yet', null);
    expect(store.get().sessions).toHaveLength(1);
    expect(current()!.id).toBe(id);
    expect(current()!.answers).toEqual({ 1: 3, 2: 5, 3: 2 });
  });

  it('채점한 기록이 있으면 새 기록을 만든다', () => {
    startSession('sample-a', 'not_yet', null);
    enter(answersA, ALL);
    store.update((d) => ({ ...d, sessions: d.sessions.map((s) => markGraded(s, examA, '2026-11-22T10:00:00.000Z')) }));
    const first = current()!.id;
    startSession('sample-a', 'not_yet', null);
    expect(store.get().sessions).toHaveLength(2);
    expect(current()!.id).not.toBe(first);
    expect(current()!.answers).toEqual({});
  });

  it('같은 시험을 다시 고르면 "채점은 아직인가요?"의 답은 방금 고른 것으로 바뀐다', () => {
    startSession('sample-a', 'already', null);
    const id = current()!.id;
    startSession('sample-a', 'not_yet', null);
    expect(current()!.id).toBe(id);
    expect(current()!.gradedBefore).toBe('not_yet');
    startSession('sample-a', 'already', null);
    expect(current()!.id).toBe(id);
    expect(current()!.gradedBefore).toBe('already');
  });
});

describe('이어서 보기', () => {
  it('지금 보는 기록이 있으면 그 기록이다', () => {
    startSession('sample-a', 'not_yet', null);
    startSession('sample-b', 'not_yet', 'first');
    expect(resumeCandidate(store.get())!.session.id).toBe(current()!.id);
    expect(resumeCandidate(store.get())!.exam.id).toBe('sample-b');
  });

  it('지금 보던 기록을 지워도 남은 기록 가운데 가장 최근 것을 이어 볼 수 있다', () => {
    startSession('sample-a', 'not_yet', null);
    const a = current()!.id;
    startSession('sample-b', 'not_yet', 'first');
    deleteSession(current()!.id);
    expect(store.get().currentId).toBeNull();
    expect(resumeCandidate(store.get())!.session.id).toBe(a);
  });

  it('기록이 없으면 없다', () => {
    expect(resumeCandidate(store.get())).toBeNull();
  });

  it('테스트 중에는 앞 참가자의 기록을 이어 보지 않는다', () => {
    startSession('sample-a', 'not_yet', null);
    startTestRun('P01', 'keypad', 'sample-a');
    expect(store.get().sessions).toHaveLength(1);
    expect(resumeCandidate(store.get())).toBeNull();
    // 이번 참가자가 기록을 만들면 그 기록이 대상이다.
    startSession('sample-a', 'not_yet', null);
    const mine = current()!.id;
    store.update((d) => ({ ...d, currentId: null }));
    expect(resumeCandidate(store.get())!.session.id).toBe(mine);
  });
});

describe('테스트 측정과 시험 기록', () => {
  it('테스트를 시작하면 앞 사람의 기록이 현재 기록으로 남지 않는다', () => {
    startSession('sample-a', 'not_yet', null);
    enter(answersA, [1, 2]);
    startTestRun('P01', 'keypad', 'sample-a');
    expect(store.get().currentId).toBeNull();
    // 참가자가 시험을 고르면 앞 사람의 채점 전 기록을 이어 쓰지 않고 빈 기록에서 시작한다.
    startSession('sample-a', 'not_yet', null);
    expect(store.get().sessions).toHaveLength(2);
    expect(current()!.answers).toEqual({});
    expect(activeRun(store.get())!.sessionId).toBe(current()!.id);
    expect(activeRun(store.get())!.examId).toBe('sample-a');
  });

  it('테스트 중에 시험을 다시 골라도 같은 기록을 이어 쓰고 측정이 끊기지 않는다', () => {
    startTestRun('P01', 'keypad', 'sample-a');
    logScreenEvent('exams');
    startSession('sample-a', 'not_yet', null);
    logScreenEvent('input');
    enter(answersA, [1, 2]);
    // 뒤로 가서 같은 시험을 다시 고른다.
    logScreenEvent('exams');
    startSession('sample-a', 'not_yet', null);
    logScreenEvent('input');
    expect(store.get().sessions).toHaveLength(1);
    expect(current()!.answers).toEqual({ 1: 3, 2: 5 });
    enter(answersA, ALL.slice(2));
    const run = activeRun(store.get())!;
    expect(run.sessionId).toBe(current()!.id);
    expect(Object.keys(run.itemInputs)).toHaveLength(30);
    expect(run.inputDoneAt).not.toBeNull();
    setRunAnswerKey(run.id, keyText);
    const m = runMetrics(activeRun(store.get())!, current(), examA);
    expect(m.residualErrors).toBe(0);
    expect(m.inputSeconds).not.toBeNull();
    expect(m.enteredCount).toBe(30);
  });

  it('테스트 중에 다른 시험을 고르면 새 기록에 다시 묶는다', () => {
    startTestRun('P02', 'rows', 'sample-a');
    startSession('sample-a', 'not_yet', null);
    const first = current()!.id;
    startSession('sample-b', 'not_yet', 'first');
    const run = activeRun(store.get())!;
    expect(current()!.id).not.toBe(first);
    expect(run.sessionId).toBe(current()!.id);
    expect(run.examId).toBe('sample-b');
    expect(run.plannedExamId).toBe('sample-a');
    expect(run.examReselects).toBe(1);
  });

  it('답을 넣다가 다른 시험으로 바꾸면 앞 시험에서 누른 횟수와 시각이 섞이지 않는다', () => {
    startTestRun('P02', 'keypad', 'sample-a');
    logScreenEvent('exams');
    startSession('sample-b', 'not_yet', 'first');
    logScreenEvent('input');
    const answersB = exampleAnswers(findExam('sample-b') as Exam);
    enter(answersB, [1, 2]);
    logScreenEvent('review');
    putAnswer(handle(), 2, answersB[2] === 1 ? 2 : 1, 'review');
    const before = activeRun(store.get())!;
    expect(before.itemInputs).toEqual({ 1: 1, 2: 2 });
    expect(before.reviewFixed).toEqual([2]);
    expect(before.inputStartAt).not.toBeNull();
    // 뒤로 가서 계획한 시험을 고른다.
    logScreenEvent('exams');
    startSession('sample-a', 'not_yet', null);
    const rebound = activeRun(store.get())!;
    expect(rebound.examId).toBe('sample-a');
    expect(rebound.examReselects).toBe(1);
    expect(rebound.itemInputs).toEqual({});
    expect(rebound.reviewFixed).toEqual([]);
    expect(rebound.inputStartAt).toBeNull();
    expect(rebound.firstInputAt).toBeNull();
    expect(rebound.examSelectAt).not.toBeNull();
    logScreenEvent('input');
    enter(answersA, ALL);
    const run = activeRun(store.get())!;
    expect(run.inputStartAt).not.toBeNull();
    expect(Object.values(run.itemInputs).reduce((a, b) => a + b, 0)).toBe(30);
    expect(run.itemInputs[1]).toBe(1);
    // 화면 진입 기록에는 다시 고른 흔적이 그대로 남는다.
    expect(run.screens.map((x) => x.screen)).toEqual(['exams', 'input', 'review', 'exams', 'input']);
    const csv = exportCsv([{ run, session: current(), exam: examA }]).split('\n');
    const head = csv[0]!.split(',');
    expect(head).toContain('exam_reselects');
    expect(csv[1]!.split(',')[head.indexOf('exam_reselects')]).toBe('1');
  });

  it('채점까지 마친 뒤에 새로 시작한 기록은 재지 않고, 측정은 채점한 기록에 묶인 채로 둔다', () => {
    startTestRun('P02', 'keypad', 'sample-a');
    startSession('sample-a', 'not_yet', null);
    logScreenEvent('input');
    enter(answersA, ALL);
    const graded = current()!.id;
    store.update((d) => ({ ...d, sessions: d.sessions.map((s) => markGraded(s, examA, '2026-11-22T10:00:00.000Z')) }));
    logScreenEvent('score');
    const before = activeRun(store.get())!;
    expect(before.firstScoreAt).not.toBeNull();
    // 같은 시험을 한 번 더 시작한다. 새 기록이 생기지만 측정은 그대로다.
    tick(1000);
    startSession('sample-a', 'not_yet', null);
    expect(current()!.id).not.toBe(graded);
    logScreenEvent('input');
    putAnswer(handle(), 1, 1, 'input');
    const run = activeRun(store.get())!;
    expect(run.sessionId).toBe(graded);
    expect(run.examReselects).toBe(0);
    expect(run.itemInputs).toEqual(before.itemInputs);
    expect(run.firstScoreAt).toBe(before.firstScoreAt);
    expect(run.screens[run.screens.length - 1]!.screen).toBe('other:input');
    // 새로 시작한 기록은 다시 골라도 이어 쓴다.
    const second = current()!.id;
    tick(1000);
    startSession('sample-a', 'not_yet', null);
    expect(current()!.id).toBe(second);
  });

  it('측정에 묶이지 않은 기록의 화면은 따로 적고 시각 측정에 쓰지 않는다', () => {
    // 앞 참가자가 채점까지 한 기록이 기기에 남아 있다.
    startSession('sample-a', 'not_yet', null);
    enter(answersA, ALL);
    store.update((d) => ({ ...d, sessions: d.sessions.map((s) => markGraded(s, examA, '2026-11-22T10:00:00.000Z')) }));
    const old = current()!.id;
    startTestRun('P03', 'keypad', 'sample-a');
    // 새 참가자가 시험을 고르기 전에 기록 탭에서 앞 기록을 열어 본다.
    logScreenEvent('start');
    logScreenEvent('history');
    openSession(old);
    logScreenEvent('anatomy');
    logScreenEvent('score');
    logScreenEvent('input');
    logScreenEvent('marks');
    logScreenEvent('start');
    let run = activeRun(store.get())!;
    expect(run.screens.map((x) => x.screen)).toEqual(['start', 'history', 'other:anatomy', 'other:score', 'other:input', 'other:marks', 'start']);
    expect(run.firstScoreAt).toBeNull();
    expect(run.inputStartAt).toBeNull();
    expect(run.marksMs).toBe(0);
    // 그 뒤에 과제대로 진행하면 이번 기록의 시각만 남는다.
    logScreenEvent('exams');
    tick(1000);
    startSession('sample-a', 'not_yet', null);
    logScreenEvent('input');
    enter(answersA, ALL);
    store.update((d) => ({
      ...d,
      sessions: d.sessions.map((s) => (s.id === d.currentId ? markGraded(s, examA, '2026-11-22T10:10:00.000Z') : s)),
    }));
    tick(5000);
    logScreenEvent('score');
    run = activeRun(store.get())!;
    expect(run.sessionId).toBe(current()!.id);
    expect(run.firstScoreAt).not.toBeNull();
    expect(run.firstScoreAt! - run.examSelectAt!).toBeGreaterThanOrEqual(0);
    expect(runMetrics(run, current(), examA).selectToScoreSeconds).toBeGreaterThanOrEqual(0);
  });

  it('답을 지우는 것은 입력 횟수로 세지 않는다', () => {
    startTestRun('P03', 'keypad', 'sample-a');
    startSession('sample-a', 'not_yet', null);
    putAnswer(handle(), 22, 12, 'input');
    putAnswer(handle(), 22, undefined, 'input');
    putAnswer(handle(), 22, 12, 'input');
    expect(activeRun(store.get())!.itemInputs[22]).toBe(2);
  });

  it('입력 확인에서 마지막 문항을 채워도 입력 확인 화면에 다시 올 때 입력 완료 시각이 남는다', () => {
    startTestRun('P04', 'keypad', 'sample-a');
    startSession('sample-a', 'not_yet', null);
    logScreenEvent('input');
    enter(answersA, ALL.slice(0, 29));
    expect(activeRun(store.get())!.inputDoneAt).toBeNull();
    // 측정에 묶이지 않은 경로로 마지막 답이 들어간 경우를 흉내 낸다.
    store.update((d) => ({ ...d, sessions: d.sessions.map((s) => ({ ...s, answers: { ...s.answers, 30: 48 } })) }));
    logScreenEvent('review');
    expect(activeRun(store.get())!.inputDoneAt).not.toBeNull();
  });

  it('지금 보던 기록을 지우면 다른 기록으로 옮겨 가지 않는다', () => {
    startSession('sample-a', 'not_yet', null);
    startSession('sample-b', 'not_yet', 'first');
    const cur = current()!.id;
    deleteSession(cur);
    expect(store.get().sessions).toHaveLength(1);
    expect(store.get().currentId).toBeNull();
  });

  it('참가자를 마치거나 기록을 지워도 최종 답과 남은 오입력은 측정 기록에 남는다', () => {
    startTestRun('P05', 'keypad', 'sample-a');
    startSession('sample-a', 'not_yet', null);
    enter({ ...answersA, 3: 5 }, ALL);
    const runId = activeRun(store.get())!.id;
    setRunAnswerKey(runId, keyText);
    finishTestRun();
    expect(store.get().activeRunId).toBeNull();
    const closed = store.get().testRuns.find((r) => r.id === runId)!;
    expect(closed.endedAt).not.toBeNull();
    expect(closed.finalAnswers).toHaveLength(30);
    expect(closed.finalAnswers![2]).toBe(5);
    deleteAllSessions();
    expect(store.get().sessions).toEqual([]);
    const kept = store.get().testRuns.find((r) => r.id === runId)!;
    const m = runMetrics(kept, null, examA);
    expect(m.residualErrors).toBe(1);
    expect(m.residualNos).toEqual([3]);
    expect(m.enteredCount).toBe(30);
  });

  it('참가자를 마친 뒤에 그 기록을 고쳐도 끝난 측정의 최종 답과 남은 오입력은 바뀌지 않는다', () => {
    startTestRun('P05', 'keypad', 'sample-a');
    startSession('sample-a', 'not_yet', null);
    enter({ ...answersA, 3: 5 }, ALL);
    const runId = activeRun(store.get())!.id;
    const sessionId = current()!.id;
    setRunAnswerKey(runId, keyText);
    finishTestRun();
    const row = () => {
      const d = store.get();
      const run = d.testRuns.find((r) => r.id === runId)!;
      return { run, session: d.sessions.find((x) => x.id === run.sessionId) ?? null, exam: examA };
    };
    expect(runMetrics(row().run, row().session, examA).residualNos).toEqual([3]);
    // 끝난 뒤에 누군가 그 기록을 열어 1번과 2번을 고친다.
    openSession(sessionId);
    putAnswer(handle(), 1, 1, 'review');
    putAnswer(handle(), 2, 1, 'review');
    expect(current()!.answers[1]).toBe(1);
    expect(runMetrics(row().run, row().session, examA).residualNos).toEqual([3]);
    expect(finalAnswersOf(row().run, row().session, examA)!.slice(0, 3)).toEqual([3, 5, 5]);
    expect(JSON.parse(exportJson([row()], 0)).runs[0].finalAnswers.slice(0, 3)).toEqual([3, 5, 5]);
    expect(exportCsv([row()])).toContain(',1,3,');
    // 다음 참가자를 시작하고 마쳐도, 고친 기록을 지워도 사본은 그대로다.
    startTestRun('P06', 'keypad', 'sample-a');
    finishTestRun();
    expect(row().run.finalAnswers!.slice(0, 3)).toEqual([3, 5, 5]);
    deleteSession(sessionId);
    expect(row().run.finalAnswers!.slice(0, 3)).toEqual([3, 5, 5]);
    expect(runMetrics(row().run, null, examA).residualNos).toEqual([3]);
  });

  it('시험 기록을 지운 뒤에도 옮겨 둔 최종 답으로 답지를 대조할 수 있다', () => {
    startTestRun('P05', 'keypad', 'sample-a');
    startSession('sample-a', 'not_yet', null);
    enter({ ...answersA, 3: 5 }, ALL);
    const runId = activeRun(store.get())!.id;
    finishTestRun();
    deleteAllSessions();
    const run = () => store.get().testRuns.find((r) => r.id === runId)!;
    // 답지를 아직 넣지 않았어도 최종 답은 남아 있다(진행자 화면이 이 값으로 대조를 받아 준다).
    expect(finalAnswersOf(run(), null, examA)).toHaveLength(30);
    expect(runMetrics(run(), null, examA).residualErrors).toBeNull();
    setRunAnswerKey(runId, keyText);
    expect(runMetrics(run(), null, examA).residualNos).toEqual([3]);
  });

  it('새 참가자를 시작하면 앞 참가자의 측정은 닫힌다', () => {
    startTestRun('P06', 'keypad', 'sample-a');
    startSession('sample-a', 'not_yet', null);
    enter(answersA, [1]);
    startTestRun('P07', 'rows', 'sample-a');
    const d = store.get();
    expect(d.testRuns).toHaveLength(2);
    expect(d.testRuns[0]!.endedAt).not.toBeNull();
    expect(d.testRuns[0]!.finalAnswers![0]).toBe(3);
    expect(activeRun(d)!.participant).toBe('P07');
    expect(d.inputMode).toBe('rows');
    expect(d.currentId).toBeNull();
  });

  it('테스트를 시작하지 않으면 아무것도 재지 않는다', () => {
    startSession('sample-a', 'not_yet', null);
    logScreenEvent('input');
    enter(answersA, [1, 2, 3]);
    expect(store.get().testRuns).toEqual([]);
  });
});
