import { describe, expect, it } from 'vitest';
import { findExam } from '../exams';
import { exampleAnswers, exampleCauses, exampleMarks } from '../logic/example';
import { GradeError } from '../logic/scoring';
import type { Exam, Session, TestRun } from '../types';
import {
  clearMarks,
  cycleMark,
  isMarkedAfterGrading,
  markGraded,
  markSaved,
  newSession,
  recordRetry,
  resumePath,
  setAnswer,
  setCause,
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

  it('"없어요"는 표시를 모두 지운다. 채점한 뒤에 지웠으면 그것도 적어 둔다', () => {
    let s = cycleMark(cycleMark(filled(), 9), 14);
    expect(clearMarks(s).marks).toEqual({});
    expect(clearMarks(s).marksEditedAfterGrading).toBe(false);
    const none = filled();
    expect(clearMarks(none)).toBe(none);
    s = markGraded(s, examA, NOW);
    expect(clearMarks(s).marksEditedAfterGrading).toBe(true);
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
    expect(head.slice(0, 5)).toEqual(['participant', 'input_mode', 'planned_exam', 'exam', 'started_at']);
    expect(head).toHaveLength(13 + 30);
    expect(cells[0]).toBe('P01');
    expect(cells[head.indexOf('input_seconds')]).toBe('60.4');
    expect(cells[head.indexOf('residual_errors')]).toBe('1');
    expect(cells[head.indexOf('inputs_q30')]).toBe('1');
    expect(cells[head.indexOf('inputs_q1')]).toBe('0');
  });

  it('답지를 넣지 않았으면 남은 오입력은 비워 둔다', () => {
    const m = runMetrics(run(), filled(), examA);
    expect(m.residualErrors).toBeNull();
    expect(m.inputSeconds).toBeNull();
    expect(m.selectToScoreSeconds).toBeNull();
  });
});
