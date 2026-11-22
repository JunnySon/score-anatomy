import { exampleAnswers } from '../src/logic/example';
import { auditPage, waitSettled } from './audit';
import { addMetric, chooseExam, enterKeypad, expect, expectHash, loadExam, openApp, tapKey, test } from './helpers';

// 별도 검토에서 찾은 조건: 글자를 키웠거나 화면이 낮을 때도 답 입력 화면을 끝까지 쓸 수 있어야 한다.
// 내용이 한 화면에 다 들어오지 않으면 스크롤되고, 키패드와 안내문은 늘 보인다.

const CASES = [
  { name: '360x640, 기본 글자 20px', viewport: { width: 360, height: 640 }, fontPx: 20 },
  { name: '360x640, 기본 글자 24px', viewport: { width: 360, height: 640 }, fontPx: 24 },
  { name: '360x560', viewport: { width: 360, height: 560 }, fontPx: 16 },
  { name: '320x568', viewport: { width: 320, height: 568 }, fontPx: 16 },
  { name: '가로 640x360', viewport: { width: 640, height: 360 }, fontPx: 16 },
];

for (const c of CASES) {
  test.describe(c.name, () => {
    test.use({ viewport: c.viewport });

    test('키패드 방식: 키패드와 안내문이 늘 보이고 지금 칸으로 스크롤된다', async ({ page }) => {
      // 브라우저의 기본 글자 크기를 키운 것과 같은 효과(rem 기준이 커진다).
      await page.addInitScript((px) => {
        const apply = () => {
          const style = document.createElement('style');
          style.textContent = `html { font-size: ${px}px; }`;
          document.head.appendChild(style);
        };
        if (document.head) apply();
        else document.addEventListener('DOMContentLoaded', apply);
      }, c.fontPx);
      const exam = loadExam('a');
      const answers = exampleAnswers(exam);
      await openApp(page, '/?input=keypad');
      await page.getByRole('button', { name: '시험 고르기' }).click();
      await chooseExam(page, 'sample-a');
      const check = async (label: string) => {
        await waitSettled(page);
        // 키패드의 모든 키가 화면 안에 온전히 있다.
        const keys = page.locator('.pad [data-key]');
        const n = await keys.count();
        for (let i = 0; i < n; i += 1) await expect(keys.nth(i), `${label}: 키가 화면 안에 있어야 함`).toBeInViewport({ ratio: 1 });
        // 지금 넣을 칸이 보이는 곳으로 스크롤돼 있다.
        await expect(page.locator('main [aria-current="true"]'), `${label}: 지금 칸이 보여야 함`).toBeInViewport({ ratio: 0.9 });
        // 내용이 넘치면 스크롤할 수 있어야 한다(잘린 채로 멈추지 않는다).
        const scroll = await page.locator('main.body').evaluate((el) => ({ overflow: getComputedStyle(el).overflowY, over: el.scrollHeight - el.clientHeight }));
        expect(scroll.overflow, `${label}: 넘치면 스크롤`).toBe('auto');
        const r = await auditPage(page);
        expect(r.obscured, `${label}: 가려진 조작 요소`).toEqual([]);
        expect(r.overlaps, `${label}: 겹친 조작 요소`).toEqual([]);
        addMetric({ kind: 'condition', name: c.name, label, overflowPx: Math.max(0, scroll.over) });
      };
      await check('1번');
      await enterKeypad(page, exam, answers, 1, 21);
      await check('22번(단답형)');
      // 안내문이 떠도 키패드 바로 위에 온전히 보인다.
      await tapKey(page, 'go');
      const msg = page.getByText("22번이 비어 있어요. 안 푼 문항이면 '안 풂'을 눌러 주세요.");
      await expect(msg).toBeInViewport({ ratio: 1 });
      await check('22번, 안내문');
      await enterKeypad(page, exam, answers, 22, 30);
      await expectHash(page, '/review');
    });
  });
}

test.describe('폭 320px', () => {
  test.use({ viewport: { width: 320, height: 568 } });
  test('5행 방식: 지원 범위보다 좁아도 보기 5개가 화면 밖으로 나가지 않는다', async ({ page }) => {
    await openApp(page, '/?input=rows');
    await page.getByRole('button', { name: '시험 고르기' }).click();
    await chooseExam(page, 'sample-a');
    for (const n of [1, 2, 3, 4, 5]) await expect(page.locator(`[data-row="1"] [data-choice="${n}"]`)).toBeInViewport({ ratio: 1 });
    const r = await auditPage(page);
    expect(r.clippedSide).toEqual([]);
    expect(r.horizontalOverflow).toBe(false);
  });
});
