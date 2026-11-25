import type { Page } from '@playwright/test';
import { exampleAnswers } from '../src/logic/example';
import { openBundle, BUNDLES } from './appBridge';
import { waitSettled } from './audit';
import { addMetric, expect, expectHash, loadExam, openApp, seedStore, test } from './helpers';
import { sessionRecord, storeOf } from './remoteData';

// 가로 넘침 확인(작업 지시서 4-1 의 2-2). 맥이 iOS 18.4 에서 본 두 번 눌러 확대의 원인 후보 하나는 내용이 화면보다 넓게 놓여
// 처음 배율이 1이 아니게 되는 것이다(웹킷의 ViewportConfiguration). 그래서 모든 화면을 아이폰과 안드로이드의 흔한 폭 일곱 가지에서
// 열어, 문서와 본문의 스크롤 폭이 화면 폭을 넘지 않는지와 화면 밖으로 0.5px 넘게 나간 요소가 없는지 본다.
// 일부러 빼는 것: .sr-only(화면 낭독기용 글자. 1px 상자로 줄여 글자 자리에 두므로 넘침을 만들지 않지만 글자 상자가 넓게 잴 수 있음),
// .tap-shield(누름을 받지 않는 투명한 고정 위치 표시. 누른 자리 둘레 48px 이라 화면 가장자리를 누르면 조금 나갈 수 있고 문서 폭에 들지 않음).
// 이 테스트는 넘침이 없다는 것만 본다. 확대가 고쳐졌는지는 맥이 시뮬레이터에서 잰다.

const WIDTHS = [360, 375, 390, 393, 402, 414, 430];
const HEIGHT = 844;
const examA = loadExam('a');
const firstAnswers = (n: number) => Object.fromEntries(Object.entries(exampleAnswers(examA)).slice(0, n));

interface Overflow {
  vw: number;
  docW: number;
  bodyW: number;
  offenders: string[];
}

/** 지금 화면의 가로 넘침을 잰다. */
async function measure(page: Page): Promise<Overflow> {
  await waitSettled(page);
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (el.closest('.sr-only, .tap-shield, script, style')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > vw + 0.5 || r.left < -0.5) {
        const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
        offenders.push(`${el.tagName.toLowerCase()}${cls} ${Math.round(r.left * 10) / 10}~${Math.round(r.right * 10) / 10}`);
      }
    }
    return { vw, docW: document.documentElement.scrollWidth, bodyW: document.body.scrollWidth, offenders: offenders.slice(0, 10) };
  });
}

function check(o: Overflow, width: number, at: string): void {
  expect.soft(o.vw, at).toBe(width);
  expect.soft(o.docW, `${at}: 문서(html)의 스크롤 폭`).toBeLessThanOrEqual(o.vw);
  expect.soft(o.bodyW, `${at}: 본문(body)의 스크롤 폭`).toBeLessThanOrEqual(o.vw);
  expect.soft(o.offenders, `${at}: 화면 밖으로 나간 요소`).toEqual([]);
}

interface State {
  name: string;
  /** 넣을 기록(없으면 빈 기록). */
  store: unknown;
  hash: string;
  /** 열린 뒤 그 상태를 만드는 조작(바텀시트 열기 등). */
  prepare?: (page: Page) => Promise<void>;
}

const graded = JSON.parse(storeOf([sessionRecord('s-graded', 'sample-a', { targetGrade: '2' })]));
const ungraded = (answers: Record<string, unknown>) =>
  JSON.parse(storeOf([sessionRecord('s-open', 'sample-a', { answers, marks: {}, causes: {}, gradedAt: null, firstGradedAt: null })]));

