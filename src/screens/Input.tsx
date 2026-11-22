import { useState } from 'react';
import { AnswerSheet, DigitPad, EntryBox, McPad } from '../components/pads';
import { Badge, BottomSheet, Message, Progress, Screen, TopBar } from '../components/ui';
import { choicesOf } from '../exams/validate';
import { eraseDigit, initEntry, pressDigit } from '../logic/entry';
import { countEntered } from '../logic/scoring';
import { GROUP_SIZE, groupCount, groupIndexOf, sectionOf } from '../logic/sections';
import { navigate } from '../router';
import { logAnswerCommit, putAnswer, type SessionHandle } from '../state/hooks';
import { answerText, firstMissingIndex } from '../state/session';
import { S } from '../strings';
import type { AnswerValue, ExamItem, InputMode } from '../types';

// (3) 답 입력 화면. 키패드 방식과 5행 방식이 같은 기록을 쓴다.

export function InputScreen({ h, mode }: { h: SessionHandle; mode: InputMode }) {
  return mode === 'rows' ? <InputRows h={h} /> : <InputKeypad h={h} />;
}

function InputTop({ h }: { h: SessionHandle }) {
  return (
    <TopBar
      back="/exams"
      title={h.exam.title}
      right={
        <button type="button" className="btn btn--text" onClick={() => navigate(h.path('/review'))}>
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
}: {
  item: ExamItem;
  value: AnswerValue | undefined;
  current: boolean;
  onSelect: () => void;
}) {
  const text = answerText(value, S.common.skip);
  return (
    <button
      type="button"
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
  // 이미 넣어 둔 단답형 답에 막 도착한 상태인지. 이때 숫자를 누르면 새로 쓴다.
  const [freshNo, setFreshNo] = useState<number | null>(() => {
    const it = items[cursor];
    return it && typeof session.answers[it.no] === 'number' ? it.no : null;
  });
  const [msg, setMsg] = useState<string | null>(null);

  const item = items[Math.min(cursor, last)]!;
  const existing = session.answers[item.no];
  const section = sectionOf(exam, item.no);
  const entered = countEntered(exam, session.answers);
  const g = groupIndexOf(cursor);
  const currentGroup = items.slice(g * GROUP_SIZE, (g + 1) * GROUP_SIZE);
  const prevGroup = g > 0 ? items.slice((g - 1) * GROUP_SIZE, g * GROUP_SIZE) : [];

  const goTo = (index: number) => {
    const it = items[index];
    if (!it) return;
    setCursor(index);
    setMsg(null);
    setFreshNo(typeof session.answers[it.no] === 'number' ? it.no : null);
  };

  const advance = () => {
    setMsg(null);
    if (cursor >= last) navigate(h.path('/review'));
    else goTo(cursor + 1);
  };

  /** 한 칸 뒤로 가서 지운다. */
  const eraseBack = () => {
    if (cursor <= 0) return;
    const prev = items[cursor - 1]!;
    putAnswer(h, prev.no, undefined, 'input');
    setCursor(cursor - 1);
    setFreshNo(null);
  };

  const put = (v: AnswerValue) => {
    putAnswer(h, item.no, v, 'input');
    advance();
  };

  const eraseMc = () => {
    setMsg(null);
    // 지금 칸에 답이 있으면 그 칸을 지우고, 비어 있으면 한 칸 뒤로 가서 지운다.
    if (existing !== undefined) putAnswer(h, item.no, undefined, 'input');
    else eraseBack();
  };

  const entry = { ...initEntry(existing), fresh: freshNo === item.no };

  const onDigit = (d: number) => {
    const r = pressDigit(entry, d);
    setFreshNo(null);
    if (r.overflow) {
      setMsg(S.common.shortRange);
      return;
    }
    setMsg(null);
    // 누른 숫자는 바로 칸에 반영한다. 넘어가는 것은 "다음"을 눌렀을 때뿐이다.
    putAnswer(h, item.no, Number(r.entry.text), 'input', false);
  };

  const eraseShort = () => {
    setMsg(null);
    setFreshNo(null);
    if (typeof existing === 'number') {
      const next = eraseDigit(entry).text;
      putAnswer(h, item.no, next === '' ? undefined : Number(next), 'input', false);
    } else if (existing === 'skip') {
      putAnswer(h, item.no, undefined, 'input', false);
    } else {
      eraseBack();
    }
  };

  const nextShort = () => {
    if (existing === undefined) {
      setMsg(S.common.emptyItem(item.no));
      return;
    }
    logAnswerCommit(h, item.no);
    advance();
  };

  const pad =
    item.kind === 'mc' ? (
      <McPad
        choices={choicesOf(item)}
        onPick={(n) => put(n)}
        fn={[
          { key: 'skip', label: S.common.skip, onPress: () => put('skip') },
          { key: 'erase', label: S.common.erase, onPress: eraseMc },
        ]}
      />
    ) : (
      <DigitPad onDigit={onDigit} onErase={eraseShort} onSkip={() => put('skip')} onGo={nextShort} goLabel={S.common.next} />
    );

  return (
    <Screen top={<InputTop h={h} />} footer={pad} bodyClass="body--fit">
      <div className="input-head">
        <div className="input-head__row">
          <span className="strong" data-testid="section-name">
            {section ? S.input.section(section.kind, section.from, section.to) : ''}
          </span>
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
        {item.kind === 'short' ? <EntryBox text={answerText(existing, S.common.skip)} label={S.input.entryLabel} /> : null}
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
            <Cell key={it.no} item={it} value={session.answers[it.no]} current={it.no === item.no} onSelect={() => goTo(items.indexOf(it))} />
          ))}
          <GhostCells count={GROUP_SIZE - currentGroup.length} />
        </div>
      </div>

      <p className="sub hint">{S.input.hint}</p>
      {msg ? (
        <div className="mt2">
          <Message>{msg}</Message>
        </div>
      ) : null}
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
          <span className="strong" data-testid="page-range">
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
                className={`row__no${v === 'skip' ? ' row__no--skip' : ''}`}
                aria-label={S.input.rowNoButton(it.no)}
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
                  aria-label={typeof v === 'number' ? S.input.rowShortFilled(it.no, String(v)) : S.input.rowShortOpen(it.no)}
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
