import type { Locator, Page } from '@playwright/test';
import { exampleAnswers, exampleCauses, exampleMarks } from '../src/logic/example';
import { S, S_APP, S_TEST } from '../src/strings';
import type { Exam } from '../src/types';
import {
  BUNDLES,
  bridgeLog,
  lastSavedJson,
  openBundle,
  otherRequestsOf,
  remoteRequests,
  sendRemote,
  sendRemoteFailed,
  setRemoteMode,
  setRemoteNext,
  storeMessages,
} from './appBridge';
import { auditPage, findAnswerLeaks, type LeakTarget } from './audit';
import { chooseCauses, chooseExam, enterKeypad, expect, expectHash, loadExam, setMarks, tapKey, test } from './helpers';
import {
  AT_0840,
  AT_1710,
  AT_2010,
  CONFIRMED_CUTS,
  ESTIMATE_CUTS,
  TEST_LOCK,
  TEST_NOTE,
  correctedExam,
  itemsWith,
  remoteData,
  sessionRecord,
  storeOf,
  testExam,
  typesPendingExam,
  unreleasedExam,
} from './remoteData';

// 앱용 묶음과 다리 규격 2(작업 지시서 3의 5장과 8장): 가짜 껍데기가 시험 자료(remote)를 넘겨주는 브라우저에서 커밋된 묶음을 직접 연다.
// 껍데기와의 약속은 docs/앱_다리_규격.md 7장에 있다. 넘겨받는 시험은 예시 시험 A의 사본으로 지은 테스트 전용 시험이다(e2e/remoteData.ts).
// 모든 테스트가 묶음 파일 말고 읽은 주소가 없는지(바깥 요청 0건)와, 그려진 화면에 금지 문자가 없는지 함께 본다.
// 콘솔 오류는 테스트 공통 준비(e2e/helpers.ts)가 실패로 센다. 넘겨받은 자료에서 버린 것의 이유는 경고(console.warn)라서 실패가 아니다.
// 이 파일은 앱용 묶음 흐름의 지표(kind app)를 남기지 않는다(verify 12번이 그 수를 같음으로 견준다).

// 등급컷(ESTIMATE_CUTS, CONFIRMED_CUTS)과 잠금 항목(TEST_LOCK)은 화면 코스(e2e/tour.ts)도 쓰므로 e2e/remoteData.ts 에 있다.
/** 기록을 넣은 때(e2e/remoteData.ts 의 CREATED_AT)의 날짜 글자(기기 시간대는 한국 시간, playwright.config.ts). */
const CREATED_DATE = '2030년 1월 2일';
const TITLE = '테스트 전용 시험 A';

interface SavedRecord {
  id: string;
  examId: string;
  answers: Record<string, unknown>;
  marks: Record<string, unknown>;
  causes: Record<string, unknown>;
  retries: Record<string, { correct: boolean; answersRev?: number }>;
  savedAt: string | null;
  gradedAt: string | null;
  gradedWith?: { answersRev: number; score: number };
  examTitle?: string;
}

/** 저장 형식(JSON)으로 옮긴 값. 문항 번호 열쇠가 글자가 된다. */
const asStored = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** saStore 로 저장한 기록 가운데 그 기록 한 건을 저장한 차례대로. */
async function savedRecords(page: Page, id: string): Promise<SavedRecord[]> {
  return (await storeMessages(page))
    .filter((m) => m.op === 'save')
    .map((m) => (JSON.parse(m.json!) as { sessions: SavedRecord[] }).sessions.find((s) => s.id === id))
    .filter((s): s is SavedRecord => s !== undefined);
}

/** 마지막으로 저장한 그 기록. 저장한 적이 없으면 null. */
async function lastRecord(page: Page, id: string): Promise<SavedRecord | null> {
  const list = await savedRecords(page, id);
  return list[list.length - 1] ?? null;
}

/** 기록마다 저장한 답과 표시가 모두 같은지 본다(학생이 넣은 답과 표시는 어떤 경우에도 바뀌지 않는다). */
function expectSameInput(records: SavedRecord[], answers: unknown, marks: unknown): void {
  for (const r of records) {
    expect(r.answers, '저장한 답').toEqual(asStored(answers));
    expect(r.marks, '저장한 표시').toEqual(asStored(marks));
  }
}

/** 시험 선택 화면의 시험 id 를 보이는 차례대로. */
const examIds = (page: Page): Promise<string[]> =>
  page.locator('main [role="radio"][data-testid^="exam-"]').evaluateAll((els) => els.map((el) => (el.getAttribute('data-testid') ?? '').slice('exam-'.length)));

/** 오답 원인 화면의 틀린 문항 번호. */
const wrongNos = (page: Page): Promise<number[]> =>
  page.locator('[data-testid^="wrong-"]').evaluateAll((els) => els.map((el) => Number((el.getAttribute('data-testid') ?? '').slice('wrong-'.length))));

/** 주소의 해시만 바꾼다(다시 읽지 않는다). 그 화면이 그려졌는지는 부르는 쪽이 expectHash 로 본다. */
async function gotoHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((h) => {
    window.location.hash = `#${h}`;
  }, hash);
}

