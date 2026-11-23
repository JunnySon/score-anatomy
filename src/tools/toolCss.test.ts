import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// 사용성 테스트 도구 화면(5행 방식, 진행자용 화면, "준비 중인 기능")의 모양(CSS)과 앱 배포용 묶음.
// 배포용 묶음은 도구 모듈(src/tools/full.ts)을 빈 모듈(none.ts)로 바꿔 빌드해서, 도구 모듈만 불러오는 CSS 파일도 묶음에서 빠진다.
// 그 파일에 일반 화면이 쓰는 클래스의 규칙이 들어가면 배포용 묶음에서만 그 규칙이 빠져 화면이 모양 없이 그려진다
// (작업 지시서 1 때 옮긴 규칙에서 생긴 결함을 작업 지시서 3의 3부 앞에서 고쳤다, docs/결정기록.md 6장).
// 그래서 소스를 읽어 도구 모듈만 불러오는 CSS 파일을 찾고, 그 파일의 규칙이 도구 모듈만 쓰는 클래스에만 걸리는지 본다.
// 화면에서 실제 모양을 견주는 검사는 e2e/appStyle.spec.ts 에 있다.

const ROOT = process.cwd();
const rel = (p: string) => relative(ROOT, p).split(sep).join('/');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');

/** src 아래의 모듈(테스트 파일 빼고). */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [rel(full)] : [];
  });
}

/**
 * 빌드 설정(vite.config.ts)의 별칭. 앱 배포용 묶음(app-release)만 #tools 를 빈 모듈로 바꾸고,
 * 시험용 묶음(app-test)은 도구 모듈을 싣는다. 두 앱 묶음은 같은 다리(app.ts)와 시스템 글꼴을 쓴다.
 */
const ALIASES = {
  release: { '#tools': 'src/tools/none.ts', '#platform': 'src/platform/app.ts', '#font': 'src/styles/font-system.css' },
  test: { '#tools': 'src/tools/full.ts', '#platform': 'src/platform/app.ts', '#font': 'src/styles/font-system.css' },
} as const;

