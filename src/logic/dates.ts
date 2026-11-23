// "YYYY-MM-DD" 날짜 문자열(시험 시행일 examDate, 등급컷 기준일 cuts.asOf).
// Date 로 바꾸지 않고 문자열을 연, 월, 일로 잘라 검사, 정렬, 문구에 쓴다.
// Date 로 바꾸면 실행하는 곳의 시간대에 따라 하루가 밀릴 수 있다.

export interface Ymd {
  y: number;
  m: number;
  d: number;
}

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
 * 두 날짜를 견준다. a가 앞서면 음수, 같으면 0, 뒤면 양수.
 * 모양이 맞는 문자열은 자릿수가 같아서 글자 순서가 곧 날짜 순서다.
 */
export function compareYmd(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
