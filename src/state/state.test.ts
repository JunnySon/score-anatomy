import { describe, expect, it } from 'vitest';
import { findExam } from '../exams';
import { exampleAnswers, exampleCauses, exampleMarks } from '../logic/example';
import { GradeError, gradeExam } from '../logic/scoring';
import type { Exam, Session, TestRun } from '../types';
import {
  currentRetry,
  cycleMark,
  isMarkedAfterGrading,
  markGraded,
  markSaved,
  newSession,
  recordRetry,
  resumePath,
  setAnswer,
  setCause,
  setSelfCheck,
  stageOf,
  toggleUnsure,
  viewAnswer,
} from './session';
import { defaultData, parseStored, Store, STORAGE_KEY, type StorageLike } from './store';
import { diffAnswerKey, exportCsv, exportJson, logAnswer, logScreen, newRun, PARTICIPANT_PATTERN, parseAnswerKey, runMetrics } from './testlog';

const examA = findExam('sample-a') as Exam;
const examC = findExam('sample-c') as Exam;
const NOW = '2026-11-22T10:00:00.000Z';

function filled(): Session {
  return { ...newSession('sample-a', 'not_yet', null, NOW), answers: exampleAnswers(examA) };
}

describe('기록 고치기', () => {
  it('새 기록은 비어 있고 입력 단계다', () => {
    const s = newSession('sample-a', 'not_yet', null, NOW);
    expect(s.answers).toEqual({});
    expect(stageOf(s, examA)).toBe('input');
    expect(resumePath(s, examA)).toBe('/input');
  });

  it('답을 넣고, 안 풂으로 바꾸고, 지운다', () => {
    let s = newSession('sample-a', 'not_yet', null, NOW);
    s = setAnswer(s, 1, 3);
    s = setAnswer(s, 2, 'skip');
    expect(s.answers).toEqual({ 1: 3, 2: 'skip' });
    s = setAnswer(s, 1, undefined);
    expect(s.answers).toEqual({ 2: 'skip' });
    expect(setAnswer(s, 2, 'skip')).toBe(s);
  });

  it('안 풂으로 바꾸면 그 문항의 표시는 지운다', () => {
    let s = filled();
    s = cycleMark(cycleMark(s, 9), 9);
    expect(s.marks[9]).toBe('guess');
    s = setAnswer(s, 9, 'skip');
    expect(s.marks[9]).toBeUndefined();
  });

  it('표시는 표시 없음, 고민, 찍음, 표시 없음 순으로 돈다', () => {
    let s = filled();
    s = cycleMark(s, 3);
    expect(s.marks[3]).toBe('doubt');
    s = cycleMark(s, 3);
    expect(s.marks[3]).toBe('guess');
    s = cycleMark(s, 3);
    expect(s.marks[3]).toBeUndefined();
    s = toggleUnsure(s, 25);
    expect(s.marks[25]).toBe('unsure');
    s = toggleUnsure(s, 25);
    expect(s.marks[25]).toBeUndefined();
  });

  it('미입력이 있으면 채점 시각을 남기지 않는다', () => {
    const s = setAnswer(filled(), 14, undefined);
    expect(() => markGraded(s, examA, NOW)).toThrow(GradeError);
    expect(stageOf(s, examA)).toBe('input');
  });

  it('채점하면 결과 단계가 되고, 답을 고쳐 맞힌 문항의 원인은 지워진다', () => {
    let s: Session = { ...filled(), marks: exampleMarks(), causes: exampleCauses() };
    expect(stageOf(s, examA)).toBe('review');
    s = markGraded(s, examA, NOW);
    expect(s.gradedAt).toBe(NOW);
    expect(stageOf(s, examA)).toBe('graded');
    expect(resumePath(s, examA)).toBe('/anatomy');
    expect(Object.keys(s.causes).map(Number)).toEqual([11, 15, 20, 21, 27, 29]);
    // 15번을 정답으로 고치면 원인과 재풀이 기록이 없어진다.
    s = recordRetry(s, 15, false, false, NOW);
    s = setAnswer(s, 15, 3);
    expect(s.causes[15]).toBeUndefined();
    expect(s.retries[15]).toBeUndefined();
    s = markGraded(s, examA, NOW);
    expect(Object.keys(s.causes).map(Number)).toEqual([11, 20, 21, 27, 29]);
  });

  it('채점하면 채점 흔적(gradedWith)에 정답 판 번호와 점수를 적고, 오답 원인은 지우지 않는다(작업 지시서 3의 4-6)', () => {
    const s = markGraded({ ...filled(), marks: exampleMarks(), causes: exampleCauses() }, examA, NOW);
    // 예시 시험 A에는 정답 판 번호(answersRev)가 없어서 1이다.
    expect(s.gradedWith).toEqual({ answersRev: 1, score: 78 });
    // 정답 판 번호를 올리고 15번 정답을 넣은 답(1)으로 고친 사본(테스트 전용 자료)으로 다시 채점하면 지금 값이 적힌다.
    const fixed: Exam = {
      ...examA,
      answersRev: 2,
      answersNote: '테스트 전용 정정 안내예요.',
      items: examA.items.map((it) => (it.no === 15 ? { ...it, answer: 1 } : it)),
    };
    const again = markGraded(s, fixed, NOW);
    expect(again.gradedWith).toEqual({ answersRev: 2, score: 82 });
    // 맞게 된 15번의 원인은 지우지 않는다(채점 결과에는 원인이 붙지 않아 화면에서만 빠진다).
    expect(again.causes).toEqual(exampleCauses());
    expect(gradeExam(fixed, again).items.find((it) => it.no === 15)!.cause).toBeNull();
    // 답과 표시는 그대로다.
    expect(again.answers).toEqual(s.answers);
    expect(again.marks).toEqual(s.marks);
  });

  it('재풀이 기록에는 정답 판 번호가 2 이상일 때만 적고, 판이 다른 기록은 이어 세지 않고 화면에서 뺀다(작업 지시서 3의 4-6)', () => {
    let s = markGraded(filled(), examA, NOW);
    s = recordRetry(s, 15, false, false, NOW);
    // 정답 판 번호 1(칸 없음)이면 지금까지와 같은 모양이다.
    expect(s.retries[15]).toEqual({ correct: false, attempts: 1, firstCorrectAttempt: null, answerKnown: false, at: NOW });
    expect(recordRetry(s, 15, true, false, NOW, 1).retries[15]).toEqual({ correct: true, attempts: 2, firstCorrectAttempt: 2, answerKnown: false, at: NOW });
    expect(currentRetry(s, 15, examA)).toEqual(s.retries[15]);
    // 정답 판 번호가 2인 판에서는 그 전의 기록을 보여 주지 않고(지우지도 않고), 다시 풀면 처음부터 센다.
    const rev2: Exam = { ...examA, answersRev: 2, answersNote: '테스트 전용 정정 안내예요.' };
    expect(currentRetry(s, 15, rev2)).toBeNull();
    expect(s.retries[15]).toBeDefined();
    s = recordRetry(s, 15, true, false, NOW, 2);
    expect(s.retries[15]).toEqual({ correct: true, attempts: 1, firstCorrectAttempt: 1, answerKnown: false, at: NOW, answersRev: 2 });
    expect(currentRetry(s, 15, rev2)).toEqual(s.retries[15]);
    expect(currentRetry(s, 15, examA)).toBeNull();
    // 같은 판에서는 이어 센다.
    expect(recordRetry(s, 15, false, true, NOW, 2).retries[15]).toEqual({ correct: false, attempts: 2, firstCorrectAttempt: 1, answerKnown: true, at: NOW, answersRev: 2 });
    expect(currentRetry(s, 20, rev2)).toBeNull();
  });

  it('채점한 뒤에 표시를 바꾸면 따로 적는다', () => {
    let s = markGraded(filled(), examA, NOW);
    expect(isMarkedAfterGrading(s)).toBe(false);
    s = cycleMark(s, 9);
    expect(isMarkedAfterGrading(s)).toBe(true);
    const already = newSession('sample-a', 'already', null, NOW);
    expect(isMarkedAfterGrading(already)).toBe(true);
  });

  it('채점한 뒤에 답을 고치면 다시 채점해야 하고, 고친 문항을 적어 둔다', () => {
    let s = markGraded(filled(), examA, NOW);
    expect(s.firstGradedAt).toBe(NOW);
    s = setAnswer(s, 11, 2);
    expect(s.gradedAt).toBeNull();
    expect(s.firstGradedAt).toBe(NOW);
    expect(s.answersEditedAfterGrading).toEqual([11]);
    expect(stageOf(s, examA)).toBe('review');
    expect(resumePath(s, examA)).toBe('/review');
    s = setAnswer(setAnswer(s, 3, 1), 11, 4);
    expect(s.answersEditedAfterGrading).toEqual([3, 11]);
    // 같은 값을 다시 넣는 것은 고친 것이 아니다.
    const same = markGraded(filled(), examA, NOW);
    expect(setAnswer(same, 1, 3)).toBe(same);
    // 다시 채점해도 처음 채점한 시각은 그대로다.
    const LATER = '2026-11-22T11:00:00.000Z';
    s = markGraded(s, examA, LATER);
    expect(s.gradedAt).toBe(LATER);
    expect(s.firstGradedAt).toBe(NOW);
    expect(stageOf(s, examA)).toBe('graded');
    // 답을 고쳐서 채점 시각이 비어 있는 동안 표시를 바꿔도 채점한 뒤 표시로 적는다.
    let t = setAnswer(markGraded(filled(), examA, NOW), 1, 4);
    expect(isMarkedAfterGrading(t)).toBe(false);
    t = cycleMark(t, 9);
    expect(isMarkedAfterGrading(t)).toBe(true);
  });

  it('채점은 붙어 있는 표시를 그대로 둔다(1.1에서 "없어요"와 "채점하기"를 하나로 합쳤다)', () => {
    const s = cycleMark(cycleMark(cycleMark(filled(), 9), 9), 14);
    const g = markGraded(s, examA, NOW);
    expect(g.marks).toEqual({ 9: 'guess', 14: 'doubt' });
    expect(g.marksEditedAfterGrading).toBe(false);
  });

  it('찍음 표시 정답의 스스로 확인: 마지막 선택이 기록이 되고, "아직 안 풀어 봤어요"는 기록을 지운다', () => {
    const LATER = '2026-11-22T11:00:00.000Z';
    let s = markGraded(filled(), examA, NOW);
    s = setSelfCheck(s, 14, 'solved', NOW);
    expect(s.selfChecks[14]).toEqual({ result: 'solved', at: NOW });
    s = setSelfCheck(s, 14, 'stuck', LATER);
    expect(s.selfChecks[14]).toEqual({ result: 'stuck', at: LATER });
    s = setSelfCheck(s, 14, null, LATER);
    expect(s.selfChecks[14]).toBeUndefined();
    expect(setSelfCheck(s, 14, null, LATER)).toBe(s);
    // 답을 고치면 그 문항의 스스로 확인 기록도 지운다(원인, 재풀이 기록과 같다).
    s = setSelfCheck(s, 9, 'solved', NOW);
    expect(setAnswer(s, 9, 1).selfChecks[9]).toBeUndefined();
  });

  it('원인, 정답 확인, 재풀이 기록', () => {
    let s = markGraded(filled(), examA, NOW);
    s = setCause(s, 15, 'slip');
    expect(setCause(s, 15, 'slip')).toBe(s);
    s = viewAnswer(s, 27);
    expect(s.answerViewed[27]).toBe(true);
    s = recordRetry(s, 15, false, false, NOW);
    expect(s.retries[15]).toEqual({ correct: false, attempts: 1, firstCorrectAttempt: null, answerKnown: false, at: NOW });
    s = recordRetry(s, 15, true, false, NOW);
    expect(s.retries[15]).toEqual({ correct: true, attempts: 2, firstCorrectAttempt: 2, answerKnown: false, at: NOW });
    // 처음에 바로 맞힌 문항은 다시 맞혀도 처음 맞힌 차례가 1로 남는다.
    s = recordRetry(recordRetry(s, 20, true, false, NOW), 20, true, false, NOW);
    expect(s.retries[20]).toEqual({ correct: true, attempts: 2, firstCorrectAttempt: 1, answerKnown: false, at: NOW });
    s = recordRetry(s, 27, true, true, NOW);
    expect(s.retries[27]!.answerKnown).toBe(true);
  });

  it('정답 공개 전 시험은 저장 단계에 머문다', () => {
    let s = newSession('sample-c', 'not_yet', null, NOW);
    for (const it of examC.items) s = setAnswer(s, it.no, it.kind === 'mc' ? 1 : 0);
    expect(stageOf(s, examC)).toBe('review');
    s = markSaved(s, NOW);
    expect(stageOf(s, examC)).toBe('saved');
    expect(resumePath(s, examC)).toBe('/marks');
    expect(() => markGraded(s, examC, NOW)).toThrow(GradeError);
  });

  it('저장해 둔 기록은 정답이 공개된 뒤에도 표시 화면으로 이어지고, 채점하면 결과로 간다', () => {
    // 정답 공개 전에 저장해 둔 기록을, 정답이 공개된 같은 시험(여기서는 시험 A의 모양)으로 다시 연다.
    let s = newSession('sample-a', 'not_yet', null, NOW);
    for (const it of examA.items) s = setAnswer(s, it.no, it.answer as number);
    s = markSaved(s, NOW);
    expect(stageOf(s, examA)).toBe('saved');
    expect(resumePath(s, examA)).toBe('/marks');
    s = markGraded(s, examA, NOW);
    expect(s.savedAt).toBeNull();
    expect(stageOf(s, examA)).toBe('graded');
    expect(resumePath(s, examA)).toBe('/anatomy');
    // 답을 지워 미입력이 생기면 다시 답 입력부터다.
    expect(stageOf(setAnswer(markSaved(s, NOW), 3, undefined), examA)).toBe('input');
  });
});

class MemoryStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

describe('저장소', () => {
  it('저장 형식에 version 필드가 있다', () => {
    const mem = new MemoryStorage();
    const store = new Store(mem);
    store.update((d) => ({ ...d, sessions: [filled()] }));
    const saved = JSON.parse(mem.getItem(STORAGE_KEY)!);
    expect(saved.version).toBe(1);
    expect(saved.sessions).toHaveLength(1);
    expect(store.storageOk).toBe(true);
    // 다시 열면 그대로 읽는다.
    expect(new Store(mem).get().sessions[0]!.answers[1]).toBe(3);
  });

  it('쓰기가 실패해도 메모리 상태로 동작한다', () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    const store = new Store(broken);
    expect(store.get()).toEqual(defaultData());
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    store.update((d) => ({ ...d, inputMode: 'rows' }));
    expect(store.get().inputMode).toBe('rows');
    expect(store.storageOk).toBe(false);
    expect(notified).toBe(1);
  });

  it('저장소가 아예 없어도 동작한다', () => {
    const store = new Store(null);
    store.update((d) => ({ ...d, sessions: [filled()] }));
    expect(store.get().sessions).toHaveLength(1);
    expect(store.storageOk).toBe(false);
  });

  it('망가진 값이나 다른 버전은 읽지 않는다', () => {
    expect(parseStored(null)).toBeNull();
    expect(parseStored('{not json')).toBeNull();
    expect(parseStored('[]')).toBeNull();
    expect(parseStored(JSON.stringify({ version: 2, sessions: [] }))).toBeNull();
    const ok = parseStored(JSON.stringify({ version: 1, sessions: [{ id: 'a', examId: 'sample-a' }, { nope: true }], currentId: 'zzz', inputMode: 'rows' }));
    expect(ok!.sessions).toHaveLength(1);
    expect(ok!.sessions[0]!.answers).toEqual({});
    expect(ok!.currentId).toBeNull();
    expect(ok!.inputMode).toBe('rows');
    expect(ok!.testRuns).toEqual([]);
  });

  it('1.1에서 더한 칸(스스로 확인 기록, 받지 않은 누름 수)이 없는 옛 기록도 version 1 그대로 읽는다', () => {
    const old = parseStored(
      JSON.stringify({
        version: 1,
        sessions: [{ id: 'a', examId: 'sample-a', answers: { 1: 3 } }],
        currentId: 'a',
        testRuns: [{ id: 'r', participant: 'P01', startedAt: 5 }],
      }),
    )!;
    expect(old.version).toBe(1);
    expect(old.sessions[0]!.selfChecks).toEqual({});
    expect(old.testRuns[0]!.discardedTaps).toBe(0);
    expect(old.testRuns[0]!.filledTaps).toBe(0);
    expect(old.testRuns[0]!.filledHeldTaps).toBe(0);
    const fresh = parseStored(
      JSON.stringify({
        version: 1,
        sessions: [
          {
            id: 'a',
            examId: 'sample-a',
            selfChecks: { 9: { result: 'solved', at: NOW }, 14: { result: 'maybe', at: NOW }, 20: 'stuck' },
          },
        ],
        testRuns: [
          { id: 'r', participant: 'P01', discardedTaps: 3, filledTaps: 2, filledHeldTaps: 1 },
          { id: 's', participant: 'P02', discardedTaps: -1, filledTaps: 1.5, filledHeldTaps: 2 },
          { id: 't', participant: 'P03', filledTaps: 1, filledHeldTaps: 4 },
          { id: 'u', participant: 'P04', filledTaps: 2, filledHeldTaps: -1 },
        ],
      }),
    )!;
    expect(fresh.sessions[0]!.selfChecks).toEqual({ 9: { result: 'solved', at: NOW } });
    expect(fresh.testRuns.map((r) => r.discardedTaps)).toEqual([3, 0, 0, 0]);
    expect(fresh.testRuns.map((r) => r.filledTaps)).toEqual([2, 0, 1, 2]);
    // 0.3.2의 칸(누르는 동안 온 dblclick 규칙으로 채운 수)은 채운 누름 수를 넘지 않고, 틀린 값은 0으로 읽는다.
    expect(fresh.testRuns.map((r) => r.filledHeldTaps)).toEqual([1, 0, 1, 0]);
  });

  it('채점 흔적(gradedWith)과 재풀이 기록의 정답 판 번호가 없는 옛 기록도 version 1 그대로 읽고, 모양이 맞는 값만 남긴다(작업 지시서 3의 4-6)', () => {
    const retry = { correct: true, attempts: 1, firstCorrectAttempt: 1, answerKnown: false, at: NOW };
    const read = (more: Record<string, unknown>) =>
      parseStored(JSON.stringify({ version: 1, sessions: [{ id: 'a', examId: 'sample-a', ...more }] }))!.sessions[0]!;
    // 칸이 없으면 칸 없이 읽는다(옛 기록).
    const old = read({ gradedAt: NOW, retries: { 15: retry } });
    expect('gradedWith' in old).toBe(false);
    expect(old.retries[15]).toEqual(retry);
    // 모양이 맞으면 그대로 남긴다.
    expect(read({ gradedWith: { answersRev: 2, score: 82 } }).gradedWith).toEqual({ answersRev: 2, score: 82 });
    expect(read({ gradedWith: { answersRev: 1, score: 0, extra: true } }).gradedWith).toEqual({ answersRev: 1, score: 0 });
    // 모양이 틀리면 칸이 없는 옛 기록으로 읽는다.
    for (const bad of [null, 'x', 78, [1, 78], {}, { answersRev: 0, score: 78 }, { answersRev: 1.5, score: 78 }, { answersRev: '2', score: 78 }, { answersRev: 2 }, { answersRev: 2, score: -1 }, { answersRev: 2, score: 7.5 }]) {
      expect('gradedWith' in read({ gradedWith: bad }), JSON.stringify(bad)).toBe(false);
    }
    // 재풀이 기록의 정답 판 번호는 2 이상일 때만 남긴다(1이나 틀린 값이면 칸 없음, 곧 1).
    const retries = read({ retries: { 1: { ...retry, answersRev: 3 }, 2: { ...retry, answersRev: 1 }, 3: { ...retry, answersRev: 'x' }, 4: { ...retry, answersRev: 2.5 } } }).retries;
    expect(retries[1]!.answersRev).toBe(3);
    for (const no of [2, 3, 4]) expect('answersRev' in retries[no]!).toBe(false);
    // 저장 형식의 version 은 그대로 1이고, 채점 흔적은 저장했다가 다시 열어도 남는다.
    const mem = new MemoryStorage();
    const store = new Store(mem);
    store.update((d) => ({ ...d, sessions: [markGraded(filled(), examA, NOW)] }));
    const saved = JSON.parse(mem.getItem(STORAGE_KEY)!);
    expect(saved.version).toBe(1);
    expect(saved.sessions[0].gradedWith).toEqual({ answersRev: 1, score: 78 });
    expect(new Store(mem).get().sessions[0]!.gradedWith).toEqual({ answersRev: 1, score: 78 });
  });

  it('기록 속의 모양이 맞지 않는 값은 버린다', () => {
    const ok = parseStored(
      JSON.stringify({
        version: 1,
        sessions: [
          {
            id: 'a',
            examId: 'sample-a',
            answers: { 1: 3, 2: 'skip', 3: 'x', 4: 1.5, 5: null, abc: 2 },
            marks: { 1: 'guess', 2: 'nope' },
            causes: { 11: 'slip', 15: 'because' },
            answerViewed: { 27: true, 29: 'yes' },
            retries: { 15: null, 20: { correct: true, attempts: 2, answerKnown: false, at: 'x' }, 21: { correct: 'y' } },
            targetGrade: 'constructor',
            gradedAt: '2026-11-22T10:00:00.000Z',
          },
        ],
        currentId: 'a',
        testRuns: [{ id: 'r', participant: 'P01', itemInputs: { 1: 2, 2: 'x' }, screens: [{ screen: 'input', at: 1 }, { name: 'old', at: 2 }], finalAnswers: [1, 'skip', 'bad'] }],
      }),
    )!;
    const s = ok.sessions[0]!;
    expect(s.answers).toEqual({ 1: 3, 2: 'skip' });
    expect(s.marks).toEqual({ 1: 'guess' });
    expect(s.causes).toEqual({ 11: 'slip' });
    expect(s.answerViewed).toEqual({ 27: true });
    expect(Object.keys(s.retries)).toEqual(['20']);
    // 예전 형식에는 처음 맞힌 차례가 없다. 맞힌 기록이면 그때의 시도 수로 채운다.
    expect(s.retries[20]!.firstCorrectAttempt).toBe(2);
    // 예전 형식에는 처음 채점한 시각이 없다. 채점 시각으로 채운다.
    expect(s.firstGradedAt).toBe('2026-11-22T10:00:00.000Z');
    expect(s.answersEditedAfterGrading).toEqual([]);
    const r = ok.testRuns[0]!;
    expect(r.itemInputs).toEqual({ 1: 2 });
    expect(r.screens).toEqual([{ screen: 'input', at: 1 }]);
    expect(r.finalAnswers).toEqual([1, 'skip', null]);
  });
});

