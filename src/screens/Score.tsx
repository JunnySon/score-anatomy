import { Badge, Screen, TopBar } from '../components/ui';
import type { Grade } from '../logic/scoring';
import { navigate } from '../router';
import type { SessionHandle } from '../state/hooks';
import { isMarkedAfterGrading } from '../state/session';
import { S } from '../strings';

// (6) 점수 화면. 점수가 낮아도 형식은 같다. 평가와 위로를 적지 않는다.

export function Score({ h, grade }: { h: SessionHandle; grade: Grade }) {
  const { exam, session } = h;
  return (
    <Screen
      top={<TopBar title={S.score.top} />}
      tabs="current"
      actions={
        <>
          <div className="actions__row">
            <button type="button" className="btn btn--text grow" onClick={() => navigate(h.path('/review'))}>
              {S.score.fix}
            </button>
            <button type="button" className="btn btn--secondary grow" onClick={() => navigate(h.path('/anatomy'))}>
              {S.score.toAnatomy}
            </button>
          </div>
          <button type="button" className="btn btn--primary" onClick={() => navigate(h.path('/causes'))}>
            {S.score.toCauses}
          </button>
        </>
      }
    >
      <div className="inline">
        <p className="sub">{exam.title}</p>
        {exam.isSample ? <Badge>{S.common.sample}</Badge> : null}
      </div>
      <p className="hero mt4" data-testid="score">
        {S.common.points(grade.actual)}
      </p>
      <p className="mt2">{S.common.correctOf(grade.itemCount, grade.correctCount)}</p>
      {isMarkedAfterGrading(session) ? (
        <p className="cap mt4" data-testid="after-grading-note">
          {S.common.afterGradingNote}
        </p>
      ) : null}
    </Screen>
  );
}
