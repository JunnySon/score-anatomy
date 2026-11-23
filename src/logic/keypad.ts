import { choicesOf } from '../exams/validate';
import type { Answers, AnswerValue, ExamItem } from '../types';
import { entryValue, eraseDigit, initEntry, pressDigit, type DigitEntry } from './entry';
import { isAnswered } from './scoring';

// 키패드 방식 답 입력의 규칙(작업 지시서 1의 3-2, 3-3). 화면 코드와 떼어 둔 순수 함수다.
//
// 앱이 커서를 스스로 옮기는 곳은 "빈칸인 바로 다음 번호"와 "입력 확인 화면"뿐이다.
// 그 밖의 이동은 학생이 번호가 적힌 버튼이나 칸을 직접 눌러서 한다.
//
// 용어
// - 빈칸: 답이 없는 문항. "안 풂"은 빈칸이 아니다.
// - 들어온 길(via): 지금 문항에 어떻게 들어왔는지.
//   continue(이어서): 답을 넣어 저절로 넘어왔거나, "이어서 넣기" 버튼으로 왔거나, 지우기로 앞 번호에 왔거나, 화면을 처음 열었을 때.
//   blank(빈칸 누름): 학생이 빈칸을 직접 눌러 들어왔다.
//   fix(고치기): 학생이 답이 든 칸을 직접 눌러 들어왔거나 "M번도 고치기" 버튼으로 들어왔다. 들어온 뒤 그 칸을 지워도 그대로다.
//
// 답을 넣은 뒤(5지선다 답 키, "안 풂", 단답형 "다음"으로 확정) 갈 곳은 위에서부터 처음 맞는 것 하나다.
// 가. 빈칸이 하나도 없거나 방금 넣은 문항이 마지막 문항이면 입력 확인으로 넘어간다.
// 나. 들어온 길이 고치기가 아니고 바로 다음 번호가 빈칸이면 다음 번호로 간다(들어온 길은 이어서).
// 다. 그 밖에는 그 칸에 머물고 키패드를 잠근다.

export type Via = 'continue' | 'blank' | 'fix';

/** 잠김. put: 답을 넣고 그 칸에 머물러서 잠김. full: 화면을 열었을 때 빈칸이 없어서 잠김. */
export type Lock = 'put' | 'full' | null;

/** 키패드 위 안내문 자리에 잠깐 띄우는 안내. */
export type Notice =
  | { kind: 'erased'; no: number }
  | { kind: 'nothingToErase' }
  | { kind: 'shortRange' }
  | { kind: 'empty'; no: number }
  | { kind: 'notCommitted'; no: number };

export interface KeypadState {
  /** 지금 문항의 순번(0부터). */
  cursor: number;
  via: Via;
  lock: Lock;
  /** 단답형에서 누르고 있는 숫자(확정 전). null이면 큰 칸에 저장된 답을 보여 준다. */
  draft: DigitEntry | null;
  notice: Notice | null;
}

export type KeyEvent =
  /** 칸을 누름. */
  | { type: 'cell'; index: number }
  /** 5지선다 답 키. */
  | { type: 'choice'; value: number }
  /** "안 풂". */
  | { type: 'skip' }
  /** 단답형 숫자 키. */
  | { type: 'digit'; digit: number }
  /** 단답형 "다음". */
  | { type: 'go' }
  /** "지우기". */
  | { type: 'erase' }
  /** 잠금 안내의 "M번도 고치기". */
  | { type: 'fixNext' }
  /** "K번부터 이어서 넣기". */
  | { type: 'continue' };

export interface Outcome {
  state: KeypadState;
  /** 저장할 답. value가 undefined면 그 문항의 답을 지운다. */
  store: { no: number; value: AnswerValue | undefined } | null;
  /** 입력 확인 화면으로 넘어간다. */
  toReview: boolean;
  /** 받아들인 누름인지. 잠긴 키와 지금 누를 수 없는 버튼은 false(아무것도 바뀌지 않는다). */
  accepted: boolean;
}

