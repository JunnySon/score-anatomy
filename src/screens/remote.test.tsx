import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Routes } from '../App';
import { catalog, findBundledExam, findExam } from '../exams';
import { validateExam } from '../exams/validate';
import { KST_OFFSET_MS } from '../logic/dates';
import { exampleAnswers, exampleCauses, exampleMarks } from '../logic/example';
import { parseHash } from '../router';
import { buildDemoSession } from '../state/demo';
import { useDemoHandle, watchOldGradedRecords, type SessionHandle } from '../state/hooks';
import { markGraded, markSaved, newSession } from '../state/session';
import { defaultData, store } from '../state/store';
import { formatDate, S } from '../strings';
import type { Exam, Session } from '../types';
import { ExamSelect } from './ExamSelect';
import { History } from './History';
import { Start, startPreview } from './Start';
import { TestAdmin } from './TestAdmin';

// 넘겨받은 시험 자료(다리 규격 2, 작업 지시서 3의 5-2, 5-3)로 시험 목록이 바뀔 때의 화면을 글자로 그려서(서버 렌더링) 확인한다.
// 앱의 시험 목록 저장소(catalog)에 껍데기가 알리는 것처럼 소식을 넣는다(receive). 단위 테스트의 플랫폼은 브라우저용이라 껍데기가 없다.
// 저장소의 seq 는 커지기만 하므로, 테스트마다 더 큰 seq 의 자료를 넣어 그 테스트에 필요한 목록을 만든다.
// 넘겨받는 시험은 예시 시험 A의 사본으로 지은 테스트 전용 자료다(id test-remote-a). 날짜와 시각은 지시서의 형식 예시만 쓴다.
// 답을 넣는 도중에 새 자료가 와도 커서와 잠금이 그대로인지는 화면이 다시 마운트되지 않는 것이라 브라우저 화면 테스트가 본다.

const examA = findBundledExam('sample-a') as Exam;
const NOW = '2030-01-02T08:40:00.000Z';

let seq = 0;
/** 껍데기가 새 시험 자료를 넘겨준 것처럼 앱의 시험 목록에 알린다. seq 는 늘 앞보다 크다. */
function arrive(exams: unknown[], locks: unknown[] = []): void {
  seq += 1;
  catalog.receive({ type: 'remote', remote: { seq, issuedAt: '2030-01-02T17:10', exams, locks } });
  expect(catalog.get().remote?.seq).toBe(seq);
}

/** 넘겨받는 시험: 예시 시험 A의 사본으로 지은 테스트 전용 시험. 등급컷은 아직 없는 판이다. */
function remoteExam(more: Partial<Exam> = {}): Exam {
  const exam: Exam = { ...examA, id: 'test-remote-a', title: '테스트 전용 시험 A', note: '테스트 전용으로 지은 시험이에요.', isSample: true, ...more };
  delete exam.cuts;
  expect(validateExam(exam)).toEqual([]);
  return exam;
}
/** 정답 공개 전 판(rev 1): 문항 구성과 배점만 있다. */
const unreleasedA = () => remoteExam({ answerReleased: false, items: examA.items.map(({ answer: _answer, ...it }) => it) });
/** 정답이 든 판(rev 2). 정답을 처음 넣은 것이라 정답 판 번호(answersRev)는 1 그대로다. */
const releasedA = () => remoteExam({ rev: 2 });

/** 주소의 화면을 그린다(App.tsx 의 Routes). */
function routeHtml(path: string): string {
  const route = parseHash(`#${path}`);
  return renderToStaticMarkup(<Routes route={route} screenKey={route.name} />);
}

