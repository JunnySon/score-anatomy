import { useEffect, useState } from 'react';
import type { Hm } from '../logic/dates';
import { lockStateAt, sameLockState, type LockState } from '../logic/lock';
import { S } from '../strings';
import type { LockEntry } from '../types';
import { Message } from './ui';

// 풀이 잠금 안내 조각(작업 지시서 3의 4-5).
// 지금 앱에는 풀이 계열 기능(해설 보기, 풀이 단계 보기, 풀이 사진 판독과 평가)이 없어서 학생이 보는 화면에는 붙이지 않는다.
// 풀이 계열 기능을 더할 때는 useLockState 로 판정하고, 잠겼으면 그 기능 대신 LockNotice 를 보여 준다(docs/결정기록.md 6장).
// 답 입력, 답 저장, 채점, 점수 해부, 계단, 오답 원인, 정답 보기, 다시 풀기, 좌표, 기록은 잠그지 않는다.

/** 지금은 시험 시간이라 풀이를 쉰다는 안내. until 은 풀리는 시각(한국 시간)이다. */
export function LockNotice({ until }: { until: Hm }) {
  return (
    <Message plain testId="lock-notice">
      {S.solutionLock.notice(until.h, until.mi)}
    </Message>
  );
}

/** 화면이 열려 있는 동안 다시 판정하는 간격. 잠금이 시작되거나 끝나고 늦어도 이만큼 뒤에는 화면이 맞게 바뀐다. */
export const LOCK_RECHECK_MS = 15_000;

/**
 * 합친 잠금 달력으로 지금 풀이가 잠겼는지 판정한다(src/logic/lock.ts 의 lockStateAt).
 * 처음 그릴 때 판정하고, 화면이 열려 있는 동안 LOCK_RECHECK_MS 마다 다시 판정해 결과가 바뀔 때만 다시 그린다.
 */
export function useLockState(entries: readonly LockEntry[]): LockState {
  const [state, setState] = useState<LockState>(() => lockStateAt(Date.now(), entries));
  useEffect(() => {
    const check = () =>
      setState((prev) => {
        const next = lockStateAt(Date.now(), entries);
        return sameLockState(prev, next) ? prev : next;
      });
    check();
    const timer = setInterval(check, LOCK_RECHECK_MS);
    return () => clearInterval(timer);
  }, [entries]);
  return state;
}