/** 키패드 위 안내문 자리에 보여 줄 것. */
export interface Panel {
  /** 안내문. */
  text:
    | { kind: 'locked'; no: number }
    | { kind: 'noBlank' }
    | { kind: 'fixing'; no: number }
    | Notice
    | null;
  /** "M번도 고치기"의 M(문항 번호). 없으면 null. */
  fixNext: number | null;
  /** "K번부터 이어서 넣기"의 K(문항 번호). 없으면 null. */
  continueAt: number | null;
}

function filled(items: ExamItem[], answers: Answers, index: number): boolean {
  const it = items[index];
  return it !== undefined && isAnswered(it, answers[it.no]);
}

/** 첫 빈칸의 순번. 없으면 -1. */
export function firstBlank(items: ExamItem[], answers: Answers): number {
  return items.findIndex((it) => !isAnswered(it, answers[it.no]));
}

/** from보다 뒤에 있는 빈칸 가운데 가장 가까운 것, 없으면 가장 앞의 빈칸. 빈칸이 없으면 -1. */
export function nextBlankAfter(items: ExamItem[], answers: Answers, from: number): number {
  for (let i = from + 1; i < items.length; i += 1) if (!filled(items, answers, i)) return i;
  return firstBlank(items, answers);
}

/** 화면을 열었을 때. 빈칸이 있으면 첫 빈칸에서 시작하고, 없으면 잠근 채로 시작한다. */
export function initKeypad(items: ExamItem[], answers: Answers): KeypadState {
  const i = firstBlank(items, answers);
  if (i < 0) return { cursor: Math.max(0, items.length - 1), via: 'continue', lock: 'full', draft: null, notice: null };
  return { cursor: i, via: 'continue', lock: null, draft: null, notice: null };
}

/** 큰 칸의 숫자(단답형). 누르고 있는 숫자가 없으면 저장된 답을 불러온다. */
export function entryOf(state: KeypadState, items: ExamItem[], answers: Answers): DigitEntry {
  const it = items[state.cursor];
  if (state.draft) return state.draft;
  return initEntry(it ? answers[it.no] : undefined);
}

/** 큰 번호 위의 이름. 잠긴 동안 "지금 넣을 문항"이라고 하면 키를 받지 않는다는 안내와 어긋나서 상태마다 다르게 적는다. */
export type NowLabel = 'now' | 'fixing' | 'put' | 'noBlank';

export function nowLabelOf(state: KeypadState): NowLabel {
  if (state.lock === 'full') return 'noBlank';
  if (state.lock === 'put') return 'put';
  if (state.via === 'fix') return 'fixing';
  return 'now';
}

/** 키가 잠겼는지. 답 키, 안 풂, 숫자 키, "다음"은 잠금마다, "지우기"는 빈칸 없이 연 잠금에서만 잠긴다. */
export function keysLocked(state: KeypadState): { answer: boolean; erase: boolean } {
  return { answer: state.lock !== null, erase: state.lock === 'full' };
}

/** 누르고 있는 숫자가 들어 있는 답과 다른지. 다르면 "다음"을 누르지 않고 떠날 때 알린다. */
export function isDirty(state: KeypadState, items: ExamItem[], answers: Answers): boolean {
  const it = items[state.cursor];
  if (!it || state.draft === null) return false;
  return state.draft.text !== initEntry(answers[it.no]).text;
}

export function panelOf(state: KeypadState, items: ExamItem[], answers: Answers): Panel {
  const it = items[state.cursor];
  if (!it) return { text: null, fixNext: null, continueAt: null };
  if (state.lock === 'full') return { text: { kind: 'noBlank' }, fixNext: null, continueAt: null };
  const k = nextBlankAfter(items, answers, state.cursor);
  const continueAt = k >= 0 && k !== state.cursor ? items[k]!.no : null;
  if (state.lock === 'put') {
    const next = items[state.cursor + 1];
    const fixNext = next && isAnswered(next, answers[next.no]) ? next.no : null;
    return { text: { kind: 'locked', no: it.no }, fixNext, continueAt };
  }
  if (state.via === 'fix') return { text: state.notice ?? { kind: 'fixing', no: it.no }, fixNext: null, continueAt };
  return { text: state.notice, fixNext: null, continueAt: null };
}

