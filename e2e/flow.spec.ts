import { exampleAnswers, exampleCauses, exampleMarks } from '../src/logic/example';
import type { Answers } from '../src/types';
import {
  addMetric,
  chooseCauses,
  chooseExam,
  correctAnswers,
  enterKeypad,
  enterRows,
  expect,
  expectHash,
  loadExam,
  openApp,
  retryAnswer,
  setMarks,
  test,
  wrongValue,
} from './helpers';

// 10장 2번: 화면 흐름 테스트(390x844).
// 키패드 방식과 5행 방식 각각으로 예시 시험 A의 답 30개를 넣고 재풀이까지 끝낸다.

test.use({ viewport: { width: 390, height: 844 } });

/** 글자가 화면 안에 실제로 보이는지 확인한다. */
async function expectShown(page: import('@playwright/test').Page, testId: string, text: string | RegExp) {
  const el = page.getByTestId(testId);
  await el.scrollIntoViewIfNeeded();
  await expect(el).toContainText(text);
  await expect(el).toBeInViewport();
}

for (const mode of ['keypad', 'rows'] as const) {
  test(`예시 시험 A, ${mode === 'keypad' ? '키패드' : '5행'} 방식: 답 30개부터 재풀이까지`, async ({ page }) => {
    const exam = loadExam('a');
    const answers = exampleAnswers(exam);

    // 시작, 시험 선택
    await openApp(page, `/?input=${mode}`);
    await expect(page.getByTestId('preview')).toContainText('예시');
    await page.getByRole('button', { name: '시험 고르기' }).click();
    await expectHash(page, '/exams');
    await chooseExam(page, 'sample-a');

    // 답 입력
    if (mode === 'keypad') {
      await expect(page.getByTestId('section-name')).toHaveText('객관식 1~21번');
      await enterKeypad(page, exam, answers, 1, 11);
      await expect(page.getByTestId('entered-count')).toHaveText('11문항 입력');
      await expect(page.getByTestId('now-no')).toHaveText('12번');
      await enterKeypad(page, exam, answers, 12, 21);
      await expect(page.getByTestId('section-name')).toHaveText('단답형 22~30번');
      // 단답형은 한 자리만 눌렀다고 넘어가지 않는다. "다음"을 누르기 전에는 답으로 들어가지도 않는다.
      await page.locator('[data-key="1"]').click();
      await expect(page.getByTestId('now-no')).toHaveText('22번');
      await expect(page.getByTestId('entry')).toContainText('1');
      await expect(page.locator('main [data-cell="22"] .cell__val')).toHaveText('');
      await expect(page.getByTestId('entered-count')).toHaveText('21문항 입력');
      await page.locator('[data-key="erase"]').click();
      await enterKeypad(page, exam, answers, 22, 30);
      await expectHash(page, '/review');
    } else {
      await enterRows(page, exam, answers);
    }

    // 입력 확인: 30칸이 넣은 답과 같다.
    await expect(page.getByRole('heading', { name: '넣은 답을 확인해 주세요' })).toBeVisible();
    await expect(page.locator('main [data-cell]')).toHaveCount(30);
    for (const it of exam.items) {
      await expect(page.locator(`main [data-cell="${it.no}"] .cell__val`)).toHaveText(String(answers[it.no]));
    }
    await expect(page.locator('[data-missing="true"]')).toHaveCount(0);
    await page.getByRole('button', { name: '맞아요, 다음으로' }).click();
    await expectHash(page, '/marks');

    // 표시: 5지선다 21문항만 격자에 나온다.
    await expect(page.locator('[data-mark-cell]')).toHaveCount(21);
    await expect(page.locator('[data-short-mark]')).toHaveCount(9);
    await setMarks(page, exampleMarks());
    await page.getByRole('button', { name: '채점하기' }).click();

    // 점수
    await expectHash(page, '/score');
    await expect(page.getByTestId('score')).toHaveText('78점');
    await expect(page.getByText('30문항 가운데 24문항을 맞혔어요.')).toBeVisible();
    await page.getByRole('button', { name: '틀린 문항 살펴보기' }).click();

    // 오답 원인
    await expectHash(page, '/causes');
    await expect(page.locator('[data-testid^="wrong-"]')).toHaveCount(6);
    for (const no of [11, 15, 20, 21, 27, 29]) await expect(page.getByTestId(`wrong-${no}`)).toBeVisible();
    await expect(page.getByTestId('wrong-27')).toContainText('내 답 146');
    await chooseCauses(page, exampleCauses());
    // 21번은 정답을 먼저 본다. "정답 확인함"으로 기록된다.
    await page.getByTestId('show-answer-21').click();
    await expect(page.getByTestId('answer-21')).toContainText('정답 2');
    await expect(page.getByTestId('answer-21')).toContainText('정답 확인함');
    await page.getByRole('button', { name: '점수 해부 보기' }).click();

    // 점수 해부
    await expectHash(page, '/anatomy');
    await expectShown(page, 'actual', '78점');
    await expect(page.getByText('30문항 가운데 24문항을 맞혔어요.')).toBeVisible();
    await expectShown(page, 'row-guess', '7점');
    await expect(page.getByTestId('row-guess')).toContainText('추측했다고 표시한 정답');
    await expect(page.getByTestId('row-guess')).toContainText('78점 안에 들어 있어요');
    await expectShown(page, 'row-slip', '8점');
    await expect(page.getByTestId('row-slip')).toContainText('실수라고 표시한 오답');
    await expect(page.getByTestId('row-slip')).toContainText('78점에는 들어 있지 않아요');
    await expect(page.getByTestId('sentence')).toHaveText(
      '78점 가운데 7점은 찍었다고 표시한 문항에서 나왔어요. 틀린 22점 가운데 8점은 실수라고 표시했어요.',
    );
    // 100점 막대: 71, 7, 8, 14점 구간과 78, 100 눈금.
    const bar = page.getByTestId('score-bar');
    await expect(bar).toHaveAttribute('role', 'img');
    await expect(bar).toHaveAttribute(
      'aria-label',
      '100점 막대. 표시 없이 맞힌 점수 71점, 추측했다고 표시한 정답 7점, 실수라고 표시한 오답 8점, 그 외 오답 14점.',
    );
    const segs = await bar.locator('[data-seg]').evaluateAll((els) => els.map((el) => `${el.getAttribute('data-seg')}:${el.getAttribute('data-points')}`));
    expect(segs).toEqual(['solid:71', 'hatch:7', 'outline:8', 'dashed:14']);
    const barBox = (await bar.boundingBox())!;
    expect(Math.round(barBox.height)).toBe(28);
    await expect(page.getByTestId('tick-actual')).toHaveText('78');
    await expect(page.getByTestId('tick-total')).toHaveText('100');

    // 등급컷 상자
    await expect(page.getByTestId('cutbox')).toContainText('어디까지 가는 계단을 볼까요?');
    await expect(page.locator('[data-testid^="grade-"]')).toHaveCount(3);
    await page.getByTestId('grade-2').click();
    await expect(page.getByTestId('cut-title')).toHaveText('2등급 컷 81~85점');
    await expect(page.getByTestId('cut-badge')).toContainText('추정');
    await expect(page.getByTestId('cut-actual')).toHaveText('실제 78점 기준 3~7점 남았어요');
    await expectShown(page, 'cut-actual', '3~7점');
    await expect(page.getByTestId('cut-luck')).toContainText('찍기 운을 평균으로 보면 약 75점, 그 기준으로는 6~10점이에요');
    await expectShown(page, 'cut-luck', '약 75점');
    await expectShown(page, 'cut-luck', '6~10점');
    await expect(page.getByTestId('cut-luck')).toContainText('추정');
    await page.getByText('약 75점 설명 보기').click();
    await expect(page.getByTestId('luck-detail')).toHaveText(
      '찍었다고 표시한 문항을 운이 보통이었을 때로 다시 계산한 점수예요. 실제 점수는 78점 그대로예요.',
    );
    await page.getByTestId('cut-badge').click();
    await expect(page.getByTestId('cut-source')).toContainText('예시 값이에요');
    await expect(page.getByTestId('cut-source')).toContainText('기준일: 2026-11-22');
    await page.getByRole('button', { name: '닫기' }).click();
    await page.getByTestId('grade-1').click();
    await expect(page.getByTestId('cut-actual')).toHaveText('실제 78점 기준 10~14점 남았어요');
    await expect(page.getByTestId('cut-luck')).toContainText('그 기준으로는 13~17점이에요');
    await page.getByTestId('grade-3').click();
    await expect(page.getByTestId('cut-actual')).toHaveText('컷 범위보다 위예요.');
    await expect(page.getByTestId('cut-luck')).toContainText('약 75점, 그 기준으로는 컷 범위 안이에요');
    await page.getByTestId('grade-2').click();
    await expect(page.getByTestId('cut-actual')).toHaveText('실제 78점 기준 3~7점 남았어요');

    // 계단
    await expect(page.getByTestId('to-steps')).toHaveText('고칠 것 3가지 보기');
    await page.getByTestId('to-steps').click();
    await expectHash(page, '/steps');
    await expect(page.getByRole('heading', { name: '먼저 고칠 3가지' })).toBeVisible();
    await expect(page.locator('[data-testid^="step-"][data-type]')).toHaveCount(3);
    await expect(page.getByTestId('step-1')).toContainText('적분');
    await expect(page.getByTestId('step-1')).toContainText('놓친 배점 8점');
    await expect(page.getByTestId('step-1').getByTestId('step-reason')).toContainText('이 유형의 14번은 찍어서 맞혔다고 표시했어요.');
    await expect(page.getByTestId('step-1').getByTestId('todo-today')).toContainText('오늘 시험지의 14번, 20번, 21번을 다시 풀기');
    await expect(page.getByTestId('step-2')).toContainText('수열');
    await expect(page.getByTestId('step-2').getByTestId('step-reason')).toHaveText(
      '이번 시험에서 이 유형으로 8점을 놓쳤고, 둘 다 실수라고 표시했어요.',
    );
    await expect(page.getByTestId('step-2').getByTestId('todo-today')).toContainText('오늘 시험지의 15번과 29번을 다시 풀기');
    await expect(page.getByTestId('step-2').getByTestId('todo-coords')).toContainText('예시 좌표');
    await expect(page.getByTestId('step-3')).toContainText('확률');

    // 재풀이: 수열. 15번은 맞히고 29번은 다시 틀린다.
    await page.getByTestId('step-2').getByTestId('retry-btn').click();
    await expectHash(page, '/retry/t03');
    await retryAnswer(page, exam, 15, 3);
    await expect(page.getByTestId('retry-result')).toContainText('다시 풀어 맞혔어요.');
    await expect(page.getByTestId('retry-label')).toHaveText('실수로 표시함, 다시 풀어 맞힘');
    await page.getByTestId('retry-next').click();
    await retryAnswer(page, exam, 29, 275);
    await expect(page.getByTestId('retry-result')).toContainText('이번에도 답이 달랐어요. 이 유형을 계단에 남겨 둘게요.');
    await page.getByTestId('retry-next').click();
    await expectHash(page, '/steps');
    await expect(page.getByTestId('step-2').getByTestId('retry-status')).toContainText('15번: 실수로 표시함, 다시 풀어 맞힘');
    await expect(page.getByTestId('step-2').getByTestId('retry-status')).toContainText('29번: 다시 풀었지만 답이 다름');

    // 재풀이: 적분. 14번(찍어서 맞혔다고 표시), 20번(풀이가 안 떠올랐다고 표시), 21번(정답을 먼저 봄).
    await page.getByTestId('step-1').getByTestId('retry-btn').click();
    await expectHash(page, '/retry/t06');
    await retryAnswer(page, exam, 14, 1);
    await expect(page.getByTestId('retry-result')).toContainText('다시 풀어 맞혔어요.');
    await expect(page.getByTestId('retry-label')).toHaveText('다시 풀어 맞힘');
    await page.getByTestId('retry-next').click();
    // 20번은 한 번 틀린 뒤에 맞힌다. 몇 번째에 맞혔는지 그대로 적는다.
    await retryAnswer(page, exam, 20, 4);
    await expect(page.getByTestId('retry-result')).toContainText('이번에도 답이 달랐어요.');
    await page.getByTestId('retry-next').click();
    await retryAnswer(page, exam, 21, 2);
    await expect(page.getByTestId('retry-result')).toContainText('정답을 확인한 뒤 다시 맞혔어요.');
    await expect(page.getByTestId('retry-label')).toHaveText('정답 확인 후 다시 맞힘');
    await page.getByTestId('retry-next').click();
    await expectHash(page, '/steps');
    await expect(page.getByTestId('step-1').getByTestId('retry-status')).toContainText('14번: 다시 풀어 맞힘');
    await expect(page.getByTestId('step-1').getByTestId('retry-status')).toContainText('20번: 다시 풀었지만 답이 다름');
    await expect(page.getByTestId('step-1').getByTestId('retry-status')).toContainText('21번: 정답 확인 후 다시 맞힘');
    await page.getByTestId('step-1').getByTestId('retry-btn').click();
    await retryAnswer(page, exam, 14, 1);
    // 처음에 바로 맞힌 문항은 또 맞혀도 라벨이 그대로다.
    await expect(page.getByTestId('retry-label')).toHaveText('다시 풀어 맞힘');
    await page.getByTestId('retry-next').click();
    await retryAnswer(page, exam, 20, 5);
    await expect(page.getByTestId('retry-label')).toHaveText('2번째에 맞힘');
    await page.getByRole('button', { name: '뒤로' }).click();
    await expectHash(page, '/steps');

    // 기록에 78점으로 남고, 새로 열어도 그대로다.
    await page.getByRole('link', { name: '기록' }).click();
    await expectHash(page, '/history');
    await expect(page.getByTestId('history-item')).toHaveCount(1);
    await expect(page.getByTestId('history-item')).toContainText('예시 시험 A');
    await expect(page.getByTestId('history-item')).toContainText('78점');
    await page.reload();
    await expect(page.getByTestId('history-item')).toContainText('78점');
    addMetric({ kind: 'flow', name: `A-${mode}`, score: 78, guess: 7, slip: 8, cut2: '3~7', luck: 75, cut2luck: '6~10', steps: 3 });
  });
}

