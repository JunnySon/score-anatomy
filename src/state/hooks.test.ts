import { beforeEach, describe, expect, it } from 'vitest';
import { findExam } from '../exams';
import { exampleAnswers } from '../logic/example';
import type { Answers, Exam } from '../types';
import {
  deleteAllSessions,
  deleteSession,
  finishTestRun,
  logScreenEvent,
  putAnswer,
  setRunAnswerKey,
  startSession,
  startTestRun,
  type SessionHandle,
} from './hooks';
import { markGraded } from './session';
import { defaultData, store } from './store';
import { activeRun, runMetrics } from './testlog';

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
  store.update(() => defaultData());
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

  it('"이미 했어요"라고 답한 기록은 다시 골라도 그대로다', () => {
    startSession('sample-a', 'already', null);
    startSession('sample-a', 'not_yet', null);
    expect(current()!.gradedBefore).toBe('already');
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
