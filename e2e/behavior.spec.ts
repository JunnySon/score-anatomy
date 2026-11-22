import { exampleAnswers } from '../src/logic/example';
import { chooseExam, enterKeypad, expect, expectHash, loadExam, openApp, tapKey, test } from './helpers';

// 화면 동작 확인: 입력 규칙, 주소의 input 값, 저장, 기기 설정 따르기.

test('키패드 방식: 지우기, 칸 누르기, 안 풂, 전체 보기', async ({ page }) => {
  await openApp(page, '/?input=keypad');
  await page.getByRole('button', { name: '시험 고르기' }).click();
  await chooseExam(page, 'sample-a');

  // 키를 누르면 답이 들어가고 다음 문항으로 넘어간다.
  await tapKey(page, 3);
  await tapKey(page, 5);
  await expect(page.getByTestId('now-no')).toHaveText('3번');
  await expect(page.locator('[data-cell="1"] .cell__val')).toHaveText('3');
  await expect(page.locator('[data-cell="2"] .cell__val')).toHaveText('5');

  // 지우기는 한 칸 뒤로 가서 지운다.
  await tapKey(page, 'erase');
  await expect(page.getByTestId('now-no')).toHaveText('2번');
  await expect(page.locator('[data-cell="2"] .cell__val')).toHaveText('');
  await expect(page.locator('[data-cell="1"] .cell__val')).toHaveText('3');

  // 안 풂은 미입력과 구분해 넣는다.
  await tapKey(page, 'skip');
  await expect(page.locator('[data-cell="2"] .cell__val')).toHaveText('안 풂');
  await expect(page.getByTestId('now-no')).toHaveText('3번');

  // 칸을 누르면 그 문항으로 간다. 현재 칸에는 표시가 붙는다.
  await page.locator('[data-cell="1"]').click();
  await expect(page.getByTestId('now-no')).toHaveText('1번');
  await expect(page.locator('[data-cell="1"]')).toHaveAttribute('aria-current', 'true');
  // 첫 칸에서는 뒤로 갈 칸이 없어 "지우기"가 아무것도 지우지 않는다.
  await tapKey(page, 'erase');
  await expect(page.getByTestId('now-no')).toHaveText('1번');
  await expect(page.locator('[data-cell="1"] .cell__val')).toHaveText('3');
  // 답이 있는 칸에서 키를 누르면 그 칸의 답이 바뀌고 다음 문항으로 넘어간다.
  await tapKey(page, 4);
  await expect(page.locator('[data-cell="1"] .cell__val')).toHaveText('4');
  await expect(page.getByTestId('now-no')).toHaveText('2번');
  // "지우기"는 지금 칸에 답이 있어도 지시서대로 한 칸 뒤로 가서 지우고, 무엇을 지웠는지 알린다.
  await page.locator('[data-cell="3"]').click();
  await tapKey(page, 'erase');
  await expect(page.getByTestId('now-no')).toHaveText('2번');
  await expect(page.locator('[data-cell="2"] .cell__val')).toHaveText('');
  await expect(page.getByText('2번 답을 지웠어요.')).toBeVisible();

  // 묶음이 넘어가면 직전 묶음과 현재 묶음 두 줄이 보인다.
  await tapKey(page, 1);
  await tapKey(page, 1);
  await tapKey(page, 1);
  await tapKey(page, 1);
  await expect(page.getByTestId('now-no')).toHaveText('6번');
  await expect(page.locator('[data-cell="1"]')).toBeVisible();
  await expect(page.locator('[data-cell="6"]')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('[data-cell="10"]')).toBeVisible();
  await expect(page.locator('main [data-cell]')).toHaveCount(10);

  // 전체 보기는 입력 확인 격자를 미리 연다. 미입력 칸은 "미입력"으로 보인다.
  await page.getByRole('button', { name: '전체 보기' }).click();
  await expectHash(page, '/review');
  await expect(page.locator('main [data-cell="1"] .cell__val')).toHaveText('4');
  await expect(page.locator('main [data-cell="6"] .cell__val')).toHaveText('미입력');
  await expect(page.locator('[data-missing="true"]')).toHaveCount(25);

  // 미입력이 남아 있으면 넘어가지 않고 첫 미입력 칸으로 옮기며 안내한다.
  await page.getByRole('button', { name: '맞아요, 다음으로' }).click();
  await expectHash(page, '/review');
  await expect(page.getByText("6번이 비어 있어요. 안 푼 문항이면 '안 풂'을 눌러 주세요.")).toBeVisible();
  await expect(page.locator('main [data-cell="6"]')).toBeFocused();

  // 표시 화면 주소로 바로 가도 미입력이 있으면 입력 확인으로 돌아온다.
  await page.evaluate(() => {
    window.location.hash = '#/marks';
  });
  await expectHash(page, '/review');
  // 채점 결과 주소도 열리지 않는다(몰래 오답 처리하지 않는다).
  await page.evaluate(() => {
    window.location.hash = '#/score';
  });
  await expectHash(page, '/input');
});

