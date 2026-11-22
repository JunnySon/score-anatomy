import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { findExam } from '../exams';
import { exampleAnswers, exampleCauses, exampleMarks } from '../logic/example';
import { gradeExam } from '../logic/scoring';
import type { SessionHandle } from '../state/hooks';
import { newSession } from '../state/session';
import type { Causes as CauseMap, Exam, Marks as MarkMap, Session } from '../types';
import { Anatomy } from './Anatomy';
import { Causes } from './Causes';
import { Retry } from './Retry';
import { Score } from './Score';
import { Steps } from './Steps';

// 화면을 글자로 그려서(서버 렌더링) 드문 상태의 문구를 확인한다.
// 브라우저에서의 모양은 e2e 화면 검사가 본다.

const examA = findExam('sample-a') as Exam;
const NOW = '2026-11-22T10:00:00.000Z';

function handleFor(exam: Exam, marks: MarkMap, causes: CauseMap, more: Partial<Session> = {}): SessionHandle {
  const session: Session = {
    ...newSession(exam.id, 'not_yet', null, NOW),
    answers: exampleAnswers(examA),
    marks,
    causes,
    gradedAt: NOW,
    firstGradedAt: NOW,
    ...more,
  };
  return { isDemo: false, session, exam, update: () => undefined, path: (p) => p };
}

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function anatomy(h: SessionHandle): string {
  return renderToStaticMarkup(<Anatomy h={h} grade={gradeExam(h.exam, h.session)} />);
}

