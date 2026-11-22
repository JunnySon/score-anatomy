import { useEffect, useRef, useState, type Ref } from 'react';
import { AnswerSheet, DigitPad, EntryBox, McPad } from '../components/pads';
import { Badge, BottomSheet, Message, Progress, Screen, TopBar } from '../components/ui';
import { choicesOf } from '../exams/validate';
import { entryValue, eraseDigit, initEntry, pressDigit, type DigitEntry } from '../logic/entry';
import { countEntered } from '../logic/scoring';
import { GROUP_SIZE, groupCount, groupIndexOf, sectionOf } from '../logic/sections';
import { navigate } from '../router';
import { putAnswer, type SessionHandle } from '../state/hooks';
import { answerText, firstMissingIndex } from '../state/session';
import { S } from '../strings';
import { markUiChanged } from '../tapGuard';
import type { AnswerValue, ExamItem, InputMode } from '../types';

// (3) 답 입력 화면. 키패드 방식과 5행 방식이 같은 기록을 쓴다.

export function InputScreen({ h, mode }: { h: SessionHandle; mode: InputMode }) {
  return mode === 'rows' ? <InputRows h={h} /> : <InputKeypad h={h} />;
}

/** leave가 있으면 다른 화면으로 나가는 버튼이 그 함수를 거친다(확정하지 않은 숫자를 알릴 때 쓴다). */
function InputTop({ h, leave }: { h: SessionHandle; leave?: (to: string) => void }) {
  const go = leave ?? navigate;
  return (
    <TopBar
      back="/exams"
      onBack={leave ? () => leave('/exams') : undefined}
      title={h.exam.title}
      right={
        <button type="button" className="btn btn--text" onClick={() => go(h.path('/review'))}>
          {S.input.showAll}
        </button>
      }
    />
  );
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

function InputKeypad({ h }: { h: SessionHandle }) {
  const { exam, session } = h;
  const items = exam.items;
  const last = items.length - 1;
  const [cursor, setCursor] = useState(() => {
    const i = firstMissingIndex(exam, session);
    return i < 0 ? last : i;
  });
  // 단답형에서 누르고 있는 숫자. "다음"을 눌러야 답으로 들어간다.
  const [draft, setDraft] = useState<{ no: number; entry: DigitEntry } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const currentRef = useRef<HTMLButtonElement | null>(null);

  const item = items[Math.min(cursor, last)]!;
  const existing = session.answers[item.no];
  const section = sectionOf(exam, item.no);
  const entered = countEntered(exam, session.answers);
  const g = groupIndexOf(cursor);
  const currentGroup = items.slice(g * GROUP_SIZE, (g + 1) * GROUP_SIZE);
  const prevGroup = g > 0 ? items.slice((g - 1) * GROUP_SIZE, g * GROUP_SIZE) : [];
  const typing = draft !== null && draft.no === item.no;
  const entry: DigitEntry = typing ? draft.entry : initEntry(existing);

  // 글자를 키웠거나 화면이 낮아서 내용이 넘치면 지금 칸이 보이게 스크롤한다.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' });
  }, [cursor, msg]);

  const moveTo = (index: number, message: string | null) => {
    if (!items[index]) return;
    setCursor(index);
    setDraft(null);
    setMsg(message);
  };

  /** 누르고 있는 숫자가 들어 있는 답과 다른지. 다르면 "다음"을 누르지 않고 떠날 때 알린다. */
  const dirty = typing && entry.text !== initEntry(existing).text;

  /** 칸을 눌러 그 문항으로 간다. 확정하지 않은 숫자는 버리고 알린다. */
  const goTo = (index: number) => {
    if (index === cursor) return;
    // 묶음이 바뀌면 같은 자리에 다섯 문항 앞(뒤)의 칸이 온다. 연달아 누른 것이 그 칸에 닿지 않게 한다.
    // 키를 눌러 다음 묶음으로 넘어갈 때는 막지 않는다(같은 키를 빠르게 이어 누르는 것은 받아야 한다).
    if (groupIndexOf(index) !== g) markUiChanged();
    moveTo(index, dirty ? S.input.notCommitted(item.no) : null);
  };

  /**
   * "전체 보기"나 위쪽 뒤로 가기로 나간다. 확정하지 않은 숫자가 있으면 버리고 알린 뒤 이 화면에 머문다.
   * 다시 누르면 나간다. 누른 숫자가 말없이 사라지지 않게 하려는 것이다.
   */
  const leave = (to: string) => {
    if (dirty) {
      setDraft(null);
      setMsg(S.input.notCommitted(item.no));
      // 안내문을 읽기 전에 같은 자리를 또 눌러 나가 버리지 않게 한다.
      markUiChanged();
      return;
    }
    navigate(to);
  };

  const advance = () => {
    if (cursor >= last) navigate(h.path('/review'));
    else moveTo(cursor + 1, null);
  };

  /** "지우기"는 한 칸 뒤로 가서 지운다(지시서 8장 (3)). 무엇을 지웠는지 알린다. */
  const eraseBack = () => {
    if (cursor <= 0) {
      setMsg(null);
      return;
    }
    const prev = items[cursor - 1]!;
    const had = session.answers[prev.no] !== undefined;
    putAnswer(h, prev.no, undefined, 'input');
    moveTo(cursor - 1, had ? S.input.erased(prev.no) : null);
  };

  const put = (v: AnswerValue) => {
    putAnswer(h, item.no, v, 'input');
    advance();
  };

  const onDigit = (d: number) => {
    const r = pressDigit(entry, d);
    if (r.overflow) {
      setMsg(S.common.shortRange);
      return;
    }
    setMsg(null);
    setDraft({ no: item.no, entry: r.entry });
  };

  const eraseShort = () => {
    if (entry.text !== '') {
      // 누르고 있는 숫자는 한 자리씩 지운다. 저장된 답은 "다음"을 눌러야 바뀐다.
      setMsg(null);
      setDraft({ no: item.no, entry: eraseDigit(entry) });
    } else {
      eraseBack();
    }
  };

  /** 단답형은 "다음"을 눌러야 확정되어 넘어간다. */
  const nextShort = () => {
    if (!typing) {
      // 이미 들어 있는 답(숫자나 안 풂)은 그대로 두고 넘어간다.
      if (existing !== undefined) advance();
      else setMsg(S.common.emptyItem(item.no));
      return;
    }
    const v = entryValue(entry);
    if (v !== null) {
      put(v);
      return;
    }
    // 칸에 "안 풂"이 보이는 채로 누르면 그대로 넘어간다.
    if (existing === 'skip') {
      advance();
      return;
    }
    // 숫자를 다 지우고 "다음"을 누르면 들어 있던 답을 지운다(빈 칸을 확정). 그래야 안내문이 사실과 맞다.
    if (existing !== undefined) putAnswer(h, item.no, undefined, 'input');
    setDraft(null);
    setMsg(S.common.emptyItem(item.no));
  };

  const pad =
    item.kind === 'mc' ? (
      <McPad
        choices={choicesOf(item)}
        onPick={(n) => put(n)}
        fn={[
          { key: 'skip', label: S.common.skip, onPress: () => put('skip') },
          { key: 'erase', label: S.common.erase, onPress: eraseBack },
        ]}
      />
    ) : (
      <DigitPad onDigit={onDigit} onErase={eraseShort} onSkip={() => put('skip')} onGo={nextShort} goLabel={S.common.next} />
    );

  // 큰 칸에는 누르고 있는 숫자를 보여 준다. 누르다가 다 지웠으면 빈 칸이고, 안 풂이 들어 있던 문항만 "안 풂"이 다시 보인다.
  const shown = !typing ? answerText(existing, S.common.skip) : entry.text !== '' ? entry.text : existing === 'skip' ? S.common.skip : '';

  return (
    <Screen
      top={<InputTop h={h} leave={leave} />}
      bodyClass="body--fit"
      // 키패드가 5지선다용에서 단답형용으로(또는 거꾸로) 바뀔 때, 연달아 누른 것이 새 키에 닿지 않게 한다.
      guardKey={item.kind}
      footer={
        <>
          {msg ? (
            <div className="pad-msg">
              <Message>{msg}</Message>
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
          <span className="cap">{S.input.nowLabel}</span>
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
            <Cell key={it.no} item={it} value={session.answers[it.no]} current={false} onSelect={() => goTo(items.indexOf(it))} />
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
              onSelect={() => goTo(items.indexOf(it))}
              buttonRef={it.no === item.no ? currentRef : undefined}
            />
          ))}
          <GhostCells count={GROUP_SIZE - currentGroup.length} />
        </div>
      </div>

      {/* 안내문이 떠 있는 동안에는 자리를 내준다. 안내문은 키패드 바로 위에 늘 보인다. */}
      {msg ? null : <p className="sub hint">{S.input.hint}</p>}
    </Screen>
  );
}

