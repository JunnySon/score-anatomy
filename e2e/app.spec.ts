import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { exampleAnswers, exampleCauses, exampleMarks } from '../src/logic/example';
import { S, S_APP, S_ROWS, S_TEST, S_TOOLS } from '../src/strings';
import type { Answers } from '../src/types';
import {
  BUNDLES,
  bridgeLog,
  bundlePath,
  bundleUrl,
  hapticCount,
  openBundle,
  otherRequestsOf,
  sendFromApp,
  setCopyMode,
  storeMessages,
} from './appBridge';
import { addMetric, chooseCauses, chooseExam, enterKeypad, expect, expectHash, loadExam, openApp, setMarks, tapKey, test } from './helpers';
import { AT_1710, remoteData, testExam } from './remoteData';

// 앱용 묶음(작업 지시서 1의 2부): 가짜 다리를 넣은 브라우저에서 커밋된 묶음 두 개를 직접 연다.
// 껍데기와의 약속은 docs/앱_다리_규격.md 에 있다. 묶음은 ios/ScoreAnatomy/Web 에 있고, verify 가 지금 코드로 다시 만든 것과 같은지 따로 본다.
// 기록을 지키는 검사는 실제로 내보내는 배포용 묶음에서도 돈다.

/** 키패드로 넣을 때 누르는 키 수(5지선다 1번, 단답형은 숫자 자리 수와 "다음"). */
function keyPresses(answers: Answers, from: number, to: number, kinds: Record<number, 'mc' | 'short'>): number {
  let n = 0;
  for (let no = from; no <= to; no += 1) {
    const v = answers[no]!;
    n += v === 'skip' || kinds[no] === 'mc' ? 1 : String(v).length + 1;
  }
  return n;
}

const SYSTEM_FONT = '-apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif';
const localCount = (page: Page) => page.evaluate(() => window.localStorage.length);
/** 답 입력 화면처럼 아래 탭이 없는 화면에서 기록 화면으로 간다(주소의 해시만 바꾼다. 다시 읽지 않는다). */
const goHistory = async (page: Page) => {
  await page.evaluate(() => {
    window.location.hash = '#/history';
  });
  await expectHash(page, '/history');
};
const lastSave = async (page: Page) => {
  const saves = (await storeMessages(page)).filter((m) => m.op === 'save');
  return saves.length > 0 ? (JSON.parse(saves[saves.length - 1]!.json!) as Record<string, unknown>) : null;
};

