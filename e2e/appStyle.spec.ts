import type { Page } from '@playwright/test';
import { exampleAnswers, exampleMarks } from '../src/logic/example';
import { S_TOOLS } from '../src/strings';
import { type Bundle, openBundle, otherRequestsOf } from './appBridge';
import { expect, expectHash, loadExam, test } from './helpers';
import { sessionRecord, storeOf } from './remoteData';

// 앱 배포용 묶음(app-release)의 모양: 시험용 묶음(app-test)과 같은 기록, 같은 화면 상태로 열고 계산된 모양을 견준다.
// 배포용 묶음은 사용성 테스트 도구 모듈(src/tools)과 그 모듈만 불러오는 CSS 파일을 싣지 않는다. 일반 화면이 쓰는 규칙이
// 그 CSS 파일에 들어가면 배포용 묶음에서만 빠져 표시 칸, 점수 막대, 바텀시트, 대화상자, 기록 목록이 모양 없이 그려진다
// (작업 지시서 3의 3부 앞에서 고친 결함, docs/결정기록.md 6장). 소스에서 같은 규칙을 보는 검사는 src/tools/toolCss.test.ts 다.
// 두 묶음에 다 있는 요소를 문서 차례대로 짝지어 모양 속성을 견준다. 자리와 크기는 견주지 않는다.
// 도구 모듈이 그리는 것(기록 화면 아래의 "준비 중인 기능" 목록과 진행자용 링크)은 시험용 묶음에만 있어 짝짓기에서 빼고 그 수를 센다.
// 이 파일은 verify 12번이 그 수를 같음으로 견준다.

/** 견주는 모양 속성(계산된 값). 자리와 크기(left, top, width, height 등)는 뺀다. */
const PROPS = [
  'display',
  'position',
  'z-index',
  'visibility',
  'opacity',
  'overflow-x',
  'overflow-y',
  'color',
  'background-color',
  'background-image',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
  'outline-style',
  'box-shadow',
  'font-size',
  'font-weight',
  'line-height',
  'text-align',
  'white-space',
  'list-style-type',
  'flex-direction',
  'flex-wrap',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'justify-content',
  'align-items',
  'row-gap',
  'column-gap',
  'grid-template-columns',
  'grid-column-start',
  'grid-column-end',
  'grid-auto-flow',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin-top',
  'margin-bottom',
  'min-height',
  'max-height',
  'transform',
  'animation-name',
  'cursor',
] as const;
/** ::before, ::after 에서 견주는 속성(펼침 설명의 꺾쇠 등). content 가 없는 가상 요소는 견주지 않는다. */
const PSEUDO_PROPS = ['content', 'display', 'width', 'height', 'border-right-width', 'border-bottom-width', 'border-right-style', 'transform', 'background-color'] as const;
/** 도구 모듈(HistoryExtras)이 그리는 곳. 시험용 묶음에만 있다. */
const TOOL_ONLY = '[aria-labelledby="upcoming-title"], p:has(> [data-testid="tester-link"])';
/** 기록 화면에서 시험용 묶음에만 있는 요소 수: section, h2, ul, 목록 줄마다 li 와 span 둘, 링크를 담은 p 와 a. */
const HISTORY_TOOL_ELEMENTS = 5 + 3 * S_TOOLS.upcoming.length;

// 테스트 전용 기록: 예시 시험 A에 검산 예시의 답을 넣고 몇 칸을 바꿨다(3번과 24번은 안 풂, 5번은 고민, 23번은 자신 없음 표시).
// 채점까지 마쳤고 목표 등급은 2등급이다. 날짜는 형식 예시(e2e/remoteData.ts). 둘째 기록은 아무것도 넣지 않은 예시 시험 B다.
const exam = loadExam('a');
const STORE = storeOf([
  sessionRecord('style-a', 'sample-a', {
    answers: { ...exampleAnswers(exam), 3: 'skip', 24: 'skip' },
    marks: { ...exampleMarks(), 5: 'doubt', 23: 'unsure' },
    targetGrade: '2',
  }),
  sessionRecord('style-b', 'sample-b', { createdAt: '2030-01-01T08:10:00.000Z', answers: {}, marks: {}, causes: {}, gradedAt: null, firstGradedAt: null }),
]);

/** 요소 하나의 이름표(태그, 클래스, data-testid)와 모양 값. */
interface Look {
  sig: string;
  values: string[];
  before: string[] | null;
  after: string[] | null;
}
interface Shot {
  state: string;
  elements: Look[];
  toolOnly: number;
}
/** 화면 상태 하나: 이름, 그 상태로 가는 조작, 그 상태에 꼭 있어야 하는 요소(상태가 제대로 만들어졌는지 보는 대조). */
interface State {
  name: string;
  go: (page: Page) => Promise<void>;
  must: string[];
}

