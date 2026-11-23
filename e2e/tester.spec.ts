import { readFileSync } from 'node:fs';
import { exampleAnswers } from '../src/logic/example';
import { chooseExam, enterKeypad, enterRows, expect, expectHash, loadExam, openApp, seedStore, tapKey, test } from './helpers';

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
  // 답을 두 개 넣다가 뒤로 가서 같은 시험을 다시 골라도 넣은 답과 측정이 이어진다.
  await page.locator('[data-row="1"] [data-choice="1"]').click();
  await page.locator('[data-row="2"] [data-choice="1"]').click();
  await page.getByRole('button', { name: '뒤로' }).click();
  await expectHash(page, '/exams');
  await chooseExam(page, 'sample-a');
  await expect(page.locator('[data-row="1"] [data-choice="1"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('entered-count')).toHaveText('2문항 입력');
  // 일부러 3번을 잘못 넣는다.
  const typed = { ...answers, 3: 5 };
  await enterRows(page, exam, typed);
  // 입력 확인에서 3번을 고친다.
  await page.locator('main [data-cell="3"]').click();
  await tapKey(page.locator('.sheet'), answers[3] as number);
  await page.getByRole('button', { name: '맞아요, 다음으로' }).click();
  await expectHash(page, '/marks');
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: '없어요, 채점하기' }).click();
  await expectHash(page, '/score');

  // 진행자 화면으로 돌아와 측정 기록을 본다.
  await openApp(page, '/test');
  await expect(page.getByTestId('active-run')).toContainText('P07, 5행 방식');
  const card = page.getByTestId('run-card');
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute('data-participant', 'P07');
  await expect(card).toHaveAttribute('data-mode', 'rows');
  await expect(card.getByTestId('m-input')).toHaveText(/^\d+(\.\d)?초$/);
  // 1번과 2번은 처음에 한 번씩 더 눌렀고, 3번은 입력 확인에서 한 번 고쳤다: 30 + 2 + 1 = 33번.
  await expect(card.getByTestId('m-input-count')).toHaveText('33번');
  await expect(card.getByTestId('m-review-fixed')).toHaveText('1개');
  await expect(card.getByTestId('m-to-score')).toHaveText(/^\d+(\.\d)?초$/);
  const marksText = await card.getByTestId('m-marks').innerText();
  expect(Number(marksText.replace('초', ''))).toBeGreaterThanOrEqual(1);
  await card.getByText('화면 진입 기록').click();
  const screens = await card.getByTestId('run-screens').locator('li').allInnerTexts();
  // 진행자용 화면에 들어온 것도 test 로 적힌다.
  expect(screens.map((s) => s.split(' ')[1])).toEqual(['start', 'exams', 'input', 'exams', 'input', 'review', 'marks', 'score', 'test']);

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
  expect(json.runs[0].metrics.inputCount).toBe(33);
  expect(json.runs[0].metrics.reviewFixedCount).toBe(1);
  expect(json.runs[0].metrics.residualErrors).toBe(2);
  expect(json.runs[0].itemInputs['3']).toBe(2);
  expect(json.runs[0].itemInputs['1']).toBe(2);
  expect(json.runs[0].itemInputs['30']).toBe(1);
  expect(json.runs[0].finalAnswers).toEqual(key);
  expect(json.runs[0].screens.length).toBeGreaterThanOrEqual(8);
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
  expect(csv[0]!.startsWith('participant,input_mode,planned_exam,exam,exam_reselects,started_at,input_seconds,input_count,review_fixed_count,marks_seconds,select_to_score_seconds,residual_errors')).toBe(true);
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

  // 다음 참가자를 시작하면 앞 참가자의 기록이 "이어서 보기"로 열리지 않는다.
  await page.getByLabel('참가자 코드').fill('P08');
  await page.getByTestId('mode-keypad').click();
  await page.getByTestId('start-run').click();
  await expectHash(page, '/');
  await expect(page.getByRole('button', { name: '시험 고르기' })).toBeVisible();
  await expect(page.getByRole('button', { name: '이어서 보기' })).toHaveCount(0);
  // 측정 중에는 기록 탭에 이번 참가자의 기록만 보이고 "이 기기의 기록 모두 지우기"를 숨긴다. 앞 참가자의 측정값은 그대로다.
  await openApp(page, '/history');
  await expect(page.getByTestId('history-empty')).toBeVisible();
  await expect(page.getByTestId('history-item')).toHaveCount(0);
  await expect(page.getByTestId('history-remove-all')).toHaveCount(0);
  await openApp(page, '/test');
  await expect(page.getByTestId('run-card')).toHaveCount(2);
  await expect(page.getByTestId('run-card').first().getByTestId('m-residual')).toHaveText('2개');
  await page.getByTestId('finish-run').click();

  // 기록 초기화: 확인 대화상자를 거친다.
  await page.getByTestId('reset-runs').click();
  await expect(page.getByRole('alertdialog')).toContainText('테스트 기록을 모두 지울까요?');
  await page.getByRole('alertdialog').getByRole('button', { name: '지우기' }).click();
  await expect(page.getByTestId('no-runs')).toBeVisible();
});

