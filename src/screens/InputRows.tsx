import { useState } from 'react';
import { AnswerSheet } from '../components/pads';
import { BottomSheet, Progress, Screen } from '../components/ui';
import { choicesOf } from '../exams/validate';
import { countEntered } from '../logic/scoring';
import { GROUP_SIZE, groupCount, groupIndexOf } from '../logic/sections';
import { navigate } from '../router';
import { putAnswer, type SessionHandle } from '../state/hooks';
import { firstMissingIndex } from '../state/session';
import { S, S_ROWS } from '../strings';
import { InputTop } from './InputTop';
import './InputRows.css';

// (3) 답 입력 화면의 5행 방식. 한 쪽에 5문항이고 자동으로 넘기지 않는다.
// 사용성 테스트에서 키패드 방식과 견주는 데만 쓴다. 앱 배포용 묶음에는 싣지 않는다(src/tools).

export function InputRows({ h }: { h: SessionHandle }) {
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
      <BottomSheet title={S_ROWS.menuTitle(menuNo)} onClose={close}>
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
            {S_ROWS.menuSkip}
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
            {S_ROWS.menuClear}
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
        title={S_ROWS.sheetPutTitle(padItem.no)}
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
            {S_ROWS.prevPage}
          </button>
          {page < pages - 1 ? (
            <button type="button" className="btn btn--primary grow2" data-testid="rows-next" onClick={() => setPage(page + 1)}>
              {S_ROWS.nextPage(nextItems.length)}
            </button>
          ) : (
            <button type="button" className="btn btn--primary grow2" data-testid="rows-next" onClick={() => navigate(h.path('/review'))}>
              {S_ROWS.toReview}
            </button>
          )}
        </div>
      }
    >
      <div className="input-head">
        <div className="input-head__row">
          <span data-testid="page-range">{first && lastItem ? S_ROWS.pageRange(first.no, lastItem.no) : ''}</span>
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
                aria-label={v === 'skip' ? S_ROWS.rowNoButtonSkipped(it.no) : S_ROWS.rowNoButton(it.no)}
                data-row-no={it.no}
                onClick={() => setMenuNo(it.no)}
              >
                <span>{it.no}</span>
                {v === 'skip' ? <small>{S.common.skip}</small> : null}
              </button>
              {it.kind === 'mc' ? (
                <div className="row__choices" role="radiogroup" aria-label={S_ROWS.rowAnswerLabel(it.no)}>
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
                      <span className="radio__circle">{S_ROWS.rowChoice(n)}</span>
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
                      ? S_ROWS.rowShortFilled(it.no, String(v))
                      : v === 'skip'
                        ? S_ROWS.rowShortFilled(it.no, S.common.skip)
                        : S_ROWS.rowShortOpen(it.no)
                  }
                  onClick={() => setPadNo(it.no)}
                >
                  {typeof v === 'number' ? <span className="row__short-val">{v}</span> : <span className="sub">{S_ROWS.rowShortEmpty}</span>}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </Screen>
  );
}
