// 화면 문구는 모두 이 파일에 모은다.
// 작업 지시서 8장과 9장에 적힌 문구는 그대로 쓴다.
// 해요체, 한 문장에 한 가지, 사실과 다음 할 일만 말한다. 느낌표와 이모지는 쓰지 않는다.
//
// 문구는 이 파일 하나에 두되, 내보내는 묶음을 나눈다.
// - S: 모든 빌드가 쓰는 문구.
// - S_ROWS: 5행 방식 답 입력 화면에서만 쓰는 문구.
// - S_TEST: 테스트 진행자용 화면에서만 쓰는 문구.
// - S_TOOLS: 진행자용 화면으로 가는 링크, 기록 화면의 "준비 중인 기능" 목록, 테스트 기기 안내.
// - S_APP: 아이폰 앱 안에서만 쓰거나 바꿔 쓰는 문구. 화면은 platform.appText 로 읽는다.
// 앱 배포용 묶음은 S_ROWS, S_TEST, S_TOOLS 를 쓰는 화면을 싣지 않으므로 그 글자가 묶음에서 빠진다(src/tools).

import type { Cause, GradedBefore, InputMode, ItemKind, SeenBefore, TimeFeel } from './types';

/** 문항 번호 나열. 둘이면 "15번과 29번", 셋 이상이면 쉼표로 나열한다. */
export function listNos(nos: number[]): string {
  const parts = nos.map((n) => `${n}번`);
  if (parts.length === 2) return `${parts[0]}과 ${parts[1]}`;
  return parts.join(', ');
}

/** 점수 범위. 두 값이 같으면 한 숫자로 쓴다. */
export function rangePoints(from: number, to: number): string {
  return from === to ? `${from}점` : `${from}~${to}점`;
}