test('시험 기록을 지운 뒤에 답지를 넣어도 옮겨 둔 최종 답과 대조한다', async ({ page }) => {
  const exam = loadExam('a');
  const answers = exampleAnswers(exam);
  await openApp(page, '/test');
  await page.getByLabel('참가자 코드').fill('P02');
  await page.getByTestId('mode-keypad').click();
  await page.getByTestId('texam-sample-a').click();
  await page.getByTestId('start-run').click();
  await expectHash(page, '/');
  await page.getByRole('button', { name: '시험 고르기' }).click();
  await chooseExam(page, 'sample-a');
  // 3번만 답지와 다르게 넣는다.
  await enterKeypad(page, exam, { ...answers, 3: 5 });
  await expectHash(page, '/review');
  await page.getByRole('button', { name: '맞아요, 다음으로' }).click();
  await page.getByRole('button', { name: '없어요, 채점하기' }).click();
  await expectHash(page, '/score');

  // 답지를 넣기 전에 참가자가 측정 중에 자기 시험 기록을 지운다(측정 중에는 자기 기록만 보이고 하나씩 지울 수 있다).
  await openApp(page, '/history');
  await expect(page.getByTestId('history-item')).toHaveCount(1);
  await page.getByTestId('history-remove').click();
  await page.getByRole('alertdialog').getByRole('button', { name: '지우기' }).click();
  await expect(page.getByTestId('history-empty')).toBeVisible();
  await openApp(page, '/test');
  await page.getByTestId('finish-run').click();
  await expect(page.getByTestId('active-run')).toHaveCount(0);

  await openApp(page, '/test');
  const card = page.getByTestId('run-card');
  await expect(card.getByTestId('m-residual')).toHaveText('아직 없음');
  const key = exam.items.map((it) => answers[it.no]).join(',');
  await card.getByLabel('참가자에게 준 답지의 답').fill(key);
  await card.getByTestId('key-compare').click();
  await expect(card.getByText('이 참가자가 넣은 답이 아직 없어요.')).toHaveCount(0);
  await expect(card.getByTestId('key-result')).toHaveText('남은 오입력 1개');
  await expect(card).toContainText('다른 문항: 3번');
  // 새로 고쳐도 대조 결과가 남는다.
  await page.reload();
  await expect(page.getByTestId('run-card').getByTestId('m-residual')).toHaveText('1개');
});

test('주소 앞쪽의 input 값보다 진행자가 고른 입력 방식이 우선이다', async ({ page }) => {
  await page.goto('./?input=rows#/test');
  await page.locator('.app').first().waitFor();
  await page.getByLabel('참가자 코드').fill('P01');
  await page.getByTestId('mode-keypad').click();
  await page.getByTestId('start-run').click();
  await expectHash(page, '/');
  await page.getByRole('button', { name: '시험 고르기' }).click();
  await chooseExam(page, 'sample-a');
  // 진행자가 고른 키패드 방식으로 열린다.
  await expect(page.getByTestId('now-no')).toHaveText('1번');
  await expect(page.locator('[data-row]')).toHaveCount(0);
  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem('score-anatomy') ?? '{}'));
  expect(stored.testRuns[0].inputMode).toBe('keypad');
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

