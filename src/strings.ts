// 화면 문구는 모두 이 파일에 모은다.
// 작업 지시서 8장과 9장에 적힌 문구는 그대로 쓴다.
// 해요체, 한 문장에 한 가지, 사실과 다음 할 일만 말한다. 느낌표와 이모지는 쓰지 않는다.

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

/** 시와 분(24시 기준). 같은 날 같은 점수의 기록을 구분할 때만 쓴다. */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getHours()}시 ${d.getMinutes()}분`;
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
    pageRange: (from: number, to: number) => (from === to ? `${from}번` : `${from}~${to}번`),
    entered: (n: number) => `${n}문항 입력`,
    progressLabel: '입력한 문항 수',
    nowLabel: '지금 넣을 문항',
    entryLabel: '넣은 답',
    hint: '다섯 문항마다 시험지와 맞춰 보세요. 칸을 누르면 그 문항으로 가요.',
    erased: (no: number) => `${no}번 답을 지웠어요.`,
    notCommitted: (no: number) => `${no}번에 누른 숫자는 '다음'을 누르지 않아서 들어가지 않았어요.`,
    prevGroupLabel: '직전 묶음',
    currentGroupLabel: '현재 묶음',
    keypadLabel: '답 키패드',
    cellFilled: (no: number, answer: string) => `${no}번 칸, 넣은 답 ${answer}`,
    cellEmpty: (no: number) => `${no}번 칸, 비어 있음`,
    // 5행 방식
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
    none2: '없어요',
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
    answer: (a: number) => `정답 ${a}`,
    viewed: '정답 확인함',
    skip: '건너뛰기',
    go: '점수 해부 보기',
    empty: '틀린 문항이 없어요.',
  },

  anatomy: {
    top: '점수 해부',
    barLabel: (total: number, plain: number, guess: number, slip: number, other: number) => {
      // 값이 없는 구간은 말하지 않는다(0점이라고 쓰지 않는다).
      const parts: string[] = [];
      if (plain > 0) parts.push(`표시 없이 맞힌 점수 ${plain}점`);
      if (guess > 0) parts.push(`추측했다고 표시한 정답 ${guess}점`);
      if (slip > 0) parts.push(`실수라고 표시한 오답 ${slip}점`);
      if (other > 0) parts.push(slip > 0 ? `그 외 오답 ${other}점` : `오답 ${other}점`);
      return `${total}점 막대. ${parts.join(', ')}.`;
    },
    rowGuess: '추측했다고 표시한 정답',
    rowGuessSub: (actual: number) => `${actual}점 안에 들어 있어요`,
    rowGuessNone: '찍었다고 표시한 문항에서 나온 점수는 없어요.',
    rowSlip: '실수라고 표시한 오답',
    rowSlipSub: (actual: number) => `${actual}점에는 들어 있지 않아요`,
    rowSlipNone: '실수라고 표시한 오답이 없어요',
    sentenceGuess: (actual: number, guess: number) => `${actual}점 가운데 ${guess}점은 찍었다고 표시한 문항에서 나왔어요.`,
    sentenceSlip: (wrong: number, slip: number) => `틀린 ${wrong}점 가운데 ${slip}점은 실수라고 표시했어요.`,
    emptyMarks: (actual: number) => `표시한 문항이 없어서 나눠 볼 것이 없어요. ${actual}점 그대로예요.`,
    emptyGuess: (actual: number) => `찍었다고 표시한 문항이 없어서 나눠 볼 것이 없어요. ${actual}점 그대로예요.`,
    emptyGuessOnly: (actual: number) => `찍었다고 표시한 문항이 없어요. ${actual}점 그대로예요.`,
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
    asOf: (d: string) => `기준일: ${d}`,
    sourceConfirmed: '확정된 컷이에요.',
    sourceEstimate: '추정한 컷이라 범위로 적었어요. 컷이 확정되면 한 숫자로 바뀌어요.',
    actualBelow: (actual: number, from: number, to: number) => [`실제 ${actual}점 기준`, `${rangePoints(from, to)} 남았어요`] as const,
    actualWithinLead: '컷 범위 안이에요.',
    actualWithinRest: '컷이 확정되면 이 화면이 바뀌어요.',
    actualAbove: '컷 범위보다 위예요.',
    actualEqualConfirmed: '컷과 같은 점수예요.',
    actualAboveConfirmed: '컷보다 위예요.',
    luckBelow: (rounded: number, from: number, to: number) =>
      `찍기 운을 평균으로 보면 약 ${rounded}점, 그 기준으로는 ${rangePoints(from, to)}이에요`,
    // 첫 줄이 "남았어요"가 아닐 때는 둘째 줄만 읽어도 뜻이 통하게 적는다.
    luckBelowAlone: (rounded: number, from: number, to: number) =>
      `찍기 운을 평균으로 보면 약 ${rounded}점, 그 기준으로는 ${rangePoints(from, to)} 남았어요`,
    luckWithin: (rounded: number) => `찍기 운을 평균으로 보면 약 ${rounded}점, 그 기준으로는 컷 범위 안이에요`,
    luckAbove: (rounded: number) => `찍기 운을 평균으로 보면 약 ${rounded}점, 그 기준으로는 컷 범위보다 위예요`,
    luckEqualConfirmed: (rounded: number) => `찍기 운을 평균으로 보면 약 ${rounded}점, 그 기준으로는 컷과 같은 점수예요`,
    luckAboveConfirmed: (rounded: number) => `찍기 운을 평균으로 보면 약 ${rounded}점, 그 기준으로는 컷보다 위예요`,
    luckSummary: (rounded: number) => `약 ${rounded}점 설명 보기`,
    luckDetail: (actual: number) =>
      `찍었다고 표시한 문항을 운이 보통이었을 때로 다시 계산한 점수예요. 실제 점수는 ${actual}점 그대로예요.`,
    noCuts: '등급컷 자료를 기다리고 있어요. 점수와 고칠 것은 지금 볼 수 있어요.',
    toSteps: (n: number) => (n > 0 ? `고칠 것 ${n}가지 보기` : '고칠 것 보기'),
    fix: '입력 고치기',
    pickExam: '시험 고르기',
  },

  steps: {
    top: '계단',
    title: (n: number) => `먼저 고칠 ${n}가지`,
    emptyTitle: '먼저 고칠 것',
    missed: (p: number) => `놓친 배점 ${p}점`,
    guessOnly: (p: number) => `찍었다고 표시한 정답 ${p}점`,
    reasonMissed: (points: number, count: number, cause: Cause | 'mixed' | 'none') => {
      const head = `이번 시험에서 이 유형으로 ${points}점을 놓쳤`;
      if (cause === 'slip') return `${head}고, ${allOf(count)}실수라고 표시했어요.`;
      if (cause === 'blank') return `${head}고, ${allOf(count)}풀이가 안 떠올랐다고 표시했어요.`;
      if (cause === 'unknown') return `${head}고, ${allOf(count)}잘 모르겠다고 표시했어요.`;
      return `${head}어요.`;
    },
    reasonGuess: (nos: number[]) => `이 유형의 ${listNos(nos)}은 찍어서 맞혔다고 표시했어요.`,
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
    retryStatusTitle: '다시 푼 기록',
    retryStatus: (no: number, label: string) => `${no}번: ${label}`,
  },

  retry: {
    top: (name: string) => `${name} 다시 풀기`,
    nowLabel: '다시 푼 답을 넣을 문항',
    progress: (index: number, total: number) => `${total}문항 가운데 ${index}번째`,
    entryLabel: '다시 푼 답',
    check: '답 맞춰 보기',
    needAnswer: '다시 푼 답을 먼저 넣어 주세요.',
    correct: '다시 풀어 맞혔어요.',
    correctKnown: '정답을 확인한 뒤 다시 맞혔어요.',
    wrong: '이번에도 답이 달랐어요. 이 유형을 계단에 남겨 둘게요.',
    // 처음에 맞혔던 문항(찍어서 맞혔다고 표시한 문항)을 다시 풀어 틀린 경우.
    wrongAfterCorrect: '이번에는 답이 달랐어요. 이 유형을 계단에 남겨 둘게요.',
    labelCorrect: '다시 풀어 맞힘',
    labelCorrectSlip: '실수로 표시함, 다시 풀어 맞힘',
    labelCorrectKnown: '정답 확인 후 다시 맞힘',
    labelWrong: '다시 풀었지만 답이 다름',
    recordLabel: '기록',
    nextItem: '다음 문항',
    backToSteps: '계단으로 돌아가기',
    nothing: '다시 풀 문항이 없어요.',
  },

  history: {
    title: '기록',
    listLabel: '지난 시험',
    inProgress: '입력 중',
    readyToGrade: '채점 전',
    remove: '지우기',
    removeOf: (title: string, detail: string) => `${title} 기록 지우기, ${detail}`,
    open: (title: string, detail: string) => `${title} 기록 열기, ${detail}`,
    removeAll: '이 기기의 기록 모두 지우기',
    confirmOne: '이 기록을 지울까요?',
    confirmAll: '이 기기의 기록을 모두 지울까요?',
    confirmBody: '지우면 되돌릴 수 없어요.',
    confirmOneBody: (title: string, detail: string) => `${title}, ${detail} 기록이에요. 지우면 되돌릴 수 없어요.`,
    confirmAllBodyWithRuns: '지우면 되돌릴 수 없어요. 테스트 측정 기록은 테스트 진행자용 화면에서 따로 지워요.',
    confirmYes: '지우기',
    confirmNo: '그만두기',
    empty: '아직 넣은 시험이 없어요. 시험을 하나 넣으면 여기에 쌓여요.',
    upcomingTitle: '준비 중인 기능',
    upcoming: [
      { name: '7일 뒤 확인', note: '준비 중이에요.' },
      { name: '실수 카드', note: '준비 중이에요.' },
      { name: '공유 리포트', note: '준비 중이에요.' },
      { name: '점수대별 정답률', note: '응답이 모이면 열려요.' },
    ],
    storageFailed: '이 브라우저에서는 기록을 저장하지 못했어요. 화면은 그대로 쓸 수 있어요.',
    tester: '테스트 진행자용',
  },

  test: {
    title: '테스트 진행자용',
    intro: '사용성 테스트를 진행하는 사람이 쓰는 화면이에요. 측정 기록은 이 기기 안에만 남아요.',
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
    saved: '파일 저장을 요청했어요. 파일이 생기지 않으면 복사를 써 주세요.',
    saveFailed: '파일로 저장하지 못했어요. 복사를 써 주세요.',
    noNetwork: '기록은 파일이나 복사로만 꺼낼 수 있어요. 어디로도 전송하지 않아요.',
    reset: '기록 초기화',
    resetConfirm: '테스트 기록을 모두 지울까요?',
    resetBody: '참가자가 넣은 시험 기록은 지우지 않아요. 측정 기록만 지워요.',
    plannedMismatch: '참가자가 계획과 다른 시험을 골랐어요.',
    examReselected: (n: number) => `참가자가 측정 중에 다른 시험 기록으로 ${n}번 옮겨 갔어요. 아래 값은 마지막에 넣던 기록에서 잰 것이에요.`,
  },
} as const;
