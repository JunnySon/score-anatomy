import { exampleAnswers } from '../src/logic/example';
import { checkScreen } from './audit';
import { addMetric, chooseExam, enterKeypad, expect, expectHash, loadExam, openApp, settle, tapKey, test } from './helpers';

// 10장 3번: 작은 화면(360x640)에서 키패드 방식과 5행 방식 모두
// 조작 요소가 가려지거나 겹치지 않고, 스크롤 없이 한 화면에 들어오는지 확인한다.

test.use({ viewport: { width: 360, height: 640 } });

test('작은 화면, 키패드 방식: 30문항 모두에서 조작 요소가 한 화면에 들어온다', async ({ page }) => {
  const exam = loadExam('a');
  const answers = exampleAnswers(exam);
  await openApp(page, '/?input=keypad');
  await page.getByRole('button', { name: '시험 고르기' }).click();
  await chooseExam(page, 'sample-a');
  let checked = 0;
  for (const item of exam.items) {
    await expect(page.getByTestId('now-no')).toHaveText(`${item.no}번`);
    await settle(page);
    const r = await checkScreen(page, `키패드 ${item.no}번`, 'small-keypad', { mustFit: true });
    checked += 1;
    // 키패드 키와 묶음 칸이 모두 화면 안에 있다.
    expect(r.outside).toEqual([]);
    if (item.kind === 'short') {
      // 숫자를 넣은 상태와 안내문이 뜬 상태도 본다.
      await tapKey(page, 9);
      await tapKey(page, 9);
      await tapKey(page, 9);
      await tapKey(page, 9);
      await expect(page.getByText('답은 0부터 999까지예요.')).toBeVisible();
      await checkScreen(page, `키패드 ${item.no}번, 안내문`, 'small-keypad', { mustFit: true });
      await expect(page.getByText('답은 0부터 999까지예요.')).toBeInViewport({ ratio: 1 });
      checked += 1;
      await tapKey(page, 'erase');
      await tapKey(page, 'erase');
      await tapKey(page, 'erase');
    }
    await enterKeypad(page, exam, answers, item.no, item.no);
  }
  await expectHash(page, '/review');
  addMetric({ kind: 'small', mode: 'keypad', checked });
});

test('작은 화면, 5행 방식: 5줄과 아래 버튼이 스크롤 없이 보인다', async ({ page }) => {
  const exam = loadExam('a');
  const answers = exampleAnswers(exam);
  await openApp(page, '/?input=rows');
  await page.getByRole('button', { name: '시험 고르기' }).click();
  await chooseExam(page, 'sample-a');
  let checked = 0;
  const pages = Math.ceil(exam.items.length / 5);
  for (let p = 0; p < pages; p += 1) {
    const items = exam.items.slice(p * 5, p * 5 + 5);
    await expect(page.locator(`[data-row="${items[0]!.no}"]`)).toBeVisible();
    await settle(page);
    await checkScreen(page, `5행 ${p + 1}쪽, 넣기 전`, 'small-rows', { mustFit: true });
    checked += 1;
    // 5줄과 아래 버튼이 모두 화면 안에 온전히 보인다.
    await expect(page.locator('[data-row]')).toHaveCount(items.length);
    for (const it of items) await expect(page.locator(`[data-row="${it.no}"]`)).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('rows-next')).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: '이전', exact: true })).toBeInViewport({ ratio: 1 });
    for (const it of items) {
      const row = page.locator(`[data-row="${it.no}"]`);
      const v = answers[it.no] as number;
      if (it.kind === 'mc') {
        await row.locator(`[data-choice="${v}"]`).click();
      } else {
        await row.locator('[data-short]').click();
        const sheet = page.locator('.sheet');
        for (const d of String(v)) await tapKey(sheet, d);
        if (it.no === 22 || it.no === 27) {
          // 단답형 줄을 누르면 아래에 앱 자체 숫자 키패드가 열린다. 키패드가 화면 안에 다 들어온다.
          await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
          const r = await checkScreen(page, `5행 ${it.no}번 숫자 키패드`, 'small-rows');
          expect(r.outside).toEqual([]);
          checked += 1;
        }
        await tapKey(sheet, 'go');
        await expect(sheet).toHaveCount(0);
      }
    }
    if (p === 0) {
      await page.locator('[data-row="3"] [data-row-no]').click();
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
      const r = await checkScreen(page, '5행 번호 메뉴', 'small-rows');
      expect(r.outside).toEqual([]);
      checked += 1;
      await page.getByRole('button', { name: '닫기' }).click();
    }
    await checkScreen(page, `5행 ${p + 1}쪽, 넣은 뒤`, 'small-rows', { mustFit: true });
    checked += 1;
    await page.getByTestId('rows-next').click();
  }
  await expectHash(page, '/review');
  addMetric({ kind: 'small', mode: 'rows', checked });
});