const STATES: State[] = [
  { name: '시작', store: graded, hash: '/' },
  { name: '시험 고르기', store: null, hash: '/exams' },
  {
    name: '시험 고르기, 질문',
    store: null,
    hash: '/exams',
    prepare: async (page) => {
      await page.getByTestId('exam-sample-a').click();
      await expect(page.getByTestId('graded-not_yet')).toBeVisible();
    },
  },
  {
    name: '답 넣기, 객관식(키패드)', store: ungraded({}), hash: '/input?input=keypad',
    prepare: async (page) => { await expect(page.getByTestId('section-name')).toHaveText('객관식 1~21번'); },
  },
  {
    name: '답 넣기, 단답형(키패드)', store: ungraded(firstAnswers(21)), hash: '/input?input=keypad',
    prepare: async (page) => { await expect(page.getByTestId('now-no')).toHaveText('22번'); },
  },
  {
    name: '답 넣기, 5행 방식', store: ungraded({}), hash: '/input?input=rows',
    prepare: async (page) => { await expect(page.getByTestId('rows-next')).toBeVisible(); },
  },
  { name: '입력 확인', store: ungraded(exampleAnswers(examA)), hash: '/review' },
  {
    name: '입력 확인, 답 고치기 바텀시트',
    store: ungraded(exampleAnswers(examA)),
    hash: '/review',
    prepare: async (page) => {
      await page.locator('main [data-cell="14"]').click();
      await expect(page.locator('[aria-modal="true"]')).toHaveCount(1);
    },
  },
  { name: '표시', store: ungraded(exampleAnswers(examA)), hash: '/marks' },
  { name: '점수', store: graded, hash: '/score' },
  { name: '오답 원인', store: graded, hash: '/causes' },
  { name: '점수 해부(2등급)', store: graded, hash: '/anatomy' },
  {
    name: '점수 해부, 등급컷 출처 바텀시트',
    store: graded,
    hash: '/anatomy',
    prepare: async (page) => {
      await page.getByTestId('cut-badge').click();
      await expect(page.locator('[aria-modal="true"]')).toHaveCount(1);
    },
  },
  { name: '계단', store: graded, hash: '/steps' },
  {
    name: '재풀이', store: graded, hash: '/retry/t03',
    prepare: async (page) => { await expect(page.getByTestId('retry-no')).toHaveText('15번'); },
  },
  { name: '기록', store: graded, hash: '/history' },
  { name: '진행자 화면', store: null, hash: '/test' },
];

async function open(page: Page, s: State): Promise<void> {
  await openApp(page, '/');
  await seedStore(page, s.store ?? { version: 1, sessions: [], currentId: null, inputMode: 'keypad', testRuns: [], activeRunId: null });
  await page.reload();
  await openApp(page, s.hash);
  await expectHash(page, s.hash.split('?')[0]!);
  if (s.prepare) await s.prepare(page);
}

for (const width of WIDTHS) {
  test(`가로 넘침: 폭 ${width}px 에서 모든 화면의 문서 폭이 화면 폭을 넘지 않고 화면 밖으로 나간 요소가 없다`, async ({ page }) => {
    await page.setViewportSize({ width, height: HEIGHT });
    for (const s of STATES) {
      await open(page, s);
      const o = await measure(page);
      addMetric({ kind: 'overflow', bundle: 'web', width, state: s.name, ...o });
      check(o, width, `${width}px ${s.name}`);
    }
    // 대조: 화면보다 40px 넓은 요소를 넣으면 검사가 넘침을 잡아내야 한다(검사가 늘 통과로 끝나지 않는지).
    await page.evaluate(() => {
      const wide = document.createElement('div');
      wide.id = 'overflow-control';
      wide.style.width = 'calc(100vw + 40px)';
      wide.style.height = '10px';
      document.querySelector('main')!.appendChild(wide);
    });
    const caught = await measure(page);
    expect(caught.offenders.some((x) => x.startsWith('div')), `${width}px 대조: 넓은 요소를 잡아냄`).toBe(true);
    await page.evaluate(() => document.getElementById('overflow-control')!.remove());
  });
}

test('가로 넘침: 앱 시험용 묶음과 배포용 묶음도 폭 일곱 가지에서 넘치지 않는다(시작, 시험 고르기, 표시, 점수 해부, 계단, 기록)', async ({ page }) => {
  const record = sessionRecord('s-app', 'sample-a', { targetGrade: '2' });
  const hashes: [string, string][] = [
    ['시작', '/'],
    ['시험 고르기', '/exams'],
    ['표시', '/marks'],
    ['점수 해부(2등급)', '/anatomy'],
    ['계단', '/steps'],
    ['기록', '/history'],
  ];
  for (const b of BUNDLES) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: HEIGHT });
      for (const [name, hash] of hashes) {
        await openBundle(page, b, { bridge: 1, store: storeOf([record]) }, hash);
        await expectHash(page, hash);
        const o = await measure(page);
        addMetric({ kind: 'overflow', bundle: b, width, state: name, ...o });
        check(o, width, `${b} ${width}px ${name}`);
      }
    }
  }
});