test('키패드 방식: 단답형은 "다음"을 눌러야 넘어가고 0~999만 받는다', async ({ page }) => {
  const exam = loadExam('a');
  const answers = exampleAnswers(exam);
  await openApp(page, '/?input=keypad');
  await page.getByRole('button', { name: '시험 고르기' }).click();
  await chooseExam(page, 'sample-a');
  await enterKeypad(page, exam, answers, 1, 21);
  await expect(page.getByTestId('now-no')).toHaveText('22번');

  // 빈 채로는 넘어가지 않는다.
  await tapKey(page, 'go');
  await expect(page.getByTestId('now-no')).toHaveText('22번');
  await expect(page.getByText("22번이 비어 있어요. 안 푼 문항이면 '안 풂'을 눌러 주세요.")).toBeVisible();

  // 한 자리만 눌렀다고 넘어가지 않는다. 누른 숫자는 크게 보이고, "다음" 전에는 칸에 들어가지 않는다.
  await tapKey(page, 0);
  await expect(page.getByTestId('now-no')).toHaveText('22번');
  await expect(page.getByTestId('entry')).toContainText('0');
  await expect(page.locator('[data-cell="22"] .cell__val')).toHaveText('');
  await expect(page.getByTestId('entered-count')).toHaveText('21문항 입력');
  // 0 다음에 숫자를 누르면 앞의 0은 사라진다.
  await tapKey(page, 7);
  await expect(page.getByTestId('entry')).toHaveText(/7$/);
  await tapKey(page, 5);
  await tapKey(page, 3);
  await expect(page.getByTestId('entry')).toContainText('753');
  // 네 자리는 받지 않는다.
  await tapKey(page, 1);
  await expect(page.getByTestId('entry')).toContainText('753');
  await expect(page.getByText('답은 0부터 999까지예요.')).toBeVisible();
  // 지우기는 한 자리씩 지운다.
  await tapKey(page, 'erase');
  await expect(page.getByTestId('entry')).toContainText('75');
  await tapKey(page, 'go');
  await expect(page.getByTestId('now-no')).toHaveText('23번');
  await expect(page.locator('[data-cell="22"] .cell__val')).toHaveText('75');

  // 빈 단답형 칸에서 지우기를 누르면 한 칸 뒤로 가서 지운다.
  await tapKey(page, 'erase');
  await expect(page.getByTestId('now-no')).toHaveText('22번');
  await expect(page.locator('[data-cell="22"] .cell__val')).toHaveText('');

  // 0도 답으로 넣을 수 있다.
  await tapKey(page, 0);
  await tapKey(page, 'go');
  await expect(page.locator('[data-cell="22"] .cell__val')).toHaveText('0');

  // 숫자를 누르다가 "다음" 없이 다른 칸으로 가면 누른 숫자는 들어가지 않고, 그 사실을 알린다.
  await expect(page.getByTestId('now-no')).toHaveText('23번');
  await tapKey(page, 9);
  await tapKey(page, 9);
  await page.locator('[data-cell="24"]').click();
  await expect(page.getByTestId('now-no')).toHaveText('24번');
  await expect(page.locator('[data-cell="23"] .cell__val')).toHaveText('');
  await expect(page.getByText("23번에 누른 숫자는 '다음'을 누르지 않아서 들어가지 않았어요.")).toBeVisible();
  // "전체 보기"로 넘어가도 확정하지 않은 숫자는 미입력으로 남는다.
  await tapKey(page, 7);
  await page.getByRole('button', { name: '전체 보기' }).click();
  await expectHash(page, '/review');
  await expect(page.locator('main [data-cell="24"] .cell__val')).toHaveText('미입력');
  await page.getByRole('button', { name: '뒤로' }).click();
  await expectHash(page, '/input');
  // 이미 들어 있는 답은 숫자를 눌러도 "다음" 전에는 바뀌지 않는다.
  await page.locator('[data-cell="22"]').click();
  await tapKey(page, 5);
  await expect(page.getByTestId('entry')).toContainText('5');
  await expect(page.locator('[data-cell="22"] .cell__val')).toHaveText('0');
  await page.locator('[data-cell="23"]').click();
  await expect(page.locator('[data-cell="22"] .cell__val')).toHaveText('0');

  // 기기 기본 자판을 띄우는 입력 칸이 없다.
  await expect(page.locator('input, textarea, [contenteditable]')).toHaveCount(0);
});

