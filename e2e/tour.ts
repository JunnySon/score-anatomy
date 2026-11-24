import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Browser, Page } from '@playwright/test';
import { exampleAnswers, exampleCauses, exampleMarks } from '../src/logic/example';
import { S, S_APP, S_TEST } from '../src/strings';
import type { Answers, AnswerValue, Exam } from '../src/types';
import { VARIANT_URL } from '../playwright.config';
import { openBundle, otherRequestsOf, sendRemote } from './appBridge';
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
import { AT_1710, AT_2010, ESTIMATE_CUTS, TEST_LOCK, TEST_NOTE, itemsWith, remoteData, sessionRecord, storeOf, testExam, typesPendingExam } from './remoteData';

// 모든 화면을 한 바퀴 돌면서 화면마다 검사하고(10장 3, 4, 5, 7, 8, 9번) 캡처한다(10번).
// 코스의 끝에는 앱 시험용 묶음을 가짜 다리 규격 2로 열어, 넘겨받은 시험 자료가 있어야 생기는 화면을 더했다(작업 지시서 3의 5장).

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

/**
 * 넘겨받은 시험(작업 지시서 3의 5장)에서 기록의 답이 틀린 문항과 그 인정하는 답(answer 와 복수 정답 altAnswers).
 * 인정하는 답은 시험 파일에서 읽는다. "정답 보기"를 누르기 전에는 화면에 나오면 안 된다. 단답형만 화면 전체에서 찾는다.
 */
function wrongTargets(exam: Exam, answers: Answers): LeakTarget[] {
  const targets: LeakTarget[] = [];
  for (const it of exam.items) {
    if (it.allCorrect || typeof it.answer !== 'number') continue;
    if ([it.answer, ...(it.altAnswers ?? [])].includes(answers[it.no] as number)) continue;
    targets.push({ no: it.no, answer: it.answer, altAnswers: it.altAnswers, distinctive: it.kind === 'short' });
  }
  return targets;
}

