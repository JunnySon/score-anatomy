import type { Page } from '@playwright/test';
import { exampleAnswers, exampleCauses, exampleMarks } from '../src/logic/example';
import { VARIANT_URL } from '../playwright.config';
import { domSnapshot } from './audit';
import { addMetric, chooseCauses, chooseExam, enterKeypad, expect, expectHash, loadExam, openApp, retryAnswer, setMarks, tapKey, test } from './helpers';

// 10장 9번: 정답 노출 검사(차분 방식).
// 배포하는 빌드와, 틀린 6문항의 정답만 다른 값으로 바꾼 검증용 빌드에 똑같은 조작을 한다.
// "정답 보기"를 누르기 전의 화면(보이는 글자, 숨은 글자, 모든 속성, 입력 값, 가상 요소 글자)이
// 두 빌드에서 한 글자도 다르지 않으면, 그 화면 어디에도 정답이 드러나 있지 않다는 뜻이다.

test.use({ viewport: { width: 390, height: 844 } });

test('정답만 다른 두 빌드의 화면이 "정답 보기" 전에는 완전히 같다', async ({ page, browser }) => {
  const exam = loadExam('a');
  const answers = exampleAnswers(exam);
  const ctx = await browser.newContext({
    baseURL: VARIANT_URL,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  const other = await ctx.newPage();
  const errors: string[] = [];
  other.on('pageerror', (e) => errors.push(e.message));

  let compared = 0;
  const differences: string[] = [];
  /** 두 빌드에 같은 조작을 한다. */
  const both = async (fn: (p: Page) => Promise<void>) => {
    await fn(page);
    await fn(other);
  };
  /** 두 화면을 통째로 견준다. */
  const same = async (where: string) => {
    const [a, b] = [await domSnapshot(page), await domSnapshot(other)];
    compared += 1;
    if (a !== b) {
      let i = 0;
      while (i < a.length && a[i] === b[i]) i += 1;
      differences.push(`${where}: ${JSON.stringify(a.slice(Math.max(0, i - 40), i + 40))} / ${JSON.stringify(b.slice(Math.max(0, i - 40), i + 40))}`);
    }
    expect.soft(a === b, `${where}: 두 빌드의 화면이 같아야 함`).toBe(true);
  };

  // 답 입력부터 채점까지
  await both(async (p) => {
    await openApp(p, '/?input=keypad');
    await p.getByRole('button', { name: '시험 고르기' }).click();
    await chooseExam(p, 'sample-a');
    await enterKeypad(p, exam, answers);
    await expectHash(p, '/review');
  });
  await same('입력 확인');
  await both(async (p) => {
    await p.locator('main [data-cell="11"]').click();
    await expect(p.getByRole('dialog')).toBeVisible();
  });
  await same('입력 확인, 틀린 문항의 답 고치기 시트');
  await both(async (p) => {
    await p.getByRole('button', { name: '닫기' }).click();
    await p.getByRole('button', { name: '맞아요, 다음으로' }).click();
    await expectHash(p, '/marks');
    await setMarks(p, exampleMarks());
  });
  await same('표시');
  await both(async (p) => {
    await p.getByRole('button', { name: '채점하기' }).click();
    await expectHash(p, '/score');
  });
  await same('점수');

  // 오답 원인
  await both(async (p) => {
    await p.getByRole('button', { name: '틀린 문항 살펴보기' }).click();
    await expectHash(p, '/causes');
  });
  await same('오답 원인, 고르기 전');
  await both((p) => chooseCauses(p, exampleCauses()));
  await same('오답 원인, 고른 뒤');

  // 점수 해부
  await both(async (p) => {
    await p.getByRole('button', { name: '점수 해부 보기' }).click();
    await expectHash(p, '/anatomy');
  });
  await same('점수 해부, 목표 고르기 전');
  for (const g of ['1', '2', '3']) {
    await both(async (p) => {
      await p.getByTestId(`grade-${g}`).click();
      await expect(p.getByTestId('cut-title')).toContainText(`${g}등급 컷`);
    });
    await same(`점수 해부, ${g}등급`);
  }
  await both(async (p) => {
    await p.getByTestId('grade-2').click();
    await p.getByText('약 75점 설명 보기').click();
    await p.getByTestId('cut-badge').click();
    await expect(p.getByTestId('cut-source')).toBeVisible();
  });
  await same('점수 해부, 설명과 출처를 편 상태');

  // 계단
  await both(async (p) => {
    await p.getByRole('button', { name: '닫기' }).click();
    await p.getByTestId('to-steps').click();
    await expectHash(p, '/steps');
    for (const n of [1, 2, 3]) await p.getByTestId(`step-${n}`).getByText('순서를 정한 방법').click();
  });
  await same('계단, 설명을 모두 편 상태');

  // 재풀이: 두 빌드 모두에서 틀린 답을 넣는다(15번에 1, 29번에 275).
  await both(async (p) => {
    await p.getByTestId('step-2').getByTestId('retry-btn').click();
    await expectHash(p, '/retry/t03');
  });
  await same('재풀이, 답 넣기 전');
  await both(async (p) => {
    await tapKey(p, 1);
  });
  await same('재풀이, 답을 고른 상태');
  await both(async (p) => {
    await tapKey(p, 'go');
    await expect(p.getByTestId('retry-result')).toContainText('이번에도 답이 달랐어요.');
  });
  await same('재풀이, 틀린 뒤(객관식)');
  await both(async (p) => {
    await p.getByTestId('retry-next').click();
    await retryAnswer(p, exam, 29, 275);
    await expect(p.getByTestId('retry-result')).toContainText('이번에도 답이 달랐어요.');
  });
  await same('재풀이, 틀린 뒤(단답형)');
  await both(async (p) => {
    await p.getByTestId('retry-next').click();
    await expectHash(p, '/steps');
  });
  await same('계단, 다시 푼 기록이 있는 상태');

  // 기록, 시작, 예시 결과, 입력 화면으로 돌아간 상태
  await both(async (p) => {
    await p.getByRole('link', { name: '기록', exact: true }).click();
    await expectHash(p, '/history');
  });
  await same('기록');
  await both((p) => openApp(p, '/'));
  await same('시작(이어서 보기)');
  await both(async (p) => {
    await p.getByRole('button', { name: '예시 결과 보기' }).click();
    await expectHash(p, '/demo/anatomy');
    await p.getByTestId('grade-2').click();
  });
  await same('예시 결과, 점수 해부');
  await both(async (p) => {
    await p.getByTestId('to-steps').click();
    await expectHash(p, '/demo/steps');
  });
  await same('예시 결과, 계단');
  await both(async (p) => {
    await p.getByTestId('step-1').getByTestId('retry-btn').click();
    await expectHash(p, '/demo/retry/t06');
  });
  await same('예시 결과, 재풀이');
  await both((p) => openApp(p, '/input?input=rows'));
  await same('채점 뒤에 다시 연 답 입력(5행 방식)');
  await both((p) => openApp(p, '/input?input=keypad'));
  await same('채점 뒤에 다시 연 답 입력(키패드 방식)');
  await both((p) => openApp(p, '/marks'));
  await same('채점 뒤에 다시 연 표시');

  // 대조: "정답 보기"를 누르면 두 빌드의 화면이 달라져야 한다. 이 검사가 정답 노출을 실제로 잡아낸다는 뜻이다.
  await both(async (p) => {
    await openApp(p, '/causes');
    await p.getByTestId('show-answer-27').click();
    await expect(p.getByTestId('answer-27')).toBeVisible();
  });
  const short = [await domSnapshot(page), await domSnapshot(other)];
  expect(short[0] === short[1], '27번 정답을 연 뒤에는 화면이 달라야 함').toBe(false);
  await expect(page.getByTestId('answer-27')).toContainText('정답 164');
  await expect(other.getByTestId('answer-27')).toContainText('정답 731');
  await both(async (p) => {
    await p.reload();
    await openApp(p, '/causes');
  });
  // 27번은 이미 열려 있으니 두 화면이 다르다. 15번(5지선다)만 따로 본다.
  await both(async (p) => {
    await p.getByTestId('show-answer-15').click();
    await expect(p.getByTestId('answer-15')).toBeVisible();
  });
  const cardOf = (p: Page) => p.getByTestId('wrong-15').evaluate((el) => el.outerHTML);
  const mc = [await cardOf(page), await cardOf(other)];
  expect(mc[0] === mc[1], '15번 정답을 연 뒤에는 그 카드가 달라야 함').toBe(false);

  addMetric({ kind: 'leak-diff', compared, differences, controlShort: short[0] !== short[1], controlMc: mc[0] !== mc[1] });
  expect(differences).toEqual([]);
  expect(errors).toEqual([]);
  await ctx.close();
});