test('5행 방식: 같은 줄의 다른 답을 누르면 그 문항만 바뀌고 자동으로 넘어가지 않는다', async ({ page }) => {
  await openApp(page, '/?input=rows');
  await page.getByRole('button', { name: '시험 고르기' }).click();
  await chooseExam(page, 'sample-a');

  const row1 = page.locator('[data-row="1"]');
  const row2 = page.locator('[data-row="2"]');
  await expect(page.locator('[data-row]')).toHaveCount(5);
  await expect(row1.getByRole('radiogroup')).toHaveAttribute('aria-label', '1번 답');
  await expect(row1.getByRole('radio')).toHaveCount(5);

  await row1.locator('[data-choice="2"]').click();
  await row2.locator('[data-choice="4"]').click();
  await row1.locator('[data-choice="5"]').click();
  await expect(row1.locator('[data-choice="5"]')).toHaveAttribute('aria-checked', 'true');
  await expect(row1.locator('[data-choice="2"]')).toHaveAttribute('aria-checked', 'false');
  await expect(row2.locator('[data-choice="4"]')).toHaveAttribute('aria-checked', 'true');
  // 자동으로 넘기지 않는다.
  await expect(page.getByTestId('page-range')).toHaveText('1~5번');
  await expect(page.getByTestId('entered-count')).toHaveText('2문항 입력');

  // 문항 번호를 누르면 "안 풂"과 "입력 지우기"를 고를 수 있다.
  await row2.locator('[data-row-no]').click();
  await expect(page.locator('.sheet [data-menu="skip"]')).toHaveText('안 풂');
  await expect(page.locator('.sheet [data-menu="clear"]')).toHaveText('입력 지우기');
  await page.locator('.sheet [data-menu="skip"]').click();
  await expect(row2).toContainText('안 풂');
  await expect(row2.locator('[aria-checked="true"]')).toHaveCount(0);
  await row1.locator('[data-row-no]').click();
  await page.locator('.sheet [data-menu="clear"]').click();
  await expect(row1.locator('[aria-checked="true"]')).toHaveCount(0);
  await expect(page.getByTestId('entered-count')).toHaveText('1문항 입력');

  // 쪽을 넘겼다 돌아와도 넣은 답이 그대로다.
  await page.getByTestId('rows-next').click();
  await expect(page.getByTestId('page-range')).toHaveText('6~10번');
  await page.getByRole('button', { name: '이전', exact: true }).click();
  await expect(row2).toContainText('안 풂');

  // 두 방식은 같은 상태를 쓴다: 키패드 방식으로 바꿔도 넣은 답이 보인다.
  await openApp(page, '/input?input=keypad');
  await expect(page.getByTestId('now-no')).toHaveText('1번');
  await expect(page.locator('[data-cell="2"] .cell__val')).toHaveText('안 풂');
  await tapKey(page, 3);
  await openApp(page, '/input?input=rows');
  await expect(page.locator('[data-row="1"] [data-choice="3"]')).toHaveAttribute('aria-checked', 'true');
});

