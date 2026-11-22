import { Badge, IconCross, Option, Screen, TopBar } from '../components/ui';
import type { Grade } from '../logic/scoring';
import { navigate } from '../router';
import type { SessionHandle } from '../state/hooks';
import { answerText, setCause, viewAnswer } from '../state/session';
import { S } from '../strings';
import type { Cause } from '../types';

// (7) 오답 원인 화면. "정답 보기"를 누르기 전에는 정답을 보여 주지 않는다.

export function Causes({ h, grade }: { h: SessionHandle; grade: Grade }) {
  const { exam, session } = h;
  const wrong = grade.wrong;
  const allChosen = wrong.every((w) => session.causes[w.no] !== undefined);
  const toAnatomy = () => navigate(h.path('/anatomy'));
  return (
    <Screen
      top={<TopBar back={h.path('/score')} title={S.causes.top} />}
      tabs="current"
      actions={
        <div className="actions__row">
          {wrong.length > 0 && !allChosen ? (
            <button type="button" className="btn btn--text grow" onClick={toAnatomy}>
              {S.causes.skip}
            </button>
          ) : null}
          <button type="button" className="btn btn--primary grow2" onClick={toAnatomy}>
            {S.causes.go}
          </button>
        </div>
      }
    >
      <div className="inline">
        <h2 className="title">{S.causes.title}</h2>
        {exam.isSample ? <Badge>{S.common.sample}</Badge> : null}
      </div>
      {wrong.length === 0 ? (
        <p className="mt4">{S.causes.empty}</p>
      ) : (
        <>
          <p className="sub mt2">{S.causes.body}</p>
          <ol className="stack gap4 mt4" aria-label={S.causes.listLabel}>
            {wrong.map((w) => {
              const item = exam.items.find((it) => it.no === w.no);
              const viewed = session.answerViewed[w.no] === true;
              return (
                <li key={w.no} className="card" data-testid={`wrong-${w.no}`}>
                  <div className="inline">
                    <h3 className="title">{S.common.itemNo(w.no)}</h3>
                    <Badge>{S.common.points(w.points)}</Badge>
                    <span className="tag tag--bad">
                      <IconCross />
                      {S.causes.wrongTag}
                    </span>
                    <span className="sub">{S.causes.mine(answerText(w.response, S.common.skip))}</span>
                  </div>
                  <div className="opts mt3" role="radiogroup" aria-label={S.causes.groupLabel(w.no)}>
                    {(Object.keys(S.causes.options) as Cause[]).map((c) => (
                      <Option key={c} testId={`cause-${w.no}-${c}`} checked={session.causes[w.no] === c} onSelect={() => h.update((s) => setCause(s, w.no, c))}>
                        {S.causes.options[c]}
                      </Option>
                    ))}
                  </div>
                  {viewed && item && typeof item.answer === 'number' ? (
                    <p className="inline mt3" data-testid={`answer-${w.no}`} style={{ minHeight: 'var(--touch)' }}>
                      <span>{S.causes.answer(item.answer)}</span>
                      <Badge>{S.causes.viewed}</Badge>
                    </p>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--text btn--left mt2"
                      data-testid={`show-answer-${w.no}`}
                      aria-label={S.causes.showAnswerOf(w.no)}
                      onClick={() => h.update((s) => viewAnswer(s, w.no))}
                    >
                      {S.causes.showAnswer}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </Screen>
  );
}