for (const bundle of BUNDLES) {
  test(`${bundle}: 예시 시험 A를 검산 예시대로 넣으면 78점, 7점, 8점, 3~7점, 약 75점, 6~10점, 계단 3개`, async ({ page }) => {
    // 단일 HTML: 밖에서 불러오는 스크립트, 스타일, 글꼴, 그림이 없다.
    const html = readFileSync(bundlePath(bundle), 'utf8');
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/);
    expect(html).not.toMatch(/@font-face/);
    expect(html).not.toMatch(/url\(\s*(?!['"]?(?:data:|#))/);

    const exam = loadExam('a');
    const answers = exampleAnswers(exam);
    await openBundle(page, bundle);
    await expect(page.locator('html')).toHaveClass(/sa-app/);
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toBe(SYSTEM_FONT);
    // 앱에서만 바꾸는 문구.
    await expect(page.getByText(S_APP.privacy)).toBeVisible();
    await page.getByRole('button', { name: '시험 고르기' }).click();
    await chooseExam(page, 'sample-a');
    await enterKeypad(page, exam, answers);
    await expectHash(page, '/review');
    await page.getByRole('button', { name: '맞아요, 다음으로' }).click();
    await setMarks(page, exampleMarks());
    await page.getByTestId('grade').click();
    await expect(page.getByTestId('score')).toHaveText('78점');
    await page.getByRole('button', { name: '틀린 문항 살펴보기' }).click();
    await chooseCauses(page, exampleCauses());
    await page.getByRole('button', { name: '점수 해부 보기' }).click();
    await expect(page.getByTestId('actual')).toHaveText('78점');
    // 숫자 칸을 정확히 본다("78점" 같은 다른 글자에 든 "8점"으로 통과하지 않게).
    await expect(page.getByTestId('row-guess').locator('.num')).toHaveText('7점');
    await expect(page.getByTestId('row-slip').locator('.num')).toHaveText('8점');
    await page.getByTestId('grade-2').click();
    await expect(page.getByTestId('cut-actual')).toHaveText('실제 78점 기준 3~7점 남았어요');
    await expect(page.getByTestId('cut-luck')).toContainText('약 75점');
    await expect(page.getByTestId('cut-luck')).toContainText('6~10점');
    await page.getByTestId('grade-3').click();
    await expect(page.getByTestId('cut-actual')).toHaveText('컷 범위보다 위예요.');
    await page.getByTestId('to-steps').click();
    await expect(page.locator('[data-testid^="step-"][data-type]')).toHaveCount(3);
    await expect(page.getByTestId('step-1').getByTestId('step-points')).toHaveText('놓친 배점 8점, 찍었다고 표시한 정답 4점');
    // 좌표 복사는 다리(saCopy)로 하고, 껍데기의 답(copied)을 기다려 알린다.
    await page.getByTestId('step-1').getByTestId('copy-coords').click();
    await expect(page.getByTestId('step-1').getByText(S.steps.copied)).toBeVisible();
    const copies = (await bridgeLog(page)).filter(([n]) => n === 'saCopy');
    expect(copies).toEqual([['saCopy', '예시 좌표 12번\n예시 좌표 20번']]);
    // 기록 화면 아래의 앱 문구.
    await page.getByRole('link', { name: '기록', exact: true }).click();
    await expect(page.getByTestId('history-item')).toContainText('78점');
    await expect(page.getByText(S_APP.historyNote)).toBeVisible();
    // 저장은 saStore 로만 하고 localStorage 는 비어 있다. 묶음 파일 말고는 아무것도 읽지 않는다.
    const saves = await storeMessages(page);
    expect(saves.length).toBeGreaterThan(30);
    expect(saves.every((m) => m.op === 'save' && typeof m.json === 'string')).toBe(true);
    expect(await localCount(page)).toBe(0);
    expect(otherRequestsOf(page), '묶음 파일 말고 읽은 주소').toEqual([]);
    addMetric({ kind: 'app', bundle, score: 78, steps: 3, saves: saves.length });
  });

  test(`${bundle}: 저장한 기록으로 다시 열면 "이어서 보기"가 되고, 끝냈다 켠 뒤에도 기록이 남는다`, async ({ page, context }) => {
    const exam = loadExam('a');
    const answers = exampleAnswers(exam);
    await openBundle(page, bundle);
    await page.getByRole('button', { name: '시험 고르기' }).click();
    await chooseExam(page, 'sample-a');
    await enterKeypad(page, exam, answers, 1, 12);
    const saves = await storeMessages(page);
    const last = saves[saves.length - 1]!.json!;
    expect(JSON.parse(last).sessions[0].answers[12]).toBe(answers[12]);
    // 껍데기가 마지막으로 저장한 글자를 store 로 넣어 다시 연다(앱을 끝냈다 켠 것과 같다).
    const again = await context.newPage();
    await openBundle(again, bundle, { store: last });
    await expect(again.getByRole('button', { name: '이어서 보기' })).toBeVisible();
    await again.getByRole('button', { name: '이어서 보기' }).click();
    await expectHash(again, '/input');
    await expect(again.getByTestId('now-no')).toHaveText('13번');
    await expect(again.getByTestId('entered-count')).toHaveText('12문항 입력');
    // 받은 기록은 읽을 수 있어서 보관을 요청하지 않고, 다시 연 뒤의 저장도 받은 기록을 이어 쓴다(덮어쓰지 않는다).
    const againMsgs = await storeMessages(again);
    expect(againMsgs.some((m) => m.op === 'archive')).toBe(false);
    for (const m of againMsgs) expect(Object.keys(JSON.parse(m.json!).sessions[0].answers)).toHaveLength(12);
    await again.close();
  });

  for (const [name, store] of [
    ['통째로 읽을 수 없는 store', '{not json'],
    ['version 이 앱이 아는 값보다 큰 store', JSON.stringify({ version: 2, sessions: [{ id: 'x', examId: 'sample-a', answers: { 1: 3 } }] })],
    ['version 이 옮길 수 없는 옛 값인 store', JSON.stringify({ version: 0, sessions: [] })],
    ['빈 글자 store', ''],
    ['글자가 아닌 값(객체)으로 들어온 store', { version: 1, sessions: [{ id: 'x', examId: 'sample-a', answers: { 1: 3 } }] }],
  ] as const) {
    test(`${bundle}: ${name}는 덮어쓰지 않고 archive 를 먼저 보낸 뒤 새로 시작한다`, async ({ page }) => {
      await openBundle(page, bundle, { store });
      // 첫 메시지는 archive, 이어서 보관 안내 표시를 남긴 새 기록을 저장한다.
      let msgs = await storeMessages(page);
      expect(msgs[0]).toEqual({ op: 'archive' });
      expect(msgs[1]?.op).toBe('save');
      const fresh = JSON.parse(msgs[1]!.json!);
      expect(fresh.archiveNotice).toBe(true);
      expect(fresh.sessions).toEqual([]);
      await page.getByRole('link', { name: '기록', exact: true }).click();
      await expect(page.getByText(S_APP.archived)).toBeVisible();
      await expect(page.getByTestId('history-empty')).toBeVisible();
      // 기록 화면이 안내를 보여 준 뒤에는 기록에서 표시를 지운다(다음에는 보이지 않는다).
      await expect.poll(async () => (await lastSave(page))?.archiveNotice).toBeUndefined();
      // 새로 넣으면 그때부터 저장한다. archive 는 한 번뿐이다.
      await page.getByRole('link', { name: '이번 시험' }).click();
      await page.getByRole('button', { name: '시험 고르기' }).click();
      await chooseExam(page, 'sample-a');
      await tapKey(page, 3);
      msgs = await storeMessages(page);
      expect(msgs.filter((m) => m.op === 'archive')).toHaveLength(1);
      expect(msgs.slice(1).every((m) => m.op === 'save')).toBe(true);
      expect(await localCount(page)).toBe(0);
    });
  }

  test(`${bundle}: 보관 안내는 기록 화면에 들르기 전에 앱을 끄고 다시 켜도 한 번 보인다`, async ({ page, context }) => {
    await openBundle(page, bundle, { store: '{not json' });
    const fresh = (await storeMessages(page))[1]!.json!;
    await page.close();
    // 보관 뒤 껍데기에 남은 새 기록으로 다시 연다. 이 기록은 읽을 수 있어서 보관을 다시 요청하지 않는다.
    const again = await context.newPage();
    await openBundle(again, bundle, { store: fresh });
    expect((await storeMessages(again)).some((m) => m.op === 'archive')).toBe(false);
    await again.getByRole('link', { name: '기록', exact: true }).click();
    await expect(again.getByText(S_APP.archived)).toBeVisible();
    await expect.poll(async () => (await lastSave(again))?.archiveNotice).toBeUndefined();
  });

  test(`${bundle}: 껍데기가 저장에 실패했다고 알리면 지금 화면에서 한 번 알리고, 기록 화면에는 저장하지 못한 동안 보인다`, async ({ page }) => {
    const exam = loadExam('a');
    await openBundle(page, bundle);
    // 기록 화면을 연 채로 알림이 오면 바로 바뀐다.
    await page.getByRole('link', { name: '기록', exact: true }).click();
    await expect(page.getByTestId('history-storage-failed')).toHaveCount(0);
    await sendFromApp(page, { type: 'storeFailed' });
    await expect(page.getByTestId('history-storage-failed')).toHaveText(S_APP.storageFailed);
    await expect(page.getByTestId('store-notice')).toHaveText(S_APP.storageFailed);
    await expect(page.getByText(S.history.storageFailed)).toHaveCount(0);
    // 화면은 그대로 쓸 수 있다. 다음 저장을 보내면 안내를 내리고, 다시 실패해도 지금 화면의 알림은 이 실행에서 한 번뿐이다.
    await page.getByRole('link', { name: '이번 시험' }).click();
    await page.getByRole('button', { name: '시험 고르기' }).click();
    await chooseExam(page, 'sample-a');
    await enterKeypad(page, exam, exampleAnswers(exam), 1, 2);
    await expect(page.getByTestId('store-notice')).toHaveCount(0);
    await sendFromApp(page, { type: 'storeFailed' });
    await page.waitForTimeout(200);
    await expect(page.getByTestId('store-notice')).toHaveCount(0);
    await expect(page.getByTestId('entered-count')).toHaveText('2문항 입력');
  });

  test(`${bundle}: 다리 규격 번호가 웹이 받지 않는 번호(3)면 다리로 아무것도 보내지 않고 기록을 저장하지 않으며 시험 자료도 넘겨받지 않는다(앱 전용 파일을 건드리지 않는다)`, async ({ page }) => {
    // 웹은 규격 1과 2를 받는다(docs/앱_다리_규격.md 7-2). 3은 웹이 모르는 규격이라 remote 칸이 있어도 쓰지 않는다.
    await openBundle(page, bundle, {
      bridge: 3,
      store: JSON.stringify({ version: 1, sessions: [] }),
      remote: remoteData(1, AT_1710, [testExam()]),
    });
    await expect(page.locator('html')).toHaveClass(/sa-app/);
    await expect(page.getByTestId('store-notice')).toHaveText(S_APP.storageFailed);
    await page.getByRole('button', { name: '시험 고르기' }).click();
    await expect(page.getByTestId('exam-sample-a')).toBeVisible();
    await expect(page.getByTestId('exam-test-remote-a')).toHaveCount(0);
    await expect(page.getByTestId('remote-notice')).toHaveCount(0);
    await chooseExam(page, 'sample-a');
    await tapKey(page, 3);
    await expect(page.getByTestId('now-no')).toHaveText('2번');
    expect(await bridgeLog(page)).toEqual([]);
    expect(await localCount(page)).toBe(0);
    await goHistory(page);
    await expect(page.getByTestId('history-storage-failed')).toHaveText(S_APP.storageFailed);
  });

  test(`${bundle}: 껍데기 안인데 __SA_APP__ 가 객체가 아니면 localStorage 로 넘어가지 않고 저장하지 않는다`, async ({ page }) => {
    await openBundle(page, bundle, { app: 'string' });
    await expect(page.locator('html')).toHaveClass(/sa-app/);
    await expect(page.getByText(S_APP.privacy)).toBeVisible();
    await page.getByRole('button', { name: '시험 고르기' }).click();
    await chooseExam(page, 'sample-a');
    await tapKey(page, 3);
    expect(await storeMessages(page)).toEqual([]);
    expect(await localCount(page)).toBe(0);
    await goHistory(page);
    await expect(page.getByTestId('history-storage-failed')).toHaveText(S_APP.storageFailed);
  });

  test(`${bundle}: 다리 없이 브라우저로 열면 브라우저 방식(localStorage, 브라우저 문구)으로 동작한다`, async ({ page }) => {
    await openBundle(page, bundle, { app: 'none', handlers: false });
    await expect(page.locator('html')).not.toHaveClass(/sa-app/);
    await expect(page.getByText(S.start.privacy)).toBeVisible();
    await page.getByRole('button', { name: '시험 고르기' }).click();
    await chooseExam(page, 'sample-a');
    await tapKey(page, 3);
    expect(await localCount(page)).toBe(1);
    await goHistory(page);
    await expect(page.getByText(S_APP.historyNote)).toHaveCount(0);
    // 배포용 묶음은 브라우저로 열어도 진행자용 화면으로 가는 링크가 없다(묶음에서 빠져 있다).
    await expect(page.getByTestId('tester-link')).toHaveCount(bundle === 'app-test' ? 1 : 0);
  });

  test(`${bundle}: 좌표 복사가 실패하면(껍데기가 ok:false) 길게 눌러 복사하라고 알린다`, async ({ page }) => {
    await openBundle(page, bundle, { copy: 'fail' });
    await page.getByRole('button', { name: '예시 결과 보기' }).click();
    await page.getByTestId('to-steps').click();
    await page.getByTestId('step-1').getByTestId('copy-coords').click();
    await expect(page.getByTestId('step-1').getByText(S.steps.copyFailed)).toBeVisible();
    expect((await bridgeLog(page)).filter(([n]) => n === 'saCopy')).toHaveLength(1);
  });
}

for (const bundle of BUNDLES) {
  test(`${bundle}: 햅틱은 받아들인 키패드 누름 한 번에 한 번이고, 잠긴 키와 버려진 누름에는 보내지 않는다`, async ({ page }) => {
    const exam = loadExam('a');
    const answers = exampleAnswers(exam);
    const kinds = Object.fromEntries(exam.items.map((it) => [it.no, it.kind])) as Record<number, 'mc' | 'short'>;
    await openBundle(page, bundle);
    await page.getByRole('button', { name: '시험 고르기' }).click();
    await chooseExam(page, 'sample-a');
    await enterKeypad(page, exam, answers, 1, 20);
    let expected = keyPresses(answers, 1, 20, kinds);
    expect(await hapticCount(page)).toBe(expected);
    // 21번(5지선다)에서 "안 풂"을 누르면 22번(단답형)으로 넘어가며 키패드가 바뀐다.
    // 같은 자리를 곧바로 한 번 더 누르면 키패드 위에서 버린 누름이라(알림이 뜬다) 햅틱이 없다.
    expect(kinds[21]).toBe('mc');
    expect(kinds[22]).toBe('short');
    const skip = (await page.locator('.pad [data-key="skip"]').boundingBox())!;
    await page.mouse.click(skip.x + skip.width / 2, skip.y + skip.height / 2);
    await page.mouse.click(skip.x + skip.width / 2, skip.y + skip.height / 2);
    await expect(page.getByTestId('tap-notice')).toBeVisible();
    await expect(page.getByTestId('now-no')).toHaveText('22번');
    expected += 1;
    expect(await hapticCount(page)).toBe(expected);
    await page.waitForTimeout(600);
    await enterKeypad(page, exam, answers, 22, 29);
    expected += keyPresses(answers, 22, 29, kinds);
    expect(await hapticCount(page)).toBe(expected);
    // 마지막 문항(30번)을 넣고 "다음"을 누른 뒤, 같은 자리를 바로 한 번 더 누른다: 입력 확인으로 넘어가며 버린 누름이라 햅틱이 없다.
    for (const d of String(answers[30])) await tapKey(page, d);
    const go = (await page.locator('[data-key="go"]').boundingBox())!;
    await page.mouse.click(go.x + go.width / 2, go.y + go.height / 2);
    await page.mouse.click(go.x + go.width / 2, go.y + go.height / 2);
    await expectHash(page, '/review');
    expected += keyPresses(answers, 30, 30, kinds);
    expect(await hapticCount(page)).toBe(expected);
    // 다 찬 채로 답 입력 화면을 열면 키가 모두 잠겨 있다(지우기도). 잠긴 키를 눌러도 햅틱이 없다.
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: '뒤로' }).click();
    await expectHash(page, '/input');
    const before = await hapticCount(page);
    for (const k of ['go', '3', 'erase']) await page.locator(`[data-key="${k}"]`).click({ force: true });
    expect(await hapticCount(page)).toBe(before);
    // 칸을 눌러 고치기로 들어가면 키가 풀리고, 받아들인 누름(지우기)에는 햅틱이 있다.
    await page.locator('main [data-cell="29"]').click();
    await tapKey(page, 'erase');
    expect(await hapticCount(page)).toBe(before + 1);
  });
}

for (const bundle of BUNDLES) {
  for (const scale of [1.25, 1.5, 2]) {
    test(`${bundle}: 글자 크기 ${scale}배에서 답 입력을 끝까지 할 수 있다`, async ({ page }) => {
      const exam = loadExam('a');
      await openBundle(page, bundle, { fontScale: scale });
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(`${16 * scale}px`);
      await page.getByRole('button', { name: '시험 고르기' }).click();
      await chooseExam(page, 'sample-a');
      await enterKeypad(page, exam, exampleAnswers(exam));
      await expectHash(page, '/review');
      addMetric({ kind: 'app-font', bundle, scale, done: true });
    });
  }
}

test('app-test: 껍데기가 글자 크기 바뀜을 알리면 바로 바꾸고, 1보다 작으면 1, 2보다 크면 2, 숫자가 아니면 1로 본다', async ({ page }) => {
  await openBundle(page, 'app-test', { fontScale: 0.8 });
  const size = () => page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  expect(await size()).toBe('16px');
  const send = (value: unknown) => sendFromApp(page, { type: 'fontScale', value });
  await send(1.5);
  expect(await size()).toBe('24px');
  await send(3);
  expect(await size()).toBe('32px');
  await send('큼');
  expect(await size()).toBe('16px');
  // JSON 으로 실을 수 없는 값도 껍데기가 스크립트로 넣을 수 있으므로 본다.
  const sendExpr = (expr: string) =>
    page.evaluate((e) => {
      const value = { inf: Infinity, ninf: -Infinity, nan: NaN, neg: -1, nul: null }[e];
      (window as unknown as { __saFromApp: (m: unknown) => void }).__saFromApp({ type: 'fontScale', value });
    }, expr);
  await sendExpr('inf');
  expect(await size()).toBe('32px');
  await sendExpr('ninf');
  expect(await size()).toBe('16px');
  await send(1.25);
  await sendExpr('nan');
  expect(await size()).toBe('16px');
  await send(1.25);
  await sendExpr('neg');
  expect(await size()).toBe('16px');
  await send(1.25);
  await sendExpr('nul');
  expect(await size()).toBe('16px');
});

test('app-test: 진행자용 화면은 있고 "파일 저장"은 빼고 복사만 둔다. 복사가 실패하거나 답이 없으면 다시 누르라고 알린다', async ({ page }) => {
  await openBundle(page, 'app-test', {}, '/test');
  await expect(page.getByText(S_TEST.title).first()).toBeVisible();
  // 시험용 묶음의 진행자용 화면에는 소개 문장 아래에 풀이 잠금 한 줄이 있다(작업 지시서 3의 4-5). 묶음 안 달력으로 지금을 판정한다(달력에 따라 열림이나 잠김).
  await expect(page.getByTestId('lock-status')).toHaveText(/^풀이 잠금: 지금 (열림|잠김\(오[전후] \d+시( \d+분)?까지\))$/);
  await expect(page.getByTestId('save-json')).toHaveCount(0);
  await expect(page.getByTestId('save-csv')).toHaveCount(0);
  await expect(page.getByText(S_TEST.noNetworkApp)).toBeVisible();
  await page.getByTestId('copy-csv').click();
  await expect(page.getByText(S_TEST.copied)).toBeVisible();
  expect((await bridgeLog(page)).filter(([n]) => n === 'saCopy')).toHaveLength(1);
  // 껍데기가 답하지 않으면 3초 뒤 실패로 보고, 앱에 맞는 실패 문구를 보인다(파일 저장을 말하지 않는다).
  await setCopyMode(page, 'silent');
  await page.getByTestId('copy-json').click();
  await expect(page.getByText(S_TEST.copied)).toBeVisible();
  await expect(page.getByText(S_TEST.copyFailedApp)).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(S_TEST.copied)).toHaveCount(0);
  // 다음 요청을 보낸 뒤에 앞 요청의 늦은 답(ok:false)이 와도 건너뛰고, 다음 요청은 자기 답(ok:true)으로 끝난다.
  await page.getByTestId('copy-csv').click();
  await sendFromApp(page, { type: 'copied', ok: false });
  await page.waitForTimeout(100);
  await expect(page.getByText(S_TEST.copied)).toHaveCount(0);
  await sendFromApp(page, { type: 'copied', ok: true });
  await expect(page.getByText(S_TEST.copied)).toBeVisible();
  // 껍데기가 ok:false 로 답하면 실패 문구.
  await setCopyMode(page, 'fail');
  await page.getByTestId('copy-json').click();
  await expect(page.getByText(S_TEST.copyFailedApp)).toBeVisible();
  await expect(page.getByText(S_TEST.copyFailed)).toHaveCount(0);
  expect((await bridgeLog(page)).filter(([n]) => n === 'saCopy')).toHaveLength(4);
});

