import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Browser, Page } from '@playwright/test';
import { exampleAnswers, exampleCauses, exampleMarks } from '../src/logic/example';
import type { Answers, AnswerValue, Exam } from '../src/types';
import { VARIANT_URL } from '../playwright.config';
import { checkScreen, findAnswerLeaks, waitSettled, type AuditOptions, type LeakTarget } from './audit';
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
  ROOT,
  seedStore,
  setMarks,
  settle,
  tapKey,
  wrongValue,
} from './helpers';

// 모든 화면을 한 바퀴 돌면서 화면마다 검사하고(10장 3, 4, 5, 7, 8, 9번) 캡처한다(10번).

export interface TourRun {
  id: string;
  /** 캡처를 남길 폴더 이름(docs/screens 아래). 없으면 검사만 한다. */
  shotDir: string | null;
  viewport: { width: number; height: number };
  colorScheme: 'light' | 'dark';
  deviceScaleFactor: number;
}

/** 검산 예시에서 틀린 문항과 그 정답. 정답 보기를 누르기 전에는 화면에 나오면 안 된다. */
const LEAK_TARGETS: LeakTarget[] = [
  { no: 11, answer: 2, distinctive: false },
  { no: 15, answer: 3, distinctive: false },
  { no: 20, answer: 5, distinctive: false },
  { no: 21, answer: 2, distinctive: false },
  { no: 27, answer: 164, distinctive: true },
  { no: 29, answer: 257, distinctive: true },
];

/** 저장소에 직접 넣는 기록 한 건(드문 상태를 화면으로 만들 때 쓴다). */
function seededSession(id: string, exam: Exam, answers: Record<number, AnswerValue>, more: Record<string, unknown> = {}) {
  return {
    id,
    examId: exam.id,
    createdAt: '2026-11-22T10:00:00.000Z',
    gradedBefore: 'not_yet',
    seenBefore: null,
    answers,
    marks: {},
    marksEditedAfterGrading: false,
    timeFeel: null,
    savedAt: null,
    gradedAt: '2026-11-22T10:05:00.000Z',
    firstGradedAt: '2026-11-22T10:05:00.000Z',
    answersEditedAfterGrading: [],
    causes: {},
    answerViewed: {},
    targetGrade: null,
    retries: {},
    ...more,
  };
}

function storeWith(session: { id: string }) {
  return { version: 1, sessions: [session], currentId: session.id, inputMode: 'keypad', testRuns: [], activeRunId: null };
}

