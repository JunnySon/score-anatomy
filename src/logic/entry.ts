import { SHORT_MAX } from '../exams/validate';
import type { AnswerValue } from '../types';

// 단답형 숫자 입력(0~999, 최대 3자리). 기기 기본 자판 대신 앱 자체 키패드로 받는다.

export interface DigitEntry {
  text: string;
  /** 이미 넣어 둔 답을 불러온 직후인지. 이때 숫자를 누르면 새로 쓴다. */
  fresh: boolean;
}

export const MAX_DIGITS = String(SHORT_MAX).length;

export function initEntry(existing: AnswerValue | undefined): DigitEntry {
  return typeof existing === 'number' ? { text: String(existing), fresh: true } : { text: '', fresh: false };
}

/** 숫자 키 하나를 누른다. 3자리를 넘으면 받지 않고 overflow로 알린다. */
export function pressDigit(entry: DigitEntry, digit: number): { entry: DigitEntry; overflow: boolean } {
  const d = String(digit);
  if (entry.fresh || entry.text === '0') return { entry: { text: d, fresh: false }, overflow: false };
  if (entry.text.length >= MAX_DIGITS) return { entry, overflow: true };
  return { entry: { text: entry.text + d, fresh: false }, overflow: false };
}

export function eraseDigit(entry: DigitEntry): DigitEntry {
  return { text: entry.text.slice(0, -1), fresh: false };
}

export function entryValue(entry: DigitEntry): number | null {
  return entry.text === '' ? null : Number(entry.text);
}