function withAnswer(answers: Answers, no: number, value: AnswerValue | undefined): Answers {
  const next = { ...answers };
  if (value === undefined) delete next[no];
  else next[no] = value;
  return next;
}

const keep = (state: KeypadState): Outcome => ({ state, store: null, toReview: false, accepted: true });
const ignore = (state: KeypadState): Outcome => ({ state, store: null, toReview: false, accepted: false });

/** 지금 문항에 답을 넣고 갈 곳을 정한다(가, 나, 다). */
function put(state: KeypadState, items: ExamItem[], answers: Answers, value: AnswerValue): Outcome {
  const it = items[state.cursor]!;
  const store = { no: it.no, value };
  const after = withAnswer(answers, it.no, value);
  const base: KeypadState = { ...state, draft: null, notice: null, lock: null };
  // 가. 빈칸이 없거나 마지막 문항이면 입력 확인으로.
  if (firstBlank(items, after) < 0 || state.cursor >= items.length - 1) return { state: base, store, toReview: true, accepted: true };
  // 나. 고치기로 들어온 것이 아니고 바로 다음 번호가 빈칸이면 다음 번호로.
  if (state.via !== 'fix' && !filled(items, after, state.cursor + 1)) {
    return { state: { ...base, cursor: state.cursor + 1, via: 'continue' }, store, toReview: false, accepted: true };
  }
  // 다. 그 칸에 머물고 잠근다.
  return { state: { ...base, lock: 'put' }, store, toReview: false, accepted: true };
}

/** 칸이나 버튼을 눌러 index 문항으로 간다. 확정하지 않은 숫자는 버리고 알린다. */
function moveTo(state: KeypadState, items: ExamItem[], answers: Answers, index: number, via: Via): KeypadState {
  const it = items[state.cursor];
  const notice: Notice | null = isDirty(state, items, answers) && it ? { kind: 'notCommitted', no: it.no } : null;
  return { cursor: index, via, lock: null, draft: null, notice };
}