test('app-test: 진행자가 5행 방식으로 측정을 시작하면 앱에서도 5행 화면이 열리고 측정 기록이 다리로 저장된다', async ({ page }) => {
  await openBundle(page, 'app-test', {}, '/test');
  await page.getByLabel('참가자 코드').fill('P01');
  await page.getByTestId('mode-rows').click();
  await page.getByTestId('texam-sample-a').click();
  await page.getByTestId('start-run').click();
  await expectHash(page, '/');
  await page.getByRole('button', { name: '시험 고르기' }).click();
  await chooseExam(page, 'sample-a');
  await expect(page.locator('[data-row="1"]')).toBeVisible();
  await page.locator('[data-row="1"] [data-choice="2"]').click();
  await page.locator('[data-row="2"] [data-choice="4"]').click();
  await expect(page.getByTestId('entered-count')).toHaveText('2문항 입력');
  const saved = (await lastSave(page)) as { testRuns: { id: string; inputMode: string; participant: string }[]; activeRunId: string };
  expect(saved.testRuns).toHaveLength(1);
  expect(saved.testRuns[0]!.inputMode).toBe('rows');
  expect(saved.testRuns[0]!.participant).toBe('P01');
  expect(saved.activeRunId).toBe(saved.testRuns[0]!.id);
  expect(await localCount(page)).toBe(0);
  // 주소의 input=rows 도 시험용 묶음에서는 5행 화면을 연다(배포용 묶음의 대조).
  const again = await page.context().newPage();
  await openBundle(again, 'app-test', {}, '/');
  await again.goto(`${bundleUrl('app-test')}?input=rows#/exams`);
  await chooseExam(again, 'sample-a');
  await expect(again.locator('[data-row="1"]')).toBeVisible();
  await again.close();
});

