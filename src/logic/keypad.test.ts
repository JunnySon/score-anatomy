import { describe, expect, it } from 'vitest';
import { findExam } from '../exams';
import type { Answers, AnswerValue, Exam } from '../types';
import { exampleAnswers } from './example';
import { initKeypad, keysLocked, nowLabelOf, panelOf, reduceKeypad, type KeyEvent, type KeypadState, type Outcome } from './keypad';

// 키패드 방식 답 입력의 규칙(작업 지시서 1의 3-2, 3-3). 화면 없이 규칙 함수만 돌린다.

const examA = findExam('sample-a') as Exam;
const items = examA.items;
const ANSWERS = exampleAnswers(examA);
const idx = (no: number) => items.findIndex((it) => it.no === no);
const noAt = (index: number) => items[index]!.no;

/** 화면 없이 규칙만 돌리는 키패드. 저장한 답과 입력 확인으로 넘어간 것을 기록한다. */
class Pad {
  answers: Answers;
  state: KeypadState;
  reviewed = false;
  last: Outcome | null = null;

  constructor(answers: Answers = {}, state?: KeypadState) {
    this.answers = { ...answers };
    this.state = state ?? initKeypad(items, this.answers);
  }

  press(e: KeyEvent): Outcome | null {
    // 입력 확인으로 넘어간 뒤의 누름은 키패드에 닿지 않는다(화면이 바뀌었다).
    if (this.reviewed) return null;
    const out = reduceKeypad(this.state, items, this.answers, e);
    this.last = out;
    if (!out.accepted) return out;
    if (out.store) {
      if (out.store.value === undefined) delete this.answers[out.store.no];
      else this.answers[out.store.no] = out.store.value;
    }
    if (out.toReview) this.reviewed = true;
    this.state = out.state;
    return out;
  }

  tap(no: number) {
    return this.press({ type: 'cell', index: idx(no) });
  }
  key(v: number) {
    return this.press({ type: 'choice', value: v });
  }
  erase() {
    return this.press({ type: 'erase' });
  }
  /** 단답형: 숫자를 누르고 "다음". */
  short(v: number) {
    for (const d of String(v)) this.press({ type: 'digit', digit: Number(d) });
    return this.press({ type: 'go' });
  }
  /** 지금 문항의 종류에 맞게 답을 넣는다. */
  put(v: AnswerValue) {
    const it = items[this.state.cursor]!;
    if (v === 'skip') return this.press({ type: 'skip' });
    return it.kind === 'mc' ? this.key(v) : this.short(v);
  }
  get no() {
    return noAt(this.state.cursor);
  }
  get panel() {
    return panelOf(this.state, items, this.answers);
  }
}

/** 1번부터 to번까지 예시 답을 채운 기록. skip 에 적은 번호는 비운다. */
function filledUpTo(to: number, blanks: number[] = []): Answers {
  const a: Answers = {};
  for (const it of items) if (it.no <= to && !blanks.includes(it.no)) a[it.no] = ANSWERS[it.no]!;
  return a;
}

/** 문항 no에 지금 답과 다른 5지선다 답. */
const otherChoice = (answers: Answers, no: number) => ((Number(answers[no]) % 5) + 1) as number;

/** n번을 넣을 차례인 상태(이어서 들어옴). */
function at(no: number): KeypadState {
  return { cursor: idx(no), via: 'continue', lock: null, draft: null, notice: null };
}

