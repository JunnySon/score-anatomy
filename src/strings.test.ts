import { describe, expect, it } from 'vitest';
import { formatDate, formatTime, listNos, rangePoints, S, S_APP, S_ROWS, S_TEST, S_TOOLS } from './strings';

// 화면 문구 검사: 금지 문자, 느낌표, 이모지, 쓰지 않기로 한 말이 없는지 본다.

/** 문구 객체를 끝까지 내려가며 실제로 화면에 나올 문자열을 모은다. 함수는 견본 값으로 불러 본다. */
function collect(value: unknown, path: string, out: { path: string; text: string }[]): void {
  if (typeof value === 'string') {
    out.push({ path, text: value });
  } else if (typeof value === 'function') {
    const fn = value as (...args: unknown[]) => unknown;
    const samples: unknown[][] = [
      [78, 7, 8, 14, 3],
      [2, 81, 85, false, 1],
      ['2', 81, 85],
      ['예시 좌표', 9],
      [[15, 29]],
      [[14, 20, 21]],
      [[9]],
      [8, 2, 'slip'],
      [8, 3, 'blank'],
      [3, 1, 'unknown'],
      [3, 1, 'mixed'],
      ['mc', 1, 21],
      ['short', 22, 22],
      ['적분'],
      ['P01', '키패드', '예시 시험 A'],
      [12, '3', '찍음'],
      [12, true],
    ];
    for (const args of samples) {
      let result: unknown;
      try {
        result = fn(...args);
      } catch {
        continue;
      }
      if (typeof result === 'string') out.push({ path: `${path}()`, text: result });
      else if (Array.isArray(result)) for (const r of result) if (typeof r === 'string') out.push({ path: `${path}()`, text: r });
    }
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => collect(v, `${path}[${i}]`, out));
  } else if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) collect(v, `${path}.${k}`, out);
  }
}

const all: { path: string; text: string }[] = [];
collect(S, 'S', all);
collect(S_ROWS, 'S_ROWS', all);
collect(S_TEST, 'S_TEST', all);
collect(S_TOOLS, 'S_TOOLS', all);
collect(S_APP, 'S_APP', all);

// 금지 문자와 느낌표는 문자를 직접 적지 않고 코드 값으로 정규식을 만든다.
const charClass = (codes: number[]) => new RegExp(`[${codes.map((c) => String.fromCodePoint(c)).join('')}]`, 'u');
const FORBIDDEN = charClass([0x2014, 0x2013, 0x00b7, 0x318d, 0x30fb, 0x2027]);
const EXCLAMATION = charClass([0x21, 0xff01]);