test('app-test: 길게 누르기와 끌어당김을 막는 모양은 앱에만 있고, 글을 적는 칸과 좌표 목록은 고를 수 있다', async ({ page }) => {
  const style = (selector: string, prop: string) =>
    page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s!)!).getPropertyValue(p!), [selector, prop] as const);
  await openBundle(page, 'app-test', {}, '/test');
  expect(await style('body', 'user-select')).toBe('none');
  expect(await style('html', 'overscroll-behavior-y')).toBe('none');
  expect(await style('main.body', 'overscroll-behavior-y')).toBe('contain');
  // 진행자용 화면의 참가자 코드 칸, 그리고 글을 적는 칸(정답지 대조 칸과 같은 textarea).
  expect(await style('input', 'user-select')).toBe('text');
  await page.evaluate(() => document.querySelector('main')!.appendChild(document.createElement('textarea')));
  expect(await style('textarea', 'user-select')).toBe('text');
  // 계단 화면의 좌표 목록(복사가 실패하면 길게 눌러 고르라고 안내하는 곳).
  await page.goto(`${bundleUrl('app-test')}#/`);
  await page.getByRole('button', { name: '예시 결과 보기' }).click();
  await page.getByTestId('to-steps').click();
  await page.locator('.selectable').first().waitFor();
  expect(await style('.selectable', 'user-select')).toBe('text');
});

