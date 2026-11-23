import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LockNotice } from '../components/LockNotice';
import { KST_OFFSET_MS } from '../logic/dates';
import { S_TEST } from '../strings';

// 풀이 잠금(작업 지시서 3의 4-5)의 화면 조각과 진행자용 화면의 한 줄을 글자로 그려서(서버 렌더링) 확인한다.
// 묶음 안 달력(src/exams/locks.json)은 빈 배열이라, 진행자용 화면이 읽는 합친 달력(LOCKS)을 테스트 전용 달력으로 바꿔 끼운다.

vi.mock('../exams', async (importOriginal) => {
  const real = await importOriginal<typeof import('../exams')>();
  // 테스트 전용 잠금 항목. 지시서의 형식 예시("2030-01-02T08:40"부터 "2030-01-02T17:45"까지)다. 실제 시험 시간이 아니다.
  return { ...real, LOCKS: [{ id: 'test-lock-a', label: '테스트 전용 잠금 항목', start: '2030-01-02T08:40', end: '2030-01-02T17:45' }] };
});

const { TestAdmin, lockStatusLine } = await import('./TestAdmin');

/** 한국 시간 2030년 1월 2일 h시 mi분의 UTC 밀리초. */
const at = (h: number, mi: number) => Date.UTC(2030, 0, 2, h, mi) - KST_OFFSET_MS;

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

afterEach(() => {
  vi.useRealTimers();
});

/** 지금 시각을 멈춰 두고 진행자용 화면을 그린다. */
function adminAt(ms: number): string {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ms);
  return renderToStaticMarkup(<TestAdmin />);
}

function lockLineOf(html: string): string | null {
  return /data-testid="lock-status">([^<]*)</.exec(html)?.[1] ?? null;
}

describe('진행자용 화면의 풀이 잠금 한 줄(작업 지시서 3의 4-5)', () => {
  it('합친 잠금 달력으로 지금을 판정해, 잠긴 동안에는 풀리는 시각을, 그 밖에는 열림을 소개 문장 아래 한 줄로 적는다', () => {
    expect(lockLineOf(adminAt(at(8, 39)))).toBe('풀이 잠금: 지금 열림');
    expect(lockLineOf(adminAt(at(8, 40)))).toBe('풀이 잠금: 지금 잠김(오후 5시 45분까지)');
    expect(lockLineOf(adminAt(at(17, 44)))).toBe('풀이 잠금: 지금 잠김(오후 5시 45분까지)');
    expect(lockLineOf(adminAt(at(17, 45)))).toBe('풀이 잠금: 지금 열림');
    // 소개 문장 바로 다음에 둔다. 한 줄이고 하나뿐이다.
    const html = adminAt(at(8, 40));
    expect(html).toContain(`<p class="sub">${S_TEST.intro}</p><p class="sub mt2" data-testid="lock-status">`);
    expect(html.match(/data-testid="lock-status"/g)).toHaveLength(1);
    // 진행자용 화면은 안내 조각(학생에게 보일 문장)을 그리지 않는다.
    expect(html).not.toContain('data-testid="lock-notice"');
    // 한 줄의 글자를 고르는 곳.
    expect(lockStatusLine({ locked: false })).toBe(S_TEST.lockOpen);
    expect(lockStatusLine({ locked: true, until: { h: 17, mi: 45 } })).toBe(S_TEST.lockClosed(17, 45));
    expect(lockStatusLine({ locked: true, until: { h: 20, mi: 0 } })).toBe('풀이 잠금: 지금 잠김(오후 8시까지)');
  });
});

describe('풀이 잠금 안내 조각(작업 지시서 3의 4-5)', () => {
  it('풀리는 시각(그 항목의 end)을 넣어 지시서의 문장을 중립 안내 모양으로 그린다', () => {
    const html = renderToStaticMarkup(<LockNotice until={{ h: 17, mi: 45 }} />);
    expect(text(html)).toBe('지금은 시험 시간이라 풀이는 잠시 쉬어요. 오후 5시 45분부터 다시 볼 수 있어요. 답 입력은 지금도 할 수 있어요.');
    expect(html).toContain('data-testid="lock-notice"');
    expect(html).toContain('class="msg msg--plain"');
    // 분이 0이면 분을 뺀다.
    expect(text(renderToStaticMarkup(<LockNotice until={{ h: 20, mi: 0 }} />))).toContain('오후 8시부터 다시 볼 수 있어요.');
  });
});