test('입력 확인: 칸을 눌러 바텀시트에서 답을 고친다', async ({ page }) => {
  const exam = loadExam('a');
  const answers = exampleAnswers(exam);
  await openApp(page, '/?input=keypad');
  await page.getByRole('button', { name: '시험 고르기' }).click();
  await chooseExam(page, 'sample-a');
  await enterKeypad(page, exam, answers);
  await expectHash(page, '/review');

  // 5지선다 칸: 키를 누르면 바로 고쳐지고 닫힌다.
  await page.locator('main [data-cell="3"]').click();
  await expect(page.getByRole('dialog')).toContainText('3번 답 고치기');
  await expect(page.locator('.sheet [data-key="2"]')).toHaveAttribute('aria-pressed', 'true');
  await tapKey(page.locator('.sheet'), 4);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('main [data-cell="3"] .cell__val')).toHaveText('4');

  // 단답형 칸: 숫자 키패드. "넣기"를 눌러야 바뀌고, 닫으면 그대로다.
  await page.locator('main [data-cell="25"]').click();
  await expect(page.getByRole('dialog')).toContainText('25번 답 고치기');
  await expect(page.locator('.sheet').getByTestId('entry')).toContainText('150');
  await tapKey(page.locator('.sheet'), 8);
  await expect(page.locator('.sheet').getByTestId('entry')).toHaveText(/8$/);
  await page.getByRole('button', { name: '닫기' }).click();
  await expect(page.locator('main [data-cell="25"] .cell__val')).toHaveText('150');
  await page.locator('main [data-cell="25"]').click();
  await tapKey(page.locator('.sheet'), 8);
  await tapKey(page.locator('.sheet'), 8);
  await tapKey(page.locator('.sheet'), 'go');
  await expect(page.locator('main [data-cell="25"] .cell__val')).toHaveText('88');

  // 안 풂으로 바꾸기
  await page.locator('main [data-cell="30"]').click();
  await tapKey(page.locator('.sheet'), 'skip');
  await expect(page.locator('main [data-cell="30"] .cell__val')).toHaveText('안 풂');

  // 바텀시트가 열려 있는 동안 뒤 화면은 조작할 수 없다. Esc로 닫힌다.
  await page.locator('main [data-cell="1"]').click();
  await expect(page.locator('main')).toHaveAttribute('inert', '');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('main')).not.toHaveAttribute('inert', '');
});

test('표시 화면: 누를 때마다 고민, 찍음, 표시 없음 순으로 바뀌고 점수는 그대로다', async ({ page }) => {
  const exam = loadExam('a');
  const answers = exampleAnswers(exam);
  answers[4] = 'skip';
  await openApp(page, '/?input=keypad');
  await page.getByRole('button', { name: '시험 고르기' }).click();
  await chooseExam(page, 'sample-a');
  await enterKeypad(page, exam, answers);
  await page.getByRole('button', { name: '맞아요, 다음으로' }).click();
  await expectHash(page, '/marks');

  await expect(page.getByText('풀이 없이 고른 문항이 있나요?')).toBeVisible();
  await expect(page.getByText('있으면 눌러 주세요. 점수는 그대로예요.')).toBeVisible();
  await expect(page.getByText('시험지에 세모나 물음표를 쳐 둔 문항을 보면 쉬워요.')).toBeVisible();
  await expect(page.getByText('한 번 누르면 고민, 두 번 누르면 찍음, 세 번 누르면 지워져요.')).toBeVisible();

  const cell = page.locator('[data-mark-cell="9"]');
  await expect(cell).toHaveAttribute('data-mark', 'none');
  await cell.click();
  await expect(cell).toHaveAttribute('data-mark', 'doubt');
  await expect(cell).toContainText('고민');
  await cell.click();
  await expect(cell).toHaveAttribute('data-mark', 'guess');
  await expect(cell).toContainText('찍음');
  await cell.click();
  await expect(cell).toHaveAttribute('data-mark', 'none');
  await expect(cell).not.toContainText('찍음');

  // 안 푼 문항에는 표시를 붙이지 않는다.
  await expect(page.locator('button[data-mark-cell="4"]')).toHaveCount(0);
  await expect(page.locator('[data-mark-cell="4"]')).toContainText('안 풂');

  // 단답형은 번호만 보여 주고 누르면 "자신 없음"이 붙는다.
  const short = page.locator('[data-short-mark="23"]');
  await expect(short).toHaveText('23');
  await short.click();
  await expect(short).toContainText('자신 없음');
  await short.click();
  await expect(short).not.toContainText('자신 없음');

  // 주 버튼 "채점하기"와 보조 버튼 "없어요"가 함께 있다.
  await expect(page.getByRole('button', { name: '없어요' })).toBeVisible();
  await expect(page.getByRole('button', { name: '채점하기' })).toBeVisible();
  await cell.click();
  await cell.click();
  await expect(page.getByRole('button', { name: '없어요' })).toBeVisible();
  await page.getByTestId('time-missed').click();
  await expect(page.getByTestId('time-missed')).toHaveAttribute('aria-checked', 'true');

  // 9번을 찍음으로 표시해도 실제 점수는 그대로다(4번 안 풂 3점만 더 빠진 75점).
  await page.getByRole('button', { name: '채점하기' }).click();
  await expectHash(page, '/score');
  await expect(page.getByTestId('score')).toHaveText('75점');
  await expect(page.getByText('30문항 가운데 23문항을 맞혔어요.')).toBeVisible();

  // 채점한 뒤에 표시를 바꾸면 "채점한 뒤 표시"로 따로 적는다.
  await page.getByRole('button', { name: '입력 고치기' }).click();
  await expectHash(page, '/review');
  await page.getByRole('button', { name: '맞아요, 다음으로' }).click();
  await expect(page.getByTestId('after-grading-note')).toHaveCount(0);
  await page.locator('[data-mark-cell="10"]').click();
  await expect(page.getByTestId('after-grading-note')).toHaveText('채점한 뒤에 표시한 기록이에요');

  // 점수 해부 화면의 "입력 고치기"도 입력 확인으로 간다.
  await page.getByRole('button', { name: '채점하기' }).click();
  await page.getByRole('button', { name: '점수 해부 바로 보기' }).click();
  await expectHash(page, '/anatomy');
  await expect(page.getByTestId('after-grading-note')).toBeVisible();
  await page.getByRole('button', { name: '입력 고치기' }).click();
  await expectHash(page, '/review');
});

