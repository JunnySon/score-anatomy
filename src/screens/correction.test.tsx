import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CorrectionNotice } from '../components/CorrectionNotice';
import { findExam } from '../exams';
import { validateExam } from '../exams/validate';
import { exampleAnswers, exampleCauses, exampleMarks } from '../logic/example';
import { gradeExam } from '../logic/scoring';
import { fillOldGradedRecords, type SessionHandle } from '../state/hooks';
import {
  acknowledgeCorrection,
  correctionNotice,
  correctionOf,
  currentRetry,
  fillGradedWith,
  markGraded,
  newSession,
  recordRetry,
  setAnswer,
} from '../state/session';
import { defaultData, parseStored, store } from '../state/store';
import { formatDate } from '../strings';
import type { AppData, Exam, ExamItem, Session } from '../types';
import { Anatomy } from './Anatomy';
import { Causes } from './Causes';
import { History } from './History';
import { Score } from './Score';
import { Steps } from './Steps';

// 정답 정정 알림(작업 지시서 3의 4-6)을 순수 함수와, 화면을 글자로 그려서(서버 렌더링) 확인한다.
// 지금 앱에는 시험을 바꿔 끼울 길이 없어서(넘겨받는 시험은 작업 지시서 3의 5부) 화면을 눌러 보는 확인은 2부에서 한다.
// 정정은 테스트 안에서 예시 시험 A의 사본(정답 판 번호를 올리고 정답을 바꾼 테스트 전용 자료)으로 만든다. 실제 시험의 값이 아니다.
// 기록 화면은 시험 목록에서 시험을 찾으므로, 찾는 함수를 바꿔 끼워 테스트가 넣은 판을 돌려주게 한다.

const swapped = vi.hoisted(() => new Map<string, Exam>());

vi.mock('../exams', async (importOriginal) => {
  const real = await importOriginal<typeof import('../exams')>();
  return { ...real, findExam: (id: string | null | undefined) => (id && swapped.has(id) ? swapped.get(id)! : real.findExam(id)) };
});

const examA = findExam('sample-a') as Exam;
const NOW = '2026-11-22T10:00:00.000Z';
/** 테스트 전용 정정 안내(정답 값을 적지 않는다). */
const NOTE = '테스트 전용 정정 안내예요.';

/** 예시 시험 A의 사본에 정답 판 번호를 올리고 문항을 고친다(테스트 전용 자료). 판 번호(rev)도 같이 올린다. */
function corrected(answersRev: number, changes: Record<number, Partial<ExamItem>>): Exam {
  const exam: Exam = {
    ...examA,
    rev: answersRev,
    answersRev,
    answersNote: NOTE,
    items: examA.items.map((it) => (changes[it.no] ? { ...it, ...changes[it.no] } : it)),
  };
  expect(validateExam(exam)).toEqual([]);
  return exam;
}

// 검산 예시(78점)에서: 15번(4점, 넣은 답 1)은 정답을 1로 고치면 맞고, 1번(2점, 넣은 답 3)은 정답을 4로 고치면 틀리고,
// 11번(3점, 넣은 답 4)은 정답을 3으로 고쳐도 여전히 틀린다.
const up = () => corrected(2, { 15: { answer: 1 } });
const down = () => corrected(2, { 1: { answer: 4 } });
const same = () => corrected(2, { 11: { answer: 3 } });

/** 예시 시험 A(정답 판 번호 1)로 채점한 기록. 검산 예시의 답, 표시, 원인이다. */
function graded(more: Partial<Session> = {}): Session {
  const s: Session = { ...newSession('sample-a', 'not_yet', null, NOW), answers: exampleAnswers(examA), marks: exampleMarks(), causes: exampleCauses(), ...more };
  return markGraded(s, examA, NOW);
}

/** 채점 흔적(gradedWith)이 없는 옛 채점 기록. 저장된 글자에서 읽는다. */
function oldRecord(): Session {
  const old: Session = { ...graded() };
  delete old.gradedWith;
  const data = parseStored(JSON.stringify({ version: 1, sessions: [old], currentId: old.id }))!;
  const s = data.sessions[0]!;
  expect('gradedWith' in s).toBe(false);
  return s;
}