describe('화면 문구', () => {
  it('문구를 충분히 모았다', () => {
    expect(all.length).toBeGreaterThan(200);
  });

  it('금지 문자가 없다 (줄표 U+2014, U+2013, 가운뎃점 U+00B7, U+318D, U+30FB, U+2027)', () => {
    const bad = all.filter((s) => FORBIDDEN.test(s.text));
    expect(bad).toEqual([]);
  });

  it('느낌표와 이모지가 없다', () => {
    const bang = all.filter((s) => EXCLAMATION.test(s.text));
    expect(bang).toEqual([]);
    const emoji = all.filter((s) => /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}]/u.test(s.text));
    expect(emoji).toEqual([]);
  });

  it('쓰지 않기로 한 말이 없다', () => {
    const banned = [
      '잘했어요',
      '아쉬워요',
      '위험',
      '심각',
      '지금 안 하면',
      '뒤처져요',
      '남들은',
      '마지막 기회',
      '잠재 점수',
      '진짜 점수',
      '부족',
      '실수 확인',
      '풀어서 맞힌',
      '풀어서 맞힘',
      '축하',
      '대단',
      // 1.1: 계단의 순서와 숫자는 다시 풀기 결과로 바뀌지 않으므로 이 말을 쓰지 않는다.
      '계단에 남겨',
      '순위',
      '등수',
      '연속',
    ];
    for (const word of banned) {
      const hit = all.filter((s) => s.text.includes(word));
      expect(hit, word).toEqual([]);
    }
  });

  it('버튼 이름을 "확인" 한 마디로 두지 않는다', () => {
    expect(all.filter((s) => s.text.trim() === '확인')).toEqual([]);
  });

  it('추정값에는 "약"을 붙이고 소수점을 쓰지 않는다', () => {
    expect(S.anatomy.luckSummary(75)).toBe('약 75점 설명 보기');
    expect(S.anatomy.luckBelow(75, 6, 10)).toBe('찍기 운을 평균으로 보면 약 75점, 그 기준으로는 6~10점이에요');
  });

  it('8장과 9장에 적힌 문구를 그대로 쓴다', () => {
    const texts = new Set(all.map((s) => s.text));
    const required = [
      '이번 시험',
      '기록',
      '시험 고르기',
      '예시 결과 보기',
      '이어서 보기',
      '예시',
      '정답 공개 전',
      '채점은 아직인가요?',
      '아직 안 했어요',
      '이미 했어요',
      '채점한 뒤에 표시한 기록이에요',
      '이 시험지, 전에 풀어 본 적 있나요?',
      '처음이에요',
      '일부 봤어요',
      '풀어 봤어요',
      '답 넣기',
      '전체 보기',
      '지금 넣을 문항',
      '다섯 문항마다 시험지와 맞춰 보세요. 칸을 누르면 그 문항으로 가요.',
      '안 풂',
      '지우기',
      '다음',
      '입력 지우기',
      '이전',
      '넣은 답을 확인해 주세요',
      '시험지와 5개씩 맞춰 보세요.',
      '미입력',
      '맞아요, 다음으로',
      '풀이 없이 고른 문항이 있나요?',
      '있으면 눌러 주세요. 점수는 그대로예요.',
      '시험지에 세모나 물음표를 쳐 둔 문항을 보면 쉬워요.',
      '고민',
      '찍음',
      '한 번 누르면 고민, 두 번 누르면 찍음, 세 번 누르면 지워져요.',
      '자신 없음',
      '시간은 어땠나요?',
      '충분했어요',
      '빠듯했어요',
      '몇 문제는 못 봤어요',
      '채점하기',
      '없어요, 채점하기',
      '정답이 아직 공개되지 않았어요. 답은 저장해 뒀어요. 공개되면 여기서 바로 채점돼요.',
      '틀린 문항 살펴보기',
      '점수 해부 바로 보기',
      '입력 고치기',
      '풀 줄 아는데 틀렸어요',
      '풀이가 안 떠올랐어요',
      '잘 모르겠어요',
      '정답 보기',
      '정답 확인함',
      '건너뛰기',
      '점수 해부 보기',
      '추측했다고 표시한 정답',
      '실수라고 표시한 오답',
      '어디까지 가는 계단을 볼까요?',
      '추정',
      '확정',
      '예시 값이에요',
      '컷 범위보다 위예요.',
      '등급컷 자료를 기다리고 있어요. 점수와 고칠 것은 지금 볼 수 있어요.',
      '아직 원인을 표시하지 않았어요',
      '다시 풀고 답 넣기',
      '순서를 정한 방법',
      '좌표 복사',
      '예시 좌표',
      '틀린 문항이 없어요. 고칠 계단도 없어요.',
      '다시 풀어 맞혔어요.',
      '다시 풀어 맞힘',
      '실수로 표시함, 다시 풀어 맞힘',
      '정답 확인 후 다시 맞힘',
      '이번에도 답이 달랐어요.',
      '이 기기의 기록 모두 지우기',
      '7일 뒤 확인',
      '실수 카드',
      '공유 리포트',
      '점수대별 정답률',
      '준비 중이에요.',
      '응답이 모이면 열려요.',
      '테스트 진행자용',
      '답은 0부터 999까지예요.',
      '아직 넣은 시험이 없어요. 시험을 하나 넣으면 여기에 쌓여요.',
      '채점하지 못했어요. 답은 그대로 있어요.',
    ];
    for (const text of required) expect(texts.has(text), text).toBe(true);
    expect(S.common.emptyItem(14)).toBe("14번이 비어 있어요. 안 푼 문항이면 '안 풂'을 눌러 주세요.");
    expect(S.common.correctOf(30, 24)).toBe('30문항 가운데 24문항을 맞혔어요.');
    expect(S.input.section('mc', 1, 21)).toBe('객관식 1~21번');
    expect(S.input.entered(11)).toBe('11문항 입력');
    expect(S_ROWS.nextPage(5)).toBe('다음 5문항');
    expect(S.anatomy.rowGuessSub(78)).toBe('78점 안에 들어 있어요');
    expect(S.anatomy.rowSlipSub(78)).toBe('78점에는 들어 있지 않아요');
    expect(S.anatomy.emptyMarks(78)).toBe('표시한 문항이 없어서 나눠 볼 것이 없어요. 78점 그대로예요.');
    expect(S.anatomy.cutTitle('2', 81, 85)).toBe('2등급 컷 81~85점');
    expect(S.anatomy.luckDetail(78)).toBe(
      '찍었다고 표시한 문항을 보기 가운데 아무거나 골랐다고 보고 다시 계산한 평균이에요. 보기를 몇 개 지우고 골랐다면 이보다 높을 수 있고, 운에 따라 몇 점 오르내려요. 실제 점수는 78점 그대로예요.',
    );
    expect(S.anatomy.toSteps(2)).toBe('고칠 것 2가지 보기');
    expect(S.steps.title(2)).toBe('먼저 고칠 2가지');
    expect(S.steps.todoToday([15, 29])).toBe('오늘 시험지의 15번과 29번을 다시 풀기');
  });

  it('작업 지시서 1(1.1과 앱용 묶음)에 적힌 문구를 그대로 쓴다', () => {
    const texts = new Set(all.map((s) => s.text));
    for (const text of [
      '없어요, 채점하기',
      '빈칸이 없어요. 고칠 문항을 눌러 주세요.',
      '지울 답이 없어요.',
      '이 문항은 찍었다고 표시했고, 채점해 보니 맞았어요. 풀이를 끝까지 써 봤나요?',
      '끝까지 풀었어요',
      '풀어 봤는데 막혀요',
      '아직 안 풀어 봤어요',
      '끝까지 풀었다고 표시했어요.',
      '막힌다고 표시했어요.',
      '찍음 표시 정답, 끝까지 풀었다고 표시함',
      '찍음 표시 정답, 막힌다고 표시함',
      '이번에도 답이 달랐어요.',
      '화면이 막 바뀌어서 방금 누른 것은 받지 않았어요.',
      '테스트 기기예요. 기록은 진행자용 화면에서 확인해요.',
      '가입 없이 써요. 기록은 이 기기에 저장하고 서버로 보내지 않아요.',
      '앱을 지우면 기록도 함께 지워져요.',
      '앞서 저장된 기록을 읽지 못해 따로 보관해 뒀어요.',
      '이 기기에 기록을 저장하지 못했어요. 화면은 그대로 쓸 수 있어요.',
    ]) {
      expect(texts.has(text), text).toBe(true);
    }
    expect(S.input.locked(9)).toBe('9번에 답을 넣었어요. 다음에 할 일을 골라 주세요.');
    expect(S.input.fixing(9)).toBe('9번을 고치는 중이에요.');
    expect(S.input.fixNext(10)).toBe('10번도 고치기');
    expect(S.input.continueFrom(12)).toBe('12번부터 이어서 넣기');
    expect(S.input.erased(6)).toBe('6번 답을 지웠어요.');
    expect(S.steps.points(8, 4)).toBe('놓친 배점 8점, 찍었다고 표시한 정답 4점');
    expect(S.steps.points(8, 0)).toBe('놓친 배점 8점');
    expect(S.steps.points(0, 3)).toBe('찍었다고 표시한 정답 3점');
    expect(S.steps.reasonGuess([14])).toBe('이 유형의 14번은 찍었다고 표시했고, 채점해 보니 맞았어요.');
    expect(S.retry.correctNth(2)).toBe('2번째로 넣은 답이 맞았어요.');
    expect(S.retry.labelCorrectNth(2)).toBe('2번째로 넣은 답이 맞음');
    expect(S.retry.labelCorrectNthSlip(3)).toBe('실수로 표시함, 3번째로 넣은 답이 맞음');
    expect(S.exams.held(2030, 1, 2)).toBe('2030년 1월 2일 시행');
    expect(S.anatomy.barLabel(100, 71, 7, 8, 14)).toBe('100점 막대. 찍음 표시 없이 맞힌 점수 71점, 추측했다고 표시한 정답 7점, 실수라고 표시한 오답 8점, 그 외 오답 14점.');
  });

  it('작업 지시서 3(시험 당일 경로)에 적힌 문구를 그대로 쓴다', () => {
    const texts = new Set(all.map((s) => s.text));
    // 4-2: 모두 정답 처리.
    for (const text of ['이 문항은 모두 정답으로 처리됐어요.']) expect(texts.has(text), text).toBe(true);
    // 4-2: 복수 정답이면 인정하는 답을 모두 보여 주고 함께 인정한다고 알린다. 정답이 하나면 지금 글자 그대로다.
    expect(S.causes.answer([164])).toBe('정답 164');
    expect(S.causes.answer([3, 5])).toBe('정답 3, 5');
    expect(S.causes.acceptedAll(2)).toBe('둘 다 정답으로 인정해요.');
    expect(S.causes.acceptedAll(3)).toBe('모두 정답으로 인정해요.');
    expect(S.anatomy.emptyGuessAllCorrect(60)).toBe('찍었다고 표시한 문항은 모두 정답으로 처리돼서 따로 나누지 않았어요. 60점 그대로예요.');
    // 4-3: 유형 분류가 늦을 때 계단 대신 보여 주는 안내.
    for (const text of ['유형 분류를 준비하고 있어요. 점수와 등급컷은 지금 볼 수 있어요.']) expect(texts.has(text), text).toBe(true);
    // 4-4: 등급컷 설명 셋과, 확정을 약속하던 문장 대신 쓰는 문장. 기준에 시각이 있으면 한국 시간으로 적는다.
    for (const text of [
      '주관 기관이 발표한 컷이에요.',
      '추정한 컷이라 범위로 적었어요. 새 자료가 나오면 고쳐요.',
      '추정한 컷이에요. 새 자료가 나오면 고쳐요.',
      '컷 자료가 바뀌면 이 화면도 바뀌어요.',
    ]) {
      expect(texts.has(text), text).toBe(true);
    }
    expect(S.anatomy.asOfTime(2030, 1, 2, 20, 10)).toBe('기준: 2030년 1월 2일 오후 8시 10분');
    expect(S.anatomy.asOfTime(2030, 1, 2, 20, 0)).toBe('기준: 2030년 1월 2일 오후 8시');
    expect(S.anatomy.asOf('2026-11-22')).toBe('기준일: 2026-11-22');
    expect(S.anatomy.cutTitle('2', 82, 82)).toBe('2등급 컷 82점');
    // 4-5: 풀이 잠금 안내(학생 화면에는 아직 붙이지 않음)와 진행자용 화면의 한 줄. 시각 자리에는 그 항목의 end 가 들어간다.
    expect(S.solutionLock.notice(17, 45)).toBe('지금은 시험 시간이라 풀이는 잠시 쉬어요. 오후 5시 45분부터 다시 볼 수 있어요. 답 입력은 지금도 할 수 있어요.');
    expect(S_TEST.lockOpen).toBe('풀이 잠금: 지금 열림');
    expect(S_TEST.lockClosed(17, 45)).toBe('풀이 잠금: 지금 잠김(오후 5시 45분까지)');
  });
});

