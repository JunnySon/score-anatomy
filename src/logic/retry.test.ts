import { describe, expect, it } from 'vitest';
import { retryTarget } from './steps';

// 재풀이 화면의 지금 문항(작업 지시서 3의 별도 검토 A1, B4). 화면이 열린 채 넘겨받은 새 판으로 다시 풀 목록이 바뀌어도
// 지금 문항은 차례가 아니라 문항 번호로 정한다. 그래서 고른 답이 다른 문항의 다시 풀기 기록으로 들어가지 않는다.
// 목록은 문항 번호만 쓰고(작은 번호부터), 실제 시험의 값이 아니다.

describe('재풀이 화면의 지금 문항(별도 검토 A1, B4)', () => {
  it('들고 있던 문항이 목록에 있으면 차례가 바뀌어도 그 문항이다', () => {
    expect(retryTarget([8, 20, 21], 20)).toEqual({ no: 20, index: 1, moved: false });
    // 앞 문항이 빠져도(정정으로 8번이 맞게 됨) 20번 그대로다. 예전에는 차례(1)를 들고 있어서 21번으로 바뀌었다.
    expect(retryTarget([20, 21], 20)).toEqual({ no: 20, index: 0, moved: false });
    // 앞에 문항이 더해져도(정정으로 7번이 틀리게 됨) 15번 그대로다. 예전에는 차례(0)를 들고 있어서 7번으로 바뀌었다.
    expect(retryTarget([7, 15, 21], 15)).toEqual({ no: 15, index: 1, moved: false });
  });

  it('들고 있던 문항이 목록에서 빠지면 그 번호보다 뒤의 첫 문항으로 옮기고, 뒤에 없으면 마지막 문항이다', () => {
    expect(retryTarget([8, 21], 20)).toEqual({ no: 21, index: 1, moved: true });
    expect(retryTarget([8, 20], 21)).toEqual({ no: 20, index: 1, moved: true });
    expect(retryTarget([20, 21], 8)).toEqual({ no: 20, index: 0, moved: true });
  });

  it('든 문항이 없으면 첫 문항이고, 목록이 비면 없다', () => {
    expect(retryTarget([8, 20, 21], null)).toEqual({ no: 8, index: 0, moved: false });
    expect(retryTarget([], 8)).toBeNull();
    expect(retryTarget([], null)).toBeNull();
  });
});
