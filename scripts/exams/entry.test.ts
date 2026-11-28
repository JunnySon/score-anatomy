import { existsSync, linkSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateExam } from '../../src/exams/validate.ts';
import { ROOT, makeDataDir, removeDir, runTool } from './testkit.ts';

const ID = 'suneung-2027-math-probstat';
const HEADER = 'no,kind,choices,points,answer,typeId,memo';
let dir: string;
const sheetPath = (sheet: number) => join(dir, 'entry', ID + '.' + sheet + '.csv');
const output = () => join(dir, 'src', ID + '.json');
const run = (...args: string[]) => runTool(['entry', ...args, '--data', dir]);

beforeEach(() => {
  dir = makeDataDir();
  mkdirSync(join(dir, 'entry'));
});
afterEach(() => removeDir(dir));

// 임시 폴더에서만 쓰는 검사 전용 값이다. 실제 시험의 정답, 배점, 분류를 뜻하지 않는다.
function fixture(): string[][] {
  return Array.from({ length: 30 }, (_, i) => {
    const no = i + 1;
    const mc = no <= 15 || (no >= 23 && no <= 28);
    return [String(no), mc ? 'mc' : 'short', mc ? '5' : '', i < 10 ? '4' : '3', mc ? '1' : '0', 't01', ''];
  });
}

