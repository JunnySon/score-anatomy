import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { href, navigate } from '../router';
import { S } from '../strings';

// 화면 공통 부품: 화면 틀, 위쪽 줄, 하단 탭, 배지, 바텀시트, 삭제 확인 대화상자.

/**
 * 화면이 실제로 그려졌을 때 불리는 알림. 테스트 측정의 화면 진입 기록에 쓴다.
 * 다른 화면으로 되돌려 보내는 주소는 화면을 그리지 않으므로 기록되지 않는다.
 */
export const ScreenShownContext = createContext<(() => void) | null>(null);

/** 화면이나 떠 있는 층이 막 나타난 뒤 누름을 받지 않는 시간(ms). */
export const TAP_GUARD_MS = 500;

/**
 * 같은 자리를 연달아 눌렀을 때 다음 화면의 버튼까지 눌리는 일을 막는다.
 * 화면(또는 key)이 바뀐 직후 잠깐은 false를 돌려주고, 그동안 그 영역은 누름을 받지 않는다.
 * 막고 있는 동안 그 영역을 또 누르면 시간을 다시 센다. 연타가 멈춘 뒤에야 누름을 받는다.
 */
function useTapGuard(key: string, areaRef: React.RefObject<HTMLElement | null>): boolean {
  const [armedKey, setArmedKey] = useState<string | null>(null);
  useEffect(() => {
    let timer = 0;
    const onDown = (e: PointerEvent) => {
      const el = areaRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) start();
    };
    const arm = () => {
      document.removeEventListener('pointerdown', onDown, true);
      setArmedKey(key);
    };
    const start = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(arm, TAP_GUARD_MS);
    };
    document.addEventListener('pointerdown', onDown, true);
    start();
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [key, areaRef]);
  return armedKey === key;
}

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

export function TopBar({ back, title, right }: { back?: string; title: string; right?: ReactNode }) {
  return (
    <header className="top">
      {back !== undefined ? (
        <button type="button" className="icon-btn" aria-label={S.common.back} onClick={() => navigate(back)}>
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
  /** 같은 화면 안에서 아래 고정 영역의 내용이 바뀔 때 다시 잠깐 누름을 막고 싶으면 값을 바꾼다. */
  guardKey?: string;
}

export function Screen({ top, children, actions, footer, tabs, layer, bodyClass, guardKey }: ScreenProps) {
  const bodyRef = useRef<HTMLElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const armed = useTapGuard(guardKey ?? '', dockRef);
  const onShown = useContext(ScreenShownContext);
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
        <div className={`dock${armed ? '' : ' dock--guard'}`} ref={dockRef}>
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
  const armed = useTapGuard('sheet', layerRef);
  useModalLayer(layerRef, panelRef, onClose);
  return (
    <div className={`layer${armed ? '' : ' layer--guard'}`} ref={layerRef}>
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
  const armed = useTapGuard('dialog', layerRef);
  useModalLayer(layerRef, panelRef, onNo);
  return (
    <div className={`layer layer--center${armed ? '' : ' layer--guard'}`} ref={layerRef}>
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

/** 안내와 오류를 화면 안에 적는다. 팝업은 쓰지 않는다. */
export function Message({ children, plain }: { children: ReactNode; plain?: boolean }) {
  return (
    <p className={`msg${plain ? ' msg--plain' : ''}`} role="status" aria-live="polite">
      {children}
    </p>
  );
}
