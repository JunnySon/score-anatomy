import { useRef, useState } from 'react';
import { AnswerSheet } from '../components/pads';
import { Message, Screen, TopBar } from '../components/ui';
import { findMissing } from '../logic/scoring';
import { navigate } from '../router';
import { logReviewConfirm, putAnswer, type SessionHandle } from '../state/hooks';
import { answerText } from '../state/session';
import { S } from '../strings';

// (4) 입력 확인 화면. 미입력이 남아 있으면 넘어가지 않는다.

export function Review({ h }: { h: SessionHandle }) {
  const { exam, session } = h;
  const missing = findMissing(exam, session.answers);
  const [editNo, setEditNo] = useState<number | null>(null);
  const [warned, setWarned] = useState(false);
  const refs = useRef(new Map<number, HTMLButtonElement>());
  const editItem = editNo === null ? null : (exam.items.find((it) => it.no === editNo) ?? null);
  const firstMissing = missing[0];

  const go = () => {
    if (firstMissing !== undefined) {
      // 첫 미입력 칸으로 옮기며 안내한다.
      setWarned(true);
      const el = refs.current.get(firstMissing);
      el?.scrollIntoView({ block: 'center' });
      el?.focus({ preventScroll: true });
      return;
    }
    logReviewConfirm();
    navigate(h.path('/marks'));
  };

  return (
    <Screen
      top={<TopBar back={h.path('/input')} title={exam.title} />}
      tabs="current"
      layer={
        editItem ? (
          <AnswerSheet
            key={editItem.no}
            item={editItem}
            value={session.answers[editItem.no]}
            title={S.review.sheetTitle(editItem.no)}
            onSet={(v) => putAnswer(h, editItem.no, v, 'review')}
            onClose={() => setEditNo(null)}
          />
        ) : null
      }
      actions={
        <>
          {warned && firstMissing !== undefined ? <Message>{S.common.emptyItem(firstMissing)}</Message> : null}
          <button type="button" className="btn btn--primary" onClick={go}>
            {S.review.go}
          </button>
        </>
      }
    >
      <h2 className="title">{S.review.title}</h2>
      <p className="sub mt2">{S.review.hint}</p>
      <div className="grid5 mt4" role="group" aria-label={S.review.gridLabel}>
        {exam.items.map((it) => {
          const v = session.answers[it.no];
          const isMissing = missing.includes(it.no);
          const text = answerText(v, S.common.skip);
          return (
            <button
              key={it.no}
              type="button"
              ref={(el) => {
                if (el) refs.current.set(it.no, el);
                else refs.current.delete(it.no);
              }}
              className={`cell cell--tall${isMissing ? ' cell--missing' : ''}`}
              data-cell={it.no}
              data-missing={isMissing ? 'true' : undefined}
              aria-label={isMissing ? S.review.cellMissing(it.no) : S.review.cellFilled(it.no, text)}
              onClick={() => setEditNo(it.no)}
            >
              <span className="cell__no">{it.no}</span>
              <span className={`cell__val${isMissing || v === 'skip' ? ' cell__val--small' : ''}`}>{isMissing ? S.review.missing : text}</span>
            </button>
          );
        })}
      </div>
    </Screen>
  );
}
