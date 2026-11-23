import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateLocks } from '../../src/exams/validate.ts';
import { canonicalJson } from './canonical.ts';
import { main, parseArgs } from './cli.ts';
import { listSourceFiles, sourceJson, withKey } from './data.ts';
import { parseState, ro, stateText } from './state.ts';
import { ROOT, collectIo, makeDataDir, removeDir, runTool } from './testkit.ts';

// 발행 도구의 바탕(작업 지시서 3의 6-1, 6-4): 자료 폴더의 처음 모양, 키를 정렬한 JSON, 원본 시험 파일의 모양, 명령과 인자,
// 그리고 Node 가 타입 지우기로 바로 읽을 수 있는 TypeScript 인지(상대 경로는 '.ts' 까지, 타입만 가져올 때는 import type 문).

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) removeDir(dir);
});

const rel = (p: string) => relative(ROOT, p).split('\\').join('/');

/** 줄 머리가 주석인 줄을 뺀 글자(주석에 적은 설명이 검사에 걸리지 않게). */
function codeLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
    .join('\n');
}

interface ImportDecl {
  /** import type 문인지. */
  typeOnly: boolean;
  /** 중괄호 안의 이름들. 없으면 null(기본 가져오기, 이름공간, 부수 효과). */
  names: string[] | null;
  /** 중괄호 안에 "type X" 처럼 적은 것이 있는지. */
  inlineType: boolean;
  specifier: string;
}

/** 소스의 정적 import 와 export from, 동적 import 를 찾는다. */
function importsOf(source: string): ImportDecl[] {
  const code = codeLines(source);
  const out: ImportDecl[] = [];
  for (const m of code.matchAll(/^\s*(?:import|export)\s+(type\s+)?([^;]*?)\s*from\s*'([^']+)'/gm)) {
    const clause = m[2];
    const braces = /\{([^}]*)\}/.exec(clause);
    const parts = braces ? braces[1].split(',').map((s) => s.trim()).filter(Boolean) : null;
    out.push({
      typeOnly: Boolean(m[1]),
      names: parts ? parts.map((p) => p.replace(/^type\s+/, '').split(/\s+as\s+/)[0]) : null,
      inlineType: parts ? parts.some((p) => /^type\s/.test(p)) : false,
      specifier: m[3],
    });
  }
  for (const m of code.matchAll(/^\s*import\s+'([^']+)'/gm)) out.push({ typeOnly: false, names: null, inlineType: false, specifier: m[1] });
  for (const m of code.matchAll(/\bimport\(\s*'([^']+)'\s*\)/g)) out.push({ typeOnly: false, names: null, inlineType: false, specifier: m[1] });
  return out;
}

/** 타입을 지운 소스에서 실행할 때 있는 이름(내보낸 함수, 값, 클래스)을 찾는다. 인터페이스와 타입은 지워져서 없다. */
function runtimeExports(file: string): Set<string> {
  const js = stripTypeScriptTypes(readFileSync(file, 'utf8'));
  const names = new Set<string>();
  for (const m of js.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of js.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name) names.add(name);
    }
  }
  return names;
}

/** 발행 도구가 Node 로 읽는 TypeScript 파일: scripts/exams 의 테스트가 아닌 파일과, 거기서 값으로 가져오는 파일을 따라간 것. */
function toolFiles(): string[] {
  const start = readdirSync(join(ROOT, 'scripts/exams'))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => join(ROOT, 'scripts/exams', f));
  const seen = new Set<string>();
  const queue = [...start];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const d of importsOf(readFileSync(file, 'utf8'))) {
      if (!d.typeOnly && d.specifier.startsWith('.')) queue.push(resolve(dirname(file), d.specifier));
    }
  }
  return [...seen].sort();
}