describe('키패드 답 입력의 흐름(3-2)', () => {
  it('(a) 1번부터 차례로 30문항을 넣으면 잠금 없이 다음 번호로 가고 입력 확인으로 넘어간다', () => {
    const pad = new Pad();
    expect(pad.no).toBe(1);
    for (const it of items) {
      expect(pad.no).toBe(it.no);
      expect(pad.state.lock).toBeNull();
      expect(pad.panel.text).toBeNull();
      const out = pad.put(ANSWERS[it.no]!)!;
      expect(out.accepted).toBe(true);
      if (it.no < 30) {
        expect(out.toReview).toBe(false);
        expect(pad.state.lock).toBeNull();
        expect(pad.state.via).toBe('continue');
      } else {
        expect(out.toReview).toBe(true);
      }
    }
    expect(pad.reviewed).toBe(true);
    expect(pad.answers).toEqual(ANSWERS);
  });

  it('(b) 12번을 넣을 차례에 9번을 고치면 9번에 머물고 잠기며, 이어 누른 답 키는 어디에도 들어가지 않는다', () => {
    const before = filledUpTo(11);
    const pad = new Pad(before, at(12));
    pad.tap(9);
    expect(pad.state.via).toBe('fix');
    const v = otherChoice(before, 9);
    pad.key(v);
    expect(pad.answers[9]).toBe(v);
    expect(pad.no).toBe(9);
    expect(pad.state.lock).toBe('put');
    expect(pad.panel).toEqual({ text: { kind: 'locked', no: 9 }, fixNext: 10, continueAt: 12 });
    // 화면을 안 보고 이어 누른 답 키, 안 풂: 받지 않는다.
    const snapshot = { ...pad.answers };
    for (const k of [1, 2, 3, 4, 5]) expect(pad.key(k)!.accepted).toBe(false);
    expect(pad.press({ type: 'skip' })!.accepted).toBe(false);
    expect(pad.answers).toEqual(snapshot);
    expect(pad.no).toBe(9);
    // "12번부터 이어서 넣기"
    pad.press({ type: 'continue' });
    expect(pad.no).toBe(12);
    expect(pad.state.via).toBe('continue');
    expect(pad.state.lock).toBeNull();
  });

  it('(c) 잠금에서 "10번도 고치기"를 누르면 10번을 한 번 고칠 수 있고 다시 잠긴다', () => {
    const before = filledUpTo(11);
    const pad = new Pad(before, at(12));
    pad.tap(9);
    pad.key(otherChoice(before, 9));
    pad.press({ type: 'fixNext' });
    expect(pad.no).toBe(10);
    expect(pad.state.via).toBe('fix');
    expect(pad.state.lock).toBeNull();
    // 고치는 중: 답 키가 살아 있고, 아무것도 바꾸지 않고 돌아가는 버튼이 있다.
    expect(pad.panel).toEqual({ text: { kind: 'fixing', no: 10 }, fixNext: null, continueAt: 12 });
    const v = otherChoice(before, 10);
    pad.key(v);
    expect(pad.answers[10]).toBe(v);
    expect(pad.no).toBe(10);
    expect(pad.state.lock).toBe('put');
    expect(pad.key(otherChoice(pad.answers, 10))!.accepted).toBe(false);
    expect(pad.answers[10]).toBe(v);
    expect(pad.panel).toEqual({ text: { kind: 'locked', no: 10 }, fixNext: 11, continueAt: 12 });
  });

  it('(d) 5번과 7번이 비어 있을 때 5번을 눌러 채우면 잠기고, 버튼은 "6번도 고치기"와 "7번부터 이어서 넣기"다', () => {
    const pad = new Pad(filledUpTo(11, [5, 7]), at(12));
    pad.tap(5);
    expect(pad.state.via).toBe('blank');
    pad.key(2);
    expect(pad.answers[5]).toBe(2);
    expect(pad.no).toBe(5);
    expect(pad.state.lock).toBe('put');
    expect(pad.panel).toEqual({ text: { kind: 'locked', no: 5 }, fixNext: 6, continueAt: 7 });
  });

  it('(e) 5번만 비워 둔 채 30번을 넣으면 입력 확인으로 가고 5번은 미입력으로 남는다', () => {
    const pad = new Pad(filledUpTo(29, [5]), at(30));
    const out = pad.put(ANSWERS[30]!)!;
    expect(out.toReview).toBe(true);
    expect(pad.answers[5]).toBeUndefined();
    expect(pad.answers[30]).toBe(ANSWERS[30]);
  });

  it('(f) 다 찬 상태에서 9번을 고치면 입력 확인으로 가고, 이어 누른 것은 9번을 다시 바꾸지 않는다', () => {
    const pad = new Pad(ANSWERS);
    // 다 찬 채로 화면을 열면 잠근 채로 시작한다.
    expect(pad.state.lock).toBe('full');
    expect(pad.panel).toEqual({ text: { kind: 'noBlank' }, fixNext: null, continueAt: null });
    for (const k of [1, 2, 3]) expect(pad.key(k)!.accepted).toBe(false);
    pad.tap(9);
    const v = otherChoice(ANSWERS, 9);
    expect(pad.key(v)!.toReview).toBe(true);
    expect(pad.answers[9]).toBe(v);
    // 입력 확인으로 넘어간 뒤의 누름은 키패드에 닿지 않는다.
    expect(pad.key(otherChoice(pad.answers, 9))).toBeNull();
    expect(pad.answers[9]).toBe(v);
  });

  it('(g) 답이 든 칸을 눌러 바로 고친 경우와 지우기로 비운 뒤 다시 넣은 경우의 결과가 같다', () => {
    const before = filledUpTo(11);
    const v = otherChoice(before, 9);
    const direct = new Pad(before, at(12));
    direct.tap(9);
    direct.key(v);
    const viaErase = new Pad(before, at(12));
    viaErase.tap(9);
    viaErase.erase();
    expect(viaErase.answers[9]).toBeUndefined();
    expect(viaErase.state.via).toBe('fix');
    viaErase.key(v);
    expect(viaErase.answers).toEqual(direct.answers);
    expect(viaErase.state.cursor).toBe(direct.state.cursor);
    expect(viaErase.state.lock).toBe(direct.state.lock);
    expect(viaErase.panel).toEqual(direct.panel);

    // 단답형도 같다(23번 고치기: 숫자를 다 지우고 저장된 답까지 지운 뒤 다시 넣음).
    const shortBefore = filledUpTo(24);
    const d = new Pad(shortBefore, at(25));
    d.tap(23);
    d.short(512);
    const e = new Pad(shortBefore, at(25));
    e.tap(23);
    for (let i = 0; i < String(shortBefore[23]).length; i += 1) e.erase();
    expect(e.answers[23]).toBe(shortBefore[23]);
    e.erase();
    expect(e.answers[23]).toBeUndefined();
    e.short(512);
    expect(e.answers).toEqual(d.answers);
    expect(e.state.cursor).toBe(d.state.cursor);
    expect(e.state.lock).toBe(d.state.lock);
    expect(d.state.lock).toBe('put');
  });

  it('(h) 6번을 넣고 7번으로 넘어온 직후 지우기를 누르면 6번이 지워지고 6번에 머문다. 다시 넣으면 7번으로 간다', () => {
    const pad = new Pad(filledUpTo(5));
    expect(pad.no).toBe(6);
    pad.key(3);
    expect(pad.no).toBe(7);
    pad.erase();
    expect(pad.answers[6]).toBeUndefined();
    expect(pad.no).toBe(6);
    expect(pad.state.via).toBe('continue');
    expect(pad.panel.text).toEqual({ kind: 'erased', no: 6 });
    pad.key(4);
    expect(pad.answers[6]).toBe(4);
    expect(pad.no).toBe(7);
  });

  it('(i) 빈칸을 직접 눌러 들어온 직후의 지우기는 아무것도 지우지 않는다', () => {
    const before = filledUpTo(11);
    const pad = new Pad(before, at(12));
    pad.tap(14);
    const out = pad.erase()!;
    expect(out.store).toBeNull();
    expect(pad.answers).toEqual(before);
    expect(pad.no).toBe(14);
    expect(pad.panel.text).toEqual({ kind: 'nothingToErase' });
  });

  it('들어 있던 답과 같은 답을 넣어도 답을 넣은 것으로 본다(고치기면 잠긴다)', () => {
    const before = filledUpTo(11);
    const pad = new Pad(before, at(12));
    pad.tap(9);
    pad.key(before[9] as number);
    expect(pad.state.lock).toBe('put');
    expect(pad.no).toBe(9);
  });

  it('단답형: 답이 든 칸에서 숫자 없이 "다음"을 누르면 답을 넣은 것이고, 빈칸에서는 머물고 알린다', () => {
    const pad = new Pad(filledUpTo(24), at(25));
    pad.press({ type: 'go' });
    expect(pad.no).toBe(25);
    expect(pad.panel.text).toEqual({ kind: 'empty', no: 25 });
    pad.tap(23);
    const out = pad.press({ type: 'go' })!;
    expect(out.store).toEqual({ no: 23, value: ANSWERS[23] });
    expect(pad.state.lock).toBe('put');
  });

  it('잠금에서는 숫자 키와 "다음", "안 풂"도 받지 않고, "지우기"는 그 칸의 답을 지우고 푼다', () => {
    const before = filledUpTo(24);
    const pad = new Pad(before, at(25));
    pad.tap(23);
    pad.short(77);
    expect(pad.state.lock).toBe('put');
    expect(pad.press({ type: 'digit', digit: 1 })!.accepted).toBe(false);
    expect(pad.press({ type: 'go' })!.accepted).toBe(false);
    expect(pad.press({ type: 'skip' })!.accepted).toBe(false);
    expect(pad.answers[23]).toBe(77);
    pad.erase();
    expect(pad.answers[23]).toBeUndefined();
    expect(pad.state.lock).toBeNull();
    expect(pad.no).toBe(23);
    expect(pad.panel.text).toEqual({ kind: 'erased', no: 23 });
  });

  it('칸을 누르면 잠금이 풀린다. 잠긴 칸을 다시 누르면 그 칸을 고친다', () => {
    const before = filledUpTo(11);
    const pad = new Pad(before, at(12));
    pad.tap(9);
    pad.key(otherChoice(before, 9));
    pad.tap(9);
    expect(pad.state.lock).toBeNull();
    expect(pad.state.via).toBe('fix');
    pad.tap(13);
    expect(pad.state.via).toBe('blank');
    expect(pad.no).toBe(13);
  });

  it('빈칸 없이 연 화면의 잠금에서는 "지우기"도 받지 않고, 칸을 눌러야 풀린다(별도 검토 3번)', () => {
    const pad = new Pad(ANSWERS);
    expect(pad.state.lock).toBe('full');
    expect(keysLocked(pad.state)).toEqual({ answer: true, erase: true });
    for (let i = 0; i < 3; i += 1) {
      const out = pad.erase()!;
      expect(out.accepted).toBe(false);
      expect(out.store).toBeNull();
    }
    expect(pad.answers).toEqual(ANSWERS);
    pad.tap(9);
    expect(keysLocked(pad.state)).toEqual({ answer: false, erase: false });
    // 답을 넣고 잠긴 뒤에는 "지우기"를 받는다(그 칸의 답을 지우고 푼다).
    const before = filledUpTo(11);
    const p2 = new Pad(before, at(12));
    p2.tap(9);
    p2.key(otherChoice(before, 9));
    expect(keysLocked(p2.state)).toEqual({ answer: true, erase: false });
  });

  it('큰 번호 위의 이름은 상태마다 다르다: 지금 넣을, 고치는, 방금 넣은, 마지막 문항', () => {
    const before = filledUpTo(11);
    const pad = new Pad(before, at(12));
    expect(nowLabelOf(pad.state)).toBe('now');
    pad.tap(9);
    expect(nowLabelOf(pad.state)).toBe('fixing');
    pad.key(otherChoice(before, 9));
    expect(nowLabelOf(pad.state)).toBe('put');
    pad.press({ type: 'continue' });
    expect(nowLabelOf(pad.state)).toBe('now');
    pad.tap(14);
    expect(nowLabelOf(pad.state)).toBe('now');
    expect(nowLabelOf(new Pad(ANSWERS).state)).toBe('noBlank');
  });

  it('마지막 문항은 고치기로 들어와도 넣으면 입력 확인으로 간다', () => {
    const pad = new Pad(filledUpTo(30, [5]), at(5));
    pad.tap(30);
    expect(pad.put(ANSWERS[30]!)!.toReview).toBe(true);
  });

  it('(j) 무작위 누름 열 1만 개에서 규칙이 한 번도 깨지지 않는다', () => {
    // 같은 결과가 나오게 씨앗을 정한 난수(mulberry32).
    let seed = 20261123;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T,>(list: T[]): T => list[Math.floor(rand() * list.length)]!;
    const SEQUENCES = 12000;
    let events = 0;
    let puts = 0;
    let locks = 0;
    let erasures = 0;
    for (let seq = 0; seq < SEQUENCES; seq += 1) {
      // 시작 기록: 문항마다 3분의 2 확률로 답이 있다(안 풂 포함).
      const start: Answers = {};
      for (const it of items) {
        if (rand() < 0.67) start[it.no] = rand() < 0.1 ? 'skip' : it.kind === 'mc' ? 1 + Math.floor(rand() * 5) : Math.floor(rand() * 1000);
      }
      const pad = new Pad(start);
      // 고치기로 들어온 뒤 아직 답을 넣지 않았는지.
      let fixFresh = false;
      const length = 10 + Math.floor(rand() * 50);
      for (let n = 0; n < length && !pad.reviewed; n += 1) {
        const it = items[pad.state.cursor]!;
        const r = rand();
        let e: KeyEvent;
        if (r < 0.25) e = { type: 'cell', index: Math.floor(rand() * items.length) };
        else if (r < 0.5) e = it.kind === 'mc' ? { type: 'choice', value: 1 + Math.floor(rand() * 5) } : { type: 'digit', digit: Math.floor(rand() * 10) };
        else if (r < 0.6) e = it.kind === 'short' ? { type: 'go' } : { type: 'choice', value: 1 + Math.floor(rand() * 5) };
        else if (r < 0.65) e = { type: 'skip' };
        else if (r < 0.8) e = { type: 'erase' };
        else e = pick<KeyEvent>([{ type: 'fixNext' }, { type: 'continue' }]);
        const prev = pad.state;
        const before = { ...pad.answers };
        const out = pad.press(e)!;
        events += 1;

        // 잠긴 키(답 키, 안 풂, 숫자 키, 다음)는 아무것도 바꾸지 않는다.
        if (prev.lock !== null && (e.type === 'choice' || e.type === 'skip' || e.type === 'digit' || e.type === 'go')) {
          expect(out.accepted).toBe(false);
          expect(out.store).toBeNull();
        }
        if (!out.accepted) continue;

        const curNo = noAt(prev.cursor);
        if (out.store) {
          const { no, value } = out.store;
          const hadAnswer = before[no] !== undefined;
          if (value !== undefined) {
            puts += 1;
            // 답을 넣는 것은 늘 지금 칸이다.
            expect(no).toBe(curNo);
            // 답이 든 칸의 값이 바뀌는 것은 고치기로 들어온 뒤의 첫 입력뿐이다.
            if (hadAnswer && before[no] !== value) {
              expect(prev.via).toBe('fix');
              expect(fixFresh).toBe(true);
            }
            // 답을 넣은 뒤 키가 살아 있으면 커서는 바로 다음 번호다.
            if (!out.toReview && out.state.lock === null) expect(out.state.cursor).toBe(prev.cursor + 1);
            if (out.state.lock !== null) locks += 1;
            fixFresh = false;
          } else {
            erasures += 1;
            if (e.type === 'erase') {
              // 지우기가 바꾸는 칸은 지금 칸이거나, 들어온 길이 이어서일 때의 바로 앞 번호뿐이다.
              const okCurrent = no === curNo;
              const okPrev = prev.via === 'continue' && prev.cursor > 0 && no === noAt(prev.cursor - 1);
              expect(okCurrent || okPrev).toBe(true);
            } else {
              // 숫자를 다 지우고 "다음"을 눌러 지우는 것은 고치기로 들어온 지금 칸뿐이다.
              expect(e.type).toBe('go');
              expect(no).toBe(curNo);
              expect(prev.via).toBe('fix');
            }
          }
        }
        // 고치기로 들어옴: 답이 든 칸을 누름, 잠긴 칸을 다시 누름, "M번도 고치기".
        if ((e.type === 'cell' || e.type === 'fixNext') && out.state !== prev && out.state.via === 'fix' && out.store === null) {
          if (e.type === 'fixNext' || out.state.cursor !== prev.cursor || prev.lock !== null) fixFresh = true;
        }
        if (e.type === 'continue' || (e.type === 'cell' && out.state.via !== 'fix')) fixFresh = false;
      }
    }
    expect(SEQUENCES).toBeGreaterThanOrEqual(10000);
    // 검사가 실제로 여러 경우를 지났는지.
    expect(events).toBeGreaterThan(100000);
    expect(puts).toBeGreaterThan(10000);
    expect(locks).toBeGreaterThan(1000);
    expect(erasures).toBeGreaterThan(1000);
  });
});