test('기록: 항목 삭제와 모두 지우기는 확인 대화상자를 한 번 거친다', async ({ page }) => {
  const exam = loadExam('a');
  const answers = exampleAnswers(exam);
  await openApp(page, '/history');
  await expect(page.getByTestId('history-empty')).toHaveText('아직 넣은 시험이 없어요. 시험을 하나 넣으면 여기에 쌓여요.');
  for (const name of ['7일 뒤 확인', '실수 카드', '공유 리포트', '점수대별 정답률']) await expect(page.getByText(name, { exact: true })).toBeVisible();
  await expect(page.getByText('준비 중이에요.')).toHaveCount(3);
  await expect(page.getByText('응답이 모이면 열려요.')).toBeVisible();

  await openApp(page, '/exams');
  await chooseExam(page, 'sample-a');
  await enterKeypad(page, exam, answers, 1, 3);
  await page.getByRole('button', { name: '뒤로' }).click();
  await openApp(page, '/history');
  await expect(page.getByTestId('history-item')).toHaveCount(1);
  await expect(page.getByTestId('history-item')).toContainText('입력 중');
  await expect(page.getByTestId('history-item')).toContainText(/\d{4}년 \d{1,2}월 \d{1,2}일/);

  // 그만두면 남는다.
  await page.getByTestId('history-remove').click();
  await expect(page.getByRole('alertdialog')).toContainText('이 기록을 지울까요?');
  await page.getByRole('button', { name: '그만두기' }).click();
  await expect(page.getByTestId('history-item')).toHaveCount(1);
  // 지우면 없어진다.
  await page.getByTestId('history-remove').click();
  await page.getByRole('alertdialog').getByRole('button', { name: '지우기' }).click();
  await expect(page.getByTestId('history-item')).toHaveCount(0);

  // 모두 지우기
  await openApp(page, '/exams');
  await chooseExam(page, 'sample-a');
  await openApp(page, '/exams');
  await chooseExam(page, 'sample-b', 'not_yet', 'first');
  await openApp(page, '/history');
  await expect(page.getByTestId('history-item')).toHaveCount(2);
  await page.getByTestId('history-remove-all').click();
  await expect(page.getByRole('alertdialog')).toContainText('이 기기의 기록을 모두 지울까요?');
  await page.getByRole('alertdialog').getByRole('button', { name: '지우기' }).click();
  await expect(page.getByTestId('history-empty')).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem('score-anatomy') ?? '{}'));
  expect(stored.version).toBe(1);
  expect(stored.sessions).toEqual([]);
});

