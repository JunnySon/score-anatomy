import { describe, expect, it } from 'vitest';
import { entryValue, eraseDigit, initEntry, pressDigit } from './entry';

describe('단답형 숫자 입력', () => {
  it('빈 칸에서 시작해 최대 3자리까지 받는다', () => {
    let e = initEntry(undefined);
    expect(entryValue(e)).toBeNull();
    for (const d of [2, 5, 7]) e = pressDigit(e, d).entry;
    expect(e.text).toBe('257');
    const r = pressDigit(e, 1);
    expect(r.overflow).toBe(true);
    expect(r.entry.text).toBe('257');
    expect(entryValue(e)).toBe(257);
  });

  it('0 다음에 숫자를 누르면 앞의 0은 사라진다', () => {
    let e = pressDigit(initEntry(undefined), 0).entry;
    expect(entryValue(e)).toBe(0);
    e = pressDigit(e, 7).entry;
    expect(e.text).toBe('7');
  });

  it('이미 넣은 답을 불러온 직후에 숫자를 누르면 새로 쓴다', () => {
    const e = initEntry(128);
    expect(e).toEqual({ text: '128', fresh: true });
    expect(pressDigit(e, 3).entry).toEqual({ text: '3', fresh: false });
  });

  it('지우기는 한 자리씩 지운다', () => {
    let e = initEntry(128);
    e = eraseDigit(e);
    expect(e).toEqual({ text: '12', fresh: false });
    e = eraseDigit(eraseDigit(e));
    expect(entryValue(e)).toBeNull();
  });

  it('안 풂은 숫자 없이 시작한다', () => {
    expect(initEntry('skip')).toEqual({ text: '', fresh: false });
  });
});