function InputRows({ h }: { h: SessionHandle }) {
  const { exam, session } = h;
  const items = exam.items;
  const pages = groupCount(exam);
  const [page, setPage] = useState(() => {
    const i = firstMissingIndex(exam, session);
    return i < 0 ? 0 : groupIndexOf(i);
  });
  const [menuNo, setMenuNo] = useState<number | null>(null);
  const [padNo, setPadNo] = useState<number | null>(null);

  const pageItems = items.slice(page * GROUP_SIZE, (page + 1) * GROUP_SIZE);
  const nextItems = items.slice((page + 1) * GROUP_SIZE, (page + 2) * GROUP_SIZE);
  const entered = countEntered(exam, session.answers);
  const first = pageItems[0];
  const lastItem = pageItems[pageItems.length - 1];
  const padItem = padNo === null ? null : (items.find((it) => it.no === padNo) ?? null);

  let layer = null;
  if (menuNo !== null) {
    const close = () => setMenuNo(null);
    layer = (
      <BottomSheet title={S.input.menuTitle(menuNo)} onClose={close}>
        <div className="stack gap2">
          <button
            type="button"
            className="btn btn--secondary btn--block"
            data-menu="skip"
            onClick={() => {
              putAnswer(h, menuNo, 'skip', 'input');
              close();
            }}
          >
            {S.input.menuSkip}
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--block"
            data-menu="clear"
            onClick={() => {
              putAnswer(h, menuNo, undefined, 'input');
              close();
            }}
          >
            {S.input.menuClear}
          </button>
        </div>
      </BottomSheet>
    );
  } else if (padItem) {
    layer = (
      <AnswerSheet
        key={padItem.no}
        item={padItem}
        value={session.answers[padItem.no]}
        title={S.input.sheetPutTitle(padItem.no)}
        onSet={(v) => putAnswer(h, padItem.no, v, 'input')}
        onClose={() => setPadNo(null)}
      />
    );
  }

  return (
    <Screen
      top={<InputTop h={h} />}
      bodyClass="body--rows"
      layer={layer}
      // 쪽이 넘어가면 같은 자리의 버튼이 다른 문항을 가리킨다. 연달아 누른 것으로 쪽을 건너뛰지 않게 한다.
      guardKey={`page-${page}`}
      actions={
        <div className="actions__row">
          {/* 버튼 자리가 쪽마다 달라지지 않게 "이전"은 첫 쪽에서도 같은 자리에 둔다. */}
          <button
            type="button"
            className="btn btn--secondary grow"
            aria-disabled={page === 0 ? 'true' : undefined}
            onClick={() => {
              if (page > 0) setPage(page - 1);
            }}
          >
            {S.input.prevPage}
          </button>
          {page < pages - 1 ? (
            <button type="button" className="btn btn--primary grow2" data-testid="rows-next" onClick={() => setPage(page + 1)}>
              {S.input.nextPage(nextItems.length)}
            </button>
          ) : (
            <button type="button" className="btn btn--primary grow2" data-testid="rows-next" onClick={() => navigate(h.path('/review'))}>
              {S.input.toReview}
            </button>
          )}
        </div>
      }
    >
      <div className="input-head">
        <div className="input-head__row">
          <span data-testid="page-range">
            {first && lastItem ? S.input.pageRange(first.no, lastItem.no) : ''}
          </span>
          <span className="sub" data-testid="entered-count">
            {S.input.entered(entered)}
          </span>
        </div>
        <Progress value={entered} max={items.length} label={S.input.progressLabel} />
      </div>

      <ol className="rows">
        {pageItems.map((it) => {
          const v = session.answers[it.no];
          return (
            <li key={it.no} className="row" data-row={it.no}>
              <button
                type="button"
                className="row__no"
                aria-label={v === 'skip' ? S.input.rowNoButtonSkipped(it.no) : S.input.rowNoButton(it.no)}
                data-row-no={it.no}
                onClick={() => setMenuNo(it.no)}
              >
                <span>{it.no}</span>
                {v === 'skip' ? <small>{S.common.skip}</small> : null}
              </button>
              {it.kind === 'mc' ? (
                <div className="row__choices" role="radiogroup" aria-label={S.input.rowAnswerLabel(it.no)}>
                  {Array.from({ length: choicesOf(it) }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={v === n}
                      className="radio"
                      data-choice={n}
                      onClick={() => putAnswer(h, it.no, n, 'input')}
                    >
                      <span className="radio__circle">{S.input.rowChoice(n)}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <button
                  type="button"
                  className="row__short"
                  data-short={it.no}
                  aria-label={
                    typeof v === 'number'
                      ? S.input.rowShortFilled(it.no, String(v))
                      : v === 'skip'
                        ? S.input.rowShortFilled(it.no, S.common.skip)
                        : S.input.rowShortOpen(it.no)
                  }
                  onClick={() => setPadNo(it.no)}
                >
                  {typeof v === 'number' ? <span className="row__short-val">{v}</span> : <span className="sub">{S.input.rowShortEmpty}</span>}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </Screen>
  );
}