/** 여러 문항을 한꺼번에 가리킬 때 붙이는 말. 하나면 붙이지 않는다. */
function allOf(count: number): string {
  if (count === 2) return '둘 다 ';
  if (count >= 3) return '모두 ';
  return '';
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/** 시와 분(24시 기준). 같은 날 같은 점수의 기록을 구분할 때만 쓴다. withSeconds 가 true면 초까지 적는다. */
export function formatTime(iso: string, withSeconds = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const base = `${d.getHours()}시 ${d.getMinutes()}분`;
  return withSeconds ? `${base} ${d.getSeconds()}초` : base;
}

/** 날짜("2030년 1월 2일"). 연, 월, 일은 날짜 문자열을 잘라 얻은 값이다(src/logic/dates.ts). 기기의 시간대를 쓰지 않는다. */
export function dateText(y: number, m: number, d: number): string {
  return `${y}년 ${m}월 ${d}일`;
}

/**
 * 한국 시간의 시각("오후 8시 10분"). 시와 분은 시각 문자열을 잘라 얻은 값이다(src/logic/dates.ts).
 * 오전과 오후로 나눠 적고, 분이 0이면 분을 빼고 "오후 8시"로 적는다. 0시는 "오전 0시", 12시는 "오후 12시"다.
 */
export function clockText(h: number, mi: number): string {
  const hour = `${h < 12 ? '오전' : '오후'} ${h > 12 ? h - 12 : h}시`;
  return mi === 0 ? hour : `${hour} ${mi}분`;
}

export const S = {
  appName: '점수 해부',

  common: {
    back: '뒤로',
    close: '닫기',
    sample: '예시',
    estimate: '추정',
    confirmed: '확정',
    unreleased: '정답 공개 전',
    skip: '안 풂',
    erase: '지우기',
    next: '다음',
    put: '넣기',
    points: (n: number) => `${n}점`,
    itemNo: (n: number) => `${n}번`,
    correctOf: (total: number, correct: number) => `${total}문항 가운데 ${correct}문항을 맞혔어요.`,
    afterGradingNote: '채점한 뒤에 표시한 기록이에요',
    gradeFailed: '채점하지 못했어요. 답은 그대로 있어요.',
    shortRange: '답은 0부터 999까지예요.',
    emptyItem: (no: number) => `${no}번이 비어 있어요. 안 푼 문항이면 '안 풂'을 눌러 주세요.`,
    editedAfterGrading: (nos: number[]) => `채점한 뒤에 답을 고친 문항: ${listNos(nos)}`,
    crashTitle: '화면을 그리지 못했어요.',
    crashBody: '넣은 기록은 그대로 있어요. 처음 화면으로 돌아가 주세요.',
    crashBack: '처음 화면으로',
    // 연달아 누르기 보호가 누름을 버렸을 때(src/tapNotice.ts).
    tapDiscarded: '화면이 막 바뀌어서 방금 누른 것은 받지 않았어요.',
  },

  tabs: {
    label: '화면 이동',
    current: '이번 시험',
    history: '기록',
  },

  start: {
    lead: '모의고사 답을 넣으면 점수를 나눠 보고 먼저 고칠 것을 알려 드려요.',
    previewTitle: '결과 미리보기',
    previewSteps: (names: string[]) => `먼저 고칠 것: ${names.join(', ')}`,
    privacy: '가입 없이 써요. 기록은 이 기기에만 남아요.',
    pick: '시험 고르기',
    sampleResult: '예시 결과 보기',
    resume: '이어서 보기',
  },

  exams: {
    title: '어떤 시험을 넣을까요?',
    /** 시험 시행일. 날짜 문자열을 연, 월, 일로 잘라 쓴다(src/logic/dates.ts). */
    held: (y: number, m: number, d: number) => `${dateText(y, m, d)} 시행`,
    gradedQ: '채점은 아직인가요?',
    gradedOptions: { not_yet: '아직 안 했어요', already: '이미 했어요' } as Record<GradedBefore, string>,
    seenQ: '이 시험지, 전에 풀어 본 적 있나요?',
    seenOptions: { first: '처음이에요', partial: '일부 봤어요', solved: '풀어 봤어요' } as Record<SeenBefore, string>,
    go: '답 넣기',
    needExam: '시험을 먼저 골라 주세요.',
    needGraded: '채점을 했는지 골라 주세요.',
    needSeen: '전에 풀어 본 적이 있는지 골라 주세요.',
  },

  input: {
    showAll: '전체 보기',
    section: (kind: ItemKind, from: number, to: number) =>
      `${kind === 'mc' ? '객관식' : '단답형'} ${from === to ? `${from}번` : `${from}~${to}번`}`,
    entered: (n: number) => `${n}문항 입력`,
    progressLabel: '입력한 문항 수',
    nowLabel: '지금 넣을 문항',
    // 잠긴 동안에는 넣을 문항이 아니므로 큰 번호 위의 이름을 바꾼다(src/logic/keypad.ts 의 nowLabelOf).
    nowLabelFixing: '고치는 문항',
    nowLabelPut: '방금 넣은 문항',
    nowLabelNoBlank: '마지막 문항',
    entryLabel: '넣은 답',
    hint: '다섯 문항마다 시험지와 맞춰 보세요. 칸을 누르면 그 문항으로 가요.',
    erased: (no: number) => `${no}번 답을 지웠어요.`,
    nothingToErase: '지울 답이 없어요.',
    notCommitted: (no: number) => `${no}번에 누른 숫자는 '다음'을 누르지 않아서 들어가지 않았어요.`,
    // 키패드 잠금과 고치기(src/logic/keypad.ts).
    locked: (no: number) => `${no}번에 답을 넣었어요. 다음에 할 일을 골라 주세요.`,
    noBlank: '빈칸이 없어요. 고칠 문항을 눌러 주세요.',
    fixing: (no: number) => `${no}번을 고치는 중이에요.`,
    fixNext: (no: number) => `${no}번도 고치기`,
    continueFrom: (no: number) => `${no}번부터 이어서 넣기`,
    nextActionsLabel: '다음에 할 일',
    prevGroupLabel: '직전 묶음',
    currentGroupLabel: '현재 묶음',
    keypadLabel: '답 키패드',
    cellFilled: (no: number, answer: string) => `${no}번 칸, 넣은 답 ${answer}`,
    cellEmpty: (no: number) => `${no}번 칸, 비어 있음`,
  },

  review: {
    title: '넣은 답을 확인해 주세요',
    hint: '시험지와 5개씩 맞춰 보세요.',
    missing: '미입력',
    gridLabel: '넣은 답 목록',
    cellFilled: (no: number, answer: string) => `${no}번, 넣은 답 ${answer}, 눌러서 고치기`,
    cellMissing: (no: number) => `${no}번, 미입력, 눌러서 넣기`,
    sheetTitle: (no: number) => `${no}번 답 고치기`,
    currentAnswer: '지금 답',
    go: '맞아요, 다음으로',
  },

  marks: {
    title: '풀이 없이 고른 문항이 있나요?',
    body: '있으면 눌러 주세요. 점수는 그대로예요.',
    help: '시험지에 세모나 물음표를 쳐 둔 문항을 보면 쉬워요.',
    gridLabel: '5지선다 문항 표시',
    doubt: '고민',
    guess: '찍음',
    none: '표시 없음',
    legend: '한 번 누르면 고민, 두 번 누르면 찍음, 세 번 누르면 지워져요.',
    cell: (no: number, answer: string, mark: string) => `${no}번, 넣은 답 ${answer}, ${mark}`,
    cellSkipped: (no: number) => `${no}번, 안 풂`,
    shortTitle: '단답형',
    shortHint: '자신 없는 문항이 있으면 눌러 주세요.',
    unsure: '자신 없음',
    shortCell: (no: number, on: boolean) => `${no}번, ${on ? '자신 없음' : '표시 없음'}`,
    timeQ: '시간은 어땠나요?',
    timeOptions: { enough: '충분했어요', tight: '빠듯했어요', missed: '몇 문제는 못 봤어요' } as Record<TimeFeel, string>,
    grade: '채점하기',
    // 표시가 하나도 없을 때의 채점 버튼. 표시를 붙이면 같은 자리의 같은 버튼이 "채점하기"가 된다.
    gradeNone: '없어요, 채점하기',
    save: '답 저장하기',
    unreleasedNotice: '정답이 아직 공개되지 않았어요. 답은 저장해 뒀어요. 공개되면 여기서 바로 채점돼요.',
    toHistory: '기록 보기',
  },

  score: {
    top: '점수',
    toCauses: '틀린 문항 살펴보기',
    toAnatomy: '점수 해부 바로 보기',
    fix: '입력 고치기',
  },

  // 정답 정정 알림(작업 지시서 3의 4-6). 점수 화면과 점수 해부 화면 위쪽에 두고, 다음 줄에 시험 파일의 정정 안내(answersNote)를 그대로 붙인다.
  // 사실만 적는다. 점수는 지금 정답으로 다시 계산한 값이다.
  correction: {
    changed: (from: number, to: number) => `정답이 정정돼서 다시 채점했어요. ${from}점에서 ${to}점으로 바뀌었어요.`,
    same: (score: number) => `정답이 정정됐지만 점수는 ${score}점 그대로예요.`,
    // 채점 흔적이 없는 옛 기록이라 예전 점수를 알 수 없을 때.
    noPrevious: '정답이 정정돼서 지금 정답으로 채점했어요.',
    // 정답 판 번호는 오르지 않았는데 지금 시험 자료로 계산한 점수가 채점한 때와 다를 때(같은 판 번호에 다른 정답이 든 판, 예전 판).
    // 정정 안내(answersNote)는 이 바뀜의 까닭이 아닐 수 있어서 다음 줄에 붙이지 않는다.
    differs: (from: number, to: number) => `채점한 때와 다른 시험 자료로 다시 채점했어요. ${from}점에서 ${to}점으로 바뀌었어요.`,
    ack: '확인했어요',
  },

  causes: {
    top: '오답 원인',
    title: '틀린 문항을 살펴봐요',
    body: '문항마다 가까운 것을 하나 골라 주세요. 고르지 않고 넘어가도 돼요.',
    listLabel: '틀린 문항 목록',
    wrongTag: '틀림',
    mine: (answer: string) => `내 답 ${answer}`,
    groupLabel: (no: number) => `${no}번을 틀린 원인`,
    options: { slip: '풀 줄 아는데 틀렸어요', blank: '풀이가 안 떠올랐어요', unknown: '잘 모르겠어요' } as Record<Cause, string>,
    showAnswer: '정답 보기',
    showAnswerOf: (no: number) => `${no}번 정답 보기`,
    /** 정답. 복수 정답이면 인정하는 답을 모두 쉼표로 적는다(작업 지시서 3의 4-2). */
    answer: (answers: readonly number[]) => `정답 ${answers.join(', ')}`,
    /** 복수 정답일 때 정답 아래에 붙인다. 둘이면 "둘 다", 셋 이상이면 "모두". */
    acceptedAll: (count: number) => `${allOf(count)}정답으로 인정해요.`,
    viewed: '정답 확인함',
    // 정답 보기를 누른 뒤 새 판이 와서 그 문항의 정답이 바뀌었을 때(별도 검토 A5). 아래에 "정답 보기" 버튼을 다시 둔다.
    // 정정이 아닌 바뀜(예전 판이 쓰일 때 등)에도 나와서 까닭을 단정하지 않고 사실만 적는다(별도 검토 2차 Q3).
    answerChanged: '정답을 확인한 뒤 이 문항의 정답이 바뀌었어요.',
    // 모두 정답 처리 문항(작업 지시서 3의 4-2). 틀린 문항이 아니라서 틀린 문항 목록 아래에 따로 적는다.
    allCorrectLabel: '모두 정답으로 처리된 문항',
    allCorrect: '이 문항은 모두 정답으로 처리됐어요.',
    skip: '건너뛰기',
    go: '점수 해부 보기',
    empty: '틀린 문항이 없어요.',
  },

  anatomy: {
    top: '점수 해부',
    barLabel: (total: number, plain: number, guess: number, slip: number, other: number, allCorrectGuess = false) => {
      // 값이 없는 구간은 말하지 않는다(0점이라고 쓰지 않는다).
      const parts: string[] = [];
      if (plain > 0) parts.push(`찍음 표시 없이 맞힌 점수 ${plain}점`);
      if (guess > 0) parts.push(`추측했다고 표시한 정답 ${guess}점`);
      if (slip > 0) parts.push(`실수라고 표시한 오답 ${slip}점`);
      if (other > 0) parts.push(slip > 0 ? `그 외 오답 ${other}점` : `오답 ${other}점`);
      // 찍음 표시가 붙은 모두 정답 처리 문항이 있으면, 그 점수가 어느 구간에 들어갔는지 덧붙인다(작업 지시서 3의 4-2, 별도 검토 D1).
      const note = allCorrectGuess ? ' 모두 정답으로 처리된 문항은 찍음 표시가 있어도 찍음 표시 없이 맞힌 점수에 넣었어요.' : '';
      return `${total}점 막대. ${parts.join(', ')}.${note}`;
    },
    rowGuess: '추측했다고 표시한 정답',
    rowGuessSub: (actual: number) => `${actual}점 안에 들어 있어요`,
    rowGuessNone: '찍었다고 표시한 문항에서 나온 점수는 없어요.',
    // 찍음 표시가 붙은 모두 정답 처리 문항이 있을 때. 그 문항의 점수는 따로 나누지 않는다(작업 지시서 3의 4-2, 별도 검토 D1).
    rowGuessNoneAllCorrect: '모두 정답으로 처리된 문항 말고는 찍었다고 표시한 문항에서 나온 점수가 없어요.',
    rowSlip: '실수라고 표시한 오답',
    rowSlipSub: (actual: number) => `${actual}점에는 들어 있지 않아요`,
    rowSlipNone: '실수라고 표시한 오답이 없어요',
    sentenceGuess: (actual: number, guess: number) => `${actual}점 가운데 ${guess}점은 찍었다고 표시한 문항에서 나왔어요.`,
    // sentenceGuess 뒤에 붙인다. 찍음 표시가 붙은 모두 정답 처리 문항이 있을 때(별도 검토 D1).
    sentenceGuessAllCorrect: '모두 정답으로 처리된 문항은 찍음 표시가 있어도 이 점수에 넣지 않았어요.',
    sentenceSlip: (wrong: number, slip: number) => `틀린 ${wrong}점 가운데 ${slip}점은 실수라고 표시했어요.`,
    emptyMarks: (actual: number) => `표시한 문항이 없어서 나눠 볼 것이 없어요. ${actual}점 그대로예요.`,
    emptyGuess: (actual: number) => `찍었다고 표시한 문항이 없어서 나눠 볼 것이 없어요. ${actual}점 그대로예요.`,
    emptyGuessOnly: (actual: number) => `찍었다고 표시한 문항이 없어요. ${actual}점 그대로예요.`,
    // 찍음 표시가 모두 정답 처리 문항에만 있을 때. 그 문항은 표시가 없는 정답으로 다뤄서 나눠 보지 않는다(작업 지시서 3의 4-2).
    emptyGuessAllCorrect: (actual: number) => `찍었다고 표시한 문항은 모두 정답으로 처리돼서 따로 나누지 않았어요. ${actual}점 그대로예요.`,
    causesUnmarked: '아직 원인을 표시하지 않았어요',
    causesPartly: (n: number) => `원인을 표시하지 않은 문항이 ${n}개 있어요`,
    toCauses: '오답 원인 표시하기',
    cutBoxLabel: '등급컷까지 남은 점수',
    targetQ: '어디까지 가는 계단을 볼까요?',
    targetLabel: '목표 등급',
    gradeChip: (g: string) => `${g}등급`,
    cutTitle: (g: string, lo: number, hi: number) => `${g}등급 컷 ${rangePoints(lo, hi)}`,
    cutBadgeLabel: (text: string) => `${text}, 등급컷 출처 보기`,
    sourceTitle: '등급컷 출처',
    sourceSample: '예시 값이에요',
    source: (s: string) => `출처: ${s}`,
    // 등급컷 기준. 날짜만 적혀 있으면 적힌 글자 그대로("기준일: 2026-11-22"),
    // 시각까지 적혀 있으면 시험 목록의 시행일과 같은 날짜 모양에 시각을 붙인다(작업 지시서 3의 4-4).
    asOf: (d: string) => `기준일: ${d}`,
    asOfTime: (y: number, m: number, d: number, h: number, mi: number) => `기준: ${dateText(y, m, d)} ${clockText(h, mi)}`,
    // 출처 시트의 설명(작업 지시서 3의 4-4). "확정"은 주관 기관이 원점수 등급컷을 직접 발표했을 때만 쓴다.
    sourceConfirmed: '주관 기관이 발표한 컷이에요.',
    sourceEstimate: '추정한 컷이라 범위로 적었어요. 새 자료가 나오면 고쳐요.',
    sourceEstimateOne: '추정한 컷이에요. 새 자료가 나오면 고쳐요.',
    actualBelow: (actual: number, from: number, to: number) => [`실제 ${actual}점 기준`, `${rangePoints(from, to)} 남았어요`] as const,
    actualWithinLead: '컷 범위 안이에요.',
    // 추정 컷의 범위 안이거나 컷과 같은 점수일 때 덧붙인다. 컷이 어떻게 바뀔지는 약속하지 않는다(작업 지시서 3의 4-4).
    actualWithinRest: '컷 자료가 바뀌면 이 화면도 바뀌어요.',
    actualAbove: '컷 범위보다 위예요.',
    // 한 숫자 컷(확정 컷이나 두 값이 같은 추정 컷)일 때.
    actualEqualSingle: '컷과 같은 점수예요.',
    actualAboveSingle: '컷보다 위예요.',
    luckBelow: (rounded: number, from: number, to: number) =>
      `찍기 운을 평균으로 보면 약 ${rounded}점, 그 기준으로는 ${rangePoints(from, to)}이에요`,
    // 첫 줄이 "남았어요"가 아닐 때는 둘째 줄만 읽어도 뜻이 통하게 적는다.
    luckBelowAlone: (rounded: number, from: number, to: number) =>
      `찍기 운을 평균으로 보면 약 ${rounded}점, 그 기준으로는 ${rangePoints(from, to)} 남았어요`,
    luckWithin: (rounded: number) => `찍기 운을 평균으로 보면 약 ${rounded}점, 그 기준으로는 컷 범위 안이에요`,
    luckAbove: (rounded: number) => `찍기 운을 평균으로 보면 약 ${rounded}점, 그 기준으로는 컷 범위보다 위예요`,
    luckEqualSingle: (rounded: number) => `찍기 운을 평균으로 보면 약 ${rounded}점, 그 기준으로는 컷과 같은 점수예요`,
    luckAboveSingle: (rounded: number) => `찍기 운을 평균으로 보면 약 ${rounded}점, 그 기준으로는 컷보다 위예요`,
    luckSummary: (rounded: number) => `약 ${rounded}점 설명 보기`,
    luckDetail: (actual: number, allCorrectGuess = false) =>
      `찍었다고 표시한 문항을 보기 가운데 아무거나 골랐다고 보고 다시 계산한 평균이에요.${allCorrectGuess ? ' 모두 정답으로 처리된 문항은 찍음 표시가 있어도 넣지 않았어요.' : ''} 보기를 몇 개 지우고 골랐다면 이보다 높을 수 있고, 운에 따라 몇 점 오르내려요. 실제 점수는 ${actual}점 그대로예요.`,
    noCuts: '등급컷 자료를 기다리고 있어요. 점수와 고칠 것은 지금 볼 수 있어요.',
    // 유형 분류 전(typesReady false)에는 고칠 것(계단)을 볼 수 없어서 뒷문장을 뺀다(작업 지시서 3의 4-3).
    noCutsTypesPending: '등급컷 자료를 기다리고 있어요.',
    toSteps: (n: number) => (n > 0 ? `고칠 것 ${n}가지 보기` : '고칠 것 보기'),
    fix: '입력 고치기',
    pickExam: '시험 고르기',
  },

  steps: {
    top: '계단',
    title: (n: number) => `먼저 고칠 ${n}가지`,
    emptyTitle: '먼저 고칠 것',
    /** 카드의 배점 문장. 틀린 문항 배점과 찍었다고 표시한 정답 배점을 있는 것만 적는다. */
    points: (wrong: number, guess: number) => {
      const parts: string[] = [];
      if (wrong > 0) parts.push(`놓친 배점 ${wrong}점`);
      if (guess > 0) parts.push(`찍었다고 표시한 정답 ${guess}점`);
      return parts.join(', ');
    },
    reasonMissed: (points: number, count: number, cause: Cause | 'mixed' | 'none') => {
      const head = `이번 시험에서 이 유형으로 ${points}점을 놓쳤`;
      if (cause === 'slip') return `${head}고, ${allOf(count)}실수라고 표시했어요.`;
      if (cause === 'blank') return `${head}고, ${allOf(count)}풀이가 안 떠올랐다고 표시했어요.`;
      if (cause === 'unknown') return `${head}고, ${allOf(count)}잘 모르겠다고 표시했어요.`;
      return `${head}어요.`;
    },
    // 학생이 표시한 것은 찍음이고, 맞았다는 것은 채점 결과다.
    reasonGuess: (nos: number[]) => `이 유형의 ${listNos(nos)}은 찍었다고 표시했고, 채점해 보니 맞았어요.`,
    todoTitle: '할 일',
    todoToday: (nos: number[]) => `오늘 시험지의 ${listNos(nos)}을 다시 풀기`,
    coordsTitle: '비슷한 문항 좌표',
    coordsSample: '예시 좌표',
    coord: (label: string, itemNo: number) => `${label} ${itemNo}번`,
    copy: '좌표 복사',
    copied: '좌표를 복사했어요.',
    copyFailed: '복사하지 못했어요. 좌표를 길게 눌러 복사해 주세요.',
    retry: '다시 풀고 답 넣기',
    retryOf: (name: string) => `${name}, 다시 풀고 답 넣기`,
    how: '순서를 정한 방법',
    howBody: (wrong: number, guess: number, score: number) =>
      `틀린 문항의 배점과, 찍었다고 표시하고 맞힌 문항의 배점을 유형별로 더했어요. 합이 큰 유형부터 보여 드려요. 이 유형은 ${wrong}점과 ${guess}점을 더해 ${score}점이에요. 다른 학생의 자료는 쓰지 않았어요.`,
    empty: '틀린 문항이 없어요. 고칠 계단도 없어요.',
    // 유형 분류가 끝나지 않았을 때(typesReady false) 계단 화면과 계단으로 가는 길에 계단 대신 보여 준다(작업 지시서 3의 4-3).
    // 등급컷 자료가 아직 없으면 "등급컷은 지금 볼 수 있어요"가 사실과 달라서 점수만 적는다.
    typesPending: '유형 분류를 준비하고 있어요. 점수와 등급컷은 지금 볼 수 있어요.',
    typesPendingNoCuts: '유형 분류를 준비하고 있어요. 점수는 지금 볼 수 있어요.',
    // 찍음 표시가 붙은 모두 정답 처리 문항이 있을 때 계단 화면에 적는다. 그 문항은 계단에 넣지 않는다(작업 지시서 3의 4-2, 별도 검토 D1).
    allCorrectGuess: '모두 정답으로 처리된 문항은 찍음 표시가 있어도 계단에 넣지 않았어요.',
    retryStatusTitle: '다시 푼 기록',
    retryStatus: (no: number, label: string) => `${no}번: ${label}`,
  },

  retry: {
    top: (name: string) => `${name} 다시 풀기`,
    nowLabel: '다시 푼 답을 넣을 문항',
    selfNowLabel: '다시 볼 문항',
    progress: (index: number, total: number) => `${total}문항 가운데 ${index}번째`,
    entryLabel: '다시 푼 답',
    check: '답 맞춰 보기',
    needAnswer: '다시 푼 답을 먼저 넣어 주세요.',
    correct: '다시 풀어 맞혔어요.',
    correctKnown: '정답을 확인한 뒤 다시 맞혔어요.',
    /** 여러 번 넣은 끝에 맞혔을 때. n은 처음 맞은 차례(2 이상). */
    correctNth: (n: number) => `${n}번째로 넣은 답이 맞았어요.`,
    wrong: '이번에도 답이 달랐어요.',
    labelCorrect: '다시 풀어 맞힘',
    labelCorrectSlip: '실수로 표시함, 다시 풀어 맞힘',
    labelCorrectKnown: '정답 확인 후 다시 맞힘',
    labelCorrectNth: (n: number) => `${n}번째로 넣은 답이 맞음`,
    labelCorrectNthSlip: (n: number) => `실수로 표시함, ${n}번째로 넣은 답이 맞음`,
    labelWrong: '다시 풀었지만 답이 다름',
    // 찍었다고 표시하고 맞은 문항: 답을 다시 넣는 대신 스스로 확인한다.
    selfQ: '이 문항은 찍었다고 표시했고, 채점해 보니 맞았어요. 풀이를 끝까지 써 봤나요?',
    selfOptions: { solved: '끝까지 풀었어요', stuck: '풀어 봤는데 막혀요', notYet: '아직 안 풀어 봤어요' },
    selfSolved: '끝까지 풀었다고 표시했어요.',
    selfStuck: '막힌다고 표시했어요.',
    labelSelfSolved: '찍음 표시 정답, 끝까지 풀었다고 표시함',
    labelSelfStuck: '찍음 표시 정답, 막힌다고 표시함',
    recordLabel: '기록',
    nextItem: '다음 문항',
    backToSteps: '계단으로 돌아가기',
    nothing: '다시 풀 문항이 없어요.',
    // 화면이 열린 채 넘겨받은 새 판(정답 정정 등)으로 지금 문항이 다시 풀 목록에서 빠졌을 때(작업 지시서 3의 별도 검토 A1).
    // 그 문항에 넣던 답(맞춰 보기 전)은 기록하지 않고 목록의 다음 문항으로 옮긴다. dropped 는 넣던 답이 있었는지다.
    moved: (no: number, dropped: boolean) =>
      `시험 자료가 바뀌어서 ${no}번은 다시 풀 문항에서 빠졌어요.${dropped ? ' 넣던 답은 기록하지 않았어요.' : ''}`,
  },

  history: {
    title: '기록',
    listLabel: '지난 시험',
    inProgress: '입력 중',
    readyToGrade: '채점 전',
    remove: '지우기',
    removeOf: (title: string, detail: string) => `${title} 기록 지우기, ${detail}`,
    open: (title: string, detail: string) => `${title} 기록 열기, ${detail}`,
    // 정답 정정 알림을 아직 확인하지 않은 기록(작업 지시서 3의 4-6). 보이는 표시와 열기 버튼의 이름에 붙인다.
    corrected: '정답 정정으로 다시 채점됨',
    openCorrected: (title: string, detail: string) => `${title} 기록 열기, ${detail}, 정답 정정으로 다시 채점됨`,
    // 정답 판 번호는 그대로인데 다른 시험 자료로 다시 채점해 점수가 바뀐 기록(src/state/session.ts 의 differs).
    rescored: '다른 시험 자료로 다시 채점됨',
    openRescored: (title: string, detail: string) => `${title} 기록 열기, ${detail}, 다른 시험 자료로 다시 채점됨`,
    removeAll: '이 기기의 기록 모두 지우기',
    confirmOne: '이 기록을 지울까요?',
    confirmAll: '이 기기의 기록을 모두 지울까요?',
    confirmBody: '지우면 되돌릴 수 없어요.',
    confirmOneBody: (title: string, detail: string) => `${title}, ${detail} 기록이에요. 지우면 되돌릴 수 없어요.`,
    confirmYes: '지우기',
    confirmNo: '그만두기',
    empty: '아직 넣은 시험이 없어요. 시험을 하나 넣으면 여기에 쌓여요.',
    storageFailed: '이 브라우저에서는 기록을 저장하지 못했어요. 화면은 그대로 쓸 수 있어요.',
  },

  // 기록이 가리키는 시험을 지금 시험 목록에서 찾지 못했을 때(작업 지시서 3의 5-2). 기록은 지우지 않고 그대로 둔다.
  // 기록 화면의 그 기록 자리와, 그 기록을 이어 열 때의 작은 화면에 쓴다.
  missingExam: {
    body: '시험 자료를 받으면 다시 볼 수 있어요.',
    back: '처음 화면으로',
  },

  // 풀이 잠금 안내(작업 지시서 3의 4-5). 풀이 계열 기능이 생기면 잠긴 동안 그 기능 대신 보여 준다(src/components/LockNotice.tsx).
  // 지금은 풀이 계열 기능이 없어서 학생이 보는 화면에 붙이지 않는다.
  solutionLock: {
    /** h, mi 는 풀리는 시각(그 항목의 end, 한국 시간)이다. */
    notice: (h: number, mi: number) =>
      `지금은 시험 시간이라 풀이는 잠시 쉬어요. ${clockText(h, mi)}부터 다시 볼 수 있어요. 답 입력은 지금도 할 수 있어요.`,
  },
} as const;

/** 5행 방식 답 입력 화면에서만 쓰는 문구. */
export const S_ROWS = {
  pageRange: (from: number, to: number) => (from === to ? `${from}번` : `${from}~${to}번`),
  prevPage: '이전',
  nextPage: (n: number) => `다음 ${n}문항`,
  toReview: '넣은 답 확인하기',
  rowAnswerLabel: (no: number) => `${no}번 답`,
  rowChoice: (n: number) => `${n}`,
  rowNoButton: (no: number) => `${no}번, 안 풂 또는 입력 지우기`,
  rowNoButtonSkipped: (no: number) => `${no}번, 넣은 답 안 풂, 안 풂 또는 입력 지우기`,
  rowShortEmpty: '눌러서 답 넣기',
  rowShortFilled: (no: number, answer: string) => `${no}번 답 ${answer}, 눌러서 고치기`,
  rowShortOpen: (no: number) => `${no}번 답 넣기`,
  menuTitle: (no: number) => `${no}번`,
  menuSkip: '안 풂',
  menuClear: '입력 지우기',
  sheetPutTitle: (no: number) => `${no}번 답 넣기`,
} as const;

/** 진행자용 화면으로 가는 링크, 기록 화면의 "준비 중인 기능" 목록, 테스트 기기에서만 나오는 안내. */
export const S_TOOLS = {
  upcomingTitle: '준비 중인 기능',
  upcoming: [
    { name: '7일 뒤 확인', note: '준비 중이에요.' },
    { name: '실수 카드', note: '준비 중이에요.' },
    { name: '공유 리포트', note: '준비 중이에요.' },
    { name: '점수대별 정답률', note: '응답이 모이면 열려요.' },
  ],
  tester: '테스트 진행자용',
  testDevice: '테스트 기기예요. 기록은 진행자용 화면에서 확인해요.',
} as const;

/** 테스트 진행자용 화면(#/test)에서만 쓰는 문구. */
export const S_TEST = {
  title: '테스트 진행자용',
  intro: '사용성 테스트를 진행하는 사람이 쓰는 화면이에요. 측정 기록은 이 기기 안에만 남아요.',
  // 합친 풀이 잠금 달력으로 판정한 지금의 상태(작업 지시서 3의 4-5). h, mi 는 풀리는 시각(한국 시간)이다.
  lockOpen: '풀이 잠금: 지금 열림',
  lockClosed: (h: number, mi: number) => `풀이 잠금: 지금 잠김(${clockText(h, mi)}까지)`,
  newTitle: '새 참가자',
  participant: '참가자 코드',
  participantHint: 'P01처럼 적어 주세요. 이름은 넣지 마세요.',
  participantError: '참가자 코드를 P01 같은 형식으로 적어 주세요.',
  mode: '입력 방식',
  modes: { keypad: '키패드', rows: '5행' } as Record<InputMode, string>,
  exam: '시험',
  start: '테스트 시작하기',
  activeTitle: '진행 중인 참가자',
  active: (code: string, mode: string) => `${code}, ${mode} 방식`,
  finish: '이 참가자 마치기',
  runsTitle: '측정 기록',
  noRuns: '아직 측정 기록이 없어요.',
  runTitle: (code: string, mode: string, exam: string) => `${code}, ${mode}, ${exam}`,
  metric: {
    started: '시작 시각',
    input: '답 입력 시간',
    inputCount: '누른 답 입력 횟수',
    reviewFixed: '입력 확인에서 고친 문항 수',
    marks: '표시 화면에 머문 시간',
    toScore: '시험 선택부터 첫 점수까지',
    residual: '남은 오입력',
    discarded: '받지 않은 누름',
    filled: '채운 누름',
    screens: '화면 진입 기록',
  },
  seconds: (s: number) => `${s}초`,
  count: (n: number) => `${n}개`,
  times: (n: number) => `${n}번`,
  notYet: '아직 없음',
  keyTitle: '정답지 대조',
  keyLabel: '참가자에게 준 답지의 답',
  keyHint: (n: number) => `답 ${n}개를 쉼표로 구분해 붙여 넣어 주세요. 안 푼 문항은 x로 적어요.`,
  keyCompare: '답지와 비교하기',
  keyCountError: (need: number, got: number) => `답이 ${need}개여야 해요. 지금은 ${got}개예요.`,
  keyValueError: (index: number) => `${index}번째 값을 읽지 못했어요.`,
  keyNoSession: '이 참가자가 넣은 답이 아직 없어요.',
  keyResult: (n: number) => `남은 오입력 ${n}개`,
  keyDiff: (nos: number[]) => `다른 문항: ${listNos(nos)}`,
  exportTitle: '내보내기',
  saveJson: 'JSON 파일 저장',
  saveCsv: 'CSV 파일 저장',
  copyJson: 'JSON 복사',
  copyCsv: 'CSV 복사',
  copied: '복사했어요.',
  copyFailed: '복사하지 못했어요. 파일 저장을 써 주세요.',
  // 아이폰 앱에는 파일 저장이 없고 복사만 있다.
  copyFailedApp: '복사하지 못했어요. 다시 눌러 주세요.',
  saved: '파일 저장을 요청했어요. 파일이 생기지 않으면 복사를 써 주세요.',
  saveFailed: '파일로 저장하지 못했어요. 복사를 써 주세요.',
  noNetwork: '기록은 파일이나 복사로만 꺼낼 수 있어요. 어디로도 전송하지 않아요.',
  noNetworkApp: '기록은 복사로만 꺼낼 수 있어요. 어디로도 전송하지 않아요.',
  reset: '기록 초기화',
  resetConfirm: '테스트 기록을 모두 지울까요?',
  resetBody: '참가자가 넣은 시험 기록은 지우지 않아요. 측정 기록만 지워요.',
  plannedMismatch: '참가자가 계획과 다른 시험을 골랐어요.',
  examReselected: (n: number) => `참가자가 측정 중에 다른 시험 기록으로 ${n}번 옮겨 갔어요. 아래 값은 마지막에 넣던 기록에서 잰 것이에요.`,
} as const;

/**
 * 아이폰 앱 안에서만 쓰거나 바꿔 쓰는 문구. src/platform/app.ts 만 가져오고, 화면은 platform.appText 로 읽는다
 * (브라우저와 일반 웹 빌드에서는 null 이라 그리지 않는다).
 */
export const S_APP = {
  privacy: '가입 없이 써요. 기록은 이 기기에 저장하고 서버로 보내지 않아요.',
  historyNote: '앱을 지우면 기록도 함께 지워져요.',
  storageFailed: '이 기기에 기록을 저장하지 못했어요. 화면은 그대로 쓸 수 있어요.',
  archived: '앞서 저장된 기록을 읽지 못해 따로 보관해 뒀어요.',
  // 시험 선택 화면의 받은 시험 자료 안내(작업 지시서 3의 5-4, src/components/RemoteNotice.tsx).
  // 다리 규격 2 이상의 껍데기가 시험 자료를 넘겨줬을 때만 보인다.
  remoteSource: '시험 자료는 정해진 주소 한 곳에서 받아요. 넣은 답과 기록은 보내지 않아요.',
  /** 받은 자료 기준(넘겨받은 자료의 issuedAt, 한국 시간). 연, 월, 일, 시, 분은 시각 문자열을 잘라 얻은 값이다(src/logic/dates.ts). */
  remoteIssued: (y: number, m: number, d: number, h: number, mi: number) => `받은 자료 기준: ${dateText(y, m, d)} ${clockText(h, mi)}`,
  remoteRefresh: '새로 확인',
  /** "새로 확인"의 결과(src/exams/index.ts 의 RefreshResult). 10초 동안 아무 응답이 없을 때도 failed 다. */
  remoteResult: {
    new: '시험 자료를 새로 받았어요.',
    same: '이미 가장 새 자료예요.',
    failed: '새 시험 자료를 받지 못했어요. 지금 있는 자료로 쓸 수 있어요.',
  },
} as const;
