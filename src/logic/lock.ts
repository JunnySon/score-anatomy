import { checkLocks, isLockEntry } from '../exams/validate';
import type { LockEntry } from '../types';
import { kstText, parseYmdHm } from './dates';
import type { Hm } from './dates';

// 풀이 잠금(작업 지시서 3의 4-5).
// 수능, 평가원 모의평가, 전국연합학력평가가 치러지는 시간(일반 수험생 기준 1교시 시작부터 마지막 교시 종료까지)에는
// 풀이 계열 기능(해설 보기, 풀이 단계 보기, 풀이 사진 판독과 평가)을 보여 주지 않는다. 지금 앱에는 그런 기능이 하나도 없다.
// 잠그지 않는 것: 답 입력, 답 저장, 채점, 점수 해부, 계단, 오답 원인, 정답 보기, 다시 풀기, 좌표, 기록.
// 앞으로 풀이 계열 기능을 더하는 작업은 반드시 이 판정을 거친다(docs/결정기록.md 6장). 화면에서는
// src/components/LockNotice.tsx 의 useLockState 로 판정하고, 잠겼으면 그 기능 대신 LockNotice 를 보여 준다.
//
// 판정은 한국 시간으로 한다. 한국 시간은 UTC보다 9시간 빠른 것으로 고정하고 기기의 시간대 설정을 쓰지 않는다.
// 지금 시각(UTC 밀리초)을 한국 시간 글자(분까지, src/logic/dates.ts 의 kstText)로 바꿔 항목의 start, end 글자와 견준다.
// 같은 모양의 글자는 글자 순서가 곧 시각 순서이고, 구간의 경계가 분 단위라 밀리초로 견준 것과 결과가 같다.
// 이 파일은 Date 를 쓰지 않는다.

/** 판정 결과. 잠겼으면 풀리는 시각(한국 시간의 시와 분)을 함께 준다. */
export type LockState = { locked: false } | { locked: true; until: Hm };

const OPEN: LockState = { locked: false };

/**
 * 지금(UTC 밀리초) 풀이가 잠겼는지 판정한다. 구간은 start 이상 end 미만이다. 순수 함수다.
 * 잠겼으면 풀리는 시각을 돌려준다. 지금을 품은 항목에 이어 붙거나 겹친 항목이 있으면 따라가서 가장 늦은 end 가 풀리는 시각이다.
 * 형식이 틀린 항목은 보지 않는다. 날짜로 쓸 수 없는 지금 값(NaN 등)이면 어느 구간에도 들지 않으므로 열림이다.
 */
export function lockStateAt(nowUtcMs: number, entries: readonly LockEntry[]): LockState {
  const now = kstText(nowUtcMs);
  if (now === null) return OPEN;
  const valid = entries.filter((e) => isLockEntry(e));
  let end: string | null = null;
  for (const e of valid) {
    if (e.start <= now && now < e.end && (end === null || e.end > end)) end = e.end;
  }
  if (end === null) return OPEN;
  // 앞 항목의 end 에 다음 항목이 시작하면 그 시각에도 잠겨 있으므로, 이어진 항목을 끝까지 따라간다.
  // 항목은 하루 안에 있어서(start 와 end 가 같은 날) 따라가도 다른 날로 넘어가지 않는다.
  for (let grew = true; grew; ) {
    grew = false;
    for (const e of valid) {
      if (e.start <= end && e.end > end) {
        end = e.end;
        grew = true;
      }
    }
  }
  const t = parseYmdHm(end);
  return t ? { locked: true, until: { h: t.h, mi: t.mi } } : OPEN;
}

/** 두 판정 결과가 같은지. 화면이 결과가 바뀔 때만 다시 그리는 데 쓴다. */
export function sameLockState(a: LockState, b: LockState): boolean {
  if (!a.locked || !b.locked) return a.locked === b.locked;
  return a.until.h === b.until.h && a.until.mi === b.until.mi;
}

/** 버린 항목의 이유를 남기는 곳. 기본은 개발자 콘솔의 경고(console.warn)다. */
export type LockWarn = (message: string, reasons: readonly string[]) => void;

// 화면 테스트(e2e/helpers.ts)는 console.error 를 실패로 센다. 버린 항목은 화면이 멈춘 오류가 아니라서 경고로 남긴다.
const warnConsole: LockWarn = (message, reasons) => console.warn(message, reasons);

function usable(raw: unknown, name: string, warn: LockWarn): LockEntry[] {
  const { entries, errors } = checkLocks(raw);
  if (errors.length > 0) warn(Array.isArray(raw) ? `${name}에서 형식이 틀린 항목을 버렸어요.` : `${name}을 쓰지 않았어요.`, errors);
  return entries;
}

/**
 * 묶음 안 달력(src/exams/locks.json)과 넘겨받은 달력(다리 규격 2의 remote.locks)을 합친다. 순수 함수이고 이유는 warn 으로만 남긴다.
 * - 형식이 틀린 항목과, 같은 달력 안에서 앞의 항목과 id 가 겹친 항목은 버리고 warn 으로 이유를 남긴다. 달력이 배열이 아니면 빈 달력으로 본다.
 * - 넘겨받은 달력이 없으면(null, undefined) 묶음 안 달력만 쓴다.
 * - 두 달력에 같은 id 가 있으면 넘겨받은 항목을 쓴다. 넘겨받은 항목이 형식이 틀려 버려졌으면 같은 id 의 묶음 안 항목이 그대로 남는다.
 * 묶음 안 항목(넘겨받은 항목으로 바뀌지 않은 것) 다음에 넘겨받은 항목을 둔다. 받은 항목 객체는 고치지 않고 그대로 담는다.
 */
export function mergeLocks(bundled: unknown, remote: unknown, warn: LockWarn = warnConsole): LockEntry[] {
  const mine = usable(bundled, '묶음 안 잠금 달력', warn);
  if (remote === null || remote === undefined) return mine;
  const theirs = usable(remote, '넘겨받은 잠금 달력', warn);
  const replaced = new Set(theirs.map((e) => e.id));
  return [...mine.filter((e) => !replaced.has(e.id)), ...theirs];
}