const goTo = async (page: Page, hash: string) => {
  await page.evaluate((h) => {
    window.location.hash = `#${h}`;
  }, hash);
  await expectHash(page, hash);
};
const closeLayer = async (page: Page) => {
  await page.keyboard.press('Escape');
  await expect(page.locator('.layer')).toHaveCount(0);
};

/** 움직임(바텀시트가 올라오는 것 등)과 연달아 누르기 보호 표시가 끝난 뒤, 문서의 요소마다 모양을 읽는다. */
async function snapshot(page: Page, state: string): Promise<Shot> {
  await page.waitForFunction(() => !document.querySelector('.tap-shield') && document.getAnimations().every((a) => a.playState !== 'running'));
  return page.evaluate(
    ({ state, props, pseudoProps, toolOnly }) => {
      const skipped = new Set<Element>();
      for (const root of document.querySelectorAll(toolOnly)) {
        skipped.add(root);
        for (const el of root.querySelectorAll('*')) skipped.add(el);
      }
      const all = [document.documentElement, document.body, ...document.body.querySelectorAll('*')].filter(
        (el) => !['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'].includes(el.tagName),
      );
      const read = (cs: CSSStyleDeclaration, list: readonly string[]) => list.map((p) => cs.getPropertyValue(p));
      const elements = all
        .filter((el) => !skipped.has(el))
        .map((el) => {
          const cls = (el.getAttribute('class') ?? '').trim();
          const testId = el.getAttribute('data-testid');
          const [before, after] = ['::before', '::after'].map((p) => {
            const ps = getComputedStyle(el, p);
            const content = ps.getPropertyValue('content');
            return content === 'none' || content === 'normal' ? null : read(ps, pseudoProps);
          });
          return {
            sig: `${el.tagName.toLowerCase()}${cls ? `.${cls.split(/\s+/).join('.')}` : ''}${testId ? `[${testId}]` : ''}`,
            values: read(getComputedStyle(el), props),
            before: before ?? null,
            after: after ?? null,
          };
        });
      return { state, elements, toolOnly: all.filter((el) => skipped.has(el)).length };
    },
    { state, props: PROPS, pseudoProps: PSEUDO_PROPS, toolOnly: TOOL_ONLY },
  );
}

/** 묶음 하나를 같은 기록으로 열고 화면 상태를 차례로 만들며 모양을 읽는다. */
async function visit(page: Page, bundle: Bundle, states: readonly State[]): Promise<Shot[]> {
  await openBundle(page, bundle, { store: STORE }, '/');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const shots: Shot[] = [];
  for (const s of states) {
    await s.go(page);
    for (const sel of s.must) await expect(page.locator(sel).first(), `${bundle} ${s.name}: ${sel}`).toBeAttached();
    shots.push(await snapshot(page, s.name));
  }
  return shots;
}

/** 배포용과 시험용 묶음의 같은 상태를 견준다. 요소의 차례와 이름표(태그, 클래스, data-testid)가 같아야 짝지어진다. */
function compare(release: Shot[], tester: Shot[]) {
  const structure: string[] = [];
  const diffs: string[] = [];
  const perState: { state: string; compared: number; releaseOnly: number; testOnly: number }[] = [];
  release.forEach((r, k) => {
    const t = tester[k]!;
    expect(t.state).toBe(r.state);
    const n = Math.min(r.elements.length, t.elements.length);
    let paired = 0;
    for (let i = 0; i < n; i += 1) {
      const a = r.elements[i]!;
      const b = t.elements[i]!;
      if (a.sig !== b.sig) {
        structure.push(`${r.state}: ${i}번째 요소가 ${a.sig} 와 ${b.sig}`);
        break;
      }
      paired += 1;
      PROPS.forEach((p, j) => {
        if (a.values[j] !== b.values[j]) diffs.push(`${r.state} ${a.sig} ${p}: 배포용 ${a.values[j]}, 시험용 ${b.values[j]}`);
      });
      for (const part of ['before', 'after'] as const) {
        const x = a[part];
        const y = b[part];
        if (x === null && y === null) continue;
        if (x === null || y === null) {
          diffs.push(`${r.state} ${a.sig}::${part}: 배포용 ${x === null ? '없음' : '있음'}, 시험용 ${y === null ? '없음' : '있음'}`);
          continue;
        }
        PSEUDO_PROPS.forEach((p, j) => {
          if (x[j] !== y[j]) diffs.push(`${r.state} ${a.sig}::${part} ${p}: 배포용 ${x[j]}, 시험용 ${y[j]}`);
        });
      }
    }
    perState.push({ state: r.state, compared: paired, releaseOnly: r.elements.length - paired + r.toolOnly, testOnly: t.elements.length - paired + t.toolOnly });
  });
  return { structure, diffs, perState };
}