/** 화면 부품을 그린 요소 나무(훅을 쓰는 부품도 부를 수 있게 그리는 중에 부른다). */
function treeOf(render: () => ReactElement | null): ReactElement | null {
  let out: ReactElement | null = null;
  function Probe() {
    out = render();
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return out;
}

/** 저장소가 바뀐 횟수를 센다(바뀌면 저장한다). */
function countSaves(): { count: () => number; stop: () => void } {
  let n = 0;
  const stop = store.subscribe(() => {
    n += 1;
  });
  return { count: () => n, stop };
}

beforeEach(() => {
  store.update(() => defaultData());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('넘겨받은 시험 자료와 화면(작업 지시서 3의 5-2, 5-3)', () => {
  it('기록이 가리키는 시험을 찾지 못하면 기록 화면의 그 자리에 안내를 보여 주고, 기록은 지우지도 바꾸지도 않는다', () => {
    arrive([]);
    const missing: Session = { ...newSession('test-remote-a', 'not_yet', null, NOW), id: 's-missing', answers: { 1: 3 } };
    const other: Session = { ...newSession('sample-a', 'not_yet', null, NOW), id: 's-other' };
    store.update((d) => ({ ...d, sessions: [missing, other], currentId: other.id }));
    const before = store.get();
    const saves = countSaves();
    const html = renderToStaticMarkup(<History />);
    const date = formatDate(NOW);
    expect(S.missingExam.body).toBe('시험 자료를 받으면 다시 볼 수 있어요.');
    expect(html).toContain(`data-testid="history-missing">${S.missingExam.body}</span>`);
    expect(html.match(/data-testid="history-missing"/g)).toHaveLength(1);
    // 그릴 시험이 없어서 열기 버튼이 없다. 이름 자리에는 시험 id 를, 점수 자리 없이 넣은 날짜만 적는다.
    expect(html).toContain(`data-testid="history-missing-item"><span class="inline"><span class="strong">test-remote-a</span></span><span class="sub">${date}</span>`);
    expect(html).not.toContain('test-remote-a 기록 열기');
    // 학생이 지우는 것은 그대로 할 수 있다.
    expect(html).toContain(`aria-label="test-remote-a 기록 지우기, ${date}"`);
    // 다른 기록은 지금처럼 보이고 열린다.
    expect(html).toContain(`aria-label="예시 시험 A 기록 열기, ${date}, 입력 중"`);
    expect(html.match(/data-testid="history-item"/g)).toHaveLength(2);
    // 그리는 동안 저장소를 바꾸지 않았다(저장하지 않았다).
    expect(saves.count()).toBe(0);
    expect(store.get()).toBe(before);
    // 시험 자료를 받으면 그 기록을 다시 볼 수 있다.
    arrive([remoteExam()]);
    const after = renderToStaticMarkup(<History />);
    expect(after).not.toContain('history-missing');
    expect(after).toContain(`aria-label="테스트 전용 시험 A 기록 열기, ${date}, 입력 중"`);
    saves.stop();
    expect(saves.count()).toBe(0);
    expect(store.get()).toBe(before);
  });

  it('지금 기록의 시험을 찾지 못하면 처음 화면으로 보내지 않고 안내와 돌아갈 길이 있는 작은 화면을 보여 주고, 자료를 받으면 그 기록의 화면을 그린다', () => {
    arrive([]);
    const s: Session = { ...newSession('test-remote-a', 'not_yet', null, NOW), id: 's-current', answers: { 1: 3, 2: 5 } };
    store.update((d) => ({ ...d, sessions: [s], currentId: s.id }));
    const before = store.get();
    const saves = countSaves();
    for (const path of ['/input', '/review', '/marks', '/score', '/anatomy', '/causes', '/steps', '/retry/t01']) {
      const html = routeHtml(path);
      expect(html, path).toContain(`data-testid="exam-missing">${S.missingExam.body}</p>`);
      expect(html, path).toContain(`href="#/" data-testid="exam-missing-back">${S.missingExam.back}</a>`);
    }
    saves.stop();
    expect(saves.count()).toBe(0);
    expect(store.get()).toBe(before);
    // 지금 기록이 없으면 지금처럼 처음 화면으로 보낸다(그리는 것이 없다).
    store.update((d) => ({ ...d, currentId: null }));
    expect(routeHtml('/input')).toBe('');
    store.update((d) => ({ ...d, currentId: s.id }));
    // 시험 자료를 받으면 같은 주소가 그 기록의 답 입력 화면으로 다시 그려진다. 넣은 답은 그대로다.
    arrive([unreleasedA()]);
    const input = routeHtml('/input');
    expect(input).not.toContain('exam-missing');
    expect(input).toContain('data-testid="now-no"');
    expect(store.get().sessions[0]).toBe(s);
  });

  it('정답 공개 전에 저장해 둔 답은 정답이 든 판을 받으면 앱을 다시 켜지 않아도 채점할 수 있다', () => {
    arrive([unreleasedA()]);
    const answers = exampleAnswers(examA);
    const s = markSaved({ ...newSession('test-remote-a', 'not_yet', null, NOW), id: 's-saved', answers, marks: exampleMarks() }, NOW);
    store.update((d) => ({ ...d, sessions: [s], currentId: s.id }));
    const date = formatDate(NOW);
    // 정답 공개 전: 표시 화면은 저장했다는 안내이고 채점 버튼이 없다. 기록 화면은 "정답 공개 전"이다.
    let marks = routeHtml('/marks');
    expect(marks).toContain(S.marks.unreleasedNotice);
    expect(marks).not.toContain('data-testid="grade"');
    expect(renderToStaticMarkup(<History />)).toContain(`<span class="sub">${date}, ${S.common.unreleased}</span>`);
    // 정답이 든 판(rev 2)을 받으면 같은 화면이 채점 버튼으로 다시 그려진다. 기록 화면은 "채점 전"이다.
    arrive([releasedA()]);
    marks = routeHtml('/marks');
    expect(marks).toContain('data-testid="grade"');
    expect(marks).not.toContain(S.marks.unreleasedNotice);
    expect(renderToStaticMarkup(<History />)).toContain(`<span class="sub">${date}, ${S.history.readyToGrade}</span>`);
    // 채점은 저장해 둔 답과 표시 그대로 지금 정답으로 한다(검산 예시와 같은 답이라 78점).
    expect(store.get().sessions[0]).toBe(s);
    const graded = markGraded(s, findExam('test-remote-a')!, NOW);
    expect(graded.gradedWith).toEqual({ answersRev: 1, score: 78 });
    expect(graded.answers).toEqual(answers);
    expect(graded.marks).toEqual(exampleMarks());
  });

  it('시험 목록이 바뀌면 옛 채점 기록을 채운다(시작할 때 찾지 못한 시험이 나중에 오면 그때)', () => {
    arrive([]);
    const exam = releasedA();
    const graded = markGraded(
      { ...newSession('test-remote-a', 'not_yet', null, NOW), id: 's-old', answers: exampleAnswers(examA), marks: exampleMarks(), causes: exampleCauses() },
      exam,
      NOW,
    );
    const old: Session = { ...graded };
    delete old.gradedWith;
    store.update((d) => ({ ...d, sessions: [old] }));
    const stop = watchOldGradedRecords();
    // 시험을 찾지 못하는 동안은 채우지 않고 기록을 지우지도 않는다.
    expect(store.get().sessions).toEqual([old]);
    expect(store.get().sessions[0]).toBe(old);
    arrive([exam]);
    expect(store.get().sessions).toEqual([{ ...old, gradedWith: { answersRev: 1, score: 78 } }]);
    // 그만두면 더 채우지 않는다.
    stop();
    const other: Session = { ...old, id: 's-old-2' };
    store.update((d) => ({ ...d, sessions: [...d.sessions, other] }));
    arrive([exam]);
    expect(store.get().sessions[1]).toBe(other);
  });

  it('시험 선택 화면과 진행자용 화면은 지금 시험 목록을 그리고, 시험 선택 화면의 연달아 누르기 보호 열쇠에는 seq 가 들어 있다', () => {
    arrive([remoteExam({ id: 'test-remote-b', title: '테스트 전용 시험 B', examDate: '2030-01-02' }), remoteExam()]);
    const order = ['test-remote-b', 'test-remote-a', 'sample-a', 'sample-b', 'sample-c'];
    const select = renderToStaticMarkup(<ExamSelect />);
    expect([...select.matchAll(/data-testid="exam-([^"]+)"/g)].map((m) => m[1]).filter((id) => id !== 'date')).toEqual(order);
    expect(select).toContain('2030년 1월 2일 시행');
    const admin = renderToStaticMarkup(<TestAdmin />);
    expect([...admin.matchAll(/data-testid="texam-([^"]+)"/g)].map((m) => m[1])).toEqual(order);
    // 목록이 바뀌면(seq) 선택지의 자리가 옮겨 갈 수 있어서 보호 열쇠가 바뀐다.
    const keyOf = () => (treeOf(() => ExamSelect()) as ReactElement<{ guardKey?: string }>).props.guardKey;
    expect(keyOf()).toBe(`///${seq}`);
    arrive([remoteExam()]);
    expect(keyOf()).toBe(`///${seq}`);
    expect([...renderToStaticMarkup(<ExamSelect />).matchAll(/data-testid="exam-([^"]+)"/g)].map((m) => m[1])).toEqual([
      'test-remote-a',
      'sample-a',
      'sample-b',
      'sample-c',
    ]);
  });

  it('진행자용 화면의 풀이 잠금 한 줄은 넘겨받은 달력을 합친 달력으로 판정한다', () => {
    const lockLine = (html: string) => /data-testid="lock-status">([^<]*)</.exec(html)?.[1] ?? null;
    vi.useFakeTimers({ toFake: ['Date'] });
    // 한국 시간 2030년 1월 2일 오전 8시 40분(지시서의 형식 예시).
    vi.setSystemTime(Date.UTC(2030, 0, 2, 8, 40) - KST_OFFSET_MS);
    arrive([], [{ id: 'test-lock-a', label: '테스트 전용 잠금 항목', start: '2030-01-02T08:40', end: '2030-01-02T17:45' }]);
    expect(lockLine(renderToStaticMarkup(<TestAdmin />))).toBe('풀이 잠금: 지금 잠김(오후 5시 45분까지)');
    arrive([]);
    expect(lockLine(renderToStaticMarkup(<TestAdmin />))).toBe('풀이 잠금: 지금 열림');
  });

  it('예시 결과와 시작 화면 미리보기는 묶음 안 예시 시험으로 그려서 넘겨받은 자료로 바뀌지 않는다', () => {
    // 예시 시험 A와 같은 id 의 테스트 전용 판(rev 2): 1번 정답과 유형 이름을 바꿨다. 시험 목록에서는 이 판이 묶음 안 판을 대신한다.
    const types = Object.fromEntries(Object.entries(examA.types).map(([id, t]) => [id, { ...t, name: '테스트 전용 유형' }]));
    const override: Exam = { ...examA, rev: 2, title: '테스트 전용 시험 A', items: examA.items.map((it) => (it.no === 1 ? { ...it, answer: 4 } : it)), types };
    expect(validateExam(override)).toEqual([]);
    arrive([override]);
    expect(findExam('sample-a')).toBe(override);
    expect(findBundledExam('sample-a')).toBe(examA);
    // 예시 결과의 기록과 손잡이는 묶음 안 예시 시험 그대로다(검산 예시의 1번 답은 묶음 안 정답 3).
    const demo = buildDemoSession()!;
    expect(demo.answers).toEqual(exampleAnswers(examA));
    expect(demo.answers[1]).toBe(3);
    const box: { h: SessionHandle | null } = { h: null };
    treeOf(() => {
      box.h = useDemoHandle();
      return null;
    });
    expect(box.h?.exam).toBe(examA);
    // 시작 화면의 미리보기도 묶음 안 예시 시험의 유형 이름으로 적는다.
    const start = renderToStaticMarkup(<Start resumeTo={null} />);
    expect(start).toContain(startPreview(examA)!.stepsLine);
    expect(start).not.toContain('테스트 전용 유형');
  });
});
