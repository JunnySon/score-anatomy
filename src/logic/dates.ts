// 날짜와 시각 문자열.
// - "YYYY-MM-DD": 시험 시행일 examDate, 등급컷 기준 cuts.asOf.
// - "YYYY-MM-DDTHH:mm": 한국 시간의 날짜와 시각. 등급컷 기준 cuts.asOf 에도 쓸 수 있다(작업 지시서 3의 4-4).
// Date 로 바꾸지 않고 문자열을 연, 월, 일, 시, 분으로 잘라 검사, 정렬, 문구에 쓴다.
// Date 로 바꾸면 실행하는 곳의 시간대에 따라 하루가 밀릴 수 있다.
// 지금 시각(UTC 밀리초)을 한국 시간 글자로 적을 때만 Date 를 쓴다. 그때도 9시간을 더한 값을 UTC 로 읽고,
// 기기의 시간대 설정을 읽는 Date 메서드는 이 파일에서 쓰지 않는다.

export interface Ymd {
  y: number;
  m: number;
  d: number;
}

/** 시와 분(24시 기준). */
export interface Hm {
  h: number;
  mi: number;
}

export interface YmdHm extends Ymd, Hm {}

/** 등급컷 기준(cuts.asOf). 날짜만 적었으면 time 이 null 이다. */
export interface AsOf extends Ymd {
  time: Hm | null;
}

/** 한국 시간은 UTC보다 9시간 빠른 것으로 고정한다. 기기의 시간대 설정을 쓰지 않는다. */
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** 그 달의 마지막 날. */
export function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeap(y) ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/** "YYYY-MM-DD" 모양이고 실제로 있는 날짜면 연, 월, 일을 돌려준다. 아니면 null. */
export function parseYmd(text: unknown): Ymd | null {
  if (typeof text !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return { y, m: mo, d };
}

/** 실제로 있는 날짜인지. */
export function isValidYmd(text: unknown): boolean {
  return parseYmd(text) !== null;
}

/**
 * "YYYY-MM-DDTHH:mm"(한국 시간) 모양이고 실제로 있는 날짜와 시각이면 연, 월, 일, 시, 분을 돌려준다. 아니면 null.
 * 시와 분은 두 자리로 적고, 시는 0~23, 분은 0~59다("T24:00", "T23:60", "T8:10" 은 받지 않는다). 초는 적지 않는다.
 */
export function parseYmdHm(text: unknown): YmdHm | null {
  if (typeof text !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const day = parseYmd(m[1]);
  const h = Number(m[2]);
  const mi = Number(m[3]);
  if (!day || h > 23 || mi > 59) return null;
  return { ...day, h, mi };
}

/** 실제로 있는 날짜와 시각인지("YYYY-MM-DDTHH:mm"). */
export function isValidYmdHm(text: unknown): boolean {
  return parseYmdHm(text) !== null;
}

/** 등급컷 기준(cuts.asOf)을 읽는다. "YYYY-MM-DD" 또는 "YYYY-MM-DDTHH:mm"(한국 시간)이고 실제로 있는 값이어야 한다. 아니면 null. */
export function parseAsOf(text: unknown): AsOf | null {
  const day = parseYmd(text);
  if (day) return { ...day, time: null };
  const t = parseYmdHm(text);
  return t ? { y: t.y, m: t.m, d: t.d, time: { h: t.h, mi: t.mi } } : null;
}

/**
 * 두 날짜를 견준다. a가 앞서면 음수, 같으면 0, 뒤면 양수.
 * 모양이 맞는 문자열은 자릿수가 같아서 글자 순서가 곧 날짜 순서다("YYYY-MM-DDTHH:mm" 끼리도 같다).
 */
export function compareYmd(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 지금 시각(UTC 밀리초)을 한국 시간 "YYYY-MM-DDTHH:mm" 으로 적는다. 초 아래는 버린다.
 * 9시간을 더한 값을 UTC 로 읽어서, 기기의 시간대 설정과 상관없이 같은 글자가 나온다.
 * 날짜로 쓸 수 없는 값(유한한 수가 아님, 1년보다 앞이나 9999년보다 뒤)이면 null.
 */
export function kstText(utcMs: number): string | null {
  if (!Number.isFinite(utcMs)) return null;
  const shifted = new Date(utcMs + KST_OFFSET_MS);
  if (Number.isNaN(shifted.getTime())) return null;
  // toISOString 은 늘 UTC 로 "YYYY-MM-DDTHH:mm:ss.sssZ" 를 적는다. 네 자리 해가 아니면 모양이 달라 아래 검사에서 걸러진다.
  const text = shifted.toISOString().slice(0, 16);
  return isValidYmdHm(text) ? text : null;
}