const csvCell = (value: string) => /[",\r\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
function save(sheet: number, rows: string[][], header = HEADER) {
  writeFileSync(sheetPath(sheet), '\uFEFF' + [header, ...rows.map(row => row.map(csvCell).join(','))].join('\r\n') + '\r\n');
}

describe('수능 두 번 입력 원본 만들기', () => {
  it('필수 세 칸이 모두 빈 두 입력지에서는 90개 누락을 알리고 원본을 만들지 않는다', () => {
    const blank = fixture().map(row => [...row.slice(0, 3), '', '', '', '']);
    save(1, blank);
    save(2, blank);
    const r = run();
    expect(r.status).toBe(1);
    const issues = r.stderr.trim().split(/\r?\n/);
    expect(issues).toHaveLength(90);
    for (let no = 1; no <= 30; no += 1) {
      for (const field of ['points', 'answer', 'typeId']) expect(issues.some(line => line.startsWith('두 입력지: ' + no + '번 자리 ' + field))).toBe(true);
    }
    expect(existsSync(output())).toBe(false);
  });

  it('실제 Node에서 일치한 두 장으로 규격에 맞는 1판을 만들고 메모와 예시 좌표, 등급컷을 제외한다', () => {
    const rows = fixture();
    rows[15][4] = '999';
    rows[22][4] = '5';
    rows[0][6] = '확실하지 않음, "재확인"\n검사 전용';
    save(1, rows);
    save(2, rows);
    // 서로 다른 편집기로 저장해 BOM과 줄바꿈이 달라도 셀 내용이 같으면 통과한다.
    writeFileSync(sheetPath(2), readFileSync(sheetPath(2), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'));
    const state = readFileSync(join(dir, 'state.json'));
    const r = run('짝수형');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('유형이 확실하지 않음: 1번');
    const text = readFileSync(output(), 'utf8');
    const exam = JSON.parse(text);
    expect(validateExam(exam)).toEqual([]);
    expect(exam).toMatchObject({ id: ID, title: '2027학년도 수능 수학(확률과 통계)', examDate: '2026-11-19', rev: 1, isPast: true, isSample: false, answerReleased: true });
    expect(exam.note).toContain('짝수형');
    expect(exam.items).toHaveLength(30);
    expect(exam.items[16]).toEqual({ no: 17, kind: 'short', points: 3, answer: 0, typeId: 't01' });
    expect(exam.items[22]).toMatchObject({ no: 23, kind: 'mc', choices: 5, answer: 5 });
    expect(exam).not.toHaveProperty('cuts');
    const reference = JSON.parse(readFileSync(join(ROOT, 'src/exams/sample-a.json'), 'utf8')).types as Record<string, { name: string }>;
    expect(exam.types).toEqual(Object.fromEntries(Object.entries(reference).map(([id, t]) => [id, { name: t.name }])));
    expect(text).not.toContain('확실하지 않음');
    expect(run('짝수형').stdout).toContain('이미 같은 원본');
    expect(runTool(['check', '--data', dir]).status).toBe(0);
    expect(readFileSync(join(dir, 'state.json'))).toEqual(state);
  });

  it('두 장의 번호, 점수, 정답, 유형과 메모 차이를 한 번에 표시하고 기존 원본을 보존한다', () => {
    const rows = fixture();
    save(1, rows);
    rows[0][0] = '2';
    rows[0][3] = '3';
    rows[0][4] = '01';
    rows[15][5] = 't08';
    rows[29][6] = '확실하지 않음';
    save(2, rows);
    writeFileSync(output(), '기존 파일');
    const r = run();
    expect(r.status).toBe(1);
    for (const s of ['1번 자리 no', '1번 자리 points', '1번 자리 answer', '16번 자리 typeId', '30번 자리 memo']) {
      expect(r.stderr).toContain(s + ' 다름');
    }
    expect(readFileSync(output(), 'utf8')).toBe('기존 파일');
  });

  it('두 장의 잘못이 같아도 필수 값과 문항 형식을 모두 검사하고 단답 정답 빈칸을 0으로 읽지 않는다', () => {
    const rows = fixture();
    rows[0][4] = '6';
    rows[1][3] = '-2';
    rows[2][5] = 'toString';
    rows[15][4] = '';
    rows[16][4] = '1000';
    rows[17][2] = '5';
    rows[22][1] = 'short';
    rows[23][2] = '';
    rows[29][0] = '29';
    save(1, rows);
    save(2, rows);
    const r = run();
    expect(r.status).toBe(1);
    for (const s of ['1번 자리 answer', '2번 자리 points', '3번 자리 typeId', '16번 자리 answer', '17번 자리 answer', '18번 자리 단답형', '23번 자리 kind', '24번 자리 choices', '30번 자리 no']) expect(r.stderr).toContain(s);
    expect(existsSync(output())).toBe(false);
  });

  it('배점 합계가 100이 아닌 입력을 거부한다', () => {
    const rows = fixture();
    rows[29][3] = '2';
    save(1, rows);
    save(2, rows);
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('99점');
    expect(existsSync(output())).toBe(false);
  });

  it('행 누락, 열 누락과 틀린 머리글을 알려 주고 쓰지 않는다', () => {
    const rows = fixture();
    save(1, rows);
    rows.pop();
    rows[0].pop();
    save(2, rows, HEADER.replace('answer', 'ans'));
    const r = run();
    expect(r.status).toBe(1);
    for (const s of ['머리글 answer 다름', '1번 자리 memo 다름', '30번 자리 no 다름', '30번 자리 행이 없어요']) expect(r.stderr).toContain(s);
    expect(existsSync(output())).toBe(false);
  });

  it('두 장을 모두 읽어야 하며 깨진 CSV나 UTF-8은 거부한다', () => {
    save(1, fixture());
    expect(run().status).toBe(1);
    writeFileSync(sheetPath(2), '"닫히지 않은 값');
    expect(run().stderr).toContain('따옴표');
    writeFileSync(sheetPath(2), Buffer.from([0xc3, 0x28]));
    expect(run().status).toBe(1);
    expect(existsSync(output())).toBe(false);
  });

  it('두 이름이 같은 실제 파일을 가리키면 독립 입력으로 인정하지 않는다', () => {
    save(1, fixture());
    linkSync(sheetPath(1), sheetPath(2));
    expect(run().stderr).toContain('같은 파일');
    expect(existsSync(output())).toBe(false);
  });

  it('이미 내용이 다른 원본을 덮어쓰지 않는다', () => {
    save(1, fixture());
    save(2, fixture());
    writeFileSync(output(), '앞 판의 원본');
    expect(run().status).toBe(1);
    expect(readFileSync(output(), 'utf8')).toBe('앞 판의 원본');
  });
});
