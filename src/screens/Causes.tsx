import { Badge, IconCross, Option, Screen, TopBar } from '../components/ui';
import { examShiftKey } from '../exams/merge';
import { acceptedAnswers } from '../exams/validate';
import type { Grade } from '../logic/scoring';
import { navigate } from '../router';
import type { SessionHandle } from '../state/hooks';
import { answerSeenNow, answerText, setCause, viewAnswer } from '../state/session';
import { S } from '../strings';
import type { Cause } from '../types';

// (7) 오답 원인 화면. "정답 보기"를 누르기 전에는 정답을 보여 주지 않는다.
// 정답은 인정하는 답(answer 와 복수 정답 altAnswers)으로 보여 준다. 모두 정답 처리 문항은 늘 맞은 것이라
// 틀린 문항 목록에 오지 않으므로, 목록 아래에 따로 알린다(작업 지시서 3의 4-2).

/** "정답 보기"를 누른 뒤의 정답 칸. 복수 정답이면 인정하는 답을 모두 적고 함께 인정한다고 알린다. */
function AnswerShown({ no, accepted }: { no: number; accepted: number[] }) {
  const line = (
    <>
      <span>{S.causes.answer(accepted)}</span>
      <Badge>{S.causes.viewed}</Badge>
    </>
  );
  // 정답이 하나면 1.1과 같은 모양이다.
  if (accepted.length === 1) {
    return (
      <p className="inline mt3" data-testid={`answer-${no}`} style={{ minHeight: 'var(--touch)' }}>
        {line}
      </p>
    );
  }
  return (
    <div className="mt3" data-testid={`answer-${no}`}>
      <p className="inline" style={{ minHeight: 'var(--touch)' }}>
        {line}
      </p>
      <p className="sub">{S.causes.acceptedAll(accepted.length)}</p>
    </div>
  );
}

export function Causes({ h, grade }: { h: SessionHandle; grade: Grade }) {
  const { exam, session } = h;
  const wrong = grade.wrong;
  // 모두 정답 처리 문항. 정답을 드러내는 말이 아니라서 "정답 보기"를 누르지 않아도 보여 준다.
  const allCorrectItems = exam.items.filter((it) => it.allCorrect === true);
  const allChosen = wrong.every((w) => session.causes[w.no] !== undefined);
  const toAnatomy = () => navigate(h.path('/anatomy'));
  return (
    <Screen
      top={<TopBar back={h.path('/score')} title={S.causes.top} />}
      tabs="current"
      // 정정된 판이 오면 틀린 문항 카드가 빠지거나 더해져 아래 카드의 자리가 옮겨 간다. 그때 누른 것이 다른 문항의 원인으로 들어가지 않게 한다(별도 검토 A3).
      shiftKey={examShiftKey(exam)}
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
              // 지금 정답을 봤을 때만 정답을 펼친다. 정답 보기를 누른 뒤 정답이 정정되어 그 문항의 정답이 바뀌었으면
              // 바뀌었다고 적고 "정답 보기"를 다시 둔다(별도 검토 A5). 학생이 누르기 전에는 새 정답을 보여 주지 않는다.
              const viewed = item ? answerSeenNow(session, item) : false;
              const changedAfterView = session.answerViewed[w.no] === true && !viewed;
              const accepted = item ? acceptedAnswers(item) : [];
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
                  {viewed && accepted.length > 0 ? (
                    <AnswerShown no={w.no} accepted={accepted} />
                  ) : (
                    <>
                      {changedAfterView ? (
                        <p className="sub mt3" data-testid={`answer-changed-${w.no}`}>
                          {S.causes.answerChanged}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn--text btn--left mt2"
                        data-testid={`show-answer-${w.no}`}
                        aria-label={S.causes.showAnswerOf(w.no)}
                        onClick={() => h.update((s) => viewAnswer(s, w.no, item))}
                      >
                        {S.causes.showAnswer}
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
      {allCorrectItems.length > 0 ? (
        <ul className="stack gap4 mt4" aria-label={S.causes.allCorrectLabel}>
          {allCorrectItems.map((it) => (
            <li key={it.no} className="card" data-testid={`all-correct-${it.no}`}>
              <div className="inline">
                <h3 className="title">{S.common.itemNo(it.no)}</h3>
                <Badge>{S.common.points(it.points)}</Badge>
              </div>
              <p className="mt2">{S.causes.allCorrect}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </Screen>
  );
}
