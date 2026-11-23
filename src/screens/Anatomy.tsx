import { useState } from 'react';
import { ScoreBar } from '../components/ScoreBar';
import { Badge, BottomSheet, Chip, IconInfo, Message, Screen, TopBar } from '../components/ui';
import { typesReadyOf } from '../exams/validate';
import { cutView, gradeKeys, type CutView } from '../logic/cuts';
import { analyze, type Grade } from '../logic/scoring';
import { selectSteps } from '../logic/steps';
import { actualLine, anatomySentences, asOfLine, cutNote, luckLine, noCutsText, typesPendingText } from '../logic/text';
import { href, navigate } from '../router';
import type { SessionHandle } from '../state/hooks';
import { isMarkedAfterGrading, setTargetGrade } from '../state/session';
import { S } from '../strings';

// (8) 점수 해부 화면. 이 앱의 핵심 화면이다.
// 주 숫자는 실제 점수 하나뿐이다. 추정값에는 "추정" 배지와 "약"을 붙인다.

/**
 * 등급컷 출처 시트의 내용: 예시 값인지, 출처, 기준, 설명(작업 지시서 3의 4-4).
 * 배지를 눌러야 열리는 시트라서, 단위 테스트가 서버 그리기로 글자를 볼 수 있게 따로 내보낸다.
 */
export function CutSource({ cv, isSample }: { cv: CutView; isSample: boolean }) {
  return (
    <div className="stack gap2" data-testid="cut-source">
      {isSample ? <p>{S.anatomy.sourceSample}</p> : null}
      <p>{S.anatomy.source(cv.source)}</p>
      <p>{asOfLine(cv.asOf)}</p>
      <p className="sub">{cutNote(cv)}</p>
    </div>
  );
}