test('저장이 안 되는 브라우저에서도 화면은 동작한다', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error('quota');
    };
    Storage.prototype.getItem = () => {
      throw new Error('denied');
    };
  });
  const exam = loadExam('a');
  const answers = exampleAnswers(exam);
  await openApp(page, '/?input=keypad');
  await page.getByRole('button', { name: '시험 고르기' }).click();
  await chooseExam(page, 'sample-a');
  await enterKeypad(page, exam, answers);
  await page.getByRole('button', { name: '맞아요, 다음으로' }).click();
  await page.getByRole('button', { name: '없어요' }).click();
  await expect(page.getByTestId('score')).toHaveText('78점');
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await expect(page.getByText('이 브라우저에서는 기록을 저장하지 못했어요. 화면은 그대로 쓸 수 있어요.')).toBeVisible();
  await expect(page.getByTestId('history-item')).toContainText('78점');
});

test('저장된 값이 망가져 있어도 처음 상태로 열린다', async ({ page }) => {
  await openApp(page, '/');
  await page.evaluate(() => window.localStorage.setItem('score-anatomy', '{not json'));
  await page.reload();
  await expect(page.getByRole('button', { name: '시험 고르기' })).toBeVisible();
  await page.evaluate(() => window.localStorage.setItem('score-anatomy', JSON.stringify({ version: 999, sessions: 'x' })));
  await page.reload();
  await expect(page.getByRole('button', { name: '시험 고르기' })).toBeVisible();
  await expect(page.getByRole('button', { name: '이어서 보기' })).toHaveCount(0);
});

test('기기 설정을 따른다: 어두운 화면, 움직임 줄이기, 확대 허용, 서비스 워커 없음', async ({ page }) => {
  await openApp(page, '/');
  const bgOf = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await bgOf()).toBe('rgb(255, 255, 255)');
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await bgOf()).toBe('rgb(17, 19, 21)');
  // 앱 안에 화면 색을 바꾸는 버튼은 없다.
  await expect(page.getByRole('button', { name: /다크|어두운|라이트|밝은|테마/ })).toHaveCount(0);

  // 움직임 줄이기
  const duration = () =>
    page.evaluate(() => {
      const btn = document.querySelector('.btn--primary');
      return btn ? getComputedStyle(btn).transitionDuration : '';
    });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await duration()).toContain('0.16s');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await duration()).not.toContain('0.16s');

  // viewport에 확대 금지 설정이 없다.
  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(viewport).toContain('width=device-width');
  expect(viewport).toContain('viewport-fit=cover');
  expect(viewport).not.toMatch(/user-scalable|maximum-scale|minimum-scale/);

  // 서비스 워커를 넣지 않는다.
  const workers = await page.evaluate(async () => ('serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0));
  expect(workers).toBe(0);

  // 알림 권한을 요청하지 않는다.
  const permission = await page.evaluate(() => ('Notification' in window ? Notification.permission : 'default'));
  expect(permission).not.toBe('granted');

  // 글꼴: Pretendard를 프로젝트 안에서 불러오고, 스택 끝은 시스템 글꼴이다.
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(family).toContain('Pretendard Variable');
  expect(family).toMatch(/-apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif$/);
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return Array.from(document.fonts).filter((f) => f.status === 'loaded' && f.family.includes('Pretendard')).length;
  });
  expect(loaded).toBeGreaterThan(0);

  // 숫자는 폭이 같은 숫자로 쓴다.
  const numeric = await page.evaluate(() => getComputedStyle(document.body).fontVariantNumeric);
  expect(numeric).toContain('tabular-nums');
});

test.describe('넓은 화면', () => {
  test.use({ viewport: { width: 1024, height: 768 }, isMobile: false, hasTouch: false });
  test('폭이 넓으면 가운데 정렬된 430px 칼럼으로 보인다', async ({ page }) => {
    await openApp(page, '/');
    const box = (await page.locator('.app').boundingBox())!;
    expect(Math.round(box.width)).toBe(430);
    expect(Math.round(box.x)).toBe(Math.round((1024 - 430) / 2));
  });
});