describe('문구 도우미', () => {
  it('문항 번호 나열', () => {
    expect(listNos([9])).toBe('9번');
    expect(listNos([15, 29])).toBe('15번과 29번');
    expect(listNos([14, 20, 21])).toBe('14번, 20번, 21번');
  });

  it('점수 범위는 물결표로 쓰고, 두 값이 같으면 한 숫자로 쓴다', () => {
    expect(rangePoints(6, 10)).toBe('6~10점');
    expect(rangePoints(4, 4)).toBe('4점');
  });

  it('날짜와 시각은 이 기기의 시간대로 적는다', () => {
    // 기대값을 실행하는 기기의 시간대로 계산한다(시간대가 달라도, 30분 단위 시간대여도 같은 테스트가 통과해야 한다).
    for (const iso of ['2026-11-22T03:05:09.000Z', '2026-11-22T23:59:59.000Z', '2026-01-01T00:00:00.000Z', '2026-06-30T12:30:45.000Z']) {
      const d = new Date(iso);
      expect(formatDate(iso)).toBe(`${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`);
      expect(formatTime(iso)).toBe(`${d.getHours()}시 ${d.getMinutes()}분`);
      expect(formatTime(iso, true)).toBe(`${d.getHours()}시 ${d.getMinutes()}분 ${d.getSeconds()}초`);
    }
    // 모양: 연월일, 시와 분(24시 기준), 초는 달라고 할 때만.
    expect(formatDate('2026-11-22T03:05:09.000Z')).toMatch(/^2026년 11월 2[123]일$/);
    expect(formatTime('2026-11-22T03:05:09.000Z')).toMatch(/^\d{1,2}시 \d{1,2}분$/);
    expect(formatTime('2026-11-22T03:05:09.000Z', true)).toMatch(/^\d{1,2}시 \d{1,2}분 9초$/);
    expect(formatDate('엉뚱한 값')).toBe('');
    expect(formatTime('엉뚱한 값')).toBe('');
    expect(formatTime('엉뚱한 값', true)).toBe('');
  });
});
