import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { href, navigate } from '../router';
import { S } from '../strings';
import { markContentShifted, markUiChanged } from '../tapGuard';

// 화면 공통 부품: 화면 틀, 위쪽 줄, 하단 탭, 배지, 바텀시트, 삭제 확인 대화상자.

/**
 * 화면이 실제로 그려졌을 때 불리는 알림. 테스트 측정의 화면 진입 기록에 쓴다.
 * 다른 화면으로 되돌려 보내는 주소는 화면을 그리지 않으므로 기록되지 않는다.
 */
export const ScreenShownContext = createContext<(() => void) | null>(null);

export function IconBack() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconClose() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconCheck() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8.5l3.2 3L13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconCross() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconRing() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function IconInfo() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 5.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="6" cy="3.6" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return <span className="badge">{children}</span>;
}

/** onBack이 있으면 뒤로 가기 버튼이 주소로 바로 가지 않고 그 함수를 부른다. */
export function TopBar({ back, onBack, title, right }: { back?: string; onBack?: () => void; title: string; right?: ReactNode }) {
  return (
    <header className="top">
      {back !== undefined ? (
        <button type="button" className="icon-btn" aria-label={S.common.back} onClick={() => (onBack ? onBack() : navigate(back))}>
          <IconBack />
        </button>
      ) : null}
      <h1 className={`top__title${back === undefined ? ' top__title--lead' : ''}`}>{title}</h1>
      {right}
    </header>
  );
}

export type TabName = 'current' | 'history';

export function TabBar({ active }: { active: TabName }) {
  return (
    <nav className="tabs" aria-label={S.tabs.label}>
      <a className="tab" href={href('/')} aria-current={active === 'current' ? 'page' : undefined}>
        {S.tabs.current}
      </a>
      <a className="tab" href={href('/history')} aria-current={active === 'history' ? 'page' : undefined}>
        {S.tabs.history}
      </a>
    </nav>
  );
}

interface ScreenProps {
  top?: ReactNode;
  children: ReactNode;
  /** 화면 아래 고정 영역의 버튼들. */
  actions?: ReactNode;
  /** 화면 아래 고정 영역에 버튼 대신 넣는 것(키패드). */
  footer?: ReactNode;
  tabs?: TabName;
  /** 바텀시트나 삭제 확인 대화상자. */
  layer?: ReactNode;
  bodyClass?: string;
  /**
   * 같은 화면 안에서 누른 자리의 내용이 바뀔 때(아래 버튼이 다른 버튼이 됨, 쪽이 넘어감) 값을 바꾼다.
   * 값이 바뀌면 바로 앞에 누른 자리를 잠깐 막는다(src/tapGuard.ts).
   */
  guardKey?: string;
  /**
   * 학생의 누름 없이 넘겨받은 새 시험 자료로 화면 안 내용의 자리가 바뀔 수 있을 때 그 자료를 나타내는 값(시험 목록, 시험의 판 번호 등).
   * 처음 그린 뒤 값이 바뀌면 마지막 누름과 상관없이 화면 전체를 0.5초 막는다(src/tapGuard.ts 의 markContentShifted, 작업 지시서 3의 별도 검토 A3).
   * 값이 undefined 로 바뀔 때는 막지 않는다.
   */
  shiftKey?: string;
}

export function Screen({ top, children, actions, footer, tabs, layer, bodyClass, guardKey, shiftKey }: ScreenProps) {
  const bodyRef = useRef<HTMLElement>(null);
  const onShown = useContext(ScreenShownContext);
  // 화면이 새로 그려지거나 guardKey가 바뀌면, 같은 자리를 연달아 누른 것이 새 버튼에 닿지 않게 한다.
  useLayoutEffect(() => {
    markUiChanged();
  }, [guardKey]);
  // 넘겨받은 새 자료로 내용의 자리가 옮겨 가면, 옮겨 가기 전의 자리를 보고 누른 것이 다른 요소에 닿지 않게 한다.
  const shiftRef = useRef(shiftKey);
  useLayoutEffect(() => {
    if (shiftRef.current === shiftKey) return;
    shiftRef.current = shiftKey;
    if (shiftKey !== undefined) markContentShifted();
  }, [shiftKey]);
  useEffect(() => {
    onShown?.();
    // 화면이 바뀌면 맨 위로 올리고, 보조 기기가 새 화면을 읽도록 초점을 옮긴다.
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = 0;
    el.focus({ preventScroll: true });
    // 화면이 처음 그려질 때 한 번만 한다.
  }, []);
  return (
    <div className={`app${top ? '' : ' app--notop'}`}>
      {top}
      <main ref={bodyRef} className={`body${bodyClass ? ` ${bodyClass}` : ''}`} tabIndex={-1}>
        {children}
      </main>
      {actions || footer || tabs ? (
        <div className="dock">
          {footer}
          {actions ? <div className="actions">{actions}</div> : null}
          {tabs ? <TabBar active={tabs} /> : null}
        </div>
      ) : null}
      {layer}
    </div>
  );
}