export function reduceKeypad(state: KeypadState, items: ExamItem[], answers: Answers, event: KeyEvent): Outcome {
  const it = items[state.cursor];
  if (!it) return ignore(state);
  const locked = state.lock !== null;

  switch (event.type) {
    case 'cell': {
      if (!items[event.index]) return ignore(state);
      const via: Via = filled(items, answers, event.index) ? 'fix' : 'blank';
      if (event.index === state.cursor) {
        // 잠긴 칸을 다시 누르면 풀고 그 칸을 고친다. 잠기지 않았으면 아무것도 바꾸지 않는다.
        return locked ? keep({ ...state, via, lock: null, draft: null, notice: null }) : keep(state);
      }
      return keep(moveTo(state, items, answers, event.index, via));
    }

    case 'choice':
      if (locked || it.kind !== 'mc' || event.value < 1 || event.value > choicesOf(it)) return ignore(state);
      return put(state, items, answers, event.value);

    case 'skip':
      if (locked) return ignore(state);
      return put(state, items, answers, 'skip');

    case 'digit': {
      if (locked || it.kind !== 'short') return ignore(state);
      const r = pressDigit(entryOf(state, items, answers), event.digit);
      if (r.overflow) return keep({ ...state, notice: { kind: 'shortRange' } });
      return keep({ ...state, draft: r.entry, notice: null });
    }

    case 'go': {
      if (locked || it.kind !== 'short') return ignore(state);
      const existing = answers[it.no];
      const has = isAnswered(it, existing);
      if (state.draft === null) {
        // 숫자를 하나도 누르지 않았으면 들어 있던 답(숫자나 안 풂)을 그대로 넣은 것으로 본다. 빈칸이면 머물고 알린다.
        if (has) return put(state, items, answers, existing as AnswerValue);
        return keep({ ...state, notice: { kind: 'empty', no: it.no } });
      }
      const v = entryValue(state.draft);
      if (v !== null) return put(state, items, answers, v);
      // 칸에 "안 풂"이 보이는 채로 누르면 안 풂을 그대로 넣은 것으로 본다.
      if (existing === 'skip') return put(state, items, answers, 'skip');
      // 숫자를 다 지우고 "다음"을 누르면 들어 있던 답을 지운다(빈 칸을 확정). 그래야 안내문이 사실과 맞다.
      const notice: Notice = { kind: 'empty', no: it.no };
      if (has) return { state: { ...state, draft: null, notice }, store: { no: it.no, value: undefined }, toReview: false, accepted: true };
      return keep({ ...state, draft: null, notice });
    }

    case 'erase': {
      // 빈칸 없이 연 화면의 잠금에서는 "지우기"도 받지 않는다. 학생이 고른 칸이 없는데 지우면
      // 고르지 않은 마지막 문항부터 지워지고, 이어 누르면 앞 번호가 차례로 지워진다. 칸을 눌러야 풀린다.
      if (state.lock === 'full') return ignore(state);
      if (locked) {
        // 잠금에서 "지우기"는 그 칸의 답을 지우고 푼다(단답형도 한 번에 지운다).
        if (!filled(items, answers, state.cursor)) return keep({ ...state, lock: null, notice: { kind: 'nothingToErase' } });
        return {
          state: { ...state, lock: null, draft: null, notice: { kind: 'erased', no: it.no } },
          store: { no: it.no, value: undefined },
          toReview: false,
          accepted: true,
        };
      }
      // 단답형: 큰 칸에 숫자가 보이면(방금 누른 숫자든 불러온 답이든) 한 자리씩 지운다. 저장된 답은 그대로다.
      if (it.kind === 'short') {
        const entry = entryOf(state, items, answers);
        if (entry.text !== '') return keep({ ...state, draft: eraseDigit(entry), notice: null });
      }
      // 지금 칸에 답(안 풂 포함)이 있으면 지우고 머문다.
      if (filled(items, answers, state.cursor)) {
        return {
          state: { ...state, draft: null, notice: { kind: 'erased', no: it.no } },
          store: { no: it.no, value: undefined },
          toReview: false,
          accepted: true,
        };
      }
      // 지금 칸이 빈칸: 이어서 들어왔으면 앞 번호로 가서 그 답을 지운다(방금 넣은 답을 바로 지우는 길이다).
      if (state.via === 'continue' && state.cursor > 0) {
        const prev = items[state.cursor - 1]!;
        const had = isAnswered(prev, answers[prev.no]);
        const next: KeypadState = { cursor: state.cursor - 1, via: 'continue', lock: null, draft: null, notice: had ? { kind: 'erased', no: prev.no } : null };
        return { state: next, store: had ? { no: prev.no, value: undefined } : null, toReview: false, accepted: true };
      }
      // 빈칸을 눌러 들어왔거나 고치기로 들어왔으면 다른 문항을 지우지 않는다.
      return keep({ ...state, draft: null, notice: { kind: 'nothingToErase' } });
    }

    case 'fixNext': {
      const p = panelOf(state, items, answers);
      if (p.fixNext === null) return ignore(state);
      return keep(moveTo(state, items, answers, state.cursor + 1, 'fix'));
    }

    case 'continue': {
      const p = panelOf(state, items, answers);
      if (p.continueAt === null) return ignore(state);
      const k = items.findIndex((x) => x.no === p.continueAt);
      return keep(moveTo(state, items, answers, k, 'continue'));
    }

    default:
      return ignore(state);
  }
}
