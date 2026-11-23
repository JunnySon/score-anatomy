import { readFileSync } from 'node:fs';
import { exampleAnswers, exampleCauses, exampleMarks } from '../src/logic/example';
import { S, S_APP, S_ROWS, S_TEST, S_TOOLS } from '../src/strings';
import type { Answers } from '../src/types';
import { bridgeLog, bundlePath, bundleUrl, hapticCount, openBundle, storeMessages } from './appBridge';
import { addMetric, chooseCauses, chooseExam, enterKeypad, expect, expectHash, loadExam, setMarks, tapKey, test } from './helpers';

// 앱용 묶음(작업 지시서 1의 2부): 가짜 다리를 넣은 브라우저에서 커밋된 묶음 두 개를 직접 연다.
// 껍데기와의 약속은 docs/앱_다리_규격.md 에 있다. 묶음은 ios/ScoreAnatomy/Web 에 있고, verify 가 지금 코드로 다시 만든 것과 같은지 따로 본다.

/** 키패드로 넣을 때 누르는 키 수(5지선다 1번, 단답형은 숫자 자리 수와 "다음"). */
function keyPresses(answers: Answers, from: number, to: number, kinds: Record<number, 'mc' | 'short'>): number {
  let n = 0;
  for (let no = from; no <= to; no += 1) {
    const v = answers[no]!;
    n += v === 'skip' || kinds[no] === 'mc' ? 1 : String(v).length + 1;
  }
  return n;
}

for (const bundle of ['app-test', 'app-release'] as const) {
  test(`${bundle}: 예시 시험 A를 검산 예시대로 넣으면 78점, 7점, 8점, 3~7점, 약 75점, 6~10점, 계단 3개`, async ({ page }) => {
    const exam = loadExam('a');
    const answers = exampleAnswers(exam);
    await openBundle(page, bundle);
    await expect(page.locator('html')).toHaveClass(/sa-app/);
    // 앱에서만 바꾸는 문구.
    await expect(page.getByText('가입 없이 써요. 기록은 이 기기에 저장하고 서버로 보내지 않아요.')).toBeVisible();
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
    await expect(page.getByTestId('row-guess')).toContainText('7점');
    await expect(page.getByTestId('row-slip')).toContainText('8점');
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
    await expect(page.getByTestId('step-1').getByText('좌표를 복사했어요.')).toBeVisible();
    const copies = (await bridgeLog(page)).filter(([n]) => n === 'saCopy');
    expect(copies).toEqual([['saCopy', '예시 좌표 12번\n예시 좌표 20번']]);
    // 기록 화면 아래의 앱 문구.
    await page.getByRole('link', { name: '기록', exact: true }).click();
    await expect(page.getByTestId('history-item')).toContainText('78점');
    await expect(page.getByText('앱을 지우면 기록도 함께 지워져요.')).toBeVisible();
    // 저장은 saStore 로만 하고 localStorage 는 비어 있다.
    const saves = await storeMessages(page);
    expect(saves.length).toBeGreaterThan(30);
    expect(saves.every((m) => m.op === 'save' && typeof m.json === 'string')).toBe(true);
    expect(await page.evaluate(() => window.localStorage.length)).toBe(0);
    addMetric({ kind: 'app', bundle, score: 78, steps: 3, saves: saves.length });
  });
}

test('app-test: 저장한 기록으로 다시 열면 "이어서 보기"가 되고, 끝냈다 켠 뒤에도 기록이 남는다', async ({ page, context }) => {
  const exam = loadExam('a');
  const answers = exampleAnswers(exam);
  await openBundle(page, 'app-test');
  await page.getByRole('button', { name: '시험 고르기' }).click();
  await chooseExam(page, 'sample-a');
  await enterKeypad(page, exam, answers, 1, 12);
  const saves = await storeMessages(page);
  const last = saves[saves.length - 1]!.json!;
  expect(JSON.parse(last).sessions[0].answers[12]).toBe(answers[12]);
  // 껍데기가 마지막으로 저장한 글자를 store 로 넣어 다시 연다(앱을 끝냈다 켠 것과 같다).
  const again = await context.newPage();
  await openBundle(again, 'app-test', { store: last });
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
] as const) {
  test(`app-test: ${name}는 덮어쓰지 않고 archive 를 먼저 보낸 뒤 새로 시작한다`, async ({ page }) => {
    await openBundle(page, 'app-test', { store });
    await page.getByRole('link', { name: '기록', exact: true }).click();
    await expect(page.getByText('앞서 저장된 기록을 읽지 못해 따로 보관해 뒀어요.')).toBeVisible();
    await expect(page.getByTestId('history-empty')).toBeVisible();
    // 새로 넣으면 그때부터 저장한다. 첫 메시지는 늘 archive 다.
    await page.getByRole('link', { name: '이번 시험' }).click();
    await page.getByRole('button', { name: '시험 고르기' }).click();
    await chooseExam(page, 'sample-a');
    await tapKey(page, 3);
    const msgs = await storeMessages(page);
    expect(msgs[0]).toEqual({ op: 'archive' });
    expect(msgs.filter((m) => m.op === 'archive')).toHaveLength(1);
    expect(msgs.slice(1).every((m) => m.op === 'save')).toBe(true);
    expect(msgs.length).toBeGreaterThan(1);
  });
}

