import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { exampleAnswers, exampleCauses, exampleMarks } from '../src/logic/example';
import type { Answers } from '../src/types';
import { checkScreen, findAnswerLeaks, type AuditOptions, type LeakTarget } from './audit';
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

// 모든 화면을 한 바퀴 돌면서 화면마다 검사하고(10장 3, 4, 5, 7, 9번) 캡처한다(10번).

export interface TourRun {
  id: string;
  /** 캡처를 남길 폴더 이름(docs/screens 아래). 없으면 검사만 한다. */
  shotDir: string | null;
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

export async function tour(page: Page, run: TourRun): Promise<void> {
  const examA = loadExam('a');
  const examB = loadExam('b');
  const examC = loadExam('c');
  const answersA = exampleAnswers(examA);
  const dir = run.shotDir ? resolve(ROOT, 'docs/screens', run.shotDir) : null;
  if (dir) mkdirSync(dir, { recursive: true });
  let count = 0;
  let leakChecks = 0;

  const stop = async (name: string, opts: AuditOptions = {}) => {
    count += 1;
    await settle(page);
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
    await checkScreen(page, name, run.id, opts);
    if (dir) {
      await page.screenshot({ path: resolve(dir, `${String(count).padStart(2, '0')}-${name}.png`), animations: 'disabled' });
    }
  };

  const noLeak = async (where: string, revealed: number[] = []) => {
    leakChecks += 1;
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
  await enterKeypad(page, examA, answersA, 12, 21);
  await tapKey(page, 1);
  await tapKey(page, 2);
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
  await enterKeypad(page, examA, answersA, 22, 30);
  await expectHash(page, '/review');

  // (4) 입력 확인
  await stop('입력확인');
  await page.locator('main [data-cell="14"]').click();
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
  await expect(page.getByTestId('step-1').getByText(/좌표를 복사했어요|복사하지 못했어요/)).toBeVisible();
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
  await page.getByTestId('wrong-15').scrollIntoViewIfNeeded();
  await stop('오답원인-정답확인');

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

  // (3) 답 입력, 5행 방식: 예시 시험 B
  const answersB: Answers = correctAnswers(examB);
  for (const no of [7, 17, 30]) answersB[no] = wrongValue(examB, no);
  answersB[12] = 'skip';
  answersB[21] = 'skip';
  await openApp(page, '/exams');
  await chooseExam(page, 'sample-b', 'not_yet', 'first');
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
  await page.getByRole('button', { name: '없어요' }).click();
  await expectHash(page, '/score');
  await page.getByRole('button', { name: '점수 해부 바로 보기' }).click();
  await expectHash(page, '/anatomy');
  await expect(page.getByTestId('row-guess-empty')).toBeVisible();
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

  // 드문 상태: 전부 정답(틀린 문항 없음). 저장소에 기록을 직접 넣어 만든다.
  await seedStore(page, {
    version: 1,
    sessions: [
      {
        id: 's-perfect',
        examId: 'sample-a',
        createdAt: '2026-11-22T10:00:00.000Z',
        gradedBefore: 'not_yet',
        seenBefore: null,
        answers: correctAnswers(examA),
        marks: {},
        marksEditedAfterGrading: false,
        timeFeel: null,
        savedAt: null,
        gradedAt: '2026-11-22T10:05:00.000Z',
        causes: {},
        answerViewed: {},
        targetGrade: '1',
        retries: {},
      },
    ],
    currentId: 's-perfect',
    inputMode: 'keypad',
    testRuns: [],
    activeRunId: null,
  });
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
  await page.getByRole('button', { name: '없어요' }).click();
  await expectHash(page, '/score');
  await openApp(page, '/test');
  await page.getByLabel('참가자에게 준 답지의 답').fill(examA.items.map((it) => answersA[it.no]).join(','));
  await page.getByTestId('key-compare').click();
  await expect(page.getByTestId('key-result')).toHaveText('남은 오입력 0개');
  await page.getByTestId('run-card').scrollIntoViewIfNeeded();
  await stop('테스트진행자-측정기록');

  addMetric({ kind: 'tour', run: run.id, screens: count, leakChecks, shots: dir ? count : 0 });
}