describe('점수 해부 화면의 상태별 문구', () => {
  it('검산 예시: 표시 행 두 줄과 문장, 막대 설명 라벨', () => {
    const html = anatomy(handleFor(examA, exampleMarks(), exampleCauses(), { targetGrade: '2' }));
    const t = text(html);
    expect(t).toContain('78점 30문항 가운데 24문항을 맞혔어요.');
    expect(t).toContain('추측했다고 표시한 정답 7점 78점 안에 들어 있어요');
    expect(t).toContain('실수라고 표시한 오답 8점 78점에는 들어 있지 않아요');
    expect(t).toContain('78점 가운데 7점은 찍었다고 표시한 문항에서 나왔어요. 틀린 22점 가운데 8점은 실수라고 표시했어요.');
    expect(t).toContain('2등급 컷 81~85점');
    expect(t).toContain('실제 78점 기준 3~7점 남았어요');
    expect(t).toContain('찍기 운을 평균으로 보면 약 75점, 그 기준으로는 6~10점이에요 추정');
    expect(html).toContain('aria-label="100점 막대. 표시 없이 맞힌 점수 71점, 추측했다고 표시한 정답 7점, 실수라고 표시한 오답 8점, 그 외 오답 14점."');
    // 주 숫자는 하나뿐이다.
    expect(html.match(/class="hero/g)).toHaveLength(1);
    // 쓰지 않기로 한 표현이 없다.
    for (const banned of ['진짜 점수', '풀어서 맞힌', '잠재 점수']) expect(t).not.toContain(banned);
    // 틀린 문항의 정답은 어디에도 없다.
    expect(html).not.toContain('164');
    expect(html).not.toContain('257');
  });

  it('컷 자료가 없으면 기다린다고 알린다', () => {
    const noCuts: Exam = { ...examA, cuts: undefined };
    const html = anatomy(handleFor(noCuts, exampleMarks(), exampleCauses(), { targetGrade: '2' }));
    expect(text(html)).toContain('등급컷 자료를 기다리고 있어요. 점수와 고칠 것은 지금 볼 수 있어요.');
    expect(html).not.toContain('data-testid="grade-');
    expect(html).not.toContain('어디까지 가는 계단을 볼까요?');
    expect(text(html)).not.toContain('약 75점');
  });

  it('표시도 원인도 없으면: 나눠 볼 것이 없다는 문구와 원인 화면 링크, 0점이라고 쓰지 않는다', () => {
    const html = anatomy(handleFor(examA, {}, {}));
    const t = text(html);
    expect(t).toContain('표시한 문항이 없어서 나눠 볼 것이 없어요. 78점 그대로예요.');
    expect(t).toContain('아직 원인을 표시하지 않았어요');
    expect(html).toContain('href="#/causes"');
    expect(t).not.toContain('0점');
    // 막대의 설명 라벨도 값이 없는 구간은 말하지 않는다.
    expect(html).toContain('aria-label="100점 막대. 표시 없이 맞힌 점수 78점, 오답 22점."');
  });

  it('표시는 없고 원인만 골랐으면: 실수 행은 보이고 "나눠 볼 것이 없어요"라고 하지 않는다', () => {
    const t = text(anatomy(handleFor(examA, {}, exampleCauses())));
    expect(t).toContain('찍었다고 표시한 문항이 없어요. 78점 그대로예요.');
    expect(t).toContain('실수라고 표시한 오답 8점 78점에는 들어 있지 않아요');
    expect(t).toContain('틀린 22점 가운데 8점은 실수라고 표시했어요.');
    expect(t).not.toContain('나눠 볼 것이 없어요');
  });

  it('고민 표시만 있으면 찍었다고 표시한 문항이 없다고 적는다', () => {
    const t = text(anatomy(handleFor(examA, { 3: 'doubt', 25: 'unsure' }, {})));
    expect(t).toContain('찍었다고 표시한 문항이 없어서 나눠 볼 것이 없어요. 78점 그대로예요.');
  });

  it('찍음 표시가 모두 틀린 문항이면 0점 숫자 대신 사실을 적는다', () => {
    const t = text(anatomy(handleFor(examA, { 11: 'guess', 20: 'guess' }, exampleCauses(), { targetGrade: '2' })));
    expect(t).toContain('찍었다고 표시한 문항에서 나온 점수는 없어요.');
    expect(t).not.toContain('추측했다고 표시한 정답 0점');
    // 78 - 0 + 0.2 x 7 = 79.4, 화면에는 약 79점. 2등급 컷 81~85까지 2~6점.
    expect(t).toContain('찍기 운을 평균으로 보면 약 79점, 그 기준으로는 2~6점이에요');
  });

  it('원인을 일부만 골랐으면 남은 문항 수와 링크를 보여 준다', () => {
    const t = text(anatomy(handleFor(examA, exampleMarks(), { 15: 'slip', 29: 'slip' })));
    expect(t).toContain('실수라고 표시한 오답 8점');
    expect(t).toContain('원인을 표시하지 않은 문항이 4개 있어요');
  });

  it('원인을 모두 골랐는데 실수가 없으면 그 사실을 적는다', () => {
    const causes: CauseMap = { 11: 'blank', 15: 'blank', 20: 'unknown', 21: 'blank', 27: 'blank', 29: 'unknown' };
    const t = text(anatomy(handleFor(examA, exampleMarks(), causes)));
    expect(t).toContain('실수라고 표시한 오답이 없어요');
    expect(t).not.toContain('실수라고 표시한 오답 0점');
  });

  it('채점한 뒤 표시와 채점한 뒤 답 고침을 작게 적는다', () => {
    const t = text(anatomy(handleFor(examA, exampleMarks(), exampleCauses(), { gradedBefore: 'already', answersEditedAfterGrading: [3, 11] })));
    expect(t).toContain('채점한 뒤에 표시한 기록이에요');
    expect(t).toContain('채점한 뒤에 답을 고친 문항: 3번과 11번');
  });
});

describe('그 밖의 화면', () => {
  it('점수 화면: 주 숫자와 한 문장, 평가하는 말이 없다', () => {
    const h = handleFor(examA, exampleMarks(), {});
    const t = text(renderToStaticMarkup(<Score h={h} grade={gradeExam(h.exam, h.session)} />));
    expect(t).toContain('78점 30문항 가운데 24문항을 맞혔어요.');
    expect(t).toContain('틀린 문항 살펴보기');
    expect(t).toContain('점수 해부 바로 보기');
    expect(t).toContain('입력 고치기');
  });

  it('오답 원인 화면: 정답 보기를 누르기 전에는 정답이 없고, 누른 문항만 정답이 나온다', () => {
    const before = handleFor(examA, exampleMarks(), {});
    const html = renderToStaticMarkup(<Causes h={before} grade={gradeExam(before.exam, before.session)} />);
    expect(html).not.toContain('164');
    expect(html).not.toContain('257');
    expect(text(html)).not.toMatch(/정답 \d/);
    expect(text(html)).toContain('내 답 146');
    const after = handleFor(examA, exampleMarks(), {}, { answerViewed: { 27: true } });
    const html2 = renderToStaticMarkup(<Causes h={after} grade={gradeExam(after.exam, after.session)} />);
    expect(text(html2)).toContain('정답 164 정답 확인함');
    expect(html2).not.toContain('257');
  });

  it('계단 화면: 예시 좌표 배지와 할 일, 재풀이 기록 라벨', () => {
    const h = handleFor(examA, exampleMarks(), exampleCauses(), {
      retries: {
        14: { correct: true, attempts: 1, firstCorrectAttempt: 1, answerKnown: false, at: NOW },
        15: { correct: true, attempts: 2, firstCorrectAttempt: 1, answerKnown: false, at: NOW },
        20: { correct: true, attempts: 3, firstCorrectAttempt: 3, answerKnown: false, at: NOW },
        29: { correct: false, attempts: 1, firstCorrectAttempt: null, answerKnown: false, at: NOW },
      },
    });
    const t = text(renderToStaticMarkup(<Steps h={h} grade={gradeExam(h.exam, h.session)} />));
    expect(t).toContain('먼저 고칠 3가지');
    expect(t).toContain('1. 적분 놓친 배점 8점');
    expect(t).toContain('오늘 시험지의 14번, 20번, 21번을 다시 풀기');
    expect(t).toContain('예시 좌표 12번');
    expect(t).toContain('14번: 다시 풀어 맞힘');
    expect(t).toContain('15번: 실수로 표시함, 다시 풀어 맞힘');
    // 세 번째에 맞힌 문항도 라벨은 지시서의 세 가지 가운데 하나다.
    expect(t).toContain('20번: 다시 풀어 맞힘');
    expect(t).not.toContain('번째에 맞힘');
    expect(t).toContain('29번: 다시 풀었지만 답이 다름');
    expect(t).not.toContain('실수 확인');
  });

  it('재풀이 화면: 없는 유형이면 다시 풀 문항이 없다고 알린다', () => {
    const h = handleFor(examA, exampleMarks(), exampleCauses());
    const t = text(renderToStaticMarkup(<Retry h={h} grade={gradeExam(h.exam, h.session)} typeId="nope" />));
    expect(t).toContain('다시 풀 문항이 없어요.');
  });
});