test('측정 카드: 망가진 시작 시각은 비워 보여 주고, 카드 안의 입력 칸은 표면색이다', async ({ page }) => {
  await openApp(page, '/');
  const run = (id: string, participant: string, startedAt: number) => ({
    id,
    participant,
    inputMode: 'keypad',
    plannedExamId: 'sample-a',
    startedAt,
    endedAt: Date.UTC(2026, 10, 22, 10, 30, 0),
    sessionId: null,
    examId: 'sample-a',
    screens: [],
  });
  await seedStore(page, {
    version: 1,
    sessions: [],
    currentId: null,
    // P01 은 시작 시각이 날짜로 쓸 수 없는 값이고, P02 는 멀쩡하다(Asia/Seoul 로 19시 0분 7초).
    testRuns: [run('r1', 'P01', 1e20), run('r2', 'P02', Date.UTC(2026, 10, 22, 10, 0, 7))],
  });
  await page.reload();
  await openApp(page, '/test');
  const broken = page.locator('[data-testid="run-card"][data-participant="P01"]');
  const fine = page.locator('[data-testid="run-card"][data-participant="P02"]');
  await expect(broken.getByTestId('m-started')).toHaveText('아직 없음');
  await expect(fine.getByTestId('m-started')).toHaveText('19:00:07');
  // 1970년의 시각(Asia/Seoul 로 09:00:00)으로 적지 않는다.
  await expect(broken).not.toContainText('09:00:00');
  // 내보낸 값에서도 비어 있다.
  await page.getByRole('button', { name: 'CSV 복사' }).click();
  await expect(page.getByRole('status').filter({ hasText: '복사했어요.' })).toHaveCount(1);
  const lines = (await page.evaluate(() => navigator.clipboard.readText())).split('\n');
  const col = lines[0]!.split(',').indexOf('started_at');
  const byParticipant = Object.fromEntries(lines.slice(1).map((l) => [l.split(',')[0], l.split(',')[col]]));
  expect(byParticipant).toEqual({ P01: '', P02: '2026-11-22T10:00:07.000Z' });
  await page.getByRole('button', { name: 'JSON 복사' }).click();
  await expect.poll(async () => (await page.evaluate(() => navigator.clipboard.readText())).startsWith('{')).toBe(true);
  const runs = JSON.parse(await page.evaluate(() => navigator.clipboard.readText())).runs as { participant: string; startedAt: number | null; startedAtIso: string }[];
  expect(runs.map((r) => [r.participant, r.startedAt, r.startedAtIso])).toEqual([
    ['P01', null, ''],
    ['P02', Date.UTC(2026, 10, 22, 10, 0, 7), '2026-11-22T10:00:07.000Z'],
  ]);

  // 카드 안의 입력 칸(정답지 대조)은 카드와 같은 표면색이고, 1px 테두리로 구분된다.
  const colors = await fine.evaluate((card) => {
    const input = card.querySelector('textarea')!;
    const cs = getComputedStyle(input);
    return {
      card: getComputedStyle(card).backgroundColor,
      input: cs.backgroundColor,
      page: getComputedStyle(document.body).backgroundColor,
      borderWidth: cs.borderTopWidth,
      borderColor: cs.borderTopColor,
    };
  });
  expect(colors.input).toBe(colors.card);
  expect(colors.input).not.toBe(colors.page);
  expect(colors.borderWidth).toBe('1px');
  expect(colors.borderColor).not.toBe(colors.input);
});


