import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findExam } from './exams';
import { exampleAnswers } from './logic/example';
import { gradeExam } from './logic/scoring';
import { parseAnswerKey } from './state/testlog';
import type { Answers, Exam } from './types';

// 문서에 적은 숫자가 실제 계산과 맞는지 본다.

const guide = readFileSync(resolve(process.cwd(), 'docs/사용성테스트_진행안내.md'), 'utf8');
const keys = [...guide.matchAll(/붙여 넣을 답지: `([^`]+)`/g)].map((m) => m[1]!);

function gradeKey(exam: Exam, text: string) {
  const parsed = parseAnswerKey(exam, text);
  expect(parsed.ok).toBe(true);
  const answers: Answers = {};
  exam.items.forEach((it, i) => {
    answers[it.no] = parsed.values[i]!;
  });
  return { answers, grade: gradeExam(exam, { answers, marks: {}, causes: {} }) };
}

describe('사용성 테스트 진행 안내의 답지', () => {
  it('답지가 2개 있다', () => {
    expect(keys).toHaveLength(2);
  });

  it('답지 A는 검산 예시와 같은 응답이고 78점이다', () => {
    const exam = findExam('sample-a') as Exam;
    const { answers, grade } = gradeKey(exam, keys[0]!);
    expect(answers).toEqual(exampleAnswers(exam));
    expect(grade.actual).toBe(78);
  });

  it('답지 B는 안 푼 문항 2개를 포함하고 82점이다', () => {
    const exam = findExam('sample-b') as Exam;
    const { answers, grade } = gradeKey(exam, keys[1]!);
    expect(grade.actual).toBe(82);
    expect(Object.entries(answers).filter(([, v]) => v === 'skip').map(([k]) => Number(k))).toEqual([12, 21]);
    expect(grade.wrong.map((w) => w.no)).toEqual([7, 12, 17, 21, 30]);
  });

  it('손으로 적는 답지와 붙여 넣을 답지가 같다', () => {
    const blocks = [...guide.matchAll(/```\n(1번[\s\S]*?)```/g)].map((m) => m[1]!);
    expect(blocks).toHaveLength(2);
    blocks.forEach((block, i) => {
      const cells = [...block.matchAll(/(\d+)번 (안 풂|\d+)/g)].map((m) => (m[2] === '안 풂' ? 'x' : m[2]));
      expect(cells).toHaveLength(30);
      expect(cells.join(',')).toBe(keys[i]);
    });
  });
});

describe('결정 기록의 번호', () => {
  const record = readFileSync(resolve(process.cwd(), 'docs/결정기록.md'), 'utf8');
  const mine = record.slice(record.indexOf('## 2. 내가 정한 것'), record.indexOf('## 3. 제안'));
  const proposals = record.slice(record.indexOf('## 3. 제안'));
  const numbers = (text: string) => [...text.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));

  it('내가 정한 것은 1번부터 빠지거나 겹치는 번호가 없다', () => {
    const list = numbers(mine);
    expect(list.length).toBeGreaterThan(60);
    expect([...list].sort((a, b) => a - b)).toEqual(list.map((_, i) => i + 1));
  });

  it('제안은 1번부터 차례로 적혀 있다', () => {
    const list = numbers(proposals);
    expect(list.length).toBeGreaterThan(10);
    expect(list).toEqual(list.map((_, i) => i + 1));
  });

  it('내가 정한 것에 제안의 말투("~기."로 끝나는 문장)가 섞여 있지 않다', () => {
    // 제안은 "~하기."로 적고 내가 정한 것은 "~요."로 적는다. 항목을 고치다가 다른 묶음의 글로 덮어쓴 것을 잡는다.
    const lines = mine.split('\n').filter((l) => /^\d+\. /.test(l));
    const odd = lines.filter((l) => /기\.( |$)/.test(l));
    expect(odd).toEqual([]);
  });
});