export async function tour(page: Page, browser: Browser, run: TourRun): Promise<void> {
  const examA = loadExam('a');
  const examB = loadExam('b');
  const examC = loadExam('c');
  const answersA = exampleAnswers(examA);
  const dir = run.shotDir ? resolve(ROOT, 'docs/screens', run.shotDir) : null;
  if (dir) mkdirSync(dir, { recursive: true });
  let count = 0;
  let leakChecks = 0;

  const shoot = async (target: Page, name: string, opts: AuditOptions = {}) => {
    count += 1;
    await settle(target);
    await checkScreen(target, name, run.id, opts);
    if (dir) {
      await target.screenshot({ path: resolve(dir, `${String(count).padStart(2, '0')}-${name}.png`), animations: 'disabled' });
    }
  };
  const stop = (name: string, opts: AuditOptions = {}) => shoot(page, name, opts);

  const noLeak = async (where: string, revealed: number[] = []) => {
    leakChecks += 1;
    await waitSettled(page);
    const leaks = await findAnswerLeaks(page, LEAK_TARGETS, revealed);
    addMetric({ kind: 'leak', run: run.id, where, leaks });
    expect.soft(leaks, `[${run.id}] ${where}: 정답 노출`).toEqual([]);
  };

  // (1) 시작, (11) 기록 빈 상태, (12) 테스트 진행자용 처음
  await openApp(page, '/?input=keypad');
  await stop('시작');
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await expectHash(page, '/history');
  await stop('기록-빈상태');
  await page.getByTestId('tester-link').click();
  await expectHash(page, '/test');
  await stop('테스트진행자-처음');

  // (2) 시험 선택
  await openApp(page, '/exams');
  await stop('시험선택');
  await page.getByTestId('exam-sample-b').click();
  await page.getByTestId('graded-already').click();
  await stop('시험선택-지난시험');
  await page.getByTestId('exam-sample-a').click();
  await page.getByTestId('graded-not_yet').click();
  await stop('시험선택-질문');
  await page.getByRole('button', { name: '답 넣기', exact: true }).click();
  await expectHash(page, '/input');

  // (3) 답 입력, 키패드 방식
  await stop('답입력-키패드-처음', { mustFit: true });
  await enterKeypad(page, examA, answersA, 1, 11);
  await stop('답입력-키패드-객관식', { mustFit: true });
  // 답이 든 칸을 누르면 그 문항을 고친다. 아무것도 바꾸지 않고 돌아가는 버튼이 있다.
  await page.locator('[data-cell="9"]').click();
  await expect(page.getByTestId('pad-panel')).toContainText('9번을 고치는 중이에요.');
  await stop('답입력-키패드-고치는중', { mustFit: true });
  // 고친 문항에 답을 넣으면 그 칸에 머물고 키패드가 잠긴다.
  await tapKey(page, answersA[9] as number);
  await expect(page.getByTestId('pad-panel')).toContainText('9번에 답을 넣었어요. 다음에 할 일을 골라 주세요.');
  await expect(page.getByTestId('fix-next')).toHaveText('10번도 고치기');
  await stop('답입력-키패드-잠금', { mustFit: true });
  await page.getByTestId('continue-from').click();
  await expect(page.getByTestId('now-no')).toHaveText('12번');
  // 빈칸에서 "지우기"는 이어서 들어왔으면 앞 번호로 가서 지우고, 무엇을 지웠는지 알린다.
  await tapKey(page, 'erase');
  await expect(page.getByText('11번 답을 지웠어요.')).toBeVisible();
  await expect(page.getByTestId('now-no')).toHaveText('11번');
  await stop('답입력-키패드-지우기안내', { mustFit: true });
  await enterKeypad(page, examA, answersA, 11, 21);
  await tapKey(page, 1);
  await tapKey(page, 2);
  // "다음"을 누르기 전에는 칸에 들어가지 않는다.
  await expect(page.locator('main [data-cell="22"] .cell__val')).toHaveText('');
  await stop('답입력-키패드-단답형', { mustFit: true });
  await tapKey(page, 3);
  await tapKey(page, 4);
  await expect(page.getByText('답은 0부터 999까지예요.')).toBeVisible();
  await stop('답입력-키패드-단답형-안내', { mustFit: true });
  await tapKey(page, 'erase');
  await tapKey(page, 'erase');
  await tapKey(page, 'erase');
  await tapKey(page, 'go');
  await expect(page.getByText("22번이 비어 있어요. 안 푼 문항이면 '안 풂'을 눌러 주세요.")).toBeVisible();
  await stop('답입력-키패드-단답형-빈칸안내', { mustFit: true });
  await enterKeypad(page, examA, answersA, 22, 24);
  // 단답형 칸을 고친 뒤의 잠금(키패드가 가장 높은 단답형에서도 한 화면에 들어와야 한다).
  await page.locator('[data-cell="23"]').click();
  await tapKey(page, 'go');
  await expect(page.getByTestId('pad-panel')).toContainText('23번에 답을 넣었어요. 다음에 할 일을 골라 주세요.');
  await stop('답입력-키패드-단답형-잠금', { mustFit: true });
  await page.getByTestId('continue-from').click();
  await expect(page.getByTestId('now-no')).toHaveText('25번');
  await enterKeypad(page, examA, answersA, 25, 30);
  await expectHash(page, '/review');
  // 다 찬 채로 답 입력 화면을 열면 잠근 채로 시작한다.
  await page.getByRole('button', { name: '뒤로' }).click();
  await expectHash(page, '/input');
  await expect(page.getByTestId('pad-panel')).toContainText('빈칸이 없어요. 고칠 문항을 눌러 주세요.');
  await stop('답입력-키패드-빈칸없음', { mustFit: true });
  await page.getByRole('button', { name: '전체 보기' }).click();
  await expectHash(page, '/review');

  // (4) 입력 확인
  await stop('입력확인');
  await page.locator('main [data-cell="14"]').click();
  await expect(page.locator('.sheet [data-key="1"]')).toContainText('지금 답');
  await stop('입력확인-답고치기-객관식');
  await tapKey(page.locator('.sheet'), 'erase');
  await page.getByRole('button', { name: '맞아요, 다음으로' }).click();
  await expect(page.getByText("14번이 비어 있어요. 안 푼 문항이면 '안 풂'을 눌러 주세요.")).toBeVisible();
  await expectHash(page, '/review');
  await stop('입력확인-미입력');
  await page.locator('main [data-cell="14"]').click();
  await tapKey(page.locator('.sheet'), answersA[14] as number);
  await page.locator('main [data-cell="27"]').click();
  await stop('입력확인-답고치기-단답형');
  await page.getByRole('button', { name: '닫기' }).click();
  await page.getByRole('button', { name: '맞아요, 다음으로' }).click();
  await expectHash(page, '/marks');

  // (5) 표시. 검산 예시의 찍음 표시에 고민과 자신 없음을 하나씩 더해 무늬를 모두 보여 준다(계산에는 쓰이지 않는다).
  await stop('표시-처음');
  await setMarks(page, { ...exampleMarks(), 5: 'doubt', 25: 'unsure' });
  await page.getByTestId('time-tight').click();
  await stop('표시-붙임');
  await page.getByRole('button', { name: '채점하기' }).click();
  await expectHash(page, '/score');

  // (6) 점수
  await stop('점수');
  await noLeak('점수');
  await page.getByRole('button', { name: '틀린 문항 살펴보기' }).click();
  await expectHash(page, '/causes');

  // (7) 오답 원인. 정답 보기를 누르기 전이다.
  await stop('오답원인-처음');
  await noLeak('오답 원인, 고르기 전');
  await chooseCauses(page, exampleCauses());
  await stop('오답원인-고름');
  await noLeak('오답 원인, 고른 뒤');
  await page.getByRole('button', { name: '점수 해부 보기' }).click();
  await expectHash(page, '/anatomy');

  // (8) 점수 해부
  await stop('점수해부-목표고르기전');
  await noLeak('점수 해부');
  await page.getByTestId('grade-2').click();
  await expect(page.getByTestId('cut-actual')).toHaveText('실제 78점 기준 3~7점 남았어요');
  await stop('점수해부-2등급');
  await page.getByTestId('cutbox').scrollIntoViewIfNeeded();
  await page.getByText('약 75점 설명 보기').click();
  await page.getByTestId('luck-detail').scrollIntoViewIfNeeded();
  await stop('점수해부-2등급-설명펼침');
  await noLeak('점수 해부, 2등급');
  await page.getByTestId('cut-badge').click();
  await stop('점수해부-컷출처');
  await page.getByRole('button', { name: '닫기' }).click();
  await page.getByTestId('grade-3').click();
  await expect(page.getByTestId('cut-actual')).toHaveText('컷 범위보다 위예요.');
  await stop('점수해부-3등급');
  await page.getByTestId('grade-1').click();
  await stop('점수해부-1등급');
  await page.getByTestId('grade-2').click();
  await page.getByTestId('to-steps').click();
  await expectHash(page, '/steps');

  // (9) 계단
  await stop('계단');
  await noLeak('계단');
  await page.getByTestId('step-1').getByText('순서를 정한 방법').click();
  await page.getByTestId('step-1').getByTestId('copy-coords').click();
  // 복사 권한을 준 상태다. 실제로 복사됐는지 내용까지 확인한다.
  await expect(page.getByTestId('step-1').getByText('좌표를 복사했어요.')).toBeVisible();
  // 윈도우의 클립보드는 줄바꿈을 \r\n 으로 바꿔 돌려주므로 줄바꿈을 맞춘 뒤 견준다.
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe('예시 좌표 12번\n예시 좌표 20번');
  await page.getByTestId('step-1').getByTestId('copy-coords').scrollIntoViewIfNeeded();
  await stop('계단-펼침');

  // (10) 재풀이: 수열(15번 객관식, 29번 단답형)
  await page.getByTestId('step-2').getByTestId('retry-btn').click();
  await expectHash(page, '/retry/t03');
  await stop('재풀이-객관식', { mustFit: true });
  await noLeak('재풀이, 답 넣기 전');
  await retryAnswer(page, examA, 15, 3);
  await stop('재풀이-맞힘');
  await page.getByTestId('retry-next').click();
  await tapKey(page, 2);
  await tapKey(page, 7);
  await tapKey(page, 5);
  await stop('재풀이-단답형', { mustFit: true });
  await tapKey(page, 'go');
  await expect(page.getByTestId('retry-result')).toContainText('이번에도 답이 달랐어요.');
  await stop('재풀이-다름');
  await noLeak('재풀이, 다시 틀린 뒤');
  await page.getByTestId('retry-next').click();
  await expectHash(page, '/steps');
  await page.getByTestId('step-2').scrollIntoViewIfNeeded();
  await stop('계단-다시푼기록');
  await noLeak('계단, 재풀이 뒤');

  // 정답 노출 검사의 양성 대조: 정답 보기를 누르면 검사기가 잡아내야 한다.
  await openApp(page, '/causes');
  await noLeak('오답 원인, 다시 열었을 때');
  await page.getByTestId('show-answer-27').click();
  await expect(page.getByTestId('answer-27')).toContainText('정답 164');
  await expect(page.getByTestId('answer-27')).toContainText('정답 확인함');
  const caught27 = await findAnswerLeaks(page, LEAK_TARGETS, []);
  expect(caught27.length, '검사기가 27번 정답 노출을 잡아내는지').toBeGreaterThan(0);
  await noLeak('오답 원인, 27번 정답만 본 뒤', [27]);
  await page.getByTestId('show-answer-15').click();
  await expect(page.getByTestId('answer-15')).toContainText('정답 3');
  const caught15 = await findAnswerLeaks(page, LEAK_TARGETS, [27]);
  expect(caught15.some((l) => l.startsWith('15번')), '검사기가 15번 정답 노출을 잡아내는지').toBe(true);
  addMetric({ kind: 'leak-control', run: run.id, caught27: caught27.length, caught15: caught15.length });
  await page.getByTestId('show-answer-21').click();
  await page.getByTestId('wrong-15').scrollIntoViewIfNeeded();
  await stop('오답원인-정답확인');

  // (10) 재풀이: 적분. 14번은 찍었다고 표시했고 맞은 문항(스스로 확인), 21번은 정답을 먼저 본 문항이다.
  await openApp(page, '/steps');
  await page.getByTestId('step-1').getByTestId('retry-btn').click();
  await expectHash(page, '/retry/t06');
  await expect(page.getByTestId('self-check')).toBeVisible();
  await stop('재풀이-찍음표시정답');
  await noLeak('재풀이, 찍음 표시 정답');
  await page.getByTestId('self-stuck').click();
  await expect(page.getByTestId('retry-label')).toHaveText('찍음 표시 정답, 막힌다고 표시함');
  await stop('재풀이-찍음표시정답-막힘');
  await page.getByTestId('retry-next').click();
  await retryAnswer(page, examA, 20, 5);
  await expect(page.getByTestId('retry-label')).toHaveText('다시 풀어 맞힘');
  await page.getByTestId('retry-next').click();
  await retryAnswer(page, examA, 21, 2);
  await expect(page.getByTestId('retry-result')).toContainText('정답을 확인한 뒤 다시 맞혔어요.');
  await expect(page.getByTestId('retry-label')).toHaveText('정답 확인 후 다시 맞힘');
  await stop('재풀이-정답확인후');
  await page.getByTestId('retry-next').click();
  await expectHash(page, '/steps');

  // (11) 기록
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await expectHash(page, '/history');
  await stop('기록');
  await page.getByTestId('history-remove').click();
  await stop('기록-삭제확인');
  await page.getByRole('button', { name: '그만두기' }).click();
  await expect(page.getByTestId('history-item')).toHaveCount(1);

  // (1) 시작: 지난 기록이 있으면 이어서 보기
  await openApp(page, '/');
  await expect(page.getByRole('button', { name: '이어서 보기' })).toBeVisible();
  await stop('시작-이어서보기');

  // 예시 결과 보기: 7장 검산 예시를 넣은 점수 해부
  await page.getByRole('button', { name: '예시 결과 보기' }).click();
  await expectHash(page, '/demo/anatomy');
  await expect(page.getByTestId('actual')).toHaveText('78점');
  await stop('예시결과-점수해부');
  await page.getByTestId('to-steps').click();
  await expectHash(page, '/demo/steps');
  await stop('예시결과-계단');

  // (3) 답 입력, 5행 방식: 예시 시험 B, "이미 했어요" 경로
  const answersB: Answers = correctAnswers(examB);
  for (const no of [7, 17, 30]) answersB[no] = wrongValue(examB, no);
  answersB[12] = 'skip';
  answersB[21] = 'skip';
  await openApp(page, '/exams');
  await chooseExam(page, 'sample-b', 'already', 'partial');
  await openApp(page, '/input?input=rows');
  await expect(page.locator('[data-row="1"]')).toBeVisible();
  await stop('답입력-5행-처음', { mustFit: true });
  await page.locator('[data-row="1"] [data-row-no]').click();
  await stop('답입력-5행-번호메뉴');
  await page.getByRole('button', { name: '닫기' }).click();
  await enterRows(page, examB, answersB, async (p) => {
    if (p === 0) await stop('답입력-5행-객관식', { mustFit: true });
    if (p === 2) await stop('답입력-5행-안풂', { mustFit: true });
    if (p === 3) {
      await stop('답입력-5행-단답형', { mustFit: true });
      await page.locator('[data-row="18"] [data-short]').click();
      await stop('답입력-5행-단답형키패드');
      await page.getByRole('button', { name: '닫기' }).click();
    }
    if (p === 5) await stop('답입력-5행-마지막', { mustFit: true });
  });
  await page.getByRole('button', { name: '맞아요, 다음으로' }).click();
  await expectHash(page, '/marks');
  await expect(page.getByTestId('after-grading-note')).toBeVisible();
  await stop('표시-채점한뒤표시');
  await page.getByRole('button', { name: '없어요, 채점하기' }).click();
  await expectHash(page, '/score');
  await page.getByRole('button', { name: '점수 해부 바로 보기' }).click();
  await expectHash(page, '/anatomy');
  await expect(page.getByTestId('row-guess-empty')).toBeVisible();
  await expect(page.getByTestId('after-grading-note')).toBeVisible();
  await stop('점수해부-빈상태');
  await page.getByTestId('grade-1').click();
  await expect(page.getByTestId('cut-badge')).toContainText('확정');
  await page.getByTestId('cutbox').scrollIntoViewIfNeeded();
  await stop('점수해부-확정컷');

  // (5) 정답 공개 전: 예시 시험 C
  const answersC: Answers = {};
  for (const it of examC.items) answersC[it.no] = it.kind === 'mc' ? ((it.no - 1) % 5) + 1 : it.no * 3;
  await openApp(page, '/exams');
  await chooseExam(page, 'sample-c');
  await openApp(page, '/input?input=keypad');
  await enterKeypad(page, examC, answersC);
  await expectHash(page, '/review');
  await page.getByRole('button', { name: '맞아요, 다음으로' }).click();
  await expectHash(page, '/marks');
  await stop('표시-정답공개전');
  await page.getByRole('button', { name: '답 저장하기' }).click();
  await expect(page.getByText('정답이 아직 공개되지 않았어요.')).toBeVisible();
  await stop('표시-정답공개전-저장');
  await page.getByRole('button', { name: '기록 보기' }).click();
  await expectHash(page, '/history');
  await expect(page.getByTestId('history-item')).toHaveCount(3);
  await stop('기록-여러건');

  // 드문 상태들. 저장소에 기록을 직접 넣어 만든다.
  // 전부 정답(틀린 문항 없음)
  await seedStore(page, storeWith(seededSession('s-perfect', examA, correctAnswers(examA), { targetGrade: '1' })));
  await page.reload();
  await openApp(page, '/anatomy');
  await expect(page.getByTestId('actual')).toHaveText('100점');
  await stop('점수해부-만점');
  await openApp(page, '/causes');
  await expect(page.getByText('틀린 문항이 없어요.', { exact: true })).toBeVisible();
  await stop('오답원인-빈상태');
  await openApp(page, '/steps');
  await expect(page.getByTestId('steps-empty')).toHaveText('틀린 문항이 없어요. 고칠 계단도 없어요.');
  await stop('계단-빈상태');

  // 컷 범위 안: 12~15번(4점씩)을 틀려 84점, 목표 2등급(81~85)
  const within = correctAnswers(examA);
  for (const no of [12, 13, 14, 15]) within[no] = wrongValue(examA, no);
  await seedStore(page, storeWith(seededSession('s-within', examA, within, { targetGrade: '2' })));
  await page.reload();
  await openApp(page, '/anatomy');
  await expect(page.getByTestId('actual')).toHaveText('84점');
  await expect(page.getByTestId('cut-actual')).toHaveText('컷 범위 안이에요.');
  await expect(page.getByText('컷이 확정되면 이 화면이 바뀌어요.')).toBeVisible();
  await page.getByTestId('cutbox').scrollIntoViewIfNeeded();
  await stop('점수해부-컷범위안');

  // 낮은 점수: 형식은 같고 평가하는 말이 없다. 1~4번만 맞히고 나머지는 틀리거나 안 풂. 2 + 2 + 2 + 3 = 9점.
  const low: Record<number, AnswerValue> = {};
  for (const it of examA.items) low[it.no] = it.no <= 4 ? (it.answer as number) : it.no % 3 === 0 ? 'skip' : wrongValue(examA, it.no);
  await seedStore(page, storeWith(seededSession('s-low', examA, low, { targetGrade: '3' })));
  await page.reload();
  await openApp(page, '/score');
  await expect(page.getByTestId('score')).toHaveText('9점');
  await expect(page.getByText('30문항 가운데 4문항을 맞혔어요.')).toBeVisible();
  await stop('점수-낮은점수');
  await openApp(page, '/anatomy');
  await expect(page.getByTestId('cut-actual')).toHaveText('실제 9점 기준 63~67점 남았어요');
  await stop('점수해부-낮은점수');

  // 등급컷 자료 없음: 등급컷을 뺀 검증용 변형 빌드의 예시 시험 B로 확인한다.
  {
    const ctx = await browser.newContext({
      baseURL: VARIANT_URL,
      viewport: run.viewport,
      colorScheme: run.colorScheme,
      deviceScaleFactor: run.deviceScaleFactor,
      hasTouch: true,
      isMobile: true,
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
    });
    const vp = await ctx.newPage();
    const outside: string[] = [];
    ctx.on('request', (req) => {
      const url = req.url();
      if (!url.startsWith(VARIANT_URL) && !url.startsWith('data:') && !url.startsWith('blob:')) outside.push(url);
    });
    await openApp(vp, '/');
    await seedStore(vp, storeWith(seededSession('s-nocuts', examB, answersB)));
    await vp.reload();
    await openApp(vp, '/anatomy');
    await expect(vp.getByTestId('actual')).toHaveText('82점');
    await expect(vp.getByTestId('no-cuts')).toHaveText('등급컷 자료를 기다리고 있어요. 점수와 고칠 것은 지금 볼 수 있어요.');
    await expect(vp.locator('[data-testid^="grade-"]')).toHaveCount(0);
    await vp.getByTestId('cutbox').scrollIntoViewIfNeeded();
    await shoot(vp, '점수해부-컷자료없음');
    expect(outside, '변형 빌드에서 밖으로 나간 요청').toEqual([]);
    await ctx.close();
  }

  // (12) 테스트 진행자용: 참가자 한 명을 시작하고 측정 기록을 본다.
  await openApp(page, '/test');
  await page.getByLabel('참가자 코드').fill('P01');
  await page.getByTestId('mode-rows').click();
  await stop('테스트진행자-새참가자');
  await page.getByTestId('start-run').click();
  await expectHash(page, '/');
  await page.getByRole('button', { name: '시험 고르기' }).click();
  await chooseExam(page, 'sample-a');
  await enterRows(page, examA, answersA);
  await page.getByRole('button', { name: '맞아요, 다음으로' }).click();
  await page.getByRole('button', { name: '없어요, 채점하기' }).click();
  await expectHash(page, '/score');
  await openApp(page, '/test');
  await page.getByLabel('참가자에게 준 답지의 답').fill(examA.items.map((it) => answersA[it.no]).join(','));
  await page.getByTestId('key-compare').click();
  await expect(page.getByTestId('key-result')).toHaveText('남은 오입력 0개');
  await page.getByTestId('run-card').scrollIntoViewIfNeeded();
  await stop('테스트진행자-측정기록');

  addMetric({ kind: 'tour', run: run.id, screens: count, leakChecks, shots: dir ? count : 0 });
}
