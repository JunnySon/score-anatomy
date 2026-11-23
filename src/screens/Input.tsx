import { useEffect, useRef, useState, type Ref } from 'react';
import { DigitPad, EntryBox, McPad } from '../components/pads';
import { Badge, LiveRegion, Message, Progress, Screen } from '../components/ui';
import { choicesOf } from '../exams/validate';
import {
  entryOf,
  initKeypad,
  isDirty,
  keysLocked,
  nowLabelOf,
  panelOf,
  reduceKeypad,
  type KeyEvent,
  type KeypadState,
  type NowLabel,
  type Panel,
} from '../logic/keypad';
import { countEntered } from '../logic/scoring';
import { GROUP_SIZE, groupIndexOf, sectionOf } from '../logic/sections';
import { navigate } from '../router';
import { putAnswer, type SessionHandle } from '../state/hooks';
import { answerText } from '../state/session';
import { S } from '../strings';
import { markUiChanged } from '../tapGuard';
import { tools } from '#tools';
import type { AnswerValue, ExamItem, InputMode } from '../types';
import { InputTop } from './InputTop';

// (3) 답 입력 화면. 키패드 방식과 5행 방식이 같은 기록을 쓴다.
// 키패드 방식의 규칙(커서 이동, 잠금, 지우기)은 src/logic/keypad.ts 의 순수 함수가 정한다.

export function InputScreen({ h, mode }: { h: SessionHandle; mode: InputMode }) {
  const Rows = tools.InputRows;
  return mode === 'rows' && Rows ? <Rows h={h} /> : <InputKeypad h={h} />;
}

function Cell({
  item,
  value,
  current,
  onSelect,
  buttonRef,
}: {
  item: ExamItem;
  value: AnswerValue | undefined;
  current: boolean;
  onSelect: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const text = answerText(value, S.common.skip);
  return (
    <button
      type="button"
      ref={buttonRef}
      className="cell"
      data-cell={item.no}
      aria-current={current ? 'true' : undefined}
      aria-label={text ? S.input.cellFilled(item.no, text) : S.input.cellEmpty(item.no)}
      onClick={onSelect}
    >
      <span className="cell__no">{item.no}</span>
      <span className={`cell__val${value === 'skip' ? ' cell__val--small' : ''}`}>{text}</span>
    </button>
  );
}

function GhostCells({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <span key={`ghost-${i}`} className="cell cell--ghost" aria-hidden="true" />
      ))}
    </>
  );
}

const NOW_LABEL: Record<NowLabel, string> = {
  now: S.input.nowLabel,
  fixing: S.input.nowLabelFixing,
  put: S.input.nowLabelPut,
  noBlank: S.input.nowLabelNoBlank,
};

/** 정보 안내(잠금, 고치기, 빈칸 없음, 지웠음)인지. 아니면 경고 안내(범위 밖 숫자, 빈칸, 확정하지 않은 숫자, 지울 답 없음)다. */
function isInfo(text: Panel['text']): boolean {
  return text !== null && (text.kind === 'locked' || text.kind === 'noBlank' || text.kind === 'fixing' || text.kind === 'erased');
}

/** 키패드 위 안내문 자리의 글자. */
function panelText(text: Panel['text']): string | null {
  if (!text) return null;
  switch (text.kind) {
    case 'locked':
      return S.input.locked(text.no);
    case 'noBlank':
      return S.input.noBlank;
    case 'fixing':
      return S.input.fixing(text.no);
    case 'erased':
      return S.input.erased(text.no);
    case 'nothingToErase':
      return S.input.nothingToErase;
    case 'shortRange':
      return S.common.shortRange;
    case 'empty':
      return S.common.emptyItem(text.no);
    case 'notCommitted':
      return S.input.notCommitted(text.no);
    default:
      return null;
  }
}