test('예시 시험 B: 섞인 배열, 지난 시험, 이미 채점한 경로, 확정 컷', async ({ page }) => {
  const exam = loadExam('b');
  // 7번, 17번, 30번은 틀리고 12번과 21번은 안 풂. 100 - (3 + 3 + 4 + 4 + 4) = 82점.
  const answers: Answers = correctAnswers(exam);
  for (const no of [7, 17, 30]) answers[no] = wrongValue(exam, no);
  answers[12] = 'skip';
  answers[21] = 'skip';

  await openApp(page, '/?input=keypad');
  await page.getByRole('button', { name: '시험 고르기' }).click();
  // 지난 시험에서만 한 번 더 묻는다.
  await page.getByTestId('exam-sample-a').click();
  await expect(page.getByText('이 시험지, 전에 풀어 본 적 있나요?')).toHaveCount(0);
  await page.getByTestId('exam-sample-b').click();
  await expect(page.getByText('이 시험지, 전에 풀어 본 적 있나요?')).toBeVisible();
  // 질문에 답하지 않으면 넘어가지 않는다.
  await page.getByRole('button', { name: '답 넣기', exact: true }).click();
  await expect(page.getByText('채점을 했는지 골라 주세요.')).toBeVisible();
  await chooseExam(page, 'sample-b', 'already', 'partial');

  // 구간 이름이 시험 데이터를 따라 바뀐다.
  await expect(page.getByTestId('section-name')).toHaveText('객관식 1~15번');
  await enterKeypad(page, exam, answers, 1, 15);
  await expect(page.getByTestId('section-name')).toHaveText('단답형 16~22번');
  await enterKeypad(page, exam, answers, 16, 22);
  await expect(page.getByTestId('section-name')).toHaveText('객관식 23~28번');
  await enterKeypad(page, exam, answers, 23, 28);
  await expect(page.getByTestId('section-name')).toHaveText('단답형 29~30번');
  await enterKeypad(page, exam, answers, 29, 30);
  await expectHash(page, '/review');
  await expect(page.locator('main [data-cell="12"] .cell__val')).toHaveText('안 풂');
  await expect(page.locator('main [data-cell="21"] .cell__val')).toHaveText('안 풂');
  await page.getByRole('button', { name: '맞아요, 다음으로' }).click();

  // 표시 화면: 5지선다 21문항, 단답형 9문항. 채점한 뒤 표시라는 안내가 보인다.
  await expectHash(page, '/marks');
  await expect(page.locator('[data-mark-cell]')).toHaveCount(21);
  await expect(page.locator('[data-short-mark]')).toHaveCount(9);
  await expect(page.getByTestId('after-grading-note')).toHaveText('채점한 뒤에 표시한 기록이에요');
  await page.getByRole('button', { name: '없어요' }).click();

  await expectHash(page, '/score');
  await expect(page.getByTestId('score')).toHaveText('82점');
  await expect(page.getByText('30문항 가운데 25문항을 맞혔어요.')).toBeVisible();
  await expect(page.getByTestId('after-grading-note')).toBeVisible();
  await page.getByRole('button', { name: '점수 해부 바로 보기' }).click();

  // 빈 상태: 표시가 없고 원인을 건너뛴 경우.
  await expectHash(page, '/anatomy');
  await expect(page.getByTestId('actual')).toHaveText('82점');
  await expect(page.getByTestId('row-guess-empty')).toHaveText('표시한 문항이 없어서 나눠 볼 것이 없어요. 82점 그대로예요.');
  await expect(page.getByTestId('row-slip-empty')).toContainText('아직 원인을 표시하지 않았어요');
  await expect(page.getByTestId('rows')).not.toContainText('0점');
  await expect(page.getByTestId('after-grading-note')).toBeVisible();
  const segs = await page.getByTestId('score-bar').locator('[data-seg]').evaluateAll((els) => els.map((el) => `${el.getAttribute('data-seg')}:${el.getAttribute('data-points')}`));
  expect(segs).toEqual(['solid:82', 'dashed:18']);

  // 확정 컷: 범위 대신 한 숫자, 배지는 확정. 등급 칩은 시험 데이터에 있는 4개.
  await expect(page.locator('[data-testid^="grade-"]')).toHaveCount(4);
  await page.getByTestId('grade-1').click();
  await expect(page.getByTestId('cut-title')).toHaveText('1등급 컷 90점');
  await expect(page.getByTestId('cut-badge')).toContainText('확정');
  await expect(page.getByTestId('cut-actual')).toHaveText('실제 82점 기준 8점 남았어요');
  await expect(page.getByTestId('cut-luck')).toHaveCount(0);
  await page.getByTestId('grade-2').click();
  await expect(page.getByTestId('cut-actual')).toHaveText('컷과 같은 점수예요.');
  await page.getByTestId('grade-3').click();
  await expect(page.getByTestId('cut-actual')).toHaveText('컷보다 위예요.');

  // 원인 화면으로 가는 링크. 안 푼 문항은 "안 풂"으로 나온다.
  await page.getByTestId('row-slip-empty').getByRole('link', { name: '오답 원인 표시하기' }).click();
  await expectHash(page, '/causes');
  await expect(page.locator('[data-testid^="wrong-"]')).toHaveCount(5);
  await expect(page.getByTestId('wrong-12')).toContainText('내 답 안 풂');
  await page.getByRole('button', { name: '건너뛰기' }).click();
  await expectHash(page, '/anatomy');

  // 계단: 적분 7점, 함수의 극한과 연속 4점, 확률 4점.
  await expect(page.getByTestId('to-steps')).toHaveText('고칠 것 3가지 보기');
  await page.getByTestId('to-steps').click();
  await expect(page.getByTestId('step-1')).toContainText('적분');
  await expect(page.getByTestId('step-1').getByTestId('step-reason')).toHaveText('이번 시험에서 이 유형으로 7점을 놓쳤어요.');
  await expect(page.getByTestId('step-2')).toContainText('함수의 극한과 연속');
  await expect(page.getByTestId('step-3')).toContainText('확률');

  // 이미 채점한 경로에서는 다시 맞혀도 "정답 확인 후 다시 맞힘"으로 적는다.
  await page.getByTestId('step-3').getByTestId('retry-btn').click();
  await retryAnswer(page, exam, 30, 96);
  await expect(page.getByTestId('retry-label')).toHaveText('정답 확인 후 다시 맞힘');
  addMetric({ kind: 'flow', name: 'B-keypad', score: 82 });
});