/** 요소 한가운데를 좌표로 누른다. 쓸 수 없는 버튼도 누르고, 연달아 누르기 보호를 기다리지 않는다. */
async function clickCenter(page: Page, target: Locator): Promise<void> {
  const box = (await target.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** 화면에 그려진 글자와 접근성 라벨. */
const screenText = (page: Page): Promise<string> =>
  page.evaluate(() => [document.body.innerText, ...Array.from(document.querySelectorAll('[aria-label]'), (el) => el.getAttribute('aria-label') ?? '')].join('\n'));

/**
 * 그려진 화면(글자, 접힌 설명, 접근성 라벨, 입력 칸, 가상 요소)에 금지 문자, 느낌표, 이모지가 없다.
 * 화면 검사(e2e/audit.ts 의 auditPage)로 읽고 검사 기록은 남기지 않는다.
 */
async function expectCleanText(page: Page, where: string): Promise<void> {
  const r = await auditPage(page);
  expect(r.forbidden, `${where}: 금지 문자`).toEqual([]);
  expect(r.exclamation, `${where}: 느낌표`).toEqual([]);
  expect(r.emoji, `${where}: 이모지`).toEqual([]);
}

/** 묶음 파일 말고 읽은 주소가 없다(바깥 요청 0건). */
function expectNoOtherRequests(...pages: Page[]): void {
  for (const p of pages) expect(otherRequestsOf(p), '묶음 파일 말고 읽은 주소').toEqual([]);
}

/** 테스트 공통 준비가 보지 않는 페이지(앱을 다시 연 새 페이지)의 콘솔 오류. */
function errorsOf(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

/** 페이지의 콘솔 경고(console.warn). 넘겨받은 자료에서 버린 것의 이유가 여기에 남는다(src/exams/merge.ts). */
function warningsOf(page: Page): { text: string; args: Promise<unknown[]> }[] {
  const list: { text: string; args: Promise<unknown[]> }[] = [];
  page.on('console', (m) => {
    if (m.type() === 'warning') list.push({ text: m.text(), args: Promise.all(m.args().map((a) => a.jsonValue().catch(() => null))) });
  });
  return list;
}

/** 정답 노출 검사의 대상(오답 원인 화면의 틀린 문항). 인정하는 답은 시험 파일에서 읽는다. 단답형만 화면 전체에서 찾는다. */
function leakTargets(exam: Exam, nos: number[]): LeakTarget[] {
  return nos.map((no) => {
    const it = exam.items.find((x) => x.no === no)!;
    return { no, answer: it.answer as number, altAnswers: it.altAnswers, distinctive: it.kind === 'short' };
  });
}

/** 받은 자료 기준 글자(시험 선택 화면의 안내). */
const issuedText = (h: number, mi: number) => S_APP.remoteIssued(2030, 1, 2, h, mi);

for (const bundle of BUNDLES) {
  test(`${bundle}: 정답 공개 전 시험을 remote 로 넣으면 목록에 나오고 답을 저장할 수 있으며, 같은 id 의 정답 든 판이 오면 앱을 다시 열지 않아도, 다시 연 뒤에도 저장해 둔 답을 채점한다`, async ({
    page,
    context,
  }) => {
    // 넘겨받는 시험은 예시 시험 A의 사본이라 문항 구성과 정답이 같다(검산 예시의 답을 넣으면 78점).
    const exam = loadExam('a');
    const answers = exampleAnswers(exam);
    const before = remoteData(1, AT_0840, [unreleasedExam()]);
    const released = remoteData(2, AT_1710, [testExam({ rev: 2 })]);
    await openBundle(page, bundle, { bridge: 2, remote: before });
    await page.getByRole('button', { name: '시험 고르기' }).click();
    // 넘겨받은 시험은 시행일이 없는 묶음 안 예시 시험보다 위에 온다. 예시와 정답 공개 전 배지가 붙는다.
    expect(await examIds(page)).toEqual(['test-remote-a', 'sample-a', 'sample-b', 'sample-c']);
    const option = page.getByTestId('exam-test-remote-a');
    await expect(option.locator('.opt__main > span').first()).toHaveText(TITLE);
    await expect(option.locator('.badge')).toHaveText([S.common.sample, S.common.unreleased]);
    await expectCleanText(page, '시험 선택(정답 공개 전 시험)');
    await chooseExam(page, 'test-remote-a');
    await enterKeypad(page, exam, answers);
    await expectHash(page, '/review');
    await page.getByRole('button', { name: S.review.go }).click();
    await setMarks(page, exampleMarks());
    await page.getByRole('button', { name: S.marks.save }).click();
    await expect(page.getByText(S.marks.unreleasedNotice)).toBeVisible();
    await expect(page.getByTestId('grade')).toHaveCount(0);
    await expectCleanText(page, '표시 화면(정답 공개 전, 저장함)');
    const savedOf = async () => {
      const json = await lastSavedJson(page);
      return json ? ((JSON.parse(json) as { sessions: SavedRecord[] }).sessions[0] ?? null) : null;
    };
    await expect.poll(async () => (await savedOf())?.savedAt ?? null).not.toBeNull();
    const savedJson = (await lastSavedJson(page))!;
    const saved = (await savedOf())!;
    expect(saved.examId).toBe('test-remote-a');
    expect(saved.gradedAt).toBeNull();
    expectSameInput([saved], answers, exampleMarks());
    const savesBefore = (await savedRecords(page, saved.id)).length;

    // 기록 화면: 저장해 둔 기록은 "정답 공개 전"이다.
    await page.getByRole('button', { name: S.marks.toHistory }).click();
    await expectHash(page, '/history');
    const item = page.getByTestId('history-item');
    await expect(item).toContainText(TITLE);
    await expect(item).toContainText(S.common.unreleased);
    // 껍데기가 같은 id 의 정답 든 판(rev 2)을 알린다. 앱을 다시 열지 않아도 기록 화면이 다시 그려지고 채점할 수 있게 된다.
    await sendRemote(page, released);
    await expect(item).toContainText(S.history.readyToGrade);
    await page.getByRole('button', { name: new RegExp(`^${TITLE} 기록 열기`) }).click();
    await expectHash(page, '/marks');
    await expect(page.getByText(S.marks.unreleasedNotice)).toHaveCount(0);
    await page.getByTestId('grade').click();
    await expect(page.getByTestId('score')).toHaveText('78점');
    await page.getByRole('button', { name: S.score.toCauses }).click();
    await chooseCauses(page, exampleCauses());
    await page.getByRole('button', { name: S.causes.go }).click();
    await expect(page.getByTestId('actual')).toHaveText('78점');
    await expect(page.getByTestId('row-guess').locator('.num')).toHaveText('7점');
    await expect(page.getByTestId('row-slip').locator('.num')).toHaveText('8점');
    // 이 판에는 등급컷 자료가 아직 없다.
    await expect(page.getByTestId('no-cuts')).toHaveText(S.anatomy.noCuts);
    await page.getByTestId('to-steps').click();
    await expect(page.locator('[data-testid^="step-"][data-type]')).toHaveCount(3);
    await expectCleanText(page, '계단(정답 든 판을 받은 뒤)');
    // 정답 든 판을 받은 뒤의 저장도 넣은 답과 표시는 저장해 둔 그대로이고, 채점 흔적은 지금 정답 판으로 적었다.
    const after = (await savedRecords(page, saved.id)).slice(savesBefore);
    expect(after.length).toBeGreaterThan(0);
    expectSameInput(after, answers, exampleMarks());
    expect(after[after.length - 1]!.gradedWith).toEqual({ answersRev: 1, score: 78 });

    // 앱을 끝냈다 켠다: 껍데기는 정답 든 판을 받아 둔 채로, 정답을 받기 전에 마지막으로 저장한 기록을 store 로 넣는다.
    const again = await context.newPage();
    const errors = errorsOf(again);
    await openBundle(again, bundle, { bridge: 2, store: savedJson, remote: released });
    await again.getByRole('button', { name: S.start.resume }).click();
    await expectHash(again, '/marks');
    await again.getByTestId('grade').click();
    await expect(again.getByTestId('score')).toHaveText('78점');
    const reopened = (await lastRecord(again, saved.id))!;
    expectSameInput([reopened], answers, exampleMarks());
    expect(reopened.gradedWith).toEqual({ answersRev: 1, score: 78 });
    await expectCleanText(again, '점수(다시 연 뒤)');
    expect(errors, '다시 연 앱의 콘솔 오류').toEqual([]);
    expectNoOtherRequests(page, again);
    await again.close();
  });
}

test('app-test: 유형 분류 전(typesReady false) 판이면 계단 자리에 안내가 나오고 다시 풀기 주소는 계단 자리로 가며, 유형 분류가 끝난 판이 오면 그 자리에서 계단과 "고칠 것" 버튼이 나온다', async ({ page }) => {
  // 유형 분류 전 판: 자리만 채우는 유형 하나("분류 중", 작업 지시서 3의 4-3 형식 예시)를 모든 문항이 가리킨다(e2e/remoteData.ts 의 typesPendingExam).
  const pending = typesPendingExam({ rev: 2 });
  const pendingWithCuts = typesPendingExam({ rev: 3, cuts: ESTIMATE_CUTS });
  const ready = testExam({ rev: 4, cuts: ESTIMATE_CUTS });
  const record = sessionRecord('s-types', 'test-remote-a', { gradedWith: { answersRev: 1, score: 78 } });
  await openBundle(page, 'app-test', { bridge: 2, store: storeOf([record]), remote: remoteData(1, AT_1710, [pending]) });
  await page.getByRole('button', { name: S.start.resume }).click();
  await expectHash(page, '/anatomy');
  // 점수 해부: 채점과 점수는 그대로 보이고, 아래 고정 영역의 계단으로 가는 버튼 자리에 안내가 있다. 등급컷 자료도 아직 없다.
  await expect(page.getByTestId('actual')).toHaveText('78점');
  await expect(page.getByTestId('steps-pending')).toHaveText(S.steps.typesPendingNoCuts);
  await expect(page.locator('.dock').getByTestId('steps-pending')).toBeVisible();
  await expect(page.getByTestId('to-steps')).toHaveCount(0);
  await expect(page.getByTestId('no-cuts')).toHaveText(S.anatomy.noCutsTypesPending);
  expect(await screenText(page)).not.toContain('분류 중');
  await expectCleanText(page, '점수 해부(유형 분류 전, 등급컷 없음)');
  // 계단 화면 주소로 들어와도 계단 대신 같은 안내다. 유형 이름은 보이지 않는다.
  await gotoHash(page, '/steps');
  await expectHash(page, '/steps');
  await expect(page.locator('main').getByTestId('steps-pending')).toHaveText(S.steps.typesPendingNoCuts);
  await expect(page.getByRole('heading', { name: S.steps.emptyTitle })).toBeVisible();
  await expect(page.locator('[data-testid^="step-"][data-type]')).toHaveCount(0);
  expect(await screenText(page)).not.toContain('분류 중');
  await expectCleanText(page, '계단(유형 분류 전)');
  // 다시 풀기 주소(자리만 채우는 유형, 분류가 끝나면 생길 유형)는 계단 자리로 돌려보낸다.
  for (const typeId of ['t00', 't06']) {
    await gotoHash(page, `/retry/${typeId}`);
    await expectHash(page, '/steps');
    await expect(page.locator('main').getByTestId('steps-pending')).toBeVisible();
  }
  // 등급컷이 먼저 온 판: 안내가 "점수와 등급컷은 지금 볼 수 있어요"로 바뀐다(지금 보고 있는 계단 화면이 다시 그려진다).
  await sendRemote(page, remoteData(2, AT_2010, [pendingWithCuts]));
  await expect(page.locator('main').getByTestId('steps-pending')).toHaveText(S.steps.typesPending);
  await gotoHash(page, '/anatomy');
  await expectHash(page, '/anatomy');
  await expect(page.getByTestId('steps-pending')).toHaveText(S.steps.typesPending);
  await expect(page.getByTestId('to-steps')).toHaveCount(0);
  await expect(page.locator('[data-testid^="grade-"]')).toHaveCount(3);
  await gotoHash(page, '/steps');
  await expectHash(page, '/steps');
  // 유형 분류가 끝난 판이 오면 지금 보고 있는 계단 화면에 계단이 나온다(검산 예시와 같은 답, 표시, 원인이라 3개).
  await sendRemote(page, remoteData(3, AT_2010, [ready]));
  await expect(page.locator('[data-testid^="step-"][data-type]')).toHaveCount(3);
  await expect(page.getByTestId('step-1').getByTestId('step-points')).toHaveText('놓친 배점 8점, 찍었다고 표시한 정답 4점');
  await expect(page.getByTestId('steps-pending')).toHaveCount(0);
  await expectCleanText(page, '계단(유형 분류가 끝난 판)');
  await gotoHash(page, '/anatomy');
  await expectHash(page, '/anatomy');
  await expect(page.getByTestId('to-steps')).toHaveText(S.anatomy.toSteps(3));
  await expect(page.getByTestId('steps-pending')).toHaveCount(0);
  // 다시 풀기도 이제 열린다.
  await gotoHash(page, '/retry/t06');
  await expectHash(page, '/retry/t06');
  expectNoOtherRequests(page);
});

test('app-test: 넘겨받은 등급컷: 시각이 든 추정 컷은 범위와 "추정", 한 값 추정 컷은 한 숫자와 "추정", 주관 기관 발표 컷은 "확정"이고 출처 시트의 기준과 설명이 셋으로 나뉜다', async ({ page }) => {
  const record = sessionRecord('s-cuts', 'test-remote-a', { gradedWith: { answersRev: 1, score: 78 } });
  await openBundle(page, 'app-test', { bridge: 2, store: storeOf([record]), remote: remoteData(1, AT_2010, [testExam({ rev: 2, cuts: ESTIMATE_CUTS })]) });
  await page.getByRole('button', { name: S.start.resume }).click();
  await expectHash(page, '/anatomy');
  await expect(page.getByTestId('actual')).toHaveText('78점');
  const sourceLines = page.getByTestId('cut-source').locator('p');
  const openSource = async () => {
    await page.getByTestId('cut-badge').click();
    await expect(page.getByTestId('cut-source')).toBeVisible();
  };
  const closeSource = async () => {
    await page.getByRole('button', { name: S.common.close }).click();
    await expect(page.getByTestId('cut-source')).toHaveCount(0);
  };
  const timeLine = S.anatomy.asOfTime(2030, 1, 2, 20, 10);
  expect(timeLine).toBe('기준: 2030년 1월 2일 오후 8시 10분');

  // 시각이 든 추정 컷(범위).
  await page.getByTestId('grade-1').click();
  await expect(page.getByTestId('cut-title')).toHaveText('1등급 컷 88~92점');
  await expect(page.getByTestId('cut-badge')).toHaveText(S.common.estimate);
  await expect(page.getByTestId('cut-actual')).toHaveText('실제 78점 기준 10~14점 남았어요');
  await openSource();
  await expect(sourceLines).toHaveText([S.anatomy.sourceSample, S.anatomy.source('예시 값'), timeLine, S.anatomy.sourceEstimate]);
  await expectCleanText(page, '등급컷 출처(추정 범위)');
  await closeSource();

  // 두 값이 같은 추정 컷: 한 숫자이고 배지는 "추정"이다.
  await page.getByTestId('grade-2').click();
  await expect(page.getByTestId('cut-title')).toHaveText('2등급 컷 82점');
  await expect(page.getByTestId('cut-badge')).toHaveText(S.common.estimate);
  await expect(page.getByTestId('cut-badge')).toHaveAttribute('aria-label', S.anatomy.cutBadgeLabel(S.common.estimate));
  await expect(page.getByTestId('cut-actual')).toHaveText('실제 78점 기준 4점 남았어요');
  await expect(page.getByTestId('cut-luck')).toContainText('찍기 운을 평균으로 보면 약 75점, 그 기준으로는 7점이에요');
  await openSource();
  await expect(sourceLines).toHaveText([S.anatomy.sourceSample, S.anatomy.source('예시 값'), timeLine, S.anatomy.sourceEstimateOne]);
  await expectCleanText(page, '등급컷 출처(추정 한 값)');
  await closeSource();

  // 켜져 있는 동안 주관 기관 발표 컷이 든 판이 온다: 지금 화면이 다시 그려지고 배지는 "확정"이다.
  await sendRemote(page, remoteData(2, AT_2010, [testExam({ rev: 3, cuts: CONFIRMED_CUTS })]));
  await expect(page.getByTestId('cut-badge')).toHaveText(S.common.confirmed);
  await expect(page.getByTestId('cut-title')).toHaveText('2등급 컷 82점');
  await expect(page.getByTestId('cut-actual')).toHaveText('실제 78점 기준 4점 남았어요');
  await openSource();
  await expect(sourceLines).toHaveText([S.anatomy.sourceSample, S.anatomy.source('예시 값'), S.anatomy.asOf('2030-01-02'), S.anatomy.sourceConfirmed]);
  await expectCleanText(page, '등급컷 출처(확정)');
  await closeSource();
  await page.getByTestId('grade-3').click();
  await expect(page.getByTestId('cut-title')).toHaveText('3등급 컷 72점');
  await expect(page.getByTestId('cut-actual')).toHaveText(S.anatomy.actualAboveSingle);
  // 확정 컷에는 "컷 자료가 바뀌면" 같은 덧붙임이 없고, 확정을 약속하는 문구는 화면 어디에도 없다.
  // 찾는 말은 src/docs.test.ts 처럼 조각으로 나눠 적는다(그 테스트가 이 파일도 읽는다).
  const text = await screenText(page);
  expect(text).not.toContain(S.anatomy.actualWithinRest);
  expect(text).not.toMatch(new RegExp(['확정', '(이\\s*)?', '되면'].join('')));
  await expectCleanText(page, '점수 해부(확정 컷)');
  expectNoOtherRequests(page);
});

test('app-test: 점수가 바뀌는 정답 정정: 켜져 있는 동안 정정된 판이 오면 점수 해부와 점수 화면 위쪽에 알리고 기록 화면에 표시를 붙이며, "확인했어요" 뒤 채점 흔적을 지금 값으로 바꾼다. 오답 원인과 계단은 지금 정답 기준이고 넣은 답과 표시는 그대로다', async ({
  page,
}) => {
  const record = sessionRecord('s-up', 'test-remote-a', { gradedWith: { answersRev: 1, score: 78 } });
  // 11번 정답을 학생이 넣은 4로 정정한 판(3점 문항이라 78점에서 81점). 11번은 찍었다고 표시한 문항이다.
  const fixed = correctedExam(3, { 11: 4 });
  await openBundle(page, 'app-test', { bridge: 2, store: storeOf([record]), remote: remoteData(1, AT_1710, [testExam({ rev: 2 })]) });
  await page.getByRole('button', { name: S.start.resume }).click();
  await expectHash(page, '/anatomy');
  await expect(page.getByTestId('actual')).toHaveText('78점');
  await expect(page.getByTestId('correction-notice')).toHaveCount(0);
  // 정정된 판이 온다. 지금 보고 있는 점수 해부 화면에 알림이 생기고 점수는 지금 정답으로 다시 계산한 값이다.
  await sendRemote(page, remoteData(2, AT_2010, [fixed]));
  await expect(page.getByTestId('correction-text')).toHaveText(S.correction.changed(78, 81));
  expect(S.correction.changed(78, 81)).toBe('정답이 정정돼서 다시 채점했어요. 78점에서 81점으로 바뀌었어요.');
  await expect(page.getByTestId('correction-note')).toHaveText(TEST_NOTE);
  await expect(page.getByTestId('correction-ack')).toHaveText(S.correction.ack);
  await expect(page.getByTestId('actual')).toHaveText('81점');
  // 알림의 정정 안내는 "정답 보기" 전에 보이는 글자다. 틀린 문항의 정답이 드러나지 않는다.
  expect(await findAnswerLeaks(page, leakTargets(fixed, [15, 20, 21, 27, 29]))).toEqual([]);
  await expectCleanText(page, '점수 해부(정정 알림, 점수가 바뀜)');
  await gotoHash(page, '/score');
  await expectHash(page, '/score');
  await expect(page.getByTestId('score')).toHaveText('81점');
  await expect(page.getByTestId('correction-text')).toHaveText(S.correction.changed(78, 81));
  await expect(page.getByTestId('correction-note')).toHaveText(TEST_NOTE);
  await expectCleanText(page, '점수(정정 알림, 점수가 바뀜)');
  // 기록 화면: 확인하기 전에는 그 기록에 "정답 정정으로 다시 채점됨"을 붙이고 열기 버튼 이름에도 넣는다.
  await page.getByRole('link', { name: S.tabs.history, exact: true }).click();
  await expectHash(page, '/history');
  await expect(page.getByTestId('history-corrected')).toHaveText(S.history.corrected);
  const detail = `${CREATED_DATE}, 81점`;
  await expect(page.getByRole('button', { name: S.history.openCorrected(TITLE, detail), exact: true })).toBeVisible();
  await expectCleanText(page, '기록(정정 표시)');
  await page.getByRole('button', { name: S.history.openCorrected(TITLE, detail), exact: true }).click();
  await expectHash(page, '/anatomy');
  // "확인했어요": 알림이 닫히고 채점 흔적이 지금 정답 판과 지금 점수가 된다.
  await page.getByTestId('correction-ack').click();
  await expect(page.getByTestId('correction-notice')).toHaveCount(0);
  await expect(page.getByTestId('actual')).toHaveText('81점');
  await expect.poll(async () => (await lastRecord(page, record.id as string))?.gradedWith).toEqual({ answersRev: 2, score: 81 });
  await gotoHash(page, '/score');
  await expectHash(page, '/score');
  await expect(page.getByTestId('correction-notice')).toHaveCount(0);
  await page.getByRole('link', { name: S.tabs.history, exact: true }).click();
  await expectHash(page, '/history');
  await expect(page.getByTestId('history-corrected')).toHaveCount(0);
  await expect(page.getByRole('button', { name: S.history.open(TITLE, detail), exact: true })).toBeVisible();
  // 정정 뒤 오답 원인: 11번은 맞은 문항이 되어 목록에서 빠진다(고른 원인은 기록에 남는다). 나머지 원인은 그대로다.
  await gotoHash(page, '/causes');
  await expectHash(page, '/causes');
  expect(await wrongNos(page)).toEqual([15, 20, 21, 27, 29]);
  await expect(page.getByTestId('cause-15-slip')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('cause-20-blank')).toHaveAttribute('aria-checked', 'true');
  // 정정 뒤 계단: 11번이 찍었다고 표시한 정답이 되어 확률 유형의 계단이 지금 정답 기준으로 바뀐다.
  await gotoHash(page, '/steps');
  await expectHash(page, '/steps');
  await expect(page.locator('[data-testid^="step-"][data-type]')).toHaveCount(3);
  await expect(page.getByTestId('step-1').getByTestId('step-points')).toHaveText('놓친 배점 8점, 찍었다고 표시한 정답 4점');
  await expect(page.getByTestId('step-3')).toHaveAttribute('data-type', 't08');
  await expect(page.getByTestId('step-3').getByTestId('step-points')).toHaveText('찍었다고 표시한 정답 6점');
  await expect(page.getByTestId('step-3').getByTestId('step-reason')).toHaveText(S.steps.reasonGuess([9, 11]));
  // 정정 전후로 저장한 답과 표시는 처음 넣은 기록 그대로다. 11번의 원인도 지우지 않았다.
  const saves = await savedRecords(page, record.id as string);
  expect(saves.length).toBeGreaterThan(0);
  expectSameInput(saves, record.answers, record.marks);
  expect(saves[saves.length - 1]!.causes).toEqual(asStored(record.causes));
  expectNoOtherRequests(page);
});

test('app-test: 점수가 그대로인 정답 정정: 알림이 "점수는 78점 그대로예요"이고 점수 화면에서 "확인했어요"로 닫으면 채점 흔적이 바뀐다. 정정으로 틀리게 된 문항은 원인을 고르기 전 상태로 나온다', async ({
  page,
}) => {
  const record = sessionRecord('s-same', 'test-remote-a', { gradedWith: { answersRev: 1, score: 78 } });
  // 7번(학생 답 5, 3점)은 정답을 4로 바꿔 틀리게, 11번(학생 답 4, 3점)은 4로 바꿔 맞게 정정한 판: 점수는 78점 그대로다.
  const fixed = correctedExam(2, { 7: 4, 11: 4 });
  await openBundle(page, 'app-test', { bridge: 2, store: storeOf([record]), remote: remoteData(1, AT_2010, [fixed]) });
  await page.getByRole('button', { name: S.start.resume }).click();
  await expectHash(page, '/anatomy');
  await expect(page.getByTestId('actual')).toHaveText('78점');
  await expect(page.getByTestId('correction-text')).toHaveText(S.correction.same(78));
  expect(S.correction.same(78)).toBe('정답이 정정됐지만 점수는 78점 그대로예요.');
  await expect(page.getByTestId('correction-note')).toHaveText(TEST_NOTE);
  await gotoHash(page, '/score');
  await expectHash(page, '/score');
  await expect(page.getByTestId('score')).toHaveText('78점');
  await expect(page.getByTestId('correction-text')).toHaveText(S.correction.same(78));
  await expectCleanText(page, '점수(정정 알림, 점수 그대로)');
  await page.getByTestId('correction-ack').click();
  await expect(page.getByTestId('correction-notice')).toHaveCount(0);
  await expect.poll(async () => (await lastRecord(page, record.id as string))?.gradedWith).toEqual({ answersRev: 2, score: 78 });
  // 정정 뒤 오답 원인: 7번은 틀린 문항이 되어 원인을 고르기 전 상태로 나오고, 11번은 빠진다.
  await gotoHash(page, '/causes');
  await expectHash(page, '/causes');
  expect(await wrongNos(page)).toEqual([7, 15, 20, 21, 27, 29]);
  for (const cause of ['slip', 'blank', 'unknown']) await expect(page.getByTestId(`cause-7-${cause}`)).toHaveAttribute('aria-checked', 'false');
  expect(await findAnswerLeaks(page, leakTargets(fixed, [7, 15, 20, 21, 27, 29]))).toEqual([]);
  // 정정 뒤 계단: 7번(수열)이 틀린 문항이 되어 계단은 지금 정답 기준으로 2개다.
  await gotoHash(page, '/steps');
  await expectHash(page, '/steps');
  await expect(page.locator('[data-testid^="step-"][data-type]')).toHaveCount(2);
  await expect(page.getByTestId('step-2')).toHaveAttribute('data-type', 't03');
  await expect(page.getByTestId('step-2').getByTestId('step-points')).toHaveText('놓친 배점 11점');
  const saves = await savedRecords(page, record.id as string);
  expect(saves.length).toBeGreaterThan(0);
  expectSameInput(saves, record.answers, record.marks);
  expectNoOtherRequests(page);
});

test('app-test: 채점 흔적(gradedWith)이 없는 옛 기록에 정답이 정정된 판이 오면 "지금 정답으로 채점했어요"를 알리고, 확인하기 전까지 기록 화면에 표시를 붙인다', async ({ page }) => {
  // 1.1에서 채점한 기록처럼 채점 흔적 칸이 없다.
  const record = sessionRecord('s-old', 'test-remote-a');
  const fixed = correctedExam(2, { 11: 4 });
  await openBundle(page, 'app-test', { bridge: 2, store: storeOf([record]), remote: remoteData(1, AT_2010, [fixed]) });
  // 정답 판이 2 이상이라 예전 점수를 알 수 없어서 조용히 채우지 않는다.
  for (const r of await savedRecords(page, record.id as string)) expect(r.gradedWith).toBeUndefined();
  await page.getByRole('link', { name: S.tabs.history, exact: true }).click();
  await expectHash(page, '/history');
  await expect(page.getByTestId('history-corrected')).toHaveText(S.history.corrected);
  await page.getByRole('button', { name: S.history.openCorrected(TITLE, `${CREATED_DATE}, 81점`), exact: true }).click();
  await expectHash(page, '/anatomy');
  await expect(page.getByTestId('correction-text')).toHaveText(S.correction.noPrevious);
  await expect(page.getByTestId('correction-note')).toHaveText(TEST_NOTE);
  await expect(page.getByTestId('actual')).toHaveText('81점');
  await gotoHash(page, '/score');
  await expectHash(page, '/score');
  await expect(page.getByTestId('correction-text')).toHaveText(S.correction.noPrevious);
  await expect(page.getByTestId('score')).toHaveText('81점');
  await expectCleanText(page, '점수(정정 알림, 옛 기록)');
  await page.getByTestId('correction-ack').click();
  await expect(page.getByTestId('correction-notice')).toHaveCount(0);
  await expect.poll(async () => (await lastRecord(page, record.id as string))?.gradedWith).toEqual({ answersRev: 2, score: 81 });
  await page.getByRole('link', { name: S.tabs.history, exact: true }).click();
  await expectHash(page, '/history');
  await expect(page.getByTestId('history-corrected')).toHaveCount(0);
  expectSameInput(await savedRecords(page, record.id as string), record.answers, record.marks);
  expectNoOtherRequests(page);
});

test('app-test: 답을 넣는 도중에 새 시험 자료가 와도 넣은 답, 커서, 키패드 잠금이 그대로이고 화면은 새 판으로 다시 그려진다', async ({ page }) => {
  const exam = loadExam('a');
  const answers = exampleAnswers(exam);
  await openBundle(page, 'app-test', { bridge: 2, remote: remoteData(1, AT_0840, [unreleasedExam()]) }, '/exams');
  await chooseExam(page, 'test-remote-a');
  // 1~4번을 넣고(커서는 5번), 2번 칸을 눌러 같은 답을 다시 넣어 2번에서 잠기게 한다.
  await enterKeypad(page, exam, answers, 1, 4);
  await expect(page.getByTestId('now-no')).toHaveText('5번');
  await page.locator('main [data-cell="2"]').click();
  await expect(page.getByTestId('now-label')).toHaveText(S.input.nowLabelFixing);
  await tapKey(page, answers[2] as number);
  await expect(page.getByTestId('pad-panel')).toHaveAttribute('data-lock', 'put');
  await expect(page.getByTestId('continue-from')).toHaveText(S.input.continueFrom(5));
  const snapshot = () =>
    page.evaluate(() => ({
      hash: window.location.hash,
      nowNo: document.querySelector('[data-testid="now-no"]')?.textContent ?? null,
      nowLabel: document.querySelector('[data-testid="now-label"]')?.textContent ?? null,
      lock: document.querySelector('[data-testid="pad-panel"]')?.getAttribute('data-lock') ?? null,
      panel: document.querySelector('[data-testid="pad-panel"]')?.textContent ?? null,
      current: document.querySelector('main [data-cell][aria-current="true"]')?.getAttribute('data-cell') ?? null,
      cells: Array.from(document.querySelectorAll('main [data-cell]'), (c) => `${c.getAttribute('data-cell')}:${c.querySelector('.cell__val')?.textContent ?? ''}`).join(' '),
      entered: document.querySelector('[data-testid="entered-count"]')?.textContent ?? null,
      lockedKeys: Array.from(document.querySelectorAll('.pad [data-key]'), (k) => `${k.getAttribute('data-key')}:${k.getAttribute('aria-disabled') ?? ''}`).join(' '),
    }));
  const before = await snapshot();
  const savesBefore = (await storeMessages(page)).length;
  const answersBefore = JSON.parse((await lastSavedJson(page))!).sessions[0].answers;
  await expect(page.locator('.top__title')).toHaveText(TITLE);
  // 껍데기가 정답이 든 새 판(제목을 바꾼 rev 2)을 알린다. 화면은 새 판으로 다시 그려지고(제목), 화면 안 상태는 그대로다.
  await sendRemote(page, remoteData(2, AT_1710, [testExam({ rev: 2, title: `${TITLE} 정답 판` })]));
  await expect(page.locator('.top__title')).toHaveText(`${TITLE} 정답 판`);
  expect(await snapshot()).toEqual(before);
  // 새 자료로 저장한 것이 없다(넣은 답은 그대로다).
  expect((await storeMessages(page)).length).toBe(savesBefore);
  expect(JSON.parse((await lastSavedJson(page))!).sessions[0].answers).toEqual(answersBefore);
  await expectCleanText(page, '답 입력(새 판을 받은 뒤, 잠김)');
  // 잠금 안내의 버튼은 그대로 쓸 수 있고, 이어서 끝까지 넣으면 정답 든 판이라 바로 채점할 수 있다.
  await page.getByTestId('continue-from').click();
  await expect(page.getByTestId('now-no')).toHaveText('5번');
  await enterKeypad(page, exam, answers, 5, 30);
  await expectHash(page, '/review');
  await page.getByRole('button', { name: S.review.go }).click();
  await page.getByTestId('grade').click();
  await expect(page.getByTestId('score')).toHaveText('78점');
  const last = (await lastSavedJson(page))!;
  expect(JSON.parse(last).sessions[0].answers).toEqual(asStored(answers));
  expectNoOtherRequests(page);
});

test('app-test: 다시 풀기 도중에 정정된 판이 와도 지금 문항은 문항 번호로 정해서, 고른 답이 다른 문항의 기록으로 들어가지 않고 목록에서 빠진 문항은 알린다(별도 검토 A1, B4)', async ({ page }) => {
  const record = sessionRecord('s-retry', 'test-remote-a', { gradedWith: { answersRev: 1, score: 78 } });
  await openBundle(page, 'app-test', { bridge: 2, store: storeOf([record]), remote: remoteData(1, AT_1710, [testExam()]) }, '/retry/t03');
  await expectHash(page, '/retry/t03');
  // 수열(t03)의 다시 풀 문항은 15번과 29번이다. 15번(5지선다)에 3을 고르고 맞춰 보기 전이다.
  await expect(page.getByTestId('retry-no')).toHaveText('15번');
  await expect(page.getByTestId('retry-progress')).toHaveText(S.retry.progress(1, 2));
  await tapKey(page, 3);
  await expect(page.getByTestId('entry').locator('.num')).toHaveText('3');
  // 7번 정답을 4로 정정한 판(학생 답 5라 7번이 틀리게 되어 목록이 7, 15, 29번이 된다). 지금 문항과 고른 답은 그대로다.
  await sendRemote(page, remoteData(2, AT_2010, [correctedExam(2, { 7: 4 })]));
  await expect(page.getByTestId('retry-progress')).toHaveText(S.retry.progress(2, 3));
  await expect(page.getByTestId('retry-no')).toHaveText('15번');
  await expect(page.getByTestId('entry').locator('.num')).toHaveText('3');
  await expect(page.getByTestId('retry-moved')).toHaveCount(0);
  // 15번 정답을 학생 답(1)으로 정정한 판: 15번이 목록에서 빠져 그 뒤의 29번으로 옮기고 알린다. 고르던 3은 쓰지 않는다.
  await sendRemote(page, remoteData(3, AT_2010, [correctedExam(3, { 7: 4, 15: 1 }, { answersRev: 3 })]));
  await expect(page.getByTestId('retry-no')).toHaveText('29번');
  await expect(page.getByTestId('retry-progress')).toHaveText(S.retry.progress(2, 2));
  await expect(page.getByTestId('retry-moved')).toHaveText(S.retry.moved(15, true));
  expect(S.retry.moved(15, true)).toBe('시험 자료가 바뀌어서 15번은 다시 풀 문항에서 빠졌어요. 넣던 답은 기록하지 않았어요.');
  await expect(page.getByTestId('entry').locator('.num')).toHaveText('');
  await expectCleanText(page, '다시 풀기(정정으로 빠진 문항)');
  // 29번(단답형)에 257을 넣고 맞춰 보면 29번의 기록만 남는다. 15번과 7번에는 다시 풀기 기록이 없다.
  for (const d of [2, 5, 7]) await tapKey(page, d);
  await tapKey(page, 'go');
  await expect(page.getByTestId('retry-result')).toHaveAttribute('data-correct', 'true');
  await expect(page.getByTestId('retry-moved')).toHaveCount(0);
  const last = (await lastRecord(page, 's-retry'))!;
  expect(Object.keys(last.retries)).toEqual(['29']);
  expect(last.retries['29']).toMatchObject({ correct: true, answersRev: 3 });
  expectSameInput(await savedRecords(page, 's-retry'), record.answers, record.marks);
  expectNoOtherRequests(page);
});

test('app-test: 학생이 누르지 않았는데 넘겨받은 새 자료로 목록 자리가 옮겨 가면 0.5초 동안 화면 전체의 누름을 받지 않아, 옮겨 가기 전 자리를 누른 것이 다른 시험이나 다른 문항의 원인으로 들어가지 않는다(별도 검토 A3)', async ({
  page,
  context,
}) => {
  const center = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  // 시험 선택: 예시 시험 B의 자리를 적어 두고, 시행일 없는 새 시험이 맨 위에 더해진 자료가 오자마자 그 자리를 누른다.
  await openBundle(page, 'app-test', { bridge: 2, remote: remoteData(1, AT_1710, []) }, '/exams');
  expect(await examIds(page)).toEqual(['sample-a', 'sample-b', 'sample-c']);
  const spot = center((await page.getByTestId('exam-sample-b').boundingBox())!);
  await sendRemote(page, remoteData(2, AT_2010, [testExam()]));
  await expect(page.locator('.tap-shield[data-area="screen"]')).toHaveCount(1);
  expect(await examIds(page)).toEqual(['test-remote-a', 'sample-a', 'sample-b', 'sample-c']);
  await page.mouse.click(spot.x, spot.y);
  // 그 자리에는 예시 시험 A가 와 있다. 그 누름은 받지 않아서 아무 시험도 고르지 않았다.
  await expect(page.locator('main [role="radio"][aria-checked="true"]')).toHaveCount(0);
  // 0.5초가 지나면 그 자리를 다시 누를 수 있다(그때 보이는 예시 시험 A가 골라진다).
  await expect(page.locator('.tap-shield')).toHaveCount(0);
  await page.mouse.click(spot.x, spot.y);
  await expect(page.getByTestId('exam-sample-a')).toHaveAttribute('aria-checked', 'true');

  // 오답 원인: 20번 카드의 "풀 줄 아는데 틀렸어요" 자리를 적어 두고, 15번이 맞게 정정된 판이 와서 아래 카드가 올라오자마자 그 자리를 누른다.
  const record = sessionRecord('s-causes', 'test-remote-a', { gradedWith: { answersRev: 1, score: 78 }, causes: {} });
  const again = await context.newPage();
  const errors = errorsOf(again);
  await openBundle(again, 'app-test', { bridge: 2, store: storeOf([record]), remote: remoteData(1, AT_1710, [testExam()]) }, '/causes');
  await expectHash(again, '/causes');
  expect(await wrongNos(again)).toEqual([11, 15, 20, 21, 27, 29]);
  await again.getByTestId('wrong-20').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const slip20 = center((await again.getByTestId('cause-20-slip').boundingBox())!);
  await sendRemote(again, remoteData(2, AT_2010, [correctedExam(2, { 15: 1 })]));
  await expect(again.locator('.tap-shield[data-area="screen"]')).toHaveCount(1);
  expect(await wrongNos(again)).toEqual([11, 20, 21, 27, 29]);
  await again.mouse.click(slip20.x, slip20.y);
  // 받지 않아서 어느 문항의 원인도 고르지 않았고, 원인을 저장하지 않았다.
  await expect(again.locator('[data-testid^="cause-"][aria-checked="true"]')).toHaveCount(0);
  for (const r of await savedRecords(again, 's-causes')) expect(r.causes).toEqual({});
  // 0.5초가 지나면 원인을 고를 수 있다.
  await expect(again.locator('.tap-shield')).toHaveCount(0);
  await again.getByTestId('cause-20-slip').click();
  await expect.poll(async () => (await lastRecord(again, 's-causes'))?.causes).toEqual({ 20: 'slip' });
  expect(errors, '다시 연 앱의 콘솔 오류').toEqual([]);
  expectNoOtherRequests(page, again);
  await again.close();
});

test('app-test: "새로 확인"을 누르면 saRemote 로 { op: "refresh" } 를 보내고 응답이 올 때까지 버튼을 쓸 수 없으며, 결과 셋(같은 seq, remoteFailed, 새 자료)을 보여 준다', async ({ page }) => {
  const first = remoteData(1, AT_1710, []);
  const next = remoteData(2, AT_2010, [testExam()]);
  await openBundle(page, 'app-test', { bridge: 2, remote: first, remoteMode: 'silent' }, '/exams');
  const notice = page.getByTestId('remote-notice');
  const refresh = page.getByTestId('remote-refresh');
  const result = page.getByTestId('remote-result');
  const live = page.getByTestId('remote-live');
  // 안내는 본문 끝(시험 목록 아래)에 있다.
  await expect(notice).toContainText(S_APP.remoteSource);
  await expect(page.getByTestId('remote-issued')).toHaveText(issuedText(17, 10));
  expect(issuedText(17, 10)).toBe('받은 자료 기준: 2030년 1월 2일 오후 5시 10분');
  await expect(refresh).toHaveText(S_APP.remoteRefresh);
  expect(await page.evaluate(() => document.querySelector('main.body')?.lastElementChild?.getAttribute('data-testid'))).toBe('remote-notice');
  expect(await examIds(page)).toEqual(['sample-a', 'sample-b', 'sample-c']);
  await expect(live).toHaveText('');
  await expectCleanText(page, '시험 선택(받은 자료 안내)');

  // 누르면 새로 확인을 하나 보내고 응답이 올 때까지 버튼을 쓸 수 없다. 그동안 눌러도 또 보내지 않는다.
  await refresh.click();
  await expect(refresh).toHaveAttribute('aria-disabled', 'true');
  await expect(refresh).toBeDisabled();
  expect(await remoteRequests(page)).toEqual([{ op: 'refresh' }]);
  await clickCenter(page, refresh);
  await page.waitForTimeout(200);
  expect(await remoteRequests(page)).toEqual([{ op: 'refresh' }]);
  await expect(result).toHaveCount(0);
  await expectCleanText(page, '시험 선택(새로 확인 기다리는 중)');
  // 껍데기가 같은 seq 의 자료로 답한다.
  await sendRemote(page, first);
  await expect(result).toHaveText(S_APP.remoteResult.same);
  await expect(live).toHaveText(S_APP.remoteResult.same);
  await expect(refresh).toBeEnabled();
  await expectCleanText(page, '시험 선택(이미 가장 새 자료)');
  // remoteFailed.
  await setRemoteMode(page, 'failed');
  await refresh.click();
  await expect(result).toHaveText(S_APP.remoteResult.failed);
  await expect(live).toHaveText(S_APP.remoteResult.failed);
  await expectCleanText(page, '시험 선택(받지 못함)');
  expect(await examIds(page)).toEqual(['sample-a', 'sample-b', 'sample-c']);
  // 더 새로운 자료: 시험 목록과 받은 자료 기준이 바뀐다.
  await setRemoteNext(page, next);
  await setRemoteMode(page, 'new');
  await refresh.click();
  await expect(result).toHaveText(S_APP.remoteResult.new);
  await expect(live).toHaveText(S_APP.remoteResult.new);
  await expect(page.getByTestId('remote-issued')).toHaveText(issuedText(20, 10));
  expect(await examIds(page)).toEqual(['test-remote-a', 'sample-a', 'sample-b', 'sample-c']);
  await expectCleanText(page, '시험 선택(새로 받음)');
  // 껍데기가 가진 자료가 그대로면(seq 2) 이미 가장 새 자료다.
  await setRemoteMode(page, 'same');
  await refresh.click();
  await expect(result).toHaveText(S_APP.remoteResult.same);
  expect(await remoteRequests(page)).toEqual([{ op: 'refresh' }, { op: 'refresh' }, { op: 'refresh' }, { op: 'refresh' }]);
  // 화면을 떠났다 오면 결과 문구가 없다.
  await gotoHash(page, '/');
  await expectHash(page, '/');
  await gotoHash(page, '/exams');
  await expectHash(page, '/exams');
  await expect(notice).toBeVisible();
  await expect(result).toHaveCount(0);
  await expect(live).toHaveText('');
  // 기다리는 새로 확인이 없을 때 온 remoteFailed 는 가진 자료를 그대로 쓰고, 결과 문구도 없다.
  await sendRemoteFailed(page);
  await page.waitForTimeout(200);
  await expect(result).toHaveCount(0);
  await expect(page.getByTestId('remote-issued')).toHaveText(issuedText(20, 10));
  expect(await examIds(page)).toEqual(['test-remote-a', 'sample-a', 'sample-b', 'sample-c']);
  expectNoOtherRequests(page);
});

test('app-test: "새로 확인"에 10초 동안 응답이 없으면 받지 못한 것으로 알리고, 그 뒤에 늦게 온 새 자료는 목록에 받는다', async ({ page }) => {
  // 시계를 바꿔 끼워 10초를 기다리지 않고 넘긴다. 누른 직후에 시간을 멈추고 건너뛰어서, 실제로 흐른 시간에 결과가 기대지 않는다.
  await page.clock.install();
  await openBundle(page, 'app-test', { bridge: 2, remote: remoteData(1, AT_1710, []), remoteMode: 'silent' }, '/exams');
  const refresh = page.getByTestId('remote-refresh');
  const result = page.getByTestId('remote-result');
  await refresh.click();
  await expect(refresh).toHaveAttribute('aria-disabled', 'true');
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
  await page.clock.fastForward(9_000);
  await expect(refresh).toHaveAttribute('aria-disabled', 'true');
  await expect(result).toHaveCount(0);
  await page.clock.fastForward(1_000);
  await expect(result).toHaveText(S_APP.remoteResult.failed);
  await expect(page.getByTestId('remote-live')).toHaveText(S_APP.remoteResult.failed);
  await expect(refresh).toBeEnabled();
  await page.clock.resume();
  expect(await remoteRequests(page)).toEqual([{ op: 'refresh' }]);
  await expectCleanText(page, '시험 선택(응답 없음)');
  // 늦게 온 자료도 seq 규칙대로 받는다. 받지 못했다는 결과 문구는 새 자료에 맞지 않아 지운다.
  await sendRemote(page, remoteData(2, AT_2010, [testExam()]));
  await expect(page.getByTestId('remote-issued')).toHaveText(issuedText(20, 10));
  await expect(result).toHaveCount(0);
  expect(await examIds(page)).toEqual(['test-remote-a', 'sample-a', 'sample-b', 'sample-c']);
  expectNoOtherRequests(page);
});

test('app-test: 넘겨받은 시험 가운데 검사를 통과하지 못한 시험만 목록에 없고 나머지는 있다(버린 이유는 콘솔 경고로 남는다)', async ({ page }) => {
  const warnings = warningsOf(page);
  const bad = testExam({ id: 'test-remote-c', title: '테스트 전용 시험 C', answersRev: 2 });
  const other = testExam({ id: 'test-remote-b', title: '테스트 전용 시험 B' });
  await openBundle(page, 'app-test', { bridge: 2, remote: remoteData(1, AT_1710, [testExam(), bad, other]) }, '/exams');
  expect(await examIds(page)).toEqual(['test-remote-a', 'test-remote-b', 'sample-a', 'sample-b', 'sample-c']);
  await expect(page.getByTestId('exam-test-remote-c')).toHaveCount(0);
  await expectCleanText(page, '시험 선택(버린 시험이 있음)');
  // 버린 시험의 순서, id 와 이유가 경고로 남는다(정정 안내 없이 answersRev 가 2).
  await expect.poll(() => warnings.length).toBe(1);
  expect(warnings[0]!.text).toContain('넘겨받은 2번째 시험(id: test-remote-c)을 쓰지 않았어요.');
  expect(await warnings[0]!.args).toEqual(['넘겨받은 2번째 시험(id: test-remote-c)을 쓰지 않았어요.', ['answersRev가 2 이상이면 answersNote에 정정 안내를 적어야 해요.']]);
  // 겉모양이 틀린 자료(seq 가 음수)는 통째로 쓰지 않고 목록과 받은 자료 기준은 그대로다.
  await sendRemote(page, { seq: -1, issuedAt: AT_2010, exams: [], locks: [] });
  await expect.poll(() => warnings.length).toBe(2);
  expect(warnings[1]!.text).toContain('넘겨받은 시험 자료를 쓰지 않았어요.');
  expect(await examIds(page)).toEqual(['test-remote-a', 'test-remote-b', 'sample-a', 'sample-b', 'sample-c']);
  await expect(page.getByTestId('remote-issued')).toHaveText(issuedText(17, 10));
  expectNoOtherRequests(page);
});

for (const bundle of BUNDLES) {
  test(`${bundle}: 규격 1 껍데기(bridge 1)는 remote 칸이 있어도 넘겨받은 시험을 쓰지 않고 받은 자료 안내와 "새로 확인"이 없으며, 검산 예시가 그대로 나온다`, async ({ page }) => {
    const exam = loadExam('a');
    // 예시 시험 A와 같은 id 의 테스트 전용 판(rev 2, 1번 정답을 바꿈). 웹이 넘겨받았다면 묶음 안 예시 시험 A를 대신해 검산 예시가 달라진다.
    const override: Exam = { ...exam, rev: 2, title: TITLE, items: exam.items.map((it) => (it.no === 1 ? { ...it, answer: 4 } : it)) };
    const remote = remoteData(1, AT_1710, [testExam(), override]);
    await openBundle(page, bundle, { bridge: 1, remote });
    await expect(page.getByText(S_APP.privacy)).toBeVisible();
    await page.getByRole('button', { name: '시험 고르기' }).click();
    await expectHash(page, '/exams');
    expect(await examIds(page)).toEqual(['sample-a', 'sample-b', 'sample-c']);
    await expect(page.getByTestId('exam-sample-a').locator('.opt__main > span').first()).toHaveText(exam.title);
    await expect(page.getByTestId('remote-notice')).toHaveCount(0);
    await expect(page.getByText(S_APP.remoteSource)).toHaveCount(0);
    await expect(page.getByText(S_APP.remoteRefresh, { exact: true })).toHaveCount(0);
    // 껍데기가 remote 알림을 보내도(규격 1 껍데기는 보내지 않는다) 받지 않는다.
    await sendRemote(page, remoteData(2, AT_2010, [testExam(), override]));
    await page.waitForTimeout(200);
    expect(await examIds(page)).toEqual(['sample-a', 'sample-b', 'sample-c']);
    await expect(page.getByTestId('remote-notice')).toHaveCount(0);
    await expectCleanText(page, '시험 선택(규격 1)');
    await chooseExam(page, 'sample-a');
    await enterKeypad(page, exam, exampleAnswers(exam));
    await expectHash(page, '/review');
    await page.getByRole('button', { name: S.review.go }).click();
    await setMarks(page, exampleMarks());
    await page.getByTestId('grade').click();
    await expect(page.getByTestId('score')).toHaveText('78점');
    await page.getByRole('button', { name: S.score.toCauses }).click();
    await chooseCauses(page, exampleCauses());
    await page.getByRole('button', { name: S.causes.go }).click();
    await expect(page.getByTestId('actual')).toHaveText('78점');
    await expect(page.getByTestId('row-guess').locator('.num')).toHaveText('7점');
    await expect(page.getByTestId('row-slip').locator('.num')).toHaveText('8점');
    await page.getByTestId('grade-2').click();
    await expect(page.getByTestId('cut-actual')).toHaveText('실제 78점 기준 3~7점 남았어요');
    await expect(page.getByTestId('cut-luck')).toContainText('약 75점');
    await expect(page.getByTestId('cut-luck')).toContainText('6~10점');
    await page.getByTestId('to-steps').click();
    await expect(page.locator('[data-testid^="step-"][data-type]')).toHaveCount(3);
    await expectCleanText(page, '계단(규격 1)');
    // 웹은 규격 1의 다리(saStore, saHaptic, saCopy)만 썼다. 규격 1 껍데기에는 saRemote 를 받는 곳이 없다.
    const names = [...new Set((await bridgeLog(page)).map(([n]) => n))];
    expect(names).toContain('saStore');
    expect(names.filter((n) => !['saStore', 'saHaptic', 'saCopy'].includes(n))).toEqual([]);
    expectNoOtherRequests(page);
  });
}

test('app-test: 넘겨받은 시험의 기록을 그 자료 없이 다시 열면 "시험 자료를 받으면 다시 볼 수 있어요."를 보여 주고 기록을 지우지 않으며, 자료가 오면 그 기록을 다시 볼 수 있다', async ({ page, context }) => {
  const exam = loadExam('a');
  const answers = exampleAnswers(exam);
  const remote = remoteData(1, AT_0840, [unreleasedExam()]);
  await openBundle(page, 'app-test', { bridge: 2, remote }, '/exams');
  await chooseExam(page, 'test-remote-a');
  await enterKeypad(page, exam, answers, 1, 3);
  await expect(page.getByTestId('entered-count')).toHaveText(S.input.entered(3));
  const json = (await lastSavedJson(page))!;
  const record = (JSON.parse(json) as { sessions: SavedRecord[] }).sessions[0]!;
  expect(Object.keys(record.answers)).toHaveLength(3);
  // 시험을 고를 때 그 시험의 제목을 기록에 적어 둔다(별도 검토 D2).
  expect(record.examTitle).toBe(TITLE);

  // 껍데기가 넘겨받은 자료를 아직 넣지 못한 채(remote 칸 없음) 기록만 넣어 다시 연다.
  const again = await context.newPage();
  const errors = errorsOf(again);
  await openBundle(again, 'app-test', { bridge: 2, store: json });
  // 이어서 볼 기록이 없다(시험을 찾은 기록만 고른다). 기록 화면에는 그 기록 자리에 안내가 있고 지우기는 그대로다.
  await expect(again.getByRole('button', { name: S.start.resume })).toHaveCount(0);
  await again.getByRole('link', { name: S.tabs.history, exact: true }).click();
  await expectHash(again, '/history');
  await expect(again.getByTestId('history-missing')).toHaveText(S.missingExam.body);
  expect(S.missingExam.body).toBe('시험 자료를 받으면 다시 볼 수 있어요.');
  // 이름 자리에는 시험 id 대신 기록에 적어 둔 시험 제목을 쓴다(별도 검토 D2).
  await expect(again.getByTestId('history-missing-item')).toContainText(TITLE);
  await expect(again.getByTestId('history-missing-item')).not.toContainText('test-remote-a');
  await expect(again.getByRole('button', { name: /기록 열기/ })).toHaveCount(0);
  await expect(again.getByTestId('history-remove')).toHaveAttribute('aria-label', new RegExp(`^${TITLE} 기록 지우기, `));
  await expectCleanText(again, '기록(시험을 찾지 못한 기록)');
  // 그 기록을 이어 여는 주소: 처음 화면으로 보내지 않고 안내와 돌아갈 길이 있는 작은 화면을 보여 준다.
  await gotoHash(again, '/input');
  await expectHash(again, '/input');
  await expect(again.getByTestId('exam-missing')).toHaveText(S.missingExam.body);
  await expect(again.getByTestId('exam-missing-back')).toHaveText(S.missingExam.back);
  await expectCleanText(again, '시험을 찾지 못한 기록의 작은 화면');
  // 이 동안 기록을 지우거나 바꾸는 저장이 가지 않았다.
  expect(await storeMessages(again)).toEqual([]);
  // 껍데기가 그 자료를 넘겨주면 같은 주소가 그 기록의 답 입력 화면으로 다시 그려지고 넣은 답이 그대로다.
  await sendRemote(again, remote);
  await expect(again.getByTestId('now-no')).toHaveText('4번');
  await expect(again.getByTestId('entered-count')).toHaveText(S.input.entered(3));
  for (const r of await savedRecords(again, record.id)) expect(r.answers).toEqual(record.answers);
  expect(errors, '다시 연 앱의 콘솔 오류').toEqual([]);
  expectNoOtherRequests(page, again);
  await again.close();
});

test('app-test: 진행자용 화면의 풀이 잠금 한 줄은 넘겨받은 잠금 항목을 합친 달력으로 판정한다(지금 잠김, 끝나는 시각부터 열림)', async ({ page }) => {
  const lock = TEST_LOCK;
  // 시계를 한국 시간 2030년 1월 2일 오전 8시 40분(형식 예시)으로 고정한다. 판정은 기기 시간대를 쓰지 않는다.
  await page.clock.setFixedTime(new Date('2030-01-02T08:40:00+09:00'));
  await openBundle(page, 'app-test', { bridge: 2, remote: remoteData(1, AT_0840, []) }, '/test');
  await expect(page.getByTestId('lock-status')).toHaveText(S_TEST.lockOpen);
  // 켜져 있는 동안 잠금 항목이 든 자료가 오면 바로 다시 판정한다.
  await sendRemote(page, remoteData(2, AT_0840, [], [lock]));
  await expect(page.getByTestId('lock-status')).toHaveText(S_TEST.lockClosed(17, 45));
  expect(S_TEST.lockClosed(17, 45)).toBe('풀이 잠금: 지금 잠김(오후 5시 45분까지)');
  await expectCleanText(page, '진행자용 화면(풀이 잠금 잠김)');
  // 끝나는 시각(오후 5시 45분)부터는 열림이다(구간은 시작 이상 끝 미만). 화면을 다시 열면 그때 시각으로 판정한다.
  await page.clock.setFixedTime(new Date('2030-01-02T17:45:00+09:00'));
  await gotoHash(page, '/');
  await expectHash(page, '/');
  await gotoHash(page, '/test');
  await expectHash(page, '/test');
  await expect(page.getByTestId('lock-status')).toHaveText(S_TEST.lockOpen);
  expectNoOtherRequests(page);
});

test('app-test: 복수 정답과 모두 정답 처리 시험: "정답 보기" 전에는 인정하는 답이 화면에 없고, 누른 뒤에는 인정하는 답을 모두 적고 함께 인정한다고 알리며, 모두 정답 처리 문항은 따로 알린다', async ({ page }) => {
  // 11번(5지선다, 학생 답 4)은 2와 1, 29번(단답형, 학생 답 275)은 257과 258을 인정한다. 둘 다 학생 답은 여전히 틀린다.
  // 20번(학생 답 3, 찍음 표시)은 모두 정답 처리라 맞은 것으로 채점한다(78점에 4점을 더해 82점).
  const multi = testExam({ rev: 2, items: itemsWith({ 11: { altAnswers: [1] }, 29: { altAnswers: [258] }, 20: { allCorrect: true } }) });
  const record = sessionRecord('s-multi', 'test-remote-a', { gradedAt: null, firstGradedAt: null, causes: {} });
  await openBundle(page, 'app-test', { bridge: 2, store: storeOf([record]), remote: remoteData(1, AT_1710, [multi]) });
  await page.getByRole('button', { name: S.start.resume }).click();
  await expectHash(page, '/review');
  await page.getByRole('button', { name: S.review.go }).click();
  await page.getByTestId('grade').click();
  await expect(page.getByTestId('score')).toHaveText('82점');
  await page.getByRole('button', { name: S.score.toCauses }).click();
  await expectHash(page, '/causes');
  expect(await wrongNos(page)).toEqual([11, 15, 21, 27, 29]);
  const allCorrect = page.getByTestId('all-correct-20');
  await expect(allCorrect).toContainText(S.causes.allCorrect);
  await expect(allCorrect.locator('.badge')).toHaveText(S.common.points(4));
  const targets = leakTargets(multi, [11, 15, 21, 27, 29]);
  expect(targets.find((t) => t.no === 29)).toEqual({ no: 29, answer: 257, altAnswers: [258], distinctive: true });
  expect(await findAnswerLeaks(page, targets)).toEqual([]);
  await expectCleanText(page, '오답 원인(복수 정답, 정답 보기 전)');
  await page.getByTestId('show-answer-11').click();
  await expect(page.getByTestId('answer-11')).toContainText(S.causes.answer([2, 1]));
  await expect(page.getByTestId('answer-11')).toContainText(S.causes.acceptedAll(2));
  expect(S.causes.acceptedAll(2)).toBe('둘 다 정답으로 인정해요.');
  await page.getByTestId('show-answer-29').click();
  await expect(page.getByTestId('answer-29')).toContainText('정답 257, 258');
  await expect(page.getByTestId('answer-29')).toContainText(S.causes.acceptedAll(2));
  // 연 문항 말고는 여전히 정답이 드러나지 않는다.
  expect(await findAnswerLeaks(page, targets, [11, 29])).toEqual([]);
  await expectCleanText(page, '오답 원인(복수 정답, 정답 보기 뒤)');
  // 모두 정답 처리 문항은 찍음 표시가 있어도 찍었다고 표시한 정답에 넣지 않는다(9번 3점과 14번 4점만).
  await page.getByRole('button', { name: S.causes.go }).click();
  await expect(page.getByTestId('actual')).toHaveText('82점');
  await expect(page.getByTestId('row-guess').locator('.num')).toHaveText('7점');
  expectSameInput(await savedRecords(page, record.id as string), record.answers, record.marks);
  expectNoOtherRequests(page);
});