function InputKeypad({ h }: { h: SessionHandle }) {
  const { exam, session } = h;
  const items = exam.items;
  const [state, setState] = useState<KeypadState>(() => initKeypad(items, session.answers));
  const currentRef = useRef<HTMLButtonElement | null>(null);
  // 잠긴 키를 누르면 화면 낭독기에 잠금 안내를 다시 전한다(알림 영역을 잠깐 비웠다가 다시 채운다).
  // 화면을 열 때의 안내(빈칸 없음 등)도 알림 영역을 빈 채로 먼저 그리고 다음 그림 차례에 채워 전한다
  // (글자를 담은 채 새로 붙은 알림 영역은 화면 낭독기가 읽지 않는 경우가 많다).
  const [srBlank, setSrBlank] = useState(true);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setSrBlank(false));
    return () => window.cancelAnimationFrame(id);
  }, []);

  const cursor = Math.min(state.cursor, items.length - 1);
  const item = items[cursor]!;
  const existing = session.answers[item.no];
  const section = sectionOf(exam, item.no);
  const entered = countEntered(exam, session.answers);
  const g = groupIndexOf(cursor);
  const currentGroup = items.slice(g * GROUP_SIZE, (g + 1) * GROUP_SIZE);
  const prevGroup = g > 0 ? items.slice((g - 1) * GROUP_SIZE, g * GROUP_SIZE) : [];
  const panel = panelOf(state, items, session.answers);
  const message = panelText(panel.text);
  const keys = keysLocked(state);
  const onLocked = () => {
    setSrBlank(true);
    window.requestAnimationFrame(() => setSrBlank(false));
  };

  // 글자를 키웠거나 화면이 낮아서 내용이 넘치면 지금 칸이 보이게 스크롤한다.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' });
  }, [cursor, message, panel.fixNext, panel.continueAt]);

  /** 누름 하나를 규칙에 넘기고, 나온 대로 답을 저장하고 화면을 옮긴다. */
  const dispatch = (event: KeyEvent) => {
    const out = reduceKeypad(state, items, session.answers, event);
    if (!out.accepted) return;
    if (out.store) putAnswer(h, out.store.no, out.store.value, 'input');
    if (out.toReview) {
      // 답을 넣어 저절로 입력 확인으로 넘어간다. 답을 넣던 박자로 더 누른 것이
      // 새 화면의 버튼에 닿지 않게, 이때만 화면 전체를 잠깐 막는다.
      markUiChanged('screen');
      navigate(h.path('/review'));
      return;
    }
    // 묶음이 바뀌면 같은 자리에 다섯 문항 앞(뒤)의 칸이 온다. 칸을 눌러 묶음이 바뀌었을 때 연달아 누른 것이 그 칸에 닿지 않게 한다.
    // 키를 눌러 다음 묶음으로 넘어갈 때는 막지 않는다(같은 키를 빠르게 이어 누르는 것은 받아야 한다).
    if (event.type === 'cell' && groupIndexOf(out.state.cursor) !== g) markUiChanged();
    // 안내문 자리의 버튼을 누르면 그 자리에 다른 버튼이 온다. 연달아 누른 것이 새 버튼에 닿지 않게 한다.
    if (event.type === 'fixNext' || event.type === 'continue') markUiChanged();
    setState(out.state);
  };

  /**
   * "전체 보기"나 위쪽 뒤로 가기로 나간다. 확정하지 않은 숫자가 있으면 버리고 알린 뒤 이 화면에 머문다.
   * 다시 누르면 나간다. 누른 숫자가 말없이 사라지지 않게 하려는 것이다.
   */
  const leave = (to: string) => {
    if (isDirty(state, items, session.answers)) {
      setState({ ...state, draft: null, notice: { kind: 'notCommitted', no: item.no } });
      // 안내문을 읽기 전에 같은 자리를 또 눌러 나가 버리지 않게 한다.
      markUiChanged();
      return;
    }
    navigate(to);
  };

  const pad =
    item.kind === 'mc' ? (
      <McPad
        choices={choicesOf(item)}
        locked={keys.answer}
        onLocked={onLocked}
        onPick={(n) => dispatch({ type: 'choice', value: n })}
        fn={[
          { key: 'skip', label: S.common.skip, onPress: () => dispatch({ type: 'skip' }) },
          { key: 'erase', label: S.common.erase, onPress: () => dispatch({ type: 'erase' }), live: !keys.erase },
        ]}
      />
    ) : (
      <DigitPad
        locked={keys.answer}
        eraseLocked={keys.erase}
        onLocked={onLocked}
        onDigit={(d) => dispatch({ type: 'digit', digit: d })}
        onErase={() => dispatch({ type: 'erase' })}
        onSkip={() => dispatch({ type: 'skip' })}
        onGo={() => dispatch({ type: 'go' })}
        goLabel={S.common.next}
      />
    );

  // 큰 칸에는 누르고 있는 숫자를 보여 준다. 누르다가 다 지웠으면 빈 칸이고, 안 풂이 들어 있던 문항만 "안 풂"이 다시 보인다.
  const entry = entryOf(state, items, session.answers);
  const shown = state.draft === null ? answerText(existing, S.common.skip) : entry.text !== '' ? entry.text : existing === 'skip' ? S.common.skip : '';
  const hasButtons = panel.fixNext !== null || panel.continueAt !== null;

  return (
    <Screen
      top={<InputTop h={h} leave={leave} />}
      bodyClass="body--fit"
      // 키패드가 5지선다용에서 단답형용으로(또는 거꾸로) 바뀔 때, 연달아 누른 것이 새 키에 닿지 않게 한다.
      guardKey={item.kind}
      footer={
        <>
          {/* 화면 낭독기에는 늘 붙어 있는 이 알림 영역으로 안내문을 전한다. 보이는 안내문은 낭독에서 뺀다(aria-hidden, 두 번 읽히지 않게). */}
          <LiveRegion text={srBlank ? '' : (message ?? '')} testId="pad-live" />
          {message ? (
            <div className="pad-msg" data-testid="pad-panel" data-lock={state.lock ?? 'none'}>
              <Message live={false} plain={isInfo(panel.text)}>
                {message}
              </Message>
              {hasButtons ? (
                <div className="pad-actions" role="group" aria-label={S.input.nextActionsLabel}>
                  {panel.fixNext !== null ? (
                    <button type="button" className="btn btn--secondary btn--panel" data-testid="fix-next" onClick={() => dispatch({ type: 'fixNext' })}>
                      {S.input.fixNext(panel.fixNext)}
                    </button>
                  ) : null}
                  {panel.continueAt !== null ? (
                    <button
                      type="button"
                      className="btn btn--secondary btn--panel"
                      data-testid="continue-from"
                      onClick={() => dispatch({ type: 'continue' })}
                    >
                      {S.input.continueFrom(panel.continueAt)}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {pad}
        </>
      }
    >
      <div className="input-head">
        <div className="input-head__row">
          <span data-testid="section-name">{section ? S.input.section(section.kind, section.from, section.to) : ''}</span>
          <span className="sub" data-testid="entered-count">
            {S.input.entered(entered)}
          </span>
        </div>
        <Progress value={entered} max={items.length} label={S.input.progressLabel} />
      </div>

      <div className="now">
        <div className="now__main" aria-live="polite">
          <span className="cap" data-testid="now-label">
            {NOW_LABEL[nowLabelOf(state)]}
          </span>
          <span className="hero" data-testid="now-no">
            {S.common.itemNo(item.no)}
          </span>
        </div>
        <span className="now__badge">
          <Badge>{S.common.points(item.points)}</Badge>
        </span>
        {item.kind === 'short' ? <EntryBox text={shown} label={S.input.entryLabel} /> : null}
      </div>

      <div className="groups">
        <div className="cells" role="group" aria-label={S.input.prevGroupLabel} aria-hidden={prevGroup.length === 0 ? 'true' : undefined}>
          {prevGroup.map((it) => (
            <Cell key={it.no} item={it} value={session.answers[it.no]} current={false} onSelect={() => dispatch({ type: 'cell', index: items.indexOf(it) })} />
          ))}
          <GhostCells count={GROUP_SIZE - prevGroup.length} />
        </div>
        <div className="cells" role="group" aria-label={S.input.currentGroupLabel}>
          {currentGroup.map((it) => (
            <Cell
              key={it.no}
              item={it}
              value={session.answers[it.no]}
              current={it.no === item.no}
              onSelect={() => dispatch({ type: 'cell', index: items.indexOf(it) })}
              buttonRef={it.no === item.no ? currentRef : undefined}
            />
          ))}
          <GhostCells count={GROUP_SIZE - currentGroup.length} />
        </div>
      </div>

      {/* 안내문이 떠 있는 동안에는 자리를 내준다. 안내문은 키패드 바로 위에 늘 보인다. */}
      {message ? null : <p className="sub hint">{S.input.hint}</p>}
    </Screen>
  );
}