/** 떠 있는 층이 열려 있는 동안 뒤 화면을 조작하지 못하게 하고, 닫히면 초점을 돌려준다. */
function useModalLayer(layerRef: React.RefObject<HTMLDivElement | null>, panelRef: React.RefObject<HTMLDivElement | null>, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // 층이 열릴 때와 닫힐 때, 같은 자리를 연달아 누른 것이 새로 드러난 버튼에 닿지 않게 한다.
  useLayoutEffect(() => {
    markUiChanged();
    return () => markUiChanged();
  }, []);
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || !layer.parentElement) return;
    const siblings = Array.from(layer.parentElement.children).filter((el) => el !== layer);
    for (const el of siblings) el.setAttribute('inert', '');
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      for (const el of siblings) el.removeAttribute('inert');
      if (prev && document.contains(prev)) prev.focus({ preventScroll: true });
    };
  }, [layerRef, panelRef]);
}

export function BottomSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const layerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalLayer(layerRef, panelRef, onClose);
  return (
    <div className="layer" ref={layerRef}>
      <div className="scrim" aria-hidden="true" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={panelRef}>
        <div className="sheet__head">
          <h2 className="sheet__title title" id={titleId}>
            {title}
          </h2>
          <button type="button" className="icon-btn" aria-label={S.common.close} onClick={onClose}>
            <IconClose />
          </button>
        </div>
        <div className="sheet__body">{children}</div>
        {/* 버린 누름 알림(src/tapNotice.ts)을 이 시트가 열려 있는 동안 화면 낭독기에 전하는 자리. */}
        <p className="sr-only" aria-live="polite" aria-atomic="true" data-tap-live="" />
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  body,
  yes,
  no,
  onYes,
  onNo,
}: {
  title: string;
  body: string;
  yes: string;
  no: string;
  onYes: () => void;
  onNo: () => void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  useModalLayer(layerRef, panelRef, onNo);
  return (
    <div className="layer layer--center" ref={layerRef}>
      <div className="scrim" aria-hidden="true" onClick={onNo} />
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} tabIndex={-1} ref={panelRef}>
        <h2 className="title" id={titleId}>
          {title}
        </h2>
        <p className="sub mt2" id={bodyId}>
          {body}
        </p>
        <div className="actions__row mt4">
          <button type="button" className="btn btn--secondary grow" onClick={onNo}>
            {no}
          </button>
          <button type="button" className="btn btn--secondary grow" data-confirm="yes" onClick={onYes}>
            {yes}
          </button>
        </div>
        {/* 버린 누름 알림(src/tapNotice.ts)을 이 대화상자가 열려 있는 동안 화면 낭독기에 전하는 자리. */}
        <p className="sr-only" aria-live="polite" aria-atomic="true" data-tap-live="" />
      </div>
    </div>
  );
}

/** 하나만 고르는 줄. 라디오 그룹 안에서 쓴다. */
export function Option({
  checked,
  onSelect,
  children,
  badges,
  testId,
}: {
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
  badges?: ReactNode;
  testId?: string;
}) {
  return (
    <button type="button" role="radio" aria-checked={checked} className="opt" onClick={onSelect} data-testid={testId}>
      <span className="opt__dot" aria-hidden="true" />
      <span className="opt__main">{children}</span>
      {badges ? <span className="opt__badges">{badges}</span> : null}
    </button>
  );
}

export function Chip({ checked, onSelect, children, testId }: { checked: boolean; onSelect: () => void; children: ReactNode; testId?: string }) {
  return (
    <button type="button" role="radio" aria-checked={checked} className="chip" onClick={onSelect} data-testid={testId}>
      <span className="chip__check">
        <IconCheck />
      </span>
      {children}
    </button>
  );
}

export function Progress({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <div className="progress__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * 안내와 오류를 화면 안에 적는다. 팝업은 쓰지 않는다.
 * live 가 false면 늘 붙어 있는 다른 알림 영역(LiveRegion)이 같은 글자를 전하므로, 보이는 안내문은 알림 영역으로 두지 않고
 * 화면 낭독기에서도 뺀다(aria-hidden, 훑어 읽을 때 같은 문장을 두 번 듣지 않게).
 */
export function Message({ children, plain, live = true, testId }: { children: ReactNode; plain?: boolean; live?: boolean; testId?: string }) {
  return (
    <p
      className={`msg${plain ? ' msg--plain' : ''}`}
      data-testid={testId}
      {...(live ? { role: 'status', 'aria-live': 'polite' as const } : { 'aria-hidden': true as const })}
    >
      {children}
    </p>
  );
}

/**
 * 화면 낭독기에 전하는 알림 영역. 처음부터 붙여 두고 글자만 바꾼다(글자를 담은 채 새로 붙은 알림 영역은
 * 화면 낭독기가 읽지 않는 경우가 많다). 보이지 않는다.
 */
export function LiveRegion({ text, testId }: { text: string; testId?: string }) {
  return (
    <p className="sr-only" role="status" aria-live="polite" data-testid={testId}>
      {text}
    </p>
  );
}
