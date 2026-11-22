import type { Page } from '@playwright/test';
import { addMetric, expect } from './helpers';

// 화면 하나를 검사한다(작업 지시서 10장의 3, 4, 5, 7번과 디자인 기준의 일부).
// 검사는 브라우저 안에서 실제로 그려진 결과를 읽는다.

export interface AuditOptions {
  /** 스크롤 없이 한 화면에 다 보여야 하는 화면인지(답 입력 화면). */
  mustFit?: boolean;
}

export interface AuditResult {
  textCount: number;
  minFont: number;
  smallText: string[];
  targetCount: number;
  minTargetW: number;
  minTargetH: number;
  smallTargets: string[];
  overlaps: string[];
  tightGaps: string[];
  minGap: number | null;
  obscured: string[];
  outside: string[];
  scrolls: boolean;
  forbidden: string[];
  exclamation: string[];
  emoji: string[];
  accentRatio: number;
  /** 그려진 글자와 그 바탕의 대비 가운데 가장 낮은 값. */
  minContrast: number;
  contrastCount: number;
  lowContrast: string[];
  heroCount: number;
  primaryCount: number;
  horizontalOverflow: boolean;
}

/** 금지 문자: 줄표(U+2014, U+2013)와 가운뎃점(U+00B7, U+318D, U+30FB, U+2027). */
const FORBIDDEN_CODES = [0x2014, 0x2013, 0x00b7, 0x318d, 0x30fb, 0x2027];
/** 느낌표와 그 변형. */
const EXCLAMATION_CODES = [0x21, 0xff01, 0xa1, 0x203c, 0x2757, 0x2755];
/** 이모지를 만드는 보조 문자: 그림 선택자, 키캡, 국기 글자 26개. */
const EMOJI_PART_CODES = [0xfe0f, 0x20e3, ...Array.from({ length: 26 }, (_, i) => 0x1f1e6 + i)];