describe('발행 도구 폴더와 바탕(작업 지시서 3의 6-1, 6-4)', () => {
  it('자료 폴더 exam-data 의 처음 모양: src(자리 파일), locks.json(검사 통과), state.json(처음 값의 정렬한 JSON), 발행 결과물은 커밋하지 않음', () => {
    const data = join(ROOT, 'exam-data');
    expect(existsSync(join(data, 'src/README.md'))).toBe(true);
    expect(listSourceFiles(data)).not.toBeNull();
    expect(validateLocks(JSON.parse(readFileSync(join(data, 'locks.json'), 'utf8')))).toEqual([]);
    const text = readFileSync(join(data, 'state.json'), 'utf8');
    const parsed = parseState(JSON.parse(text));
    expect(parsed.errors).toEqual([]);
    expect(parsed.state).not.toBeNull();
    if (parsed.state) expect(stateText(parsed.state)).toBe(text);
    const lines = (path: string) => readFileSync(join(ROOT, path), 'utf8').split(/\r?\n/);
    expect(lines('.gitignore')).toContain('dist-exams/');
    expect(lines('.gitattributes')).toContain('exam-data/testdata/** -text');
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    for (const cmd of ['check']) expect(pkg.scripts[`exams:${cmd}`]).toBe(`node scripts/exams.mjs ${cmd}`);
  });

  it('키를 정렬한 JSON 은 2칸 들여쓰기, LF, 끝 줄바꿈이고 키 차례가 달라도 같은 바이트다', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: true, y: null }], c: 'x' }, e: [], f: {}, g: undefined })).toBe(
      '{\n  "a": {\n    "c": "x",\n    "d": [\n      1,\n      {\n        "y": null,\n        "z": true\n      }\n    ]\n  },\n  "b": 1,\n  "e": [],\n  "f": {}\n}\n',
    );
    expect(canonicalJson({ x: 1, y: [2, 3] })).toBe(canonicalJson({ y: [2, 3], x: 1 }));
    // 숫자 모양의 키도 글자로 정렬한다("10" 이 "9" 앞).
    expect(canonicalJson({ 9: 'a', 10: 'b' })).toBe('{\n  "10": "b",\n  "9": "a"\n}\n');
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
    // 예시 시험 A로 견주면 키를 정렬해 2칸으로 적은 JSON.stringify 와 같다.
    const sample = JSON.parse(readFileSync(join(ROOT, 'src/exams/sample-a.json'), 'utf8')) as unknown;
    const sortDeep = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(sortDeep)
        : typeof v === 'object' && v !== null
          ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep((v as Record<string, unknown>)[k])]))
          : v;
    expect(canonicalJson(sample)).toBe(`${JSON.stringify(sortDeep(sample), null, 2)}\n`);
  });

  it('원본 시험 파일의 모양은 예시 시험 파일을 바이트 그대로 다시 쓰고, 새 칸은 정한 자리에 넣는다', () => {
    for (const name of ['sample-a', 'sample-b', 'sample-c']) {
      const text = readFileSync(join(ROOT, `src/exams/${name}.json`), 'utf8');
      expect(sourceJson(JSON.parse(text)), name).toBe(text);
    }
    const item = { no: 1, kind: 'mc', choices: 5, points: 2, typeId: 't01' };
    expect(Object.keys(withKey(item, 'answer', 3, ['no', 'kind', 'choices', 'points']))).toEqual(['no', 'kind', 'choices', 'points', 'answer', 'typeId']);
    expect(Object.keys(withKey({ ...item, answer: 3 }, 'answer', undefined, []))).toEqual(['no', 'kind', 'choices', 'points', 'typeId']);
    expect(withKey({ ...item, answer: 3 }, 'answer', 4, [])).toEqual({ ...item, answer: 4 });
    expect(Object.keys(withKey(item, 'x', 1, ['nothing']))).toEqual(['no', 'kind', 'choices', 'points', 'typeId', 'x']);
    expect(ro(1)).toBe('1로');
    expect(ro(3)).toBe('3으로');
    expect(ro(10)).toBe('10으로');
  });

  it('도구가 닿는 TypeScript 파일은 상대 경로를 .ts 까지 적고, 타입만 가져올 때는 import type 문을 쓰고, Node 의 타입 지우기로 읽힌다', () => {
    const files = toolFiles();
    const names = files.map(rel);
    // 앱의 검사 규칙을 두 벌로 만들지 않고 그대로 가져온다.
    expect(names).toContain('src/exams/validate.ts');
    expect(names).toContain('src/logic/dates.ts');
    expect(names).toContain('scripts/exams/cli.ts');
    const problems: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const at = rel(file);
      try {
        // enum, namespace, 생성자 매개변수 속성, <T>값 모양의 형 변환이 있으면 던진다.
        stripTypeScriptTypes(source);
      } catch (e) {
        problems.push(`${at}: 타입 지우기로 읽지 못해요(${(e as { code?: string }).code ?? '오류'}).`);
      }
      const code = codeLines(source);
      if (/__SA_TOOLS__/.test(code)) problems.push(`${at}: __SA_TOOLS__ 를 써요.`);
      if (/import\.meta\.env/.test(code)) problems.push(`${at}: import.meta.env 를 써요.`);
      for (const d of importsOf(source)) {
        if (d.specifier.startsWith('#')) problems.push(`${at}: 별칭 '${d.specifier}' 를 가져와요.`);
        if (d.specifier.endsWith('.json')) problems.push(`${at}: JSON 을 import 해요(${d.specifier}).`);
        if (!d.specifier.startsWith('.')) continue;
        if (!d.specifier.endsWith('.ts')) problems.push(`${at}: 상대 경로가 .ts 로 끝나지 않아요(${d.specifier}).`);
        if (d.inlineType) problems.push(`${at}: 중괄호 안에 type 을 적었어요. 타입은 import type 문으로 가져와요(${d.specifier}).`);
        if (d.typeOnly || d.names === null) continue;
        const target = resolve(dirname(file), d.specifier);
        if (!existsSync(target)) {
          problems.push(`${at}: 가져오는 파일이 없어요(${d.specifier}).`);
          continue;
        }
        const exported = runtimeExports(target);
        for (const name of d.names) if (!exported.has(name)) problems.push(`${at}: ${name} 은 ${d.specifier} 에서 실행할 때 있는 값이 아니에요(타입이면 import type 으로).`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('Node 가 타입 지우기를 하지 못하면 Node 22.18 이상이 필요하다고 알리고 끝낸다', () => {
    const run = runTool(['check'], ['--no-experimental-strip-types']);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('Node 22.18 이상이 필요해요.');
    expect(run.stdout).toBe('');
  });

  it('명령과 인자: 사용법, 아직 만들지 않은 명령, 모르는 명령과 선택지, 인자 수', async () => {
    const run = async (argv: string[]) => {
      const c = collectIo();
      const code = await main(argv, c.io);
      return { code, out: c.out, err: c.err };
    };
    const none = await run([]);
    expect(none.code).toBe(2);
    expect(none.err[0]).toBe('사용법: node scripts/exams.mjs <명령> [인자] [--data <자료 폴더>] [--out <발행 폴더>]');
    expect((await run(['help'])).code).toBe(0);
    for (const cmd of ['publish', 'verify', 'keygen', 'serve']) {
      const r = await run([cmd]);
      expect(r.code).toBe(2);
      expect(r.err).toEqual([`${cmd} 는 아직 만들지 않은 명령이에요(작업 지시서 3의 6-4, 다음 단계에서 더해요).`]);
    }
    expect((await run(['nope'])).err[0]).toBe('모르는 명령이에요: nope');
    expect((await run(['check', '--note', '테스트 전용 정정 안내예요.'])).err).toEqual(['check 에는 --note 를 쓰지 않아요.']);
    expect((await run(['check', '--bogus'])).err).toEqual(['모르는 선택지예요: --bogus']);
    expect((await run(['check', '--data'])).err).toEqual(['--data 다음에 값을 적어 주세요.']);
    expect(parseArgs(['answers', '--data=d', 'a', '--', '--b'])).toEqual({ command: 'answers', args: ['a', '--b'], options: { data: 'd' }, errors: [] });
    const dir = makeDataDir();
    dirs.push(dir);
    const ok = await run(['check', '--data', dir]);
    expect(ok.code).toBe(0);
    expect(ok.out[ok.out.length - 1]).toBe('결과: 검사를 통과했어요. 이 검사는 파일을 쓰지 않아요.');
  });

  it('npm run exams:check 와 같은 길(node scripts/exams.mjs)로 빈 자료 폴더를 검사하면 통과한다', () => {
    const dir = makeDataDir();
    dirs.push(dir);
    const run = runTool(['check', '--data', dir]);
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout.split(/\r?\n/)).toEqual([
      `시험 자료를 검사해요: ${dir}`,
      '아직 발행한 적이 없어요(seq 0).',
      'src 폴더에 시험 파일(*.json)이 없어요.',
      '잠금 달력(locks.json): 항목 0개, 아직 발행한 적이 없어요.',
      '알림 0개',
      '거부 0개',
      '결과: 검사를 통과했어요. 이 검사는 파일을 쓰지 않아요.',
      '',
    ]);
  });
});