describe('키패드의 지우기(3-3)', () => {
  it('5지선다: 지금 칸에 답이나 안 풂이 있으면 지우고 머문다', () => {
    const before = filledUpTo(11);
    const pad = new Pad(before, at(12));
    pad.tap(3);
    pad.erase();
    expect(pad.answers[3]).toBeUndefined();
    expect(pad.no).toBe(3);
    expect(pad.panel.text).toEqual({ kind: 'erased', no: 3 });
    const withSkip = new Pad({ ...before, 4: 'skip' }, at(12));
    withSkip.tap(4);
    withSkip.erase();
    expect(withSkip.answers[4]).toBeUndefined();
    expect(withSkip.no).toBe(4);
  });

  it('단답형: 큰 칸의 숫자를 한 자리씩 지우고(저장된 답은 그대로), 빈 칸에서 한 번 더 누르면 저장된 답을 지운다', () => {
    const before = filledUpTo(26);
    const pad = new Pad(before, at(27));
    pad.tap(23);
    pad.erase();
    expect(pad.state.draft?.text).toBe(String(before[23]).slice(0, -1));
    expect(pad.answers[23]).toBe(before[23]);
    while ((pad.state.draft?.text ?? 'x') !== '') pad.erase();
    expect(pad.answers[23]).toBe(before[23]);
    pad.erase();
    expect(pad.answers[23]).toBeUndefined();
    expect(pad.no).toBe(23);
    expect(pad.panel.text).toEqual({ kind: 'erased', no: 23 });
    // 이제 지금 칸이 빈칸이고 고치기로 들어왔으므로 다른 문항을 지우지 않는다.
    pad.erase();
    expect(pad.answers[22]).toBe(before[22]);
    expect(pad.panel.text).toEqual({ kind: 'nothingToErase' });
  });

  it('단답형: 안 풂은 한 번에 지운다', () => {
    const pad = new Pad({ ...filledUpTo(26), 24: 'skip' }, at(27));
    pad.tap(24);
    pad.erase();
    expect(pad.answers[24]).toBeUndefined();
  });

  it('지금 칸이 빈칸이고 이어서 들어왔으면 앞 번호로 가서 그 답을 지운다', () => {
    const pad = new Pad(filledUpTo(21));
    expect(pad.no).toBe(22);
    pad.erase();
    expect(pad.no).toBe(21);
    expect(pad.answers[21]).toBeUndefined();
    expect(pad.state.via).toBe('continue');
  });

  it('1번에서 이어서 들어온 빈칸이면 지울 답이 없다고 알린다', () => {
    const pad = new Pad();
    pad.erase();
    expect(pad.no).toBe(1);
    expect(pad.panel.text).toEqual({ kind: 'nothingToErase' });
  });
});