test('일반 웹 빌드에는 앱에서만 쓰는 모양(길게 누르기와 끌어당김 막기)과 문구가 없다', async ({ page }) => {
  await openApp(page, '/');
  await expect(page.locator('html')).not.toHaveClass(/sa-app/);
  expect(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('user-select'))).not.toBe('none');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('overscroll-behavior-y'))).toBe('auto');
  await expect(page.getByText(S.start.privacy)).toBeVisible();
  await expect(page.getByText(S_APP.privacy)).toHaveCount(0);
});

test('app-release: 진행자용 화면, 입력 방식 전환과 5행 방식, "준비 중인 기능", 측정 기록 코드가 묶음에서 빠져 있다', async ({ page }) => {
  const html = readFileSync(bundlePath('app-release'), 'utf8');
  const strings = (obj: unknown): string[] =>
    typeof obj === 'string' ? [obj] : typeof obj === 'object' && obj !== null ? Object.values(obj).flatMap(strings) : [];
  // 함수로 된 문구는 값이 들어가지 않는 고정 조각을 본다(예: "다음 N문항"의 "문항").
  const fragments = (obj: unknown): string[] =>
    typeof obj === 'function'
      ? String(obj)
          .split(/\$\{[^}]*\}/)
          .flatMap((part) => part.match(/[가-힣][^`'"]*[가-힣.]/g) ?? [])
      : typeof obj === 'object' && obj !== null
        ? Object.values(obj).flatMap(fragments)
        : [];
  // 모든 묶음이 함께 쓰는 문구(S, S_APP)에 들어 있는 말("시험", "안 풂", "복사했어요." 등)은 배포용 묶음에 있어도 되므로 뺀다.
  const shared = [...strings(S), ...strings(S_APP), ...fragments(S), ...fragments(S_APP)];
  const banned = [
    ...new Set(
      ['테스트 시작하기', '준비 중인 기능', ...strings(S_TEST), ...strings(S_TOOLS), ...strings(S_ROWS), ...fragments(S_TEST), ...fragments(S_TOOLS), ...fragments(S_ROWS)].filter(
        (t) => t.length >= 2 && !shared.some((x) => x.includes(t)),
      ),
    ),
  ];
  const found = banned.filter((t) => html.includes(t));
  expect(found, '배포용 묶음에 남은 글자').toEqual([]);
  // 측정 기록 코드(측정에 묶이지 않은 화면의 이름에 붙이는 표식)와 도구 화면만 쓰는 모양(CSS)도 빠져 있다.
  expect(html).not.toContain('other:');
  const toolCss = ['.body--rows', '.row__choices', '.radio__circle', '.upcoming', '.field__input', '.kv'];
  expect(toolCss.filter((sel) => html.includes(sel)), '배포용 묶음에 남은 도구 화면 CSS').toEqual([]);
  // 시험용 묶음에는 있다(검사가 제대로 찾는지 보는 대조).
  const testHtml = readFileSync(bundlePath('app-test'), 'utf8');
  expect(testHtml).toContain('테스트 시작하기');
  expect(testHtml).toContain('준비 중인 기능');
  expect(testHtml).toContain(S_ROWS.toReview);
  expect(testHtml).toContain('other:');
  expect(toolCss.filter((sel) => testHtml.includes(sel))).toEqual(toolCss);
  expect(banned.filter((t) => testHtml.includes(t)).length, '시험용 묶음에서 찾은 글자 수').toBeGreaterThan(40);
  addMetric({ kind: 'app-release-text', checked: banned.length, found: found.length });

  // 화면에서도: 진행자용 화면 주소는 시작 화면으로, 주소의 input=rows 는 따르지 않는다.
  await openBundle(page, 'app-release', {}, '/test');
  await expectHash(page, '/');
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await expect(page.getByTestId('tester-link')).toHaveCount(0);
  await expect(page.getByText('준비 중인 기능')).toHaveCount(0);
  await page.goto(`${bundleUrl('app-release')}?input=rows#/exams`);
  await chooseExam(page, 'sample-a');
  await expect(page.getByTestId('now-no')).toHaveText('1번');
  await expect(page.locator('[data-row]')).toHaveCount(0);
});