/** 화면에 건네는 손잡이. update 는 상자 안의 기록을 바꾼다("확인했어요"를 눌렀을 때 무엇이 바뀌는지 본다). */
function handleOf(session: Session, exam: Exam, isDemo = false): { h: SessionHandle; box: { session: Session } } {
  const box = { session };
  const h: SessionHandle = {
    isDemo,
    session,
    exam,
    update: (fn) => {
      box.session = fn(box.session);
    },
    path: (p) => (isDemo ? `/demo${p}` : p),
  };
  return { h, box };
}

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 화면 부품을 그린 요소 나무(훅을 쓰는 부품도 부를 수 있게 그리는 중에 부른다). */
function treeOf(render: () => ReactElement): ReactElement {
  let out: ReactElement | null = null;
  function Probe() {
    out = render();
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return out!;
}

/** 요소 나무에서 정정 알림을 찾아 "확인했어요"가 부르는 함수를 꺼낸다. */
function ackOf(el: unknown): (() => void) | null {
  if (Array.isArray(el)) {
    for (const c of el) {
      const found = ackOf(c);
      if (found) return found;
    }
    return null;
  }
  if (!el || typeof el !== 'object') return null;
  const e = el as { type?: unknown; props?: { children?: unknown; onAck?: () => void } };
  if (e.type === CorrectionNotice && e.props?.onAck) return e.props.onAck;
  return ackOf(e.props?.children);
}

function scoreHtml(h: SessionHandle): string {
  return renderToStaticMarkup(<Score h={h} grade={gradeExam(h.exam, h.session)} />);
}

function anatomyHtml(h: SessionHandle): string {
  return renderToStaticMarkup(<Anatomy h={h} grade={gradeExam(h.exam, h.session)} />);
}

/** 알림의 글자(첫 줄, 다음 줄, 버튼). 알림이 없으면 null. */
function noticeText(html: string): string | null {
  const m = /<div class="msg msg--plain notice" data-testid="correction-notice">(.*?)<\/div>/.exec(html);
  return m ? text(m[1]!) : null;
}

/** 점수 화면과 점수 해부 화면에서 "확인했어요"를 누른 뒤의 기록. */
function ackOnScore(session: Session, exam: Exam): Session {
  const { h, box } = handleOf(session, exam);
  const ack = ackOf(treeOf(() => Score({ h, grade: gradeExam(exam, session) })));
  expect(ack).not.toBeNull();
  ack!();
  return box.session;
}

function ackOnAnatomy(session: Session, exam: Exam): Session {
  const { h, box } = handleOf(session, exam);
  const ack = ackOf(treeOf(() => Anatomy({ h, grade: gradeExam(exam, session) })));
  expect(ack).not.toBeNull();
  ack!();
  return box.session;
}

/** 기록 화면(지금 저장소의 기록)을 그린다. */
function historyHtml(): string {
  return renderToStaticMarkup(<History />);
}

beforeEach(() => {
  store.update(() => defaultData());
});

afterEach(() => {
  swapped.clear();
});

describe('정답 정정 알림(4-6)', () => {
  it('정정 전후로 answers 와 marks 가 한 글자도 바뀌지 않는다', () => {
    // 모두 정답 처리(20번, 찍음 표시가 붙은 오답)와 복수 정답(27번, 넣은 답 146 인정)으로 고친 판도 함께 본다.
    const exams = [up(), down(), same(), corrected(2, { 20: { allCorrect: true } }), corrected(2, { 27: { altAnswers: [146] } })];
    const before = graded({ answerViewed: { 27: true }, selfChecks: { 14: { result: 'solved', at: NOW } } });
    const answers = JSON.stringify(before.answers);
    const marks = JSON.stringify(before.marks);
    for (const exam of exams) {
      const grade = gradeExam(exam, before);
      // 채점 결과의 넣은 답과 표시도 기록 그대로다(모두 정답 처리 문항의 찍음 표시도 지우지 않는다).
      for (const it of grade.items) expect(it.response).toBe(before.answers[it.no]);
      expect(grade.items.find((it) => it.no === 20)!.mark).toBe('guess');
      expect(correctionNotice(correctionOf(before, exam, grade))).not.toBeNull();
      // 알림이 있는 화면을 그려도, "확인했어요"를 눌러도 바뀌는 것은 채점 흔적(gradedWith)뿐이다.
      scoreHtml(handleOf(before, exam).h);
      anatomyHtml(handleOf(before, exam).h);
      for (const after of [ackOnScore(before, exam), ackOnAnatomy(before, exam), acknowledgeCorrection(before, exam)]) {
        expect(JSON.stringify(after.answers)).toBe(answers);
        expect(JSON.stringify(after.marks)).toBe(marks);
        expect(after).toEqual({ ...before, gradedWith: { answersRev: 2, score: grade.actual } });
        // 저장했다가 다시 읽어도 같다.
        const reread = parseStored(JSON.stringify({ ...defaultData(), sessions: [after] }))!.sessions[0]!;
        expect(JSON.stringify(reread.answers)).toBe(answers);
        expect(JSON.stringify(reread.marks)).toBe(marks);
        expect(reread.gradedWith).toEqual({ answersRev: 2, score: grade.actual });
      }
      // 옛 기록 채우기와 다시 채점(답을 고친 뒤의 채점하기)도 답과 표시를 바꾸지 않는다.
      const filled = fillGradedWith({ ...defaultData(), sessions: [before] }, () => exam).sessions[0]!;
      expect(JSON.stringify(filled.answers)).toBe(answers);
      expect(JSON.stringify(filled.marks)).toBe(marks);
      const regraded = markGraded(before, exam, NOW);
      expect(JSON.stringify(regraded.answers)).toBe(answers);
      expect(JSON.stringify(regraded.marks)).toBe(marks);
    }
    expect(JSON.stringify(before.answers)).toBe(answers);
    expect(JSON.stringify(before.marks)).toBe(marks);
  });

  it('점수가 오르는 정정', () => {
    const s = graded();
    expect(s.gradedWith).toEqual({ answersRev: 1, score: 78 });
    const exam = up();
    expect(correctionOf(s, exam, gradeExam(exam, s))).toEqual({ kind: 'changed', from: 78, to: 82, note: NOTE });
    // 점수 화면: 지금 정답으로 계산한 점수를 보여 주고, 위쪽에 알림을 둔다. 다음 줄은 정정 안내 그대로다.
    const html = scoreHtml(handleOf(s, exam).h);
    expect(noticeText(html)).toBe(`정답이 정정돼서 다시 채점했어요. 78점에서 82점으로 바뀌었어요. ${NOTE} 확인했어요`);
    expect(html).toContain('data-testid="correction-text">정답이 정정돼서 다시 채점했어요. 78점에서 82점으로 바뀌었어요.</p>');
    expect(html).toContain(`data-testid="correction-note">${NOTE}</p>`);
    expect(html).toContain('data-testid="score">82점</p>');
    expect(text(html)).toContain('30문항 가운데 25문항을 맞혔어요.');
    // 알림은 화면 맨 위(시험 이름보다 앞)에 있고, 경고색이 아닌 중립 안내 모양이다.
    expect(html.indexOf('data-testid="correction-notice"')).toBeLessThan(html.indexOf('예시 시험 A'));
    expect(html).not.toMatch(/class="msg"/);
    // 점수 해부 화면에도 같은 알림이 위쪽에 있다.
    const an = anatomyHtml(handleOf(s, exam).h);
    expect(noticeText(an)).toBe(noticeText(html));
    expect(an.indexOf('data-testid="correction-notice"')).toBeLessThan(an.indexOf('data-testid="actual"'));
    expect(an).toContain('data-testid="actual">82점</p>');
    // "확인했어요"를 누르면 채점 흔적이 지금 값이 되고 알림이 닫힌다.
    const acked = ackOnScore(s, exam);
    expect(acked.gradedWith).toEqual({ answersRev: 2, score: 82 });
    expect(noticeText(scoreHtml(handleOf(acked, exam).h))).toBeNull();
    expect(noticeText(anatomyHtml(handleOf(acked, exam).h))).toBeNull();
    // 한 번 더 정정되면(정답 판 번호 3) 확인한 점수(82점)와 견준다.
    const again = corrected(3, { 15: { answer: 1 }, 29: { altAnswers: [275] } });
    expect(correctionOf(acked, again, gradeExam(again, acked))).toEqual({ kind: 'changed', from: 82, to: 86, note: NOTE });
  });

  it('점수가 내리는 정정', () => {
    const s = graded();
    const exam = down();
    expect(correctionOf(s, exam, gradeExam(exam, s))).toEqual({ kind: 'changed', from: 78, to: 76, note: NOTE });
    const html = scoreHtml(handleOf(s, exam).h);
    expect(noticeText(html)).toBe(`정답이 정정돼서 다시 채점했어요. 78점에서 76점으로 바뀌었어요. ${NOTE} 확인했어요`);
    expect(html).toContain('data-testid="score">76점</p>');
    expect(text(html)).toContain('30문항 가운데 23문항을 맞혔어요.');
    expect(noticeText(anatomyHtml(handleOf(s, exam).h))).toBe(noticeText(html));
    // 점수 해부 화면에서 "확인했어요"를 눌러도 같다.
    const acked = ackOnAnatomy(s, exam);
    expect(acked.gradedWith).toEqual({ answersRev: 2, score: 76 });
    expect(noticeText(anatomyHtml(handleOf(acked, exam).h))).toBeNull();
    expect(noticeText(scoreHtml(handleOf(acked, exam).h))).toBeNull();
  });

  it('점수가 그대로인 정정', () => {
    const s = graded();
    const exam = same();
    expect(correctionOf(s, exam, gradeExam(exam, s))).toEqual({ kind: 'same', score: 78, note: NOTE });
    const html = scoreHtml(handleOf(s, exam).h);
    expect(noticeText(html)).toBe(`정답이 정정됐지만 점수는 78점 그대로예요. ${NOTE} 확인했어요`);
    expect(html).toContain('data-testid="score">78점</p>');
    expect(text(html)).not.toContain('바뀌었어요');
    expect(noticeText(anatomyHtml(handleOf(s, exam).h))).toBe(noticeText(html));
    const acked = ackOnScore(s, exam);
    expect(acked.gradedWith).toEqual({ answersRev: 2, score: 78 });
    expect(noticeText(scoreHtml(handleOf(acked, exam).h))).toBeNull();
  });

  it('확인 전에는 기록 화면에 정정 표시가 붙고 확인한 뒤에는 없다', () => {
    const s = graded();
    store.update((d) => ({ ...d, sessions: [s] }));
    const date = formatDate(NOW);
    // 정정 전(예시 시험 A 그대로): 표시가 없다.
    let html = historyHtml();
    expect(html).not.toContain('history-corrected');
    expect(html).toContain(`aria-label="예시 시험 A 기록 열기, ${date}, 78점"`);
    // 정답이 정정된 판을 받으면: 지금 정답으로 계산한 점수 옆에 표시가 붙고, 열기 버튼의 이름에도 들어간다.
    const exam = up();
    swapped.set('sample-a', exam);
    html = historyHtml();
    expect(html).toContain('data-testid="history-corrected">정답 정정으로 다시 채점됨</span>');
    expect(html).toContain(`aria-label="예시 시험 A 기록 열기, ${date}, 82점, 정답 정정으로 다시 채점됨"`);
    // 기록을 구분하는 글자와 지우기 버튼의 이름은 그대로다.
    expect(html).toContain(`aria-label="예시 시험 A 기록 지우기, ${date}, 82점"`);
    expect(html).toContain(`<span class="sub">${date}, 82점</span>`);
    // 점수 화면의 "확인했어요"를 누르면(저장소의 기록을 바꾼다) 표시가 없어진다.
    const h: SessionHandle = {
      isDemo: false,
      session: store.get().sessions[0]!,
      exam,
      update: (fn) => store.update((d) => ({ ...d, sessions: d.sessions.map((x) => (x.id === s.id ? fn(x) : x)) })),
      path: (p) => p,
    };
    const ack = ackOf(treeOf(() => Score({ h, grade: gradeExam(exam, h.session) })));
    ack!();
    expect(store.get().sessions[0]!.gradedWith).toEqual({ answersRev: 2, score: 82 });
    html = historyHtml();
    expect(html).not.toContain('history-corrected');
    expect(text(html)).not.toContain('정답 정정');
    expect(html).toContain(`aria-label="예시 시험 A 기록 열기, ${date}, 82점"`);
  });

  it('옛 기록: answersRev 가 1이면 조용히 채운다', () => {
    const old = oldRecord();
    // 채우기 전에도 알림과 기록 화면의 표시는 없다.
    expect(correctionOf(old, examA, gradeExam(examA, old))).toEqual({ kind: 'fill' });
    expect(correctionNotice({ kind: 'fill' })).toBeNull();
    expect(noticeText(scoreHtml(handleOf(old, examA).h))).toBeNull();
    expect(noticeText(anatomyHtml(handleOf(old, examA).h))).toBeNull();
    // 앱이 시작할 때 저장소의 옛 기록에 지금 값(정답 판 번호 1, 지금 점수)을 채운다. 다른 칸은 그대로다.
    const typing = { ...newSession('sample-a', 'not_yet', null, NOW), id: 'typing', answers: { 1: 3 } };
    // 답을 다 넣었지만 아직 채점하지 않은 기록과, 채점한 뒤 답을 고쳐 다시 채점해야 하는 기록도 채우지 않는다.
    const review = { ...newSession('sample-a', 'not_yet', null, NOW), id: 'review', answers: exampleAnswers(examA) };
    const edited = { ...setAnswer(old, 1, 4), id: 'edited' };
    expect(edited.gradedAt).toBeNull();
    store.update((d) => ({ ...d, sessions: [old, typing, review, edited], currentId: old.id }));
    let saves = 0;
    const stop = store.subscribe(() => {
      saves += 1;
    });
    expect(historyHtml()).not.toContain('history-corrected');
    fillOldGradedRecords();
    expect(saves).toBe(1);
    const [filled, ...rest] = store.get().sessions;
    expect(filled).toEqual({ ...old, gradedWith: { answersRev: 1, score: 78 } });
    // 채점된 기록이 아니면(입력 중, 채점 전, 다시 채점해야 함) 채우지 않는다.
    expect(rest).toEqual([typing, review, edited]);
    for (const [i, s] of rest.entries()) expect(s).toBe([typing, review, edited][i]);
    // 채울 것이 없으면 기록을 바꾸지 않아서 저장하지 않는다.
    fillOldGradedRecords();
    expect(saves).toBe(1);
    stop();
    const data: AppData = store.get();
    expect(fillGradedWith(data, findExam)).toBe(data);
    // 그 뒤에 정답이 정정되면 채운 점수와 견준다.
    const exam = up();
    expect(correctionOf(filled!, exam, gradeExam(exam, filled!))).toEqual({ kind: 'changed', from: 78, to: 82, note: NOTE });
  });

  it('옛 기록: answersRev 가 2 이상이면 지금 정답으로 채점했다고 알린다', () => {
    const old = oldRecord();
    const exam = up();
    // 예전 점수를 알 수 없어서 채우지 않는다.
    const data: AppData = { ...defaultData(), sessions: [old] };
    expect(fillGradedWith(data, () => exam)).toBe(data);
    expect(correctionOf(old, exam, gradeExam(exam, old))).toEqual({ kind: 'noPrevious', note: NOTE });
    const html = scoreHtml(handleOf(old, exam).h);
    expect(noticeText(html)).toBe(`정답이 정정돼서 지금 정답으로 채점했어요. ${NOTE} 확인했어요`);
    expect(html).toContain('data-testid="score">82점</p>');
    expect(text(html)).not.toContain('78점');
    expect(noticeText(anatomyHtml(handleOf(old, exam).h))).toBe(noticeText(html));
    // 기록 화면에도 표시가 붙는다.
    swapped.set('sample-a', exam);
    store.update((d) => ({ ...d, sessions: [old] }));
    fillOldGradedRecords();
    expect('gradedWith' in store.get().sessions[0]!).toBe(false);
    expect(historyHtml()).toContain('data-testid="history-corrected"');
    // "확인했어요"를 누르면 지금 값을 채우고 알림과 표시가 없어진다.
    const acked = ackOnScore(old, exam);
    expect(acked).toEqual({ ...old, gradedWith: { answersRev: 2, score: 82 } });
    expect(noticeText(scoreHtml(handleOf(acked, exam).h))).toBeNull();
    store.update((d) => ({ ...d, sessions: [acked] }));
    expect(historyHtml()).not.toContain('history-corrected');
  });

  it('정정 뒤 오답 원인 화면과 계단이 지금 정답 기준으로 나온다', () => {
    // 15번(원인 "풀 줄 아는데 틀렸어요", 재풀이 기록 있음)은 정정으로 맞게 되고, 1번(정답이던 문항)은 정정으로 틀리게 된다. 78점에서 80점.
    const exam = corrected(2, { 15: { answer: 1 }, 1: { answer: 4 } });
    const s = graded({
      retries: {
        15: { correct: false, attempts: 1, firstCorrectAttempt: null, answerKnown: false, at: NOW },
        20: { correct: true, attempts: 3, firstCorrectAttempt: 3, answerKnown: false, at: NOW },
      },
      selfChecks: { 14: { result: 'solved', at: NOW } },
    });
    const grade = gradeExam(exam, s);
    expect(grade.actual).toBe(80);
    expect(grade.wrong.map((w) => w.no)).toEqual([1, 11, 20, 21, 27, 29]);
    const { h } = handleOf(s, exam);

    // 오답 원인 화면: 정정으로 맞게 된 15번은 없고, 정정으로 틀리게 된 1번은 원인을 고르기 전 상태(고른 것 없음, 정답은 정답 보기를 눌러야 보임)로 나온다.
    const causes = renderToStaticMarkup(<Causes h={h} grade={grade} />);
    expect(causes).not.toContain('data-testid="wrong-15"');
    expect([...causes.matchAll(/data-testid="wrong-(\d+)"/g)].map((m) => Number(m[1]))).toEqual([1, 11, 20, 21, 27, 29]);
    for (const c of ['slip', 'blank', 'unknown']) expect(causes).toMatch(new RegExp(`aria-checked="false"[^>]*data-testid="cause-1-${c}"`));
    expect(causes).toContain('data-testid="show-answer-1"');
    expect(causes).not.toContain('data-testid="answer-1"');
    expect(causes).toMatch(/aria-checked="true"[^>]*data-testid="cause-29-slip"/);
    // 건너뛰기가 다시 나온다(원인을 고르지 않은 문항이 생겼다).
    expect(text(causes)).toContain('건너뛰기');

    // 점수 해부: 실수라고 표시한 오답은 지금 틀린 문항(29번)만 센다.
    const an = text(anatomyHtml(h));
    expect(an).toContain('실수라고 표시한 오답 4점 80점에는 들어 있지 않아요');
    expect(an).toContain('틀린 20점 가운데 4점은 실수라고 표시했어요.');
    expect(an).toContain('원인을 표시하지 않은 문항이 1개 있어요');

    // 계단: 지금 정답으로 다시 셈한다(정정 전에는 적분, 수열, 확률의 3가지).
    const before = renderToStaticMarkup(<Steps h={handleOf(s, examA).h} grade={gradeExam(examA, s)} />);
    expect([...before.matchAll(/data-testid="step-\d" data-type="(t\d+)"/g)].map((m) => m[1])).toEqual(['t06', 't03', 't08']);
    expect(text(before)).toContain('20번: 3번째로 넣은 답이 맞음');
    const steps = renderToStaticMarkup(<Steps h={h} grade={grade} />);
    expect(text(steps)).toContain('먼저 고칠 2가지');
    expect([...steps.matchAll(/data-testid="step-\d" data-type="(t\d+)"/g)].map((m) => m[1])).toEqual(['t06', 't08']);
    // 정정 전의 판에서 남긴 재풀이 기록(20번)은 그때의 정답으로 맞춰 본 것이라 보여 주지 않는다. 스스로 확인한 기록(14번)은 그대로다.
    expect(text(steps)).not.toContain('20번:');
    expect(text(steps)).toContain('14번: 찍음 표시 정답, 끝까지 풀었다고 표시함');
    expect(currentRetry(s, 20, exam)).toBeNull();
    // 지금 판에서 다시 풀면 새로 센다(정정 전의 3번째를 잇지 않는다).
    const retried = recordRetry(s, 20, true, false, NOW, 2);
    expect(retried.retries[20]).toEqual({ correct: true, attempts: 1, firstCorrectAttempt: 1, answerKnown: false, at: NOW, answersRev: 2 });
    expect(text(renderToStaticMarkup(<Steps h={handleOf(retried, exam).h} grade={gradeExam(exam, retried)} />))).toContain('20번: 다시 풀어 맞힘');

    // 정정으로 맞게 된 문항의 원인과 재풀이 기록은 기록에서 지우지 않는다(화면에서만 빠진다). 다시 채점해도, 확인해도 그대로다.
    for (const kept of [s, markGraded(s, exam, NOW), acknowledgeCorrection(s, exam)]) {
      expect(kept.causes).toEqual(exampleCauses());
      expect(kept.retries[15]).toEqual(s.retries[15]);
      expect(kept.retries[20]).toEqual(s.retries[20]);
    }
    // 답을 고치면 그 문항의 원인과 재풀이 기록은 지금처럼 지운다(결정기록 2장 29번).
    expect(setAnswer(s, 15, 2).causes[15]).toBeUndefined();
  });
});

describe('정답 정정 알림의 세부(4-6)', () => {
  it('정답 판 번호가 채점 흔적과 같거나 작으면, 또는 다시 채점해야 하는 기록이면 알리지 않는다', () => {
    const s = graded();
    const g = gradeExam(examA, s);
    expect(correctionOf(s, examA, g)).toEqual({ kind: 'none' });
    // 정답 판 번호 2로 채점한 기록이 정답 판 번호 1의 판(묶음 안 시험 등)으로 열려도 알리지 않는다.
    const exam = up();
    const at2 = markGraded(s, exam, NOW);
    expect(at2.gradedWith).toEqual({ answersRev: 2, score: 82 });
    expect(correctionOf(at2, exam, gradeExam(exam, at2))).toEqual({ kind: 'none' });
    expect(correctionOf(at2, examA, gradeExam(examA, at2))).toEqual({ kind: 'none' });
    // 채점한 뒤 답을 고쳐 채점 시각이 빈 기록은 점수를 보여 주지 않으므로 알리지 않고, 다시 채점하면 지금 값이 적힌다.
    const edited = setAnswer(s, 1, 4);
    expect(edited.gradedAt).toBeNull();
    expect(correctionOf(edited, exam, gradeExam(exam, edited))).toEqual({ kind: 'none' });
    expect(markGraded(edited, exam, NOW).gradedWith).toEqual({ answersRev: 2, score: 80 });
    // 지금 채점할 수 없으면(미입력) "확인했어요"도 기록을 바꾸지 않는다. 바꿀 것이 없어도 같은 기록이다.
    const missing = setAnswer(s, 1, undefined);
    expect(acknowledgeCorrection(missing, exam)).toBe(missing);
    expect(acknowledgeCorrection(s, examA)).toBe(s);
  });

  it('예시 결과에는 알림을 보여 주지 않는다', () => {
    const exam = up();
    const old = oldRecord();
    for (const s of [graded(), old]) {
      expect(noticeText(scoreHtml(handleOf(s, exam, true).h))).toBeNull();
      expect(noticeText(anatomyHtml(handleOf(s, exam, true).h))).toBeNull();
    }
  });

  it('재풀이 화면은 맞춰 본 기록에 지금 정답 판 번호를 적고, 지금 판의 기록만 결과로 보여 준다', () => {
    // 재풀이 화면은 서버 그리기로 답을 넣어 볼 수 없어서 소스를 읽어 확인한다(src/logic/scoring.test.ts 의 맞춰 보기 확인과 같은 방식).
    const src = readFileSync(resolve(process.cwd(), 'src/screens/Retry.tsx'), 'utf8');
    expect(src).toContain('recordRetry(s, no, correct, answerKnown, new Date().toISOString(), answersRevOf(exam))');
    expect(src).toContain('currentRetry(session, no, exam)');
    expect(src).not.toMatch(/session\.retries\[/);
  });

  it('알림이 닫히면 화면의 연달아 누르기 보호 열쇠(guardKey)가 바뀐다', () => {
    const s = graded();
    const exam = up();
    const guardOf = (session: Session, which: 'score' | 'anatomy') => {
      const { h } = handleOf(session, exam);
      const grade = gradeExam(exam, session);
      const tree = treeOf(() => (which === 'score' ? Score({ h, grade }) : Anatomy({ h, grade })));
      return (tree.props as { guardKey?: string }).guardKey;
    };
    const acked = acknowledgeCorrection(s, exam);
    for (const which of ['score', 'anatomy'] as const) {
      expect(guardOf(s, which)).toBe('correction');
      expect(guardOf(acked, which)).toBe('plain');
    }
  });
});
