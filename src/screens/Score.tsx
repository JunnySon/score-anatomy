import { CorrectionNotice } from '../components/CorrectionNotice';
import { Badge, Screen, TopBar } from '../components/ui';
import { examShiftKey } from '../exams/merge';
import type { Grade } from '../logic/scoring';
import { navigate } from '../router';
import type { SessionHandle } from '../state/hooks';
import { acknowledgeCorrection, correctionNotice, correctionOf, isMarkedAfterGrading } from '../state/session';
import { S } from '../strings';

// (6) 점수 화면. 점수가 낮아도 형식은 같다. 평가와 위로를 적지 않는다.

export function Score({ h, grade }: { h: SessionHandle; grade: Grade }) {
  const { exam, session } = h;
  // 정답 정정 알림(작업 지시서 3의 4-6). 점수(grade)는 지금 정답으로 계산한 값이다. 예시 결과에는 보여 주지 않는다.
  const notice = h.isDemo ? null : correctionNotice(correctionOf(session, exam, grade));
  return (
    <Screen
      top={<TopBar title={S.score.top} />}
      tabs="current"
      // 알림이 닫히면 아래 내용이 위로 올라오므로, 같은 자리를 연달아 누른 것이 올라온 요소에 닿지 않게 한다.
      guardKey={notice ? 'correction' : 'plain'}
      // 넘겨받은 새 판으로 정정 알림이 생기면 아래 내용이 내려간다. 그때는 마지막 누름과 상관없이 잠깐 막는다(별도 검토 A3).
      shiftKey={examShiftKey(exam)}
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
      {notice ? <CorrectionNotice notice={notice} onAck={() => h.update((s) => acknowledgeCorrection(s, exam))} /> : null}
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
      {session.answersEditedAfterGrading.length > 0 ? (
        <p className="cap mt2" data-testid="edited-note">
          {S.common.editedAfterGrading(session.answersEditedAfterGrading)}
        </p>
      ) : null}
    </Screen>
  );
}