test('예시 시험 C: 정답 공개 전에는 채점 대신 답을 저장한다', async ({ page }) => {
  const exam = loadExam('c');
  const answers: Answers = {};
  for (const it of exam.items) answers[it.no] = it.kind === 'mc' ? ((it.no - 1) % 5) + 1 : it.no * 3;

  await openApp(page, '/?input=keypad');
  await page.getByRole('button', { name: '시험 고르기' }).click();
  await expect(page.getByTestId('exam-sample-c')).toContainText('정답 공개 전');
  await chooseExam(page, 'sample-c');
  await enterKeypad(page, exam, answers);
  await expectHash(page, '/review');
  await page.getByRole('button', { name: '맞아요, 다음으로' }).click();
  await expectHash(page, '/marks');
  await expect(page.getByRole('button', { name: '채점하기' })).toHaveCount(0);
  await setMarks(page, { 3: 'guess', 24: 'unsure' });
  await page.getByRole('button', { name: '답 저장하기' }).click();
  await expect(page.getByText('정답이 아직 공개되지 않았어요. 답은 저장해 뒀어요. 공개되면 여기서 바로 채점돼요.')).toBeVisible();

  // 점수 화면 주소로 가도 채점 결과는 열리지 않는다.
  await page.evaluate(() => {
    window.location.hash = '#/score';
  });
  await expectHash(page, '/marks');
  await page.evaluate(() => {
    window.location.hash = '#/anatomy';
  });
  await expectHash(page, '/marks');

  // 기록에는 점수 대신 "정답 공개 전"으로 남고, 답과 표시는 저장돼 있다.
  await page.getByRole('button', { name: '기록 보기' }).click();
  await expectHash(page, '/history');
  await expect(page.getByTestId('history-item')).toContainText('정답 공개 전');
  await page.reload();
  await page.getByTestId('history-item').getByRole('button', { name: '예시 시험 C 기록 열기' }).click();
  await expectHash(page, '/marks');
  await expect(page.locator('[data-mark-cell="3"]')).toHaveAttribute('data-mark', 'guess');
  await expect(page.locator('[data-short-mark="24"]')).toHaveAttribute('aria-pressed', 'true');
  addMetric({ kind: 'flow', name: 'C-keypad', saved: true });
});
