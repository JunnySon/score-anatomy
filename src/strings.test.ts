import { describe, expect, it } from 'vitest';
import { formatDate, listNos, rangePoints, S } from './strings';

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
    expect(S.common.approx(75)).toBe('약 75점');
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
      '없어요',
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
      '이번에도 답이 달랐어요. 이 유형을 계단에 남겨 둘게요.',
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
    expect(S.input.nextPage(5)).toBe('다음 5문항');
    expect(S.anatomy.rowGuessSub(78)).toBe('78점 안에 들어 있어요');
    expect(S.anatomy.rowSlipSub(78)).toBe('78점에는 들어 있지 않아요');
    expect(S.anatomy.emptyMarks(78)).toBe('표시한 문항이 없어서 나눠 볼 것이 없어요. 78점 그대로예요.');
    expect(S.anatomy.cutTitle('2', 81, 85)).toBe('2등급 컷 81~85점');
    expect(S.anatomy.luckDetail(78)).toBe('찍었다고 표시한 문항을 운이 보통이었을 때로 다시 계산한 점수예요. 실제 점수는 78점 그대로예요.');
    expect(S.anatomy.toSteps(2)).toBe('고칠 것 2가지 보기');
    expect(S.steps.title(2)).toBe('먼저 고칠 2가지');
    expect(S.steps.todoToday([15, 29])).toBe('오늘 시험지의 15번과 29번을 다시 풀기');
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

  it('날짜', () => {
    expect(formatDate('2026-11-22T03:00:00.000Z')).toMatch(/^2026년 11월 2[23]일$/);
    expect(formatDate('엉뚱한 값')).toBe('');
  });
});