/** 두 묶음을 같은 상태로 열어 견주고, 빈 비교로 통과하지 않게 견준 요소 수와 짝 없는 요소 수를 확인한다. */
async function expectSameLook(page: Page, states: readonly State[], historyStates: readonly string[] = []) {
  const release = await visit(page, 'app-release', states);
  const tester = await visit(page, 'app-test', states);
  expect(release.map((s) => s.state)).toEqual(states.map((s) => s.name));
  const { structure, diffs, perState } = compare(release, tester);
  expect(structure, '두 묶음에서 요소의 차례가 다른 상태').toEqual([]);
  for (const s of perState) {
    expect(s.compared, `${s.state}: 견준 요소 수`).toBeGreaterThan(15);
    expect(s.releaseOnly, `${s.state}: 배포용 묶음에만 있는 요소 수`).toBe(0);
    expect(s.testOnly, `${s.state}: 시험용 묶음에만 있는 요소 수(도구 모듈이 그리는 것)`).toBe(historyStates.includes(s.state) ? HISTORY_TOOL_ELEMENTS : 0);
  }
  expect(diffs.length, `모양이 다른 곳 ${diffs.length}곳(처음 몇 곳: ${diffs.slice(0, 8).join(' / ')})`).toBe(0);
  expect(otherRequestsOf(page), '묶음 파일 말고 읽은 주소').toEqual([]);
  test.info().annotations.push({ type: '견준 요소', description: perState.map((s) => `${s.state} ${s.compared}개(시험용에만 ${s.testOnly}개)`).join(', ') });
  return perState.reduce((sum, s) => sum + s.compared, 0);
}

test('app-release 와 app-test 의 모양이 같다: 시작 화면의 작은 점수 막대, 입력 확인과 답 고치기 바텀시트, 표시 화면(찍음, 고민, 자신 없음, 안 풂)', async ({ page }) => {
  const compared = await expectSameLook(page, [
    { name: '시작 화면', go: (p) => goTo(p, '/'), must: ['.bar--mini .seg--solid'] },
    { name: '입력 확인', go: (p) => goTo(p, '/review'), must: ['.grid5 [data-cell="3"] .cell__val--small'] },
    { name: '답 고치기 바텀시트', go: (p) => p.locator('[data-cell="24"]').click(), must: ['.layer .scrim', '.sheet .sheet__head .sheet__title', '.sheet__body [data-key="go"]'] },
    {
      name: '표시 화면',
      go: async (p) => {
        await closeLayer(p);
        await goTo(p, '/marks');
      },
      must: ['.grid5 .mark-cell--guess', '.mark-cell--doubt', '.mark-cell--off', '.short-mark[aria-pressed="true"] small', '.short-mark[aria-disabled="true"]'],
    },
  ]);
  expect(compared).toBeGreaterThan(300);
});

test('app-release 와 app-test 의 모양이 같다: 점수, 점수 해부(점수 막대와 눈금, 펼친 설명), 등급컷 출처 바텀시트, 오답 원인, 계단', async ({ page }) => {
  const compared = await expectSameLook(page, [
    { name: '점수', go: (p) => goTo(p, '/score'), must: ['[data-testid="score"]'] },
    {
      name: '점수 해부',
      go: async (p) => {
        await goTo(p, '/anatomy');
        await p.locator('[data-testid="cutbox"] details > summary').click();
        await expect(p.locator('[data-testid="luck-detail"]')).toBeVisible();
      },
      must: ['.bar .seg--hatch', '.ticks .tick-mark', '.tick-label--total', '.arow .swatch.seg--outline', '.arow__sub', '.cut-head [data-testid="cut-badge"]', 'details[open] > summary'],
    },
    { name: '등급컷 출처 바텀시트', go: (p) => p.locator('[data-testid="cut-badge"]').click(), must: ['.layer .scrim', '.sheet [data-testid="cut-source"]'] },
    {
      name: '오답 원인',
      go: async (p) => {
        await closeLayer(p);
        await goTo(p, '/causes');
      },
      must: ['main .title'],
    },
    { name: '계단', go: (p) => goTo(p, '/steps'), must: ['main details > summary'] },
  ]);
  expect(compared).toBeGreaterThan(300);
});

test('app-release 와 app-test 의 모양이 같다: 기록 화면과 기록 지우기 확인 대화상자', async ({ page }) => {
  const compared = await expectSameLook(
    page,
    [
      { name: '기록', go: (p) => goTo(p, '/history'), must: ['.rule-list > li.hitem', '.hitem__open'] },
      { name: '기록 지우기 확인 대화상자', go: (p) => p.locator('[data-testid="history-remove"]').first().click(), must: ['.layer.layer--center .scrim', '.dialog [data-confirm="yes"]'] },
    ],
    ['기록', '기록 지우기 확인 대화상자'],
  );
  expect(compared).toBeGreaterThan(50);
});