describe('사용성 테스트 측정 기록', () => {
  const run = (): TestRun => newRun('P01', 'keypad', 'sample-a', 1000);

  it('참가자 코드는 P01 형식만 받는다', () => {
    expect(PARTICIPANT_PATTERN.test('P01')).toBe(true);
    expect(PARTICIPANT_PATTERN.test('P1')).toBe(false);
    expect(PARTICIPANT_PATTERN.test('p01')).toBe(false);
    expect(PARTICIPANT_PATTERN.test('김민수')).toBe(false);
  });

  it('화면 진입 시각과 표시 화면에 머문 시간', () => {
    let r = run();
    r = logScreen(r, 'start', 1000);
    r = logScreen(r, 'exams', 2000);
    r = logScreen(r, 'input', 3000);
    r = logScreen(r, 'input', 3500);
    r = logScreen(r, 'review', 60000);
    r = logScreen(r, 'marks', 70000);
    r = logScreen(r, 'score', 95000);
    r = logScreen(r, 'marks', 100000);
    r = logScreen(r, 'score', 101500);
    expect(r.screens.map((s) => s.screen)).toEqual(['start', 'exams', 'input', 'review', 'marks', 'score', 'marks', 'score']);
    expect(r.examSelectAt).toBe(2000);
    expect(r.inputStartAt).toBe(3000);
    expect(r.firstScoreAt).toBe(95000);
    expect(r.marksMs).toBe(25000 + 1500);
  });

  it('문항별 입력 횟수, 입력 확인에서 고친 문항, 입력 완료 시각', () => {
    let r = run();
    r = logAnswer(r, 1, 'input', true, false, 4000);
    r = logAnswer(r, 1, 'input', true, false, 5000);
    r = logAnswer(r, 30, 'input', true, true, 50000);
    r = logAnswer(r, 3, 'review', true, true, 55000);
    r = logAnswer(r, 3, 'review', true, true, 56000);
    r = logAnswer(r, 4, 'review', false, true, 57000);
    expect(r.itemInputs).toEqual({ 1: 2, 30: 1, 3: 2, 4: 1 });
    expect(r.firstInputAt).toBe(4000);
    expect(r.inputDoneAt).toBe(50000);
    expect(r.reviewFixed).toEqual([3]);
  });

  it('정답지 읽기와 대조', () => {
    const answers = exampleAnswers(examA);
    const text = examA.items.map((it) => answers[it.no]).join(', ');
    const parsed = parseAnswerKey(examA, text);
    expect(parsed.ok).toBe(true);
    expect(diffAnswerKey(examA, parsed.values, answers)).toEqual([]);
    // 줄바꿈으로 구분해도 읽는다. 안 푼 문항은 x.
    const withSkip = examA.items.map((it) => (it.no === 4 ? 'x' : answers[it.no])).join('\n');
    const parsed2 = parseAnswerKey(examA, withSkip);
    expect(parsed2.ok).toBe(true);
    expect(parsed2.values[3]).toBe('skip');
    expect(diffAnswerKey(examA, parsed2.values, answers)).toEqual([4]);
    // 끝에 남은 쉼표, 공백 구분, 전각 쉼표, "안 풂"도 읽는다.
    expect(parseAnswerKey(examA, `${text},`).ok).toBe(true);
    expect(parseAnswerKey(examA, ` ,${text}`).ok).toBe(true);
    expect(parseAnswerKey(examA, examA.items.map((it) => answers[it.no]).join(' ')).ok).toBe(true);
    expect(parseAnswerKey(examA, examA.items.map((it) => answers[it.no]).join(String.fromCodePoint(0xff0c))).ok).toBe(true);
    const withWords = parseAnswerKey(examA, examA.items.map((it) => (it.no === 4 ? '안 풂' : answers[it.no])).join(', '));
    expect(withWords.ok).toBe(true);
    expect(withWords.values[3]).toBe('skip');
    // 개수가 안 맞거나 범위를 벗어나면 읽지 않는다.
    expect(parseAnswerKey(examA, '1,2,3')).toMatchObject({ ok: false, errorIndex: 0, got: 3 });
    expect(parseAnswerKey(examA, '')).toMatchObject({ ok: false, got: 0 });
    const badMc = examA.items.map((it) => (it.no === 2 ? 6 : answers[it.no])).join(',');
    expect(parseAnswerKey(examA, badMc)).toMatchObject({ ok: false, errorIndex: 2 });
    const badShort = examA.items.map((it) => (it.no === 22 ? 1000 : answers[it.no])).join(',');
    expect(parseAnswerKey(examA, badShort)).toMatchObject({ ok: false, errorIndex: 22 });
  });

  it('측정값과 내보내기', () => {
    let r = run();
    r = logScreen(r, 'exams', 2000);
    r = logScreen(r, 'input', 3000);
    r = logAnswer(r, 30, 'input', true, true, 63400);
    r = logScreen(r, 'marks', 70000);
    r = logScreen(r, 'score', 100000);
    const session: Session = { ...filled(), id: 's1' };
    r = { ...r, sessionId: 's1', examId: 'sample-a' };
    const wrongKey = examA.items.map((it) => (it.no === 1 ? 1 : session.answers[it.no])).join(',');
    r = { ...r, answerKeyText: wrongKey };
    const m = runMetrics(r, session, examA);
    expect(m.inputSeconds).toBe(60.4);
    expect(m.marksSeconds).toBe(30);
    expect(m.selectToScoreSeconds).toBe(98);
    expect(m.inputCount).toBe(1);
    expect(m.residualErrors).toBe(1);
    expect(m.residualNos).toEqual([1]);
    expect(m.enteredCount).toBe(30);

    const rows = [{ run: r, session, exam: examA }];
    const json = JSON.parse(exportJson(rows, 200000));
    expect(json.format).toBe('score-anatomy-test-log');
    expect(json.runs[0].participant).toBe('P01');
    expect(json.runs[0].metrics.inputSeconds).toBe(60.4);
    expect(json.runs[0].finalAnswers).toHaveLength(30);

    const csv = exportCsv(rows).trim().split('\n');
    expect(csv).toHaveLength(2);
    const head = csv[0]!.split(',');
    const cells = csv[1]!.split(',');
    expect(head.slice(0, 6)).toEqual(['participant', 'input_mode', 'planned_exam', 'exam', 'exam_reselects', 'started_at']);
    expect(head).toHaveLength(17 + 30);
    expect(cells[head.indexOf('exam_reselects')]).toBe('0');
    // 1.1: 연달아 누르기 보호가 받지 않은 누름의 수.
    expect(cells[head.indexOf('discarded_taps')]).toBe('0');
    const csv2 = exportCsv([{ run: { ...r, discardedTaps: 3 }, session, exam: examA }]).trim().split('\n');
    expect(csv2[1]!.split(',')[head.indexOf('discarded_taps')]).toBe('3');
    // 0.3.1: 빠진 누름 채우기가 채운 누름의 수(작업 지시서 3-1의 3-1). 받지 않은 누름 바로 뒤 칸이다.
    expect(head.indexOf('filled_taps')).toBe(head.indexOf('discarded_taps') + 1);
    expect(cells[head.indexOf('filled_taps')]).toBe('0');
    const csv3 = exportCsv([{ run: { ...r, filledTaps: 2 }, session, exam: examA }]).trim().split('\n');
    expect(csv3[1]!.split(',')[head.indexOf('filled_taps')]).toBe('2');
    // 0.3.2: 채운 누름 가운데 누르는 동안 온 dblclick 규칙으로 채운 수(작업 지시서 4의 2-2). 채운 누름 바로 뒤 칸이다.
    expect(head.indexOf('filled_held_taps')).toBe(head.indexOf('filled_taps') + 1);
    expect(cells[head.indexOf('filled_held_taps')]).toBe('0');
    const csv4 = exportCsv([{ run: { ...r, filledTaps: 3, filledHeldTaps: 1 }, session, exam: examA }]).trim().split('\n');
    expect(csv4[1]!.split(',')[head.indexOf('filled_taps')]).toBe('3');
    expect(csv4[1]!.split(',')[head.indexOf('filled_held_taps')]).toBe('1');
    expect(head.indexOf('screens')).toBe(head.indexOf('filled_held_taps') + 1);
    expect(cells[0]).toBe('P01');
    expect(cells[head.indexOf('input_seconds')]).toBe('60.4');
    expect(cells[head.indexOf('residual_errors')]).toBe('1');
    expect(cells[head.indexOf('inputs_q30')]).toBe('1');
    expect(cells[head.indexOf('inputs_q1')]).toBe('0');
  });

  it('저장된 측정 기록의 시각이 날짜로 쓸 수 없는 값이어도 읽고 내보낼 수 있다', () => {
    const stored = parseStored(
      JSON.stringify({
        version: 1,
        sessions: [],
        testRuns: [
          {
            id: 'r1',
            participant: 'P01',
            inputMode: 'keypad',
            plannedExamId: 'sample-a',
            startedAt: 9e15,
            endedAt: 1e300,
            examId: 'sample-a',
            screens: [
              { screen: 'start', at: 1000 },
              { screen: 'exams', at: 9e15 },
            ],
            inputStartAt: 9e15,
            itemInputs: { 1: 2, x: 3, 0: 1 },
            // 옛 형식에는 parts 와 examReselects 가 없다. 망가진 parts 는 모양이 맞는 것만 남긴다.
            parts: { s9: { itemInputs: { 2: 1 }, marksMs: 'x', firstScoreAt: 5000 }, bad: 7 },
          },
        ],
      }),
    )!;
    const r = stored.testRuns[0]!;
    expect(r.startedAt).toBe(0);
    expect(r.endedAt).toBeNull();
    expect(r.inputStartAt).toBeNull();
    expect(r.screens).toEqual([{ screen: 'start', at: 1000 }]);
    expect(r.itemInputs).toEqual({ 1: 2 });
    expect(r.examReselects).toBe(0);
    expect(Object.keys(r.parts)).toEqual(['s9']);
    expect(r.parts.s9).toEqual({
      inputStartAt: null,
      firstInputAt: null,
      inputDoneAt: null,
      reviewConfirmAt: null,
      itemInputs: { 2: 1 },
      reviewFixed: [],
      marksMs: 0,
      firstScoreAt: 5000,
      finalAnswers: null,
    });
    const rows = [{ run: r, session: null, exam: examA }];
    expect(() => exportCsv(rows)).not.toThrow();
    expect(() => exportJson(rows, 0)).not.toThrow();
    // 읽지 못한 시작 시각은 1970년으로 적지 않고 비운다.
    const csvLines = exportCsv(rows).split('\n');
    const startedCol = csvLines[0]!.split(',').indexOf('started_at');
    expect(startedCol).toBeGreaterThan(0);
    expect(csvLines[1]!.split(',')[startedCol]).toBe('');
    expect(JSON.parse(exportJson(rows, 0)).runs[0].startedAtIso).toBe('');
    expect(JSON.parse(exportJson(rows, 0)).runs[0].startedAt).toBeNull();
    // 멀쩡한 시작 시각은 그대로 적는다.
    const fine = [{ run: { ...r, startedAt: Date.UTC(2026, 10, 22, 1, 2, 3) }, session: null, exam: examA }];
    expect(exportCsv(fine).split('\n')[1]!.split(',')[startedCol]).toBe('2026-11-22T01:02:03.000Z');
    expect(JSON.parse(exportJson(fine, 0)).runs[0].startedAtIso).toBe('2026-11-22T01:02:03.000Z');
    expect(JSON.parse(exportJson(fine, 0)).runs[0].startedAt).toBe(Date.UTC(2026, 10, 22, 1, 2, 3));
    // 날짜로 쓸 수 없는 시각이 그대로 들어와도 내보내기는 멈추지 않는다.
    const broken = [{ run: { ...r, startedAt: 9e15, screens: [{ screen: 'start', at: 9e15 }] }, session: null, exam: examA }];
    expect(() => exportCsv(broken)).not.toThrow();
    expect(() => exportJson(broken, 9e15)).not.toThrow();
  });

  it('답지를 넣지 않았으면 남은 오입력은 비워 둔다', () => {
    const m = runMetrics(run(), filled(), examA);
    expect(m.residualErrors).toBeNull();
    expect(m.inputSeconds).toBeNull();
    expect(m.selectToScoreSeconds).toBeNull();
  });
});