/** 주소의 해시만 바꾸고 그 화면이 그려질 때까지 기다린다. 앱용 묶음은 다시 읽으면 가짜 껍데기가 처음 자료를 다시 넣어서 이렇게 옮긴다. */
async function gotoHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((h) => {
    window.location.hash = `#${h}`;
  }, hash);
  await expectHash(page, hash);
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

  /**
   * 캡처를 남긴다. 화면 없이 실행한 Chrome 은 브라우저를 띄운 뒤 첫 캡처를 "Unable to capture screenshot"으로 실패할 때가 있어서,
   * 그 오류일 때만 화면을 바꾸지 않고 한 프레임을 기다렸다가 두 번까지 다시 찍는다(같은 화면 상태의 캡처다).
   */
  const capture = async (target: Page, path: string) => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await target.screenshot({ path, animations: 'disabled' });
        return;
      } catch (e) {
        if (attempt >= 3 || !String(e).includes('Unable to capture screenshot')) throw e;
        await target.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))));
      }
    }
  };
  const shoot = async (target: Page, name: string, opts: AuditOptions = {}) => {
    count += 1;
    await settle(target);
    await checkScreen(target, name, run.id, opts);
    if (dir) await capture(target, resolve(dir, `${String(count).padStart(2, '0')}-${name}.png`));
  };
  const stop = (name: string, opts: AuditOptions = {}) => shoot(page, name, opts);

  const noLeakOn = async (target: Page, targets: LeakTarget[], where: string, revealed: number[] = []) => {
    leakChecks += 1;
    await waitSettled(target);
    const leaks = await findAnswerLeaks(target, targets, revealed);
    addMetric({ kind: 'leak', run: run.id, where, leaks });
    expect.soft(leaks, `[${run.id}] ${where}: 정답 노출`).toEqual([]);
  };
  const noLeak = (where: string, revealed: number[] = []) => noLeakOn(page, LEAK_TARGETS, where, revealed);

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
  await expect(page.getByTestId('pad-panel').getByText('11번 답을 지웠어요.')).toBeVisible();
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
  await expect(page.getByTestId('pad-panel').getByText('답은 0부터 999까지예요.')).toBeVisible();
  await stop('답입력-키패드-단답형-안내', { mustFit: true });
  await tapKey(page, 'erase');
  await tapKey(page, 'erase');
  await tapKey(page, 'erase');
  await tapKey(page, 'go');
  await expect(page.getByTestId('pad-panel').getByText("22번이 비어 있어요. 안 푼 문항이면 '안 풂'을 눌러 주세요.")).toBeVisible();
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
  // 추정 컷이라 컷 자료가 바뀌면 화면도 바뀐다고 알린다. 컷이 어떻게 바뀔지는 약속하지 않는다(작업 지시서 3의 4-4).
  await expect(page.getByText('컷 자료가 바뀌면 이 화면도 바뀌어요.')).toBeVisible();
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

  // 앱 시험용 묶음(app-test)을 가짜 다리 규격 2로 연 상태(작업 지시서 3의 5장): 넘겨받은 시험 자료가 있어야 생기는 화면들.
  // 넘겨받는 시험은 예시 시험 A의 사본으로 지은 테스트 전용 시험이고(e2e/remoteData.ts), 29번은 복수 정답(257, 258)으로 둬서
  // 정답 노출 검사가 인정하는 답 모두를 찾게 한다. 기록은 검산 예시의 답, 표시, 원인으로 채점한 것이다.
  // 묶음은 file:// 주소로 열린다. 테스트 공통 준비(e2e/helpers.ts)의 요청 검사는 이 테스트의 브라우저 묶음에서 처음 연 주소(웹 서버)
  // 밖을 바깥으로 세므로, 묶음은 위의 변형 빌드처럼 새 브라우저 묶음에서 연다. 그 묶음은 묶음 파일 말고 읽은 주소가 없는지와
  // 콘솔 오류를 따로 본다. 시각은 작업 지시서 3의 형식 예시(2030-01-02의 08:40, 17:10, 17:45, 20:10)만 쓴다.
  {
    const ctx = await browser.newContext({
      viewport: run.viewport,
      colorScheme: run.colorScheme,
      deviceScaleFactor: run.deviceScaleFactor,
      hasTouch: true,
      isMobile: true,
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
    });
    const appErrors: string[] = [];
    const appPage = async () => {
      const p = await ctx.newPage();
      p.on('pageerror', (e) => appErrors.push(e.message));
      p.on('console', (m) => {
        if (m.type() === 'error') appErrors.push(m.text());
      });
      return p;
    };
    const multi = { 29: { altAnswers: [258] } };
    const pending = typesPendingExam({ rev: 2, items: itemsWith(multi) });
    const ready = testExam({ rev: 3, items: itemsWith(multi), cuts: ESTIMATE_CUTS });
    // 11번 정답을 학생이 넣은 4로 정정한 판(3점 문항이라 78점에서 81점). 정정 안내는 정답 값을 담지 않은 테스트 전용 문장이다.
    const fixed = testExam({ rev: 4, answersRev: 2, answersNote: TEST_NOTE, items: itemsWith({ ...multi, 11: { answer: 4 } }), cuts: ESTIMATE_CUTS });
    const record = sessionRecord('s-tour', 'test-remote-a', { gradedWith: { answersRev: 1, score: 78 } });
    const store = storeOf([record]);
    const before = wrongTargets(ready, record.answers as Answers);
    const after = wrongTargets(fixed, record.answers as Answers);
    expect(before.map((t) => t.no)).toEqual([11, 15, 20, 21, 27, 29]);
    expect(after.map((t) => t.no)).toEqual([15, 20, 21, 27, 29]);
    expect(after.find((t) => t.no === 29)).toEqual({ no: 29, answer: 257, altAnswers: [258], distinctive: true });

    // 유형 분류 전 판(seq 1, 받은 자료 기준 오후 5시 10분): 점수는 보이고, 계단으로 가는 버튼 자리에 안내가 있다. 등급컷 자료도 아직 없다.
    const vp = await appPage();
    await openBundle(vp, 'app-test', { bridge: 2, store, remote: remoteData(1, AT_1710, [pending], [TEST_LOCK]), remoteMode: 'silent' });
    await vp.getByRole('button', { name: S.start.resume }).click();
    await expectHash(vp, '/anatomy');
    await expect(vp.getByTestId('actual')).toHaveText('78점');
    await expect(vp.getByTestId('steps-pending')).toHaveText(S.steps.typesPendingNoCuts);
    await expect(vp.getByTestId('no-cuts')).toHaveText(S.anatomy.noCutsTypesPending);
    await shoot(vp, '앱-점수해부-유형분류전');
    await noLeakOn(vp, before, '앱 묶음 점수 해부, 유형 분류 전');

    // 시험 선택 화면 본문 끝의 받은 자료 안내와 "새로 확인". 껍데기는 새로 확인에 답하지 않는 상태로 열었다.
    await gotoHash(vp, '/exams');
    await expect(vp.getByTestId('remote-issued')).toHaveText(S_APP.remoteIssued(2030, 1, 2, 17, 10));
    await vp.getByTestId('remote-notice').scrollIntoViewIfNeeded();
    await shoot(vp, '앱-시험선택-받은자료');
    // 누르면 응답이 올 때까지 버튼을 쓸 수 없다.
    const refresh = vp.getByTestId('remote-refresh');
    await refresh.click();
    await expect(refresh).toHaveAttribute('aria-disabled', 'true');
    await shoot(vp, '앱-시험선택-새로확인중');
    // 껍데기가 더 새로운 자료(seq 2, 오후 8시 10분)로 답한다. 유형 분류가 끝났고 추정 등급컷(2등급은 한 값)이 든 판이다.
    await sendRemote(vp, remoteData(2, AT_2010, [ready], [TEST_LOCK]));
    await expect(vp.getByTestId('remote-result')).toHaveText(S_APP.remoteResult.new);
    await expect(vp.getByTestId('remote-issued')).toHaveText(S_APP.remoteIssued(2030, 1, 2, 20, 10));
    await shoot(vp, '앱-시험선택-새로받음');

    // 두 값이 같은 추정 컷은 한 숫자와 "추정"이고, 출처 시트는 시각이 든 기준과 한 값 추정 컷의 설명을 적는다.
    await gotoHash(vp, '/anatomy');
    await expect(vp.getByTestId('to-steps')).toHaveText(S.anatomy.toSteps(3));
    await vp.getByTestId('grade-2').click();
    await expect(vp.getByTestId('cut-title')).toHaveText('2등급 컷 82점');
    await expect(vp.getByTestId('cut-badge')).toHaveText(S.common.estimate);
    await vp.getByTestId('cutbox').scrollIntoViewIfNeeded();
    await shoot(vp, '앱-점수해부-한값추정컷');
    await noLeakOn(vp, before, '앱 묶음 점수 해부, 한 값 추정 컷');
    await vp.getByTestId('cut-badge').click();
    await expect(vp.getByTestId('cut-source').locator('p')).toHaveText([
      S.anatomy.sourceSample,
      S.anatomy.source('예시 값'),
      S.anatomy.asOfTime(2030, 1, 2, 20, 10),
      S.anatomy.sourceEstimateOne,
    ]);
    await shoot(vp, '앱-점수해부-컷출처');
    await noLeakOn(vp, before, '앱 묶음 등급컷 출처, 기준 시각');
    await vp.getByRole('button', { name: S.common.close }).click();
    await expect(vp.getByTestId('cut-source')).toHaveCount(0);

    // 정답 정정(seq 3): 점수 화면 위쪽의 알림. 알림의 정정 안내는 "정답 보기" 전에 보이는 글자라서 정답 노출 검사를 함께 한다.
    await sendRemote(vp, remoteData(3, AT_2010, [fixed], [TEST_LOCK]));
    await expect(vp.getByTestId('correction-text')).toHaveText(S.correction.changed(78, 81));
    await gotoHash(vp, '/score');
    await expect(vp.getByTestId('score')).toHaveText('81점');
    await expect(vp.getByTestId('correction-note')).toHaveText(TEST_NOTE);
    await shoot(vp, '앱-점수-정정알림');
    await noLeakOn(vp, after, '앱 묶음 점수, 정정 알림');
    // 대조: "정답 보기"를 누른 뒤에는 같은 검사기가 복수 정답(29번의 258)도 잡아낸다.
    await gotoHash(vp, '/causes');
    await vp.getByTestId('show-answer-29').click();
    await expect(vp.getByTestId('answer-29')).toContainText('정답 257, 258');
    expect(await findAnswerLeaks(vp, after, []), '검사기가 29번의 복수 정답 노출을 잡아내는지').toContain('29번 정답 258이 화면에 있음');
    expect(otherRequestsOf(vp), '앱 묶음에서 묶음 파일 말고 읽은 주소').toEqual([]);
    await vp.close();

    // 껍데기가 자료를 아직 넘겨주지 못한 채(remote 칸 없음) 같은 기록으로 다시 연 앱: 기록을 지우지 않고 안내를 보여 준다.
    const again = await appPage();
    await openBundle(again, 'app-test', { bridge: 2, store });
    await again.getByRole('link', { name: S.tabs.history, exact: true }).click();
    await expectHash(again, '/history');
    await expect(again.getByTestId('history-missing')).toHaveText(S.missingExam.body);
    await shoot(again, '앱-기록-시험자료없음');
    await gotoHash(again, '/anatomy');
    await expect(again.getByTestId('exam-missing')).toHaveText(S.missingExam.body);
    await shoot(again, '앱-시험자료없음');
    expect(otherRequestsOf(again), '다시 연 앱 묶음에서 묶음 파일 말고 읽은 주소').toEqual([]);
    await again.close();

    // 진행자용 화면의 풀이 잠금 한 줄: 넘겨받은 테스트 전용 잠금 항목(2030-01-02T08:40부터 17:45까지)과, 시계를 한국 시간
    // 2030년 1월 2일 오전 8시 40분에 고정한 상태. 시계는 이 브라우저 묶음 전체에 걸리므로 마지막에 새 페이지로 연다.
    await ctx.clock.setFixedTime(new Date('2030-01-02T08:40:00+09:00'));
    const admin = await appPage();
    await openBundle(admin, 'app-test', { bridge: 2, remote: remoteData(3, AT_2010, [fixed], [TEST_LOCK]) }, '/test');
    await expect(admin.getByTestId('lock-status')).toHaveText(S_TEST.lockClosed(17, 45));
    await shoot(admin, '앱-테스트진행자-풀이잠금');
    expect(otherRequestsOf(admin), '진행자용 화면을 연 앱 묶음에서 묶음 파일 말고 읽은 주소').toEqual([]);
    expect(appErrors, '앱 묶음의 콘솔 오류').toEqual([]);
    await ctx.close();
  }

  addMetric({ kind: 'tour', run: run.id, screens: count, leakChecks, shots: dir ? count : 0 });
}