/** 모듈이 불러오는 파일(타입만 가져오는 import type 은 묶음에 아무것도 싣지 않아 뺀다). */
function importsOf(file: string, aliases: Record<string, string>, files: Set<string>): string[] {
  const code = read(file);
  const specs = [
    ...[...code.matchAll(/^\s*import\s+(?!type\s)[^'";]*?\s+from\s+'([^']+)'/gm)].map((m) => m[1]!),
    ...[...code.matchAll(/^\s*import\s+'([^']+)'/gm)].map((m) => m[1]!),
    ...[...code.matchAll(/^\s*export\s+(?!type\s)[^'";]*?\s+from\s+'([^']+)'/gm)].map((m) => m[1]!),
  ];
  const out: string[] = [];
  for (const spec of specs) {
    if (spec in aliases) {
      out.push(aliases[spec]!);
      continue;
    }
    if (!spec.startsWith('.')) continue;
    const base = rel(resolve(ROOT, dirname(file), spec));
    const found = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((c) => files.has(c));
    if (found) out.push(found);
  }
  return out;
}

/** src/main.tsx 에서 닿는 모듈과 CSS 파일 전부(묶음에 실리는 것). */
function reachable(aliases: Record<string, string>, files: Set<string>): Set<string> {
  const seen = new Set<string>();
  const queue = ['src/main.tsx'];
  while (queue.length > 0) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    if (/\.tsx?$/.test(f)) queue.push(...importsOf(f, aliases, files));
  }
  return seen;
}

/** CSS 규칙의 선택자(주석을 빼고 @media 안까지)와 @keyframes 이름, animation 이 쓰는 이름. */
function cssOf(css: string): { selectors: string[]; keyframes: string[]; animations: string[] } {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors: string[] = [];
  const keyframes: string[] = [];
  const animations = [...src.matchAll(/animation(?:-name)?\s*:\s*([\w-]+)/g)].map((m) => m[1]!);
  const walk = (text: string) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth += 1;
        else if (text[j] === '}') depth -= 1;
        j += 1;
      }
      const head = text.slice(i, open).trim();
      const body = text.slice(open + 1, j - 1);
      if (head.startsWith('@keyframes')) keyframes.push(head.replace('@keyframes', '').trim());
      else if (head.startsWith('@')) walk(body);
      else if (head) selectors.push(...head.split(',').map((s) => s.trim()));
      i = j;
    }
  };
  walk(src);
  return { selectors, keyframes, animations };
}

const classesInSelector = (sel: string) => [...sel.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]!);

/**
 * 글자 조각을 모은다: 따옴표 글자, 템플릿 글자의 고정 부분, ${...} 안의 글자까지.
 * 템플릿에서 ${ 바로 앞의 조각이 '-' 나 '_' 로 끝나면('seg--${kind}') 이름을 조각으로 만드는 곳이라 prefix 로 따로 모은다.
 */
function literalPieces(expr: string): { words: string[]; prefixes: string[] } {
  const words: string[] = [];
  const prefixes: string[] = [];
  let i = 0;
  const push = (s: string) => words.push(...s.split(/\s+/).filter(Boolean));
  // 코드 자리를 읽다가 끝 글자(end)를 만나면 멈춘다. 글자 안으로 들어가면 그 글자를 끝까지 읽는다.
  const code = (end: string | null) => {
    let depth = 0;
    while (i < expr.length) {
      const c = expr[i]!;
      if (c === "'" || c === '"') {
        const close = expr.indexOf(c, i + 1);
        push(expr.slice(i + 1, close < 0 ? expr.length : close));
        i = close < 0 ? expr.length : close + 1;
      } else if (c === '`') {
        i += 1;
        template();
      } else if (c === '{') {
        depth += 1;
        i += 1;
      } else if (c === '}') {
        if (depth === 0 && end === '}') return;
        depth -= 1;
        i += 1;
      } else i += 1;
    }
  };
  const template = () => {
    let buf = '';
    while (i < expr.length) {
      const c = expr[i]!;
      if (c === '`') {
        push(buf);
        i += 1;
        return;
      }
      if (c === '$' && expr[i + 1] === '{') {
        const last = buf.split(/\s+/).pop() ?? '';
        if (/[-_]$/.test(last)) prefixes.push(last);
        push(buf);
        buf = '';
        i += 2;
        code('}');
        i += 1;
        continue;
      }
      buf += c;
      i += 1;
    }
    push(buf);
  };
  code(null);
  return { words, prefixes };
}

/** 모듈이 요소에 붙이는 클래스(JSX 의 className 과 bodyClass, DOM 의 className 과 classList). known 은 CSS 에 있는 클래스. */
function classesUsedBy(file: string, known: readonly string[]): Set<string> {
  const src = read(file);
  const exprs: string[] = [];
  for (const m of src.matchAll(/\b(?:className|bodyClass)=/g)) {
    let i = m.index + m[0].length;
    const q = src[i];
    if (q === '"' || q === "'") {
      exprs.push(src.slice(i, src.indexOf(q, i + 1) + 1));
      continue;
    }
    if (q !== '{') continue;
    const start = i;
    let depth = 0;
    for (; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    exprs.push(src.slice(start, i + 1));
  }
  for (const m of src.matchAll(/\.className\s*=\s*([^;\n]+)|classList\.(?:add|toggle|remove|replace)\(([^)]*)\)/g)) exprs.push(m[1] ?? m[2] ?? '');
  const used = new Set<string>();
  for (const e of exprs) {
    const { words, prefixes } = literalPieces(e);
    for (const w of words) used.add(w);
    for (const p of prefixes) for (const c of known) if (c.startsWith(p)) used.add(c);
  }
  return used;
}

const files = new Set(sourceFiles(resolve(ROOT, 'src')));
const releaseSet = reachable(ALIASES.release, files);
const testSet = reachable(ALIASES.test, files);
/** 시험용 묶음에만 실리는 모듈과 CSS 파일(도구 모듈과 그것만 불러오는 것). */
const toolOnly = [...testSet].filter((f) => !releaseSet.has(f)).sort();
const toolCss = toolOnly.filter((f) => f.endsWith('.css'));
const toolModules = toolOnly.filter((f) => /\.tsx?$/.test(f));
const releaseCss = [...releaseSet].filter((f) => f.endsWith('.css')).sort();
const releaseModules = [...releaseSet].filter((f) => /\.tsx?$/.test(f)).sort();
const allClasses = [...new Set([...files].filter((f) => f.endsWith('.css')).flatMap((f) => cssOf(read(f)).selectors.flatMap(classesInSelector)))];

describe('도구 화면의 CSS 와 앱 배포용 묶음', () => {
  it('빌드 설정대로 시험용 묶음에만 실리는 도구 모듈과 CSS 파일을 찾는다', () => {
    const vite = read('vite.config.ts');
    expect(vite).toContain("const withTools = mode !== 'app-release';");
    expect(vite).toContain("const toolsFile = withTools ? './src/tools/full.ts' : './src/tools/none.ts';");
    expect(toolModules).toEqual(expect.arrayContaining(['src/screens/HistoryExtras.tsx', 'src/screens/InputRows.tsx', 'src/screens/TestAdmin.tsx', 'src/tools/full.ts']));
    expect(toolCss).toEqual(expect.arrayContaining(['src/screens/HistoryExtras.css', 'src/screens/InputRows.css', 'src/screens/TestAdmin.css']));
    // 배포용 묶음에도 실리는 것: 일반 화면과 공통 부품, 일반 화면의 CSS.
    expect(releaseModules).toEqual(expect.arrayContaining(['src/App.tsx', 'src/components/ScoreBar.tsx', 'src/components/ui.tsx', 'src/screens/Anatomy.tsx', 'src/screens/History.tsx', 'src/screens/Marks.tsx', 'src/screens/Review.tsx']));
    expect(releaseCss).toEqual(expect.arrayContaining(['src/styles/app.css', 'src/styles/tokens.css']));
    expect(releaseModules.length).toBeGreaterThan(30);
  });

  it('className 을 읽는 도구는 조건부 클래스, 템플릿 글자, 앞부분에 값을 붙여 만드는 이름(seg-- 뒤의 무늬 이름), bodyClass 를 찾는다', () => {
    const marks = classesUsedBy('src/screens/Marks.tsx', allClasses);
    for (const c of ['grid5', 'mark-cell', 'mark-cell--guess', 'mark-cell--doubt', 'mark-cell--off', 'mark-cell__tag', 'short-marks', 'short-mark', 'cell__val--small']) expect(marks, c).toContain(c);
    const bar = classesUsedBy('src/components/ScoreBar.tsx', allClasses);
    for (const c of ['bar', 'bar--mini', 'seg', 'seg--solid', 'seg--hatch', 'seg--outline', 'seg--dashed', 'ticks', 'ticks--stacked', 'tick-mark', 'tick-label', 'tick-label--total']) expect(bar, c).toContain(c);
    expect(classesUsedBy('src/screens/Input.tsx', allClasses)).toContain('body--fit');
    expect(classesUsedBy('src/screens/InputRows.tsx', allClasses)).toContain('body--rows');
    // Screen 은 넘겨받은 bodyClass 를 붙일 뿐이라 'body' 로 시작하는 다른 클래스를 쓰는 것으로 보지 않는다.
    const ui = classesUsedBy('src/components/ui.tsx', allClasses);
    for (const c of ['app--notop', 'layer', 'layer--center', 'scrim', 'sheet', 'sheet__head', 'sheet__title', 'sheet__body', 'dialog', 'body']) expect(ui, c).toContain(c);
    expect(ui).not.toContain('body--rows');
    expect(classesUsedBy('src/tapGuard.ts', allClasses)).toContain('tap-shield');
  });

  it('도구 모듈만 불러오는 CSS 파일의 클래스는 배포용 묶음에 실리는 모듈이 쓰지 않는다', () => {
    const toolClasses = [...new Set(toolCss.flatMap((f) => cssOf(read(f)).selectors.flatMap(classesInSelector)))];
    expect(toolClasses.length).toBeGreaterThan(10);
    const misplaced: string[] = [];
    for (const f of releaseModules) {
      const used = classesUsedBy(f, allClasses);
      for (const c of toolClasses) if (used.has(c)) misplaced.push(`${f}: .${c}`);
    }
    // 여기에 걸린 클래스의 규칙은 src/styles/app.css 로 옮겨야 배포용 묶음에도 실린다.
    expect(misplaced, '도구 모듈만 불러오는 CSS 파일에 규칙이 있는데 배포용 묶음의 모듈도 쓰는 클래스').toEqual([]);
  });

  it('도구 모듈만 불러오는 CSS 파일의 규칙은 모두 도구 모듈이 쓰는 클래스에 걸리고, 그 파일의 @keyframes 는 다른 CSS 가 쓰지 않는다', () => {
    const toolUsed = new Set(toolModules.flatMap((f) => [...classesUsedBy(f, allClasses)]));
    const loose: string[] = [];
    let checked = 0;
    for (const f of toolCss) {
      for (const sel of cssOf(read(f)).selectors) {
        checked += 1;
        // 클래스가 없는 선택자(details > summary 등)는 모든 화면에 걸리고, 도구 모듈이 쓰지 않는 클래스의 규칙은 둘 곳이 잘못된 것이다.
        if (!classesInSelector(sel).some((c) => toolUsed.has(c))) loose.push(`${f}: ${sel}`);
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect(loose, '도구 모듈이 쓰는 클래스에 걸리지 않는 규칙').toEqual([]);
    const toolKeyframes = toolCss.flatMap((f) => cssOf(read(f)).keyframes);
    const usedElsewhere = releaseCss.flatMap((f) => cssOf(read(f)).animations.filter((a) => toolKeyframes.includes(a)).map((a) => `${f}: ${a}`));
    expect(usedElsewhere, '배포용 묶음의 CSS 가 쓰는, 도구 CSS 파일에만 있는 @keyframes').toEqual([]);
  });
});