export function Anatomy({ h, grade }: { h: SessionHandle; grade: Grade }) {
  const { exam, session } = h;
  const [sourceOpen, setSourceOpen] = useState(false);
  const an = analyze(exam, grade);
  // 유형 분류 전(typesReady false)에는 계단을 셈하지 않고, 계단으로 가는 버튼 자리에 안내를 둔다(작업 지시서 3의 4-3).
  const typesReady = typesReadyOf(exam);
  const steps = typesReady ? selectSteps(exam, grade) : [];
  const keys = gradeKeys(exam);
  const cv = cutView(exam, an, session.targetGrade);
  const sentences = anatomySentences(an);
  const unmarkedCauses = an.wrongCount - an.causeMarkedCount;
  const causesHref = href(h.path('/causes'));
  const badgeText = cv?.confirmed ? S.common.confirmed : S.common.estimate;
  const line1 = cv ? actualLine(cv, an.actual) : null;
  const line2 = cv ? luckLine(cv, an.luckAverageRounded) : null;

  return (
    <Screen
      top={<TopBar back={h.isDemo ? '/' : '/score'} title={S.anatomy.top} />}
      tabs="current"
      layer={
        sourceOpen && cv ? (
          <BottomSheet title={S.anatomy.sourceTitle} onClose={() => setSourceOpen(false)}>
            <CutSource cv={cv} isSample={exam.isSample} />
          </BottomSheet>
        ) : null
      }
      actions={
        typesReady ? (
          <button type="button" className="btn btn--primary" data-testid="to-steps" onClick={() => navigate(h.path('/steps'))}>
            {S.anatomy.toSteps(steps.length)}
          </button>
        ) : (
          <Message plain testId="steps-pending">
            {typesPendingText(exam)}
          </Message>
        )
      }
    >
      <div className="inline">
        <p className="sub">{exam.title}</p>
        {exam.isSample ? <Badge>{S.common.sample}</Badge> : null}
      </div>
      <p className="hero mt2" data-testid="actual">
        {S.common.points(an.actual)}
      </p>
      <p className="mt2">{S.common.correctOf(an.itemCount, an.correctCount)}</p>

      <div className="mt4">
        <ScoreBar an={an} />
      </div>

      <div className="mt2" data-testid="rows">
        {an.guessCorrectPoints > 0 ? (
          <div className="arow" data-testid="row-guess">
            <span className="swatch seg--hatch" aria-hidden="true" />
            <span>{S.anatomy.rowGuess}</span>
            <span className="num">{S.common.points(an.guessCorrectPoints)}</span>
            <span className="sub arow__sub">{S.anatomy.rowGuessSub(an.actual)}</span>
          </div>
        ) : an.hasGuessMark ? (
          <p className="arow arow--text" data-testid="row-guess-none">
            {S.anatomy.rowGuessNone}
          </p>
        ) : (
          <p className="arow arow--text" data-testid="row-guess-empty">
            {/* 원인을 표시한 행이 아래에 있으면 "나눠 볼 것이 없어요"라고 하지 않고 찍음 표시가 없다는 사실만 적는다. */}
            {/* 찍음 표시가 모두 정답 처리 문항에만 있으면 표시가 없다고 하지 않고, 그 문항을 따로 나누지 않았다고 적는다(작업 지시서 3의 4-2). */}
            {an.allCorrectGuessCount > 0
              ? S.anatomy.emptyGuessAllCorrect(an.actual)
              : an.causeMarkedCount > 0
                ? S.anatomy.emptyGuessOnly(an.actual)
                : an.hasAnyMark
                  ? S.anatomy.emptyGuess(an.actual)
                  : S.anatomy.emptyMarks(an.actual)}
          </p>
        )}

        {an.wrongCount === 0 ? null : an.causeMarkedCount === 0 ? (
          <div className="arow arow--text" data-testid="row-slip-empty">
            <p>{S.anatomy.causesUnmarked}</p>
            <a className="btn btn--text btn--left link" href={causesHref}>
              {S.anatomy.toCauses}
            </a>
          </div>
        ) : an.slipPoints > 0 ? (
          <div className="arow" data-testid="row-slip">
            <span className="swatch seg--outline" aria-hidden="true" />
            <span>{S.anatomy.rowSlip}</span>
            <span className="num">{S.common.points(an.slipPoints)}</span>
            <span className="sub arow__sub">{S.anatomy.rowSlipSub(an.actual)}</span>
          </div>
        ) : (
          <p className="arow arow--text" data-testid="row-slip-none">
            {S.anatomy.rowSlipNone}
          </p>
        )}
        {an.causeMarkedCount > 0 && unmarkedCauses > 0 ? (
          <div className="arow arow--text" data-testid="row-causes-partly">
            <p className="sub">{S.anatomy.causesPartly(unmarkedCauses)}</p>
            <a className="btn btn--text btn--left link" href={causesHref}>
              {S.anatomy.toCauses}
            </a>
          </div>
        ) : null}
      </div>

      {sentences.length > 0 ? (
        <p className="mt3" data-testid="sentence">
          {sentences.join(' ')}
        </p>
      ) : null}
      {isMarkedAfterGrading(session) ? (
        <p className="cap mt2" data-testid="after-grading-note">
          {S.common.afterGradingNote}
        </p>
      ) : null}
      {session.answersEditedAfterGrading.length > 0 ? (
        <p className="cap mt2" data-testid="edited-note">
          {S.common.editedAfterGrading(session.answersEditedAfterGrading)}
        </p>
      ) : null}

      <section className="box mt6" aria-label={S.anatomy.cutBoxLabel} data-testid="cutbox">
        {keys.length === 0 ? (
          <p data-testid="no-cuts">{noCutsText(exam)}</p>
        ) : (
          <>
            <p className={cv ? 'sub' : undefined} id="target-q">
              {cv ? S.anatomy.targetLabel : S.anatomy.targetQ}
            </p>
            <div className="chips mt2" role="radiogroup" aria-labelledby="target-q">
              {keys.map((g) => (
                <Chip key={g} testId={`grade-${g}`} checked={session.targetGrade === g} onSelect={() => h.update((s) => setTargetGrade(s, g))}>
                  {S.anatomy.gradeChip(g)}
                </Chip>
              ))}
            </div>
            {cv && line1 ? (
              <div className="mt3" aria-live="polite">
                <div className="cut-head">
                  <p data-testid="cut-title">
                    {S.anatomy.cutTitle(cv.grade, cv.lo, cv.hi)}
                  </p>
                  <button
                    type="button"
                    className="badge-btn"
                    data-testid="cut-badge"
                    aria-label={S.anatomy.cutBadgeLabel(badgeText)}
                    onClick={() => setSourceOpen(true)}
                  >
                    <span className="badge">
                      {badgeText}
                      <IconInfo />
                    </span>
                  </button>
                </div>
                <p className="num" data-testid="cut-actual">
                  {line1.lead.map((part, i) => (
                    <span key={part}>
                      {i > 0 ? ' ' : ''}
                      <span className="nowrap">{part}</span>
                    </span>
                  ))}
                </p>
                {line1.rest ? <p className="mt2">{line1.rest}</p> : null}
                {line2 ? (
                  <div className="mt3">
                    <p data-testid="cut-luck">
                      {line2} <Badge>{S.common.estimate}</Badge>
                    </p>
                    <details>
                      <summary>{S.anatomy.luckSummary(an.luckAverageRounded)}</summary>
                      <p className="sub" data-testid="luck-detail">
                        {S.anatomy.luckDetail(an.actual)}
                      </p>
                    </details>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </section>

      <p className="mt4">
        {h.isDemo ? (
          <button type="button" className="btn btn--text btn--left" onClick={() => navigate('/exams')}>
            {S.anatomy.pickExam}
          </button>
        ) : (
          <button type="button" className="btn btn--text btn--left" onClick={() => navigate('/review')}>
            {S.anatomy.fix}
          </button>
        )}
      </p>
    </Screen>
  );
}