export async function auditPage(page: Page): Promise<AuditResult> {
  return page.evaluate((codes) => {
    const TARGET_SEL =
      'button, a[href], input, select, textarea, summary, [role="button"], [role="radio"], [role="checkbox"], [role="tab"], [role="link"], [tabindex]:not([tabindex="-1"])';
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const name = (el: Element) => {
      const label = el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().replace(/\s+/g, ' ');
      return `${el.tagName.toLowerCase()}[${label.slice(0, 24)}]`;
    };
    const isShown = (el: Element) => {
      const withCheck = el as Element & { checkVisibility?: (o?: object) => boolean };
      if (withCheck.checkVisibility && !withCheck.checkVisibility({ checkVisibilityCSS: true })) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    // 4. 보이는 글자의 계산된 크기
    let textCount = 0;
    let minFont = Infinity;
    const smallText: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null = walker.nextNode();
    while (node) {
      const text = (node.textContent ?? '').trim();
      const el = node.parentElement;
      if (text && el && !el.closest('script, style, noscript, .sr-only') && isShown(el)) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const drawn = Array.from(range.getClientRects()).some((r) => r.width > 0 && r.height > 0);
        if (drawn) {
          const size = parseFloat(getComputedStyle(el).fontSize);
          textCount += 1;
          minFont = Math.min(minFont, size);
          if (size < 13) smallText.push(`${text.slice(0, 20)} (${size}px)`);
        }
      }
      node = walker.nextNode();
    }

    // 5. 조작 요소의 터치 영역
    const targets = Array.from(document.querySelectorAll(TARGET_SEL)).filter((el) => !el.closest('[inert]') && isShown(el));
    let minTargetW = Infinity;
    let minTargetH = Infinity;
    const smallTargets: string[] = [];
    const rects = targets.map((el) => el.getBoundingClientRect());
    targets.forEach((el, i) => {
      const r = rects[i]!;
      minTargetW = Math.min(minTargetW, r.width);
      minTargetH = Math.min(minTargetH, r.height);
      if (r.width < 47.5 || r.height < 47.5) smallTargets.push(`${name(el)} ${Math.round(r.width * 10) / 10}x${Math.round(r.height * 10) / 10}`);
    });

    // 3. 겹침, 간격, 가려짐, 화면 밖
    // 스크롤 영역 밖으로 밀려나 보이지 않는 부분은 빼고, 실제로 보이는 부분끼리 견준다.
    type Box = { left: number; top: number; right: number; bottom: number };
    const visibleBox = (el: Element): Box | null => {
      const r = el.getBoundingClientRect();
      const box: Box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      let p = el.parentElement;
      while (p && p !== document.body) {
        const cs = getComputedStyle(p);
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
          const pr = p.getBoundingClientRect();
          box.left = Math.max(box.left, pr.left);
          box.top = Math.max(box.top, pr.top);
          box.right = Math.min(box.right, pr.right);
          box.bottom = Math.min(box.bottom, pr.bottom);
        }
        p = p.parentElement;
      }
      // 8px도 안 보이는 요소는 스크롤로 밀려난 것으로 본다.
      return box.right - box.left >= 8 && box.bottom - box.top >= 8 ? box : null;
    };
    const scrollParent = (el: Element): Element | null => {
      let p = el.parentElement;
      while (p && p !== document.body) {
        const cs = getComputedStyle(p);
        if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') return p;
        p = p.parentElement;
      }
      return null;
    };
    const boxes = targets.map(visibleBox);
    const parents = targets.map(scrollParent);
    const whole = targets.map((_, i) => {
      const b = boxes[i];
      const r = rects[i]!;
      return b !== null && b !== undefined && Math.abs(b.right - b.left - r.width) < 0.5 && Math.abs(b.bottom - b.top - r.height) < 0.5;
    });
    const overlaps: string[] = [];
    const tightGaps: string[] = [];
    let minGap: number | null = null;
    for (let i = 0; i < targets.length; i += 1) {
      for (let j = i + 1; j < targets.length; j += 1) {
        const a = targets[i]!;
        const b = targets[j]!;
        const ra = boxes[i];
        const rb = boxes[j];
        if (!ra || !rb) continue;
        if (a.contains(b) || b.contains(a)) continue;
        const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (ix > 1 && iy > 1) {
          overlaps.push(`${name(a)} / ${name(b)}`);
          continue;
        }
        // 간격은 둘 다 온전히 보이고 같은 스크롤 영역에 있을 때만 잰다.
        // 스크롤 영역과 고정 영역 사이의 거리는 스크롤 위치에 따라 달라지기 때문이다.
        if (!whole[i] || !whole[j] || parents[i] !== parents[j]) continue;
        let gap: number | null = null;
        if (iy > 1) gap = Math.max(ra.left - rb.right, rb.left - ra.right);
        else if (ix > 1) gap = Math.max(ra.top - rb.bottom, rb.top - ra.bottom);
        if (gap !== null && gap >= -1) {
          minGap = minGap === null ? gap : Math.min(minGap, gap);
          if (gap < 7.5) tightGaps.push(`${name(a)} / ${name(b)} ${Math.round(gap * 10) / 10}px`);
        }
      }
    }
    const obscured: string[] = [];
    const outside: string[] = [];
    const main = document.querySelector('main.body');
    targets.forEach((el, i) => {
      const r = rects[i]!;
      const box = boxes[i];
      if (r.left < -0.5 || r.right > vw + 0.5 || r.top < -0.5 || r.bottom > vh + 0.5) outside.push(name(el));
      if (!box) return;
      // 보이는 부분의 가운데를 눌렀을 때 그 요소가 눌리는지 본다.
      const cx = (box.left + box.right) / 2;
      const cy = (box.top + box.bottom) / 2;
      if (cx < 0 || cx > vw || cy < 0 || cy > vh) return;
      const top = document.elementFromPoint(cx, cy);
      if (!top || !(el === top || el.contains(top) || top.contains(el))) obscured.push(`${name(el)} <- ${top ? name(top) : 'none'}`);
    });
    const scrolls = main ? main.scrollHeight > main.clientHeight + 1 : false;

    // 7. 화면에 그려진 글자의 금지 문자, 느낌표, 이모지
    const texts: string[] = [document.title, document.body.innerText];
    document.querySelectorAll('*').forEach((el) => {
      for (const attr of ['aria-label', 'title', 'placeholder', 'alt', 'aria-description', 'aria-valuetext']) {
        const v = el.getAttribute(attr);
        if (v) texts.push(v);
      }
    });
    const joined = texts.join('\n');
    const uniq = (list: RegExpMatchArray | null) => Array.from(new Set(list ?? [])).map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`);
    // 금지 문자와 느낌표는 문자를 직접 적지 않고 코드 값으로 정규식을 만든다.
    const charClass = (codes: number[]) => new RegExp(`[${codes.map((c) => String.fromCodePoint(c)).join('')}]`, 'gu');
    const forbidden = uniq(joined.match(charClass(codes.forbidden)));
    const exclamation = uniq(joined.match(charClass(codes.exclamation)));
    const emoji = uniq(joined.match(/\p{Extended_Pictographic}/gu)).concat(uniq(joined.match(charClass(codes.emojiParts))));

    // 디자인 기준: 진한 색(포인트색) 면적, 주 숫자와 주 버튼 개수
    const probe = document.createElement('span');
    probe.style.backgroundColor = 'var(--accent)';
    document.body.appendChild(probe);
    const accent = getComputedStyle(probe).backgroundColor;
    probe.remove();
    let accentArea = 0;
    document.querySelectorAll('.app *').forEach((el) => {
      if (!isShown(el)) return;
      if (getComputedStyle(el).backgroundColor !== accent) return;
      const r = el.getBoundingClientRect();
      const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
      const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      accentArea += w * h;
    });
    // 8. 그려진 글자와 바탕의 색 대비(실제로 계산된 색으로 다시 확인)
    const parse = (c: string): [number, number, number, number] | null => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1]!.split(/[,\s/]+/).filter(Boolean).map(Number);
      if (p.length < 3 || p.some((n) => Number.isNaN(n))) return null;
      return [p[0]!, p[1]!, p[2]!, p[3] === undefined ? 1 : p[3]];
    };
    const lum = (rgb: number[]) => {
      const f = (v: number) => {
        const x = v / 255;
        return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(rgb[0]!) + 0.7152 * f(rgb[1]!) + 0.0722 * f(rgb[2]!);
    };
    const over = (top: number[], a: number, under: number[]) => top.map((v, i) => v * a + under[i]! * (1 - a));
    /** 요소 뒤에 깔린 바탕색. 반투명이면 그 아래 색과 섞는다. 무늬(빗금) 위면 null. */
    const backdrop = (el: Element): number[] | null => {
      const layers: [number[], number][] = [];
      let p: Element | null = el;
      while (p) {
        const cs = getComputedStyle(p);
        if (cs.backgroundImage !== 'none') return null;
        const bg = parse(cs.backgroundColor);
        if (bg && bg[3] > 0) {
          layers.push([[bg[0], bg[1], bg[2]], bg[3]]);
          if (bg[3] >= 1) break;
        }
        p = p.parentElement;
      }
      let color = [255, 255, 255];
      for (let i = layers.length - 1; i >= 0; i -= 1) color = over(layers[i]![0], layers[i]![1], color);
      return color;
    };
    let minContrast = Infinity;
    let contrastCount = 0;
    const lowContrast: string[] = [];
    const w2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n2: Node | null = w2.nextNode();
    while (n2) {
      const text = (n2.textContent ?? '').trim();
      const el = n2.parentElement;
      if (text && el && !el.closest('script, style, noscript, .sr-only, [inert]') && isShown(el)) {
        const fg = parse(getComputedStyle(el).color);
        const bg = backdrop(el);
        if (!fg || !bg) {
          lowContrast.push(`${text.slice(0, 16)} (바탕이 무늬이거나 색을 읽지 못함)`);
        } else {
          const fgc = over([fg[0], fg[1], fg[2]], fg[3], bg);
          const l1 = lum(fgc);
          const l2 = lum(bg);
          const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          contrastCount += 1;
          minContrast = Math.min(minContrast, ratio);
          if (ratio < 4.5) lowContrast.push(`${text.slice(0, 16)} ${Math.round(ratio * 100) / 100}:1`);
        }
      }
      n2 = w2.nextNode();
    }

    const live = (sel: string) => Array.from(document.querySelectorAll(sel)).filter((el) => !el.closest('[inert]') && isShown(el)).length;

    return {
      textCount,
      minFont: textCount > 0 ? minFont : 0,
      smallText,
      targetCount: targets.length,
      minTargetW: targets.length > 0 ? Math.round(minTargetW * 10) / 10 : 0,
      minTargetH: targets.length > 0 ? Math.round(minTargetH * 10) / 10 : 0,
      smallTargets,
      overlaps,
      tightGaps,
      minGap: minGap === null ? null : Math.round(minGap * 10) / 10,
      obscured,
      outside,
      scrolls,
      forbidden,
      exclamation,
      emoji,
      accentRatio: Math.round((accentArea / (vw * vh)) * 1000) / 1000,
      minContrast: contrastCount > 0 ? Math.round(minContrast * 100) / 100 : 0,
      contrastCount,
      lowContrast,
      heroCount: live('.hero'),
      primaryCount: live('.btn--primary'),
      horizontalOverflow: document.documentElement.scrollWidth > vw + 1,
    };
  }, { forbidden: FORBIDDEN_CODES, exclamation: EXCLAMATION_CODES, emojiParts: EMOJI_PART_CODES });
}

/** 화면 하나를 검사하고 결과를 기록한다. 어긋난 곳이 있으면 테스트가 실패한다. */
export async function checkScreen(page: Page, name: string, run: string, opts: AuditOptions = {}): Promise<AuditResult> {
  // 전환(150~200ms)이 끝난 뒤의 모습을 검사한다.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  const r = await auditPage(page);
  addMetric({ kind: 'audit', run, name, mustFit: opts.mustFit === true, ...r });
  const at = `[${run}] ${name}`;
  expect.soft(r.smallText, `${at}: 13px보다 작은 글자`).toEqual([]);
  expect.soft(r.smallTargets, `${at}: 48x48px보다 작은 터치 영역`).toEqual([]);
  expect.soft(r.overlaps, `${at}: 겹친 조작 요소`).toEqual([]);
  expect.soft(r.tightGaps, `${at}: 간격 8px 미만인 조작 요소`).toEqual([]);
  expect.soft(r.obscured, `${at}: 가려진 조작 요소`).toEqual([]);
  expect.soft(r.forbidden, `${at}: 금지 문자`).toEqual([]);
  expect.soft(r.exclamation, `${at}: 느낌표`).toEqual([]);
  expect.soft(r.emoji, `${at}: 이모지`).toEqual([]);
  expect.soft(r.lowContrast, `${at}: 대비 4.5:1 미만인 글자`).toEqual([]);
  expect.soft(r.horizontalOverflow, `${at}: 가로 넘침`).toBe(false);
  expect.soft(r.heroCount, `${at}: 주 숫자는 화면에 하나 이하`).toBeLessThanOrEqual(1);
  expect.soft(r.primaryCount, `${at}: 주 버튼은 화면에 하나 이하`).toBeLessThanOrEqual(1);
  expect.soft(r.accentRatio, `${at}: 진한 색 면적은 화면의 10% 이하`).toBeLessThanOrEqual(0.1);
  if (opts.mustFit) {
    expect.soft(r.scrolls, `${at}: 스크롤 없이 보여야 함`).toBe(false);
    expect.soft(r.outside, `${at}: 화면 밖으로 나간 조작 요소`).toEqual([]);
  }
  return r;
}

export interface LeakTarget {
  no: number;
  answer: number;
  /** 다른 곳에 나오지 않는 값이라 화면 전체에서 찾아도 되는지(단답형 정답). */
  distinctive: boolean;
}

/**
 * 9. 정답 노출 검사. "정답 보기"를 누르기 전에 화면 글자, 입력칸 안내문, 접근성 라벨에
 * 틀린 문항의 정답이 나오지 않는지 본다.
 */
export async function findAnswerLeaks(page: Page, targets: LeakTarget[], revealed: number[] = []): Promise<string[]> {
  return page.evaluate(
    ({ targets, revealed }) => {
      const leaks: string[] = [];
      // 사람과 보조 기기에 전해지는 글자를 모은다: 그려진 글자, 입력칸 안내문과 값, 접근성 라벨, 그 밖의 속성.
      // 아이콘 그림(svg)의 좌표와 구조용 속성은 뺀다.
      const SKIP = new Set(['class', 'style', 'id', 'for', 'tabindex', 'aria-labelledby', 'aria-describedby', 'maxlength', 'rows', 'cols']);
      const collect = (root: Element): string => {
        const parts: string[] = [(root as HTMLElement).innerText ?? root.textContent ?? ''];
        const all = [root, ...Array.from(root.querySelectorAll('*'))];
        for (const el of all) {
          if (el.closest('svg')) continue;
          for (const attr of el.getAttributeNames()) {
            if (SKIP.has(attr)) continue;
            parts.push(el.getAttribute(attr) ?? '');
          }
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) parts.push(el.value, el.placeholder);
        }
        return parts.join('\n');
      };
      const whole = collect(document.body);
      // 정답을 드러내는 칸이 열려 있으면 안 된다.
      document.querySelectorAll('[data-testid^="answer-"]').forEach((el) => {
        const no = Number((el.getAttribute('data-testid') ?? '').replace('answer-', ''));
        if (!revealed.includes(no)) leaks.push(`${no}번 정답 칸이 열려 있음`);
      });
      for (const t of targets) {
        if (revealed.includes(t.no)) continue;
        if (t.distinctive && whole.includes(String(t.answer))) leaks.push(`${t.no}번 정답 ${t.answer}이 화면에 있음`);
        const card = document.querySelector(`[data-testid="wrong-${t.no}"]`);
        if (card) {
          // 카드의 숫자 토큰은 문항 번호, 배점, 내 답뿐이어야 한다.
          const tokens: string[] = collect(card).match(/\d+/g) ?? [];
          if (tokens.includes(String(t.answer))) leaks.push(`${t.no}번 카드에 정답 ${t.answer}과 같은 숫자가 있음`);
        }
      }
      if (/정답\s*(은|는|:)?\s*\d/.test(whole.replace(/추측했다고 표시한 정답\s*\d+점/g, '').replace(/찍었다고 표시한 정답\s*\d+점/g, ''))) {
        const allowed = revealed.length > 0;
        if (!allowed) leaks.push('정답 뒤에 숫자가 붙은 글자가 있음');
      }
      return leaks;
    },
    { targets, revealed },
  );
}