/** 앱의 다리처럼 보관(archive)을 받는 저장소. 받은 순서를 calls 에 남긴다. */
class ArchiveStorage implements StorageLike {
  calls: string[] = [];
  constructor(
    private text: string | null,
    private archiveSent = true,
  ) {}
  getItem(): string | null {
    return this.text;
  }
  setItem(_key: string, value: string): void {
    this.calls.push(`save:${value}`);
  }
  archive(): boolean {
    this.calls.push('archive');
    return this.archiveSent;
  }
}
const noListen = () => () => undefined;

describe('앱 저장소(다리): 읽지 못한 기록의 보관', () => {
  it('읽지 못한 기록은 보관을 먼저 요청하고, 보관 안내 표시를 남긴 새 기록을 곧바로 저장한다', () => {
    for (const text of ['{not json', JSON.stringify({ version: 2, sessions: [] }), JSON.stringify({ version: 0, sessions: [] }), '']) {
      const s = new ArchiveStorage(text);
      const store = new Store(s, noListen);
      expect(s.calls[0]).toBe('archive');
      expect(s.calls).toHaveLength(2);
      const saved = JSON.parse(s.calls[1]!.slice('save:'.length));
      expect(saved.archiveNotice).toBe(true);
      expect(saved.sessions).toEqual([]);
      expect(store.get().archiveNotice).toBe(true);
      expect(store.storageOk).toBe(true);
    }
  });

  it('읽을 수 있는 기록과 기록 없음(null)은 보관하지 않고 저장도 바로 하지 않는다', () => {
    const readable = new ArchiveStorage(JSON.stringify({ ...defaultData(), sessions: [filled()] }));
    expect(new Store(readable, noListen).get().sessions).toHaveLength(1);
    expect(readable.calls).toEqual([]);
    const none = new ArchiveStorage(null);
    expect(new Store(none, noListen).get()).toEqual(defaultData());
    expect(none.calls).toEqual([]);
  });

  it('보관 요청을 보내지 못하면 이 실행 동안 저장하지 않는다(읽지 못한 기록을 덮어쓰지 않는다)', () => {
    const s = new ArchiveStorage('{not json', false);
    const store = new Store(s, noListen);
    store.update((d) => ({ ...d, sessions: [filled()] }));
    expect(store.get().sessions).toHaveLength(1);
    expect(s.calls).toEqual(['archive']);
    expect(store.storageOk).toBe(false);
  });

  it('껍데기가 저장 실패를 알리면 storageOk 가 false 가 되고, 다음 저장을 보내면 다시 true 가 된다', () => {
    let notifyFailed: () => void = () => undefined;
    const s = new ArchiveStorage(null);
    const store = new Store(s, (fn) => {
      notifyFailed = fn;
      return () => undefined;
    });
    let changes = 0;
    store.subscribeStatus(() => {
      changes += 1;
    });
    notifyFailed();
    expect(store.storageOk).toBe(false);
    expect(store.getStatus()).toEqual({ ok: false });
    store.update((d) => ({ ...d, inputMode: 'rows' }));
    expect(store.storageOk).toBe(true);
    expect(changes).toBe(2);
  });

  it('보관 안내 표시는 기록에 남아 다시 읽어도 있고, true 가 아닌 값은 읽지 않는다', () => {
    expect(parseStored(JSON.stringify({ ...defaultData(), archiveNotice: true }))!.archiveNotice).toBe(true);
    expect(parseStored(JSON.stringify({ ...defaultData(), archiveNotice: 'yes' }))!.archiveNotice).toBeUndefined();
    expect('archiveNotice' in parseStored(JSON.stringify(defaultData()))!).toBe(false);
  });
});