test('테스트 기기: 참가자 A를 마친 뒤 대기, 참가자 B를 시작하기 전과 후에 A의 점수가 학생이 보는 화면에 나오지 않는다', async ({ page }) => {
  const exam = loadExam('a');
  // A의 점수를 다른 화면의 숫자와 겹치지 않게 97점으로 만든다(27번 3점만 틀림).
  const answersA = Object.fromEntries(exam.items.map((it) => [it.no, it.answer as number]));
  answersA[27] = 146;
  const studentText = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');

  // 참가자 A
  await openApp(page, '/test');
  await page.getByLabel('참가자 코드').fill('P01');
  await page.getByTestId('mode-keypad').click();
  await page.getByTestId('start-run').click();
  await expectHash(page, '/');
  await page.getByRole('button', { name: '시험 고르기' }).click();
  await chooseExam(page, 'sample-a');
  await enterKeypad(page, exam, answersA);
  // 마지막 문항을 넣어 입력 확인으로 넘어간 직후, 기다리지 않고 "맞아요, 다음으로" 자리를 누른다: 받지 않고 알린다(측정에 센다).
  const go = page.getByRole('button', { name: '맞아요, 다음으로' });
  const box = (await go.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId('tap-notice')).toHaveText('화면이 막 바뀌어서 방금 누른 것은 받지 않았어요.');
  await expectHash(page, '/review');
  await go.click();
  await page.getByRole('button', { name: '없어요, 채점하기' }).click();
  await expect(page.getByTestId('score')).toHaveText('97점');
  // A는 예시 시험 B도 넣다가 채점하지 않고 멈춘다(채점 전 기록이 기기에 남는다).
  await openApp(page, '/exams');
  await chooseExam(page, 'sample-b', 'not_yet', 'first');
  for (const k of [2, 4, 1, 5, 3]) await tapKey(page, k);
  await expect(page.getByTestId('entered-count')).toHaveText('5문항 입력');

  // 진행자가 A를 마친다. 진행자용 화면에서 버린 누름은 세지 않는다.
  await openApp(page, '/test');
  const finish = page.getByTestId('finish-run');
  const fb = (await finish.boundingBox())!;
  await finish.click();
  await page.mouse.click(fb.x + fb.width / 2, fb.y + fb.height / 2);
  const cardA = page.locator('[data-testid="run-card"][data-participant="P01"]');
  await expect(cardA.getByTestId('m-discarded')).toHaveText('1번');

  // 대기: 학생이 보는 화면 어디에도 A의 기록과 점수가 없다.
  await openApp(page, '/');
  await expect(page.getByRole('button', { name: '이어서 보기' })).toHaveCount(0);
  expect(await studentText()).not.toContain('97점');
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await expectHash(page, '/history');
  await expect(page.getByTestId('history-test-device')).toHaveText('테스트 기기예요. 기록은 진행자용 화면에서 확인해요.');
  await expect(page.getByTestId('history-item')).toHaveCount(0);
  await expect(page.getByTestId('history-remove-all')).toHaveCount(0);
  expect(await studentText()).not.toContain('97점');
  for (const hash of ['/anatomy', '/score', '/steps', '/marks', '/review', '/input']) {
    await openApp(page, hash);
    expect(await studentText(), hash).not.toContain('97점');
    await expect(page.getByRole('button', { name: '이어서 보기' })).toHaveCount(0);
  }
  // 대기 중에 A가 넣다 만 시험(예시 시험 B)을 골라도 A의 답이 열리지 않고 새로 시작한다.
  await openApp(page, '/exams');
  await chooseExam(page, 'sample-b', 'not_yet', 'first');
  await expect(page.getByTestId('entered-count')).toHaveText('0문항 입력');
  await expect(page.getByTestId('now-no')).toHaveText('1번');

  // 참가자 B를 시작한다.
  await openApp(page, '/test');
  await page.getByLabel('참가자 코드').fill('P02');
  await page.getByTestId('mode-keypad').click();
  await page.getByTestId('start-run').click();
  await expectHash(page, '/');
  await expect(page.getByRole('button', { name: '이어서 보기' })).toHaveCount(0);
  expect(await studentText()).not.toContain('97점');
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await expectHash(page, '/history');
  // 측정 중에는 이번 참가자의 기록만 보이고, "이 기기의 기록 모두 지우기"를 숨긴다.
  await expect(page.getByTestId('history-empty')).toBeVisible();
  await expect(page.getByTestId('history-item')).toHaveCount(0);
  await expect(page.getByTestId('history-remove-all')).toHaveCount(0);
  expect(await studentText()).not.toContain('97점');
  // B가 같은 시험을 골라도 A의 기록을 이어 쓰지 않는다.
  await page.getByRole('link', { name: '이번 시험' }).click();
  await page.getByRole('button', { name: '시험 고르기' }).click();
  await chooseExam(page, 'sample-a');
  await expect(page.getByTestId('now-no')).toHaveText('1번');
  await expect(page.getByTestId('entered-count')).toHaveText('0문항 입력');
  await tapKey(page, 1);
  await openApp(page, '/history');
  await expect(page.getByTestId('history-item')).toHaveCount(1);
  await expect(page.getByTestId('history-item')).toContainText('입력 중');
  expect(await studentText()).not.toContain('97점');

  // 진행자용 화면에는 두 참가자의 측정 기록이 모두 있고, A의 받지 않은 누름은 1번이다(CSV 에도 남는다).
  await openApp(page, '/test');
  await expect(page.getByTestId('run-card')).toHaveCount(2);
  await expect(cardA.getByTestId('m-discarded')).toHaveText('1번');
  await page.getByTestId('copy-csv').click();
  await expect(page.getByText('복사했어요.')).toBeVisible();
  const csv = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n').trim().split('\n');
  const head = csv[0]!.split(',');
  const rowA = csv.find((l) => l.startsWith('P01,'))!.split(',');
  expect(rowA[head.indexOf('discarded_taps')]).toBe('1');
});