test('app-test: 껍데기가 저장에 실패했다고 알리면 기록 화면에 알린다(화면은 그대로 쓸 수 있다)', async ({ page }) => {
  await openBundle(page, 'app-test');
  await page.evaluate(() => (window as unknown as { __saFromApp: (m: unknown) => void }).__saFromApp({ type: 'storeFailed' }));
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await expect(page.getByText('이 기기에 기록을 저장하지 못했어요. 화면은 그대로 쓸 수 있어요.')).toBeVisible();
  await expect(page.getByText('이 브라우저에서는', { exact: false })).toHaveCount(0);
});

test('app-test: 햅틱은 받아들인 키패드 누름 한 번에 한 번이고, 잠긴 키와 버려진 누름에는 보내지 않는다', async ({ page }) => {
  const exam = loadExam('a');
  const answers = exampleAnswers(exam);
  const kinds = Object.fromEntries(exam.items.map((it) => [it.no, it.kind])) as Record<number, 'mc' | 'short'>;
  await openBundle(page, 'app-test');
  await page.getByRole('button', { name: '시험 고르기' }).click();
  await chooseExam(page, 'sample-a');
  await enterKeypad(page, exam, answers, 1, 29);
  expect(await hapticCount(page)).toBe(keyPresses(answers, 1, 29, kinds));
  // 마지막 문항(30번)을 넣고 "다음"을 누른 뒤, 같은 자리를 바로 한 번 더 누른다: 입력 확인으로 넘어가며 버린 누름이라 햅틱이 없다.
  for (const d of String(answers[30])) await tapKey(page, d);
  const go = (await page.locator('[data-key="go"]').boundingBox())!;
  await page.mouse.click(go.x + go.width / 2, go.y + go.height / 2);
  await page.mouse.click(go.x + go.width / 2, go.y + go.height / 2);
  await expectHash(page, '/review');
  expect(await hapticCount(page)).toBe(keyPresses(answers, 1, 30, kinds));
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

for (const scale of [1.25, 1.5, 2]) {
  test(`app-test: 글자 크기 ${scale}배에서 답 입력을 끝까지 할 수 있다`, async ({ page }) => {
    const exam = loadExam('a');
    await openBundle(page, 'app-test', { fontScale: scale });
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(`${16 * scale}px`);
    await page.getByRole('button', { name: '시험 고르기' }).click();
    await chooseExam(page, 'sample-a');
    await enterKeypad(page, exam, exampleAnswers(exam));
    await expectHash(page, '/review');
    addMetric({ kind: 'app-font', scale, done: true });
  });
}

test('app-test: 껍데기가 글자 크기 바뀜을 알리면 바로 바꾸고, 1보다 작으면 1, 2보다 크면 2로 본다', async ({ page }) => {
  await openBundle(page, 'app-test', { fontScale: 0.8 });
  const size = () => page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  expect(await size()).toBe('16px');
  const send = (value: unknown) =>
    page.evaluate((v) => (window as unknown as { __saFromApp: (m: unknown) => void }).__saFromApp({ type: 'fontScale', value: v }), value);
  await send(1.5);
  expect(await size()).toBe('24px');
  await send(3);
  expect(await size()).toBe('32px');
  await send('큼');
  expect(await size()).toBe('16px');
});

test('app-test: 진행자용 화면은 있고 "파일 저장"은 빼고 복사만 둔다', async ({ page }) => {
  await openBundle(page, 'app-test', {}, '/test');
  await expect(page.getByText(S_TEST.title).first()).toBeVisible();
  await expect(page.getByTestId('save-json')).toHaveCount(0);
  await expect(page.getByTestId('save-csv')).toHaveCount(0);
  await expect(page.getByText(S_TEST.noNetworkApp)).toBeVisible();
  await page.getByTestId('copy-csv').click();
  await expect(page.getByText(S_TEST.copied)).toBeVisible();
  expect((await bridgeLog(page)).filter(([n]) => n === 'saCopy')).toHaveLength(1);
});

test('app-release: 진행자용 화면, 입력 방식 전환과 5행 방식, "준비 중인 기능"이 묶음에서 빠져 있다', async ({ page }) => {
  const html = readFileSync(bundlePath('app-release'), 'utf8');
  const strings = (obj: unknown): string[] =>
    typeof obj === 'string' ? [obj] : typeof obj === 'object' && obj !== null ? Object.values(obj).flatMap(strings) : [];
  // 모든 묶음이 함께 쓰는 문구(S, S_APP)에 들어 있는 말("시험", "안 풂", "복사했어요." 등)은 배포용 묶음에 있어도 되므로 뺀다.
  const shared = [...strings(S), ...strings(S_APP)];
  const banned = ['테스트 시작하기', '준비 중인 기능', ...strings(S_TEST), ...strings(S_TOOLS), ...strings(S_ROWS)].filter(
    (t) => t.length >= 2 && !shared.some((x) => x.includes(t)),
  );
  const found = [...new Set(banned)].filter((t) => html.includes(t));
  expect(found, '배포용 묶음에 남은 글자').toEqual([]);
  // 시험용 묶음에는 있다(검사가 제대로 찾는지 보는 대조).
  const testHtml = readFileSync(bundlePath('app-test'), 'utf8');
  expect(testHtml).toContain('테스트 시작하기');
  expect(testHtml).toContain('준비 중인 기능');
  expect(testHtml).toContain(S_ROWS.toReview);
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
