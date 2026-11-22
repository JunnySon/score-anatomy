import { readFileSync } from 'node:fs';
import { exampleAnswers } from '../src/logic/example';
import { chooseExam, enterRows, expect, expectHash, loadExam, openApp, tapKey, test } from './helpers';

// (12) 테스트 진행자용 화면: 측정 기록, 정답지 대조, 내보내기.

test.use({ permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });

test('진행자용 화면: 참가자 시작, 자동 기록, 정답지 대조, 내보내기, 초기화', async ({ page }) => {
  const exam = loadExam('a');
  const answers = exampleAnswers(exam);

  // 기록 화면 맨 아래의 작은 링크로 들어간다.
  await openApp(page, '/history');
  await page.getByTestId('tester-link').click();
  await expectHash(page, '/test');
  await expect(page.getByTestId('no-runs')).toBeVisible();

  // 참가자 코드는 P01 형식만 받는다. 이름은 넣을 수 없다.
  await expect(page.getByText('P01처럼 적어 주세요. 이름은 넣지 마세요.')).toBeVisible();
  await page.getByLabel('참가자 코드').fill('김민');
  await page.getByTestId('start-run').click();
  await expect(page.getByText('참가자 코드를 P01 같은 형식으로 적어 주세요.')).toBeVisible();
  await expectHash(page, '/test');
  await page.getByLabel('참가자 코드').fill('p07');
  await expect(page.getByLabel('참가자 코드')).toHaveValue('P07');
  await page.getByTestId('mode-rows').click();
  await page.getByTestId('texam-sample-a').click();
  await page.getByTestId('start-run').click();
  await expectHash(page, '/');

  // 참가자 흐름: 진행자가 고른 5행 방식으로 열린다.
  await page.getByRole('button', { name: '시험 고르기' }).click();
  await chooseExam(page, 'sample-a');
  await expect(page.locator('[data-row="1"]')).toBeVisible();
  // 일부러 3번을 잘못 넣는다.
  const typed = { ...answers, 3: 5 };
  await enterRows(page, exam, typed);
  // 입력 확인에서 3번을 고친다.
  await page.locator('main [data-cell="3"]').click();
  await tapKey(page.locator('.sheet'), answers[3] as number);
  await page.getByRole('button', { name: '맞아요, 다음으로' }).click();
  await expectHash(page, '/marks');
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: '없어요' }).click();
  await expectHash(page, '/score');

  // 진행자 화면으로 돌아와 측정 기록을 본다.
  await openApp(page, '/test');
  await expect(page.getByTestId('active-run')).toContainText('P07, 5행 방식');
  const card = page.getByTestId('run-card');
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute('data-participant', 'P07');
  await expect(card).toHaveAttribute('data-mode', 'rows');
  await expect(card.getByTestId('m-input')).toHaveText(/^\d+(\.\d)?초$/);
  await expect(card.getByTestId('m-input-count')).toHaveText('31번');
  await expect(card.getByTestId('m-review-fixed')).toHaveText('1개');
  await expect(card.getByTestId('m-to-score')).toHaveText(/^\d+(\.\d)?초$/);
  const marksText = await card.getByTestId('m-marks').innerText();
  expect(Number(marksText.replace('초', ''))).toBeGreaterThanOrEqual(1);
  await card.getByText('화면 진입 기록').click();
  const screens = await card.getByTestId('run-screens').locator('li').allInnerTexts();
  expect(screens.map((s) => s.split(' ')[1])).toEqual(['start', 'exams', 'input', 'review', 'marks', 'score']);

  // 정답지 대조: 개수가 안 맞으면 알려 준다.
  await page.getByLabel('참가자에게 준 답지의 답').fill('1,2,3');
  await page.getByTestId('key-compare').click();
  await expect(page.getByText('답이 30개여야 해요. 지금은 3개예요.')).toBeVisible();
  // 답지와 같으면 남은 오입력 0개.
  const key = exam.items.map((it) => answers[it.no]);
  await page.getByLabel('참가자에게 준 답지의 답').fill(key.join(','));
  await page.getByTestId('key-compare').click();
  await expect(page.getByTestId('key-result')).toHaveText('남은 오입력 0개');
  await expect(card.getByTestId('m-residual')).toHaveText('0개');
  // 답지와 두 문항이 다르면 2개, 다른 문항 번호를 알려 준다.
  const key2 = [...key];
  key2[4] = key2[4] === 1 ? 2 : 1;
  key2[24] = 151;
  await page.getByLabel('참가자에게 준 답지의 답').fill(key2.join(', '));
  await page.getByTestId('key-compare').click();
  await expect(page.getByTestId('key-result')).toHaveText('남은 오입력 2개');
  await expect(card).toContainText('다른 문항: 5번과 25번');

  // 내보내기: JSON 파일
  const [jsonDownload] = await Promise.all([page.waitForEvent('download'), page.getByTestId('save-json').click()]);
  expect(jsonDownload.suggestedFilename()).toMatch(/^score-anatomy-test-\d{8}-\d{4}\.json$/);
  const json = JSON.parse(readFileSync((await jsonDownload.path())!, 'utf8'));
  expect(json.format).toBe('score-anatomy-test-log');
  expect(json.runs).toHaveLength(1);
  expect(json.runs[0].participant).toBe('P07');
  expect(json.runs[0].inputMode).toBe('rows');
  expect(json.runs[0].examId).toBe('sample-a');
  expect(json.runs[0].metrics.inputCount).toBe(31);
  expect(json.runs[0].metrics.reviewFixedCount).toBe(1);
  expect(json.runs[0].metrics.residualErrors).toBe(2);
  expect(json.runs[0].itemInputs['3']).toBe(2);
  expect(json.runs[0].finalAnswers).toEqual(key);
  expect(json.runs[0].screens.length).toBeGreaterThanOrEqual(6);
  expect(typeof json.runs[0].inputStartAt).toBe('number');
  expect(typeof json.runs[0].inputDoneAt).toBe('number');
  expect(json.runs[0].inputDoneAt).toBeGreaterThanOrEqual(json.runs[0].inputStartAt);
  expect(json.runs[0].firstScoreAt).toBeGreaterThanOrEqual(json.runs[0].examSelectAt);
  // 이름 같은 개인정보 칸이 없다.
  expect(JSON.stringify(json)).not.toMatch(/"(name|email|phone|school|birth)"\s*:/i);

  // 내보내기: CSV 파일
  const [csvDownload] = await Promise.all([page.waitForEvent('download'), page.getByTestId('save-csv').click()]);
  const csv = readFileSync((await csvDownload.path())!, 'utf8').trim().split('\n');
  expect(csv).toHaveLength(2);
  expect(csv[0]!.startsWith('participant,input_mode,planned_exam,exam,started_at,input_seconds,input_count,review_fixed_count,marks_seconds,select_to_score_seconds,residual_errors')).toBe(true);
  expect(csv[0]!.endsWith('inputs_q30')).toBe(true);
  expect(csv[1]!.startsWith('P07,rows,sample-a,sample-a,')).toBe(true);

  // 내보내기: 클립보드 복사
  await page.getByTestId('copy-json').click();
  await expect(page.getByText('복사했어요.')).toBeVisible();
  const clip = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(clip.runs[0].participant).toBe('P07');
  await page.getByTestId('copy-csv').click();
  const clipCsv = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipCsv.split('\n')[1]!.startsWith('P07,rows,')).toBe(true);

  // 참가자를 마치면 그 뒤 화면 이동은 기록하지 않는다.
  await page.getByTestId('finish-run').click();
  await expect(page.getByTestId('active-run')).toHaveCount(0);
  await openApp(page, '/history');
  await openApp(page, '/test');
  await card.getByText('화면 진입 기록').click();
  expect(await card.getByTestId('run-screens').locator('li').count()).toBe(screens.length);

  // 기록 초기화: 확인 대화상자를 거친다. 참가자의 시험 기록은 남는다.
  await page.getByTestId('reset-runs').click();
  await expect(page.getByRole('alertdialog')).toContainText('테스트 기록을 모두 지울까요?');
  await page.getByRole('alertdialog').getByRole('button', { name: '지우기' }).click();
  await expect(page.getByTestId('no-runs')).toBeVisible();
  await openApp(page, '/history');
  await expect(page.getByTestId('history-item')).toHaveCount(1);
});

test('테스트를 시작하지 않으면 측정 기록을 남기지 않는다', async ({ page }) => {
  await openApp(page, '/');
  await page.getByRole('button', { name: '시험 고르기' }).click();
  await chooseExam(page, 'sample-a');
  await tapKey(page, 1);
  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem('score-anatomy') ?? '{}'));
  expect(stored.testRuns).toEqual([]);
  expect(stored.activeRunId).toBeNull();
});
