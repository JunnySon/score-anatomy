import { useState } from 'react';
import { platform } from '#platform';
import { Badge, Message, Screen, TopBar } from '../components/ui';
import { examShiftKey } from '../exams/merge';
import { typesReadyOf } from '../exams/validate';
import { analyze, type Grade } from '../logic/scoring';
import { selectSteps, type Step } from '../logic/steps';
import { retryLabel, selfCheckLabel, stepReasons, typesPendingText } from '../logic/text';
import { navigate } from '../router';
import type { SessionHandle } from '../state/hooks';
import { currentRetry } from '../state/session';
import { S } from '../strings';

// (9) 계단 화면. 먼저 고칠 유형을 내 기록만으로 정해 보여 준다.

function StepCard({ h, grade, step, index }: { h: SessionHandle; grade: Grade; step: Step; index: number }) {
  const { exam, session } = h;
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const reasons = stepReasons(step);
  const coordLines = step.coords.map((c) => S.steps.coord(c.label, c.itemNo));
  // 다시 푼 기록: 틀린 문항은 다시 넣은 답의 결과, 찍었다고 표시하고 맞은 문항은 스스로 확인한 결과.
  // 찍음 표시 정답에 1.0에서 남긴 답 기록(다시 풀어 맞힘)이 있어도 보여 주지 않는다.
  // 정답이 정정되기 전의 판에서 남긴 답 기록은 그때의 정답으로 맞춰 본 것이라 보여 주지 않는다(작업 지시서 3의 4-6, 기록은 지우지 않는다).
  const statusOf = (no: number): string | null => {
    const result = grade.items.find((it) => it.no === no);
    if (!result) return null;
    if (result.correct) {
      const self = session.selfChecks[no];
      return self ? selfCheckLabel(self.result) : null;
    }
    const rec = currentRetry(session, no, exam);
    return rec ? retryLabel(rec, result.cause) : null;
  };
  const retried = step.retryNos.map((no) => ({ no, label: statusOf(no) })).filter((r): r is { no: number; label: string } => r.label !== null);
  const titleId = `step-title-${step.typeId}`;
  return (
    <li className="card" data-testid={`step-${index + 1}`} data-type={step.typeId} aria-labelledby={titleId}>
      <h3 className="title" id={titleId}>
        {index + 1}. {step.name}
      </h3>
      {/* 배점 문장은 유형 이름 아래 줄에 두고 줄바꿈을 허용한다. */}
      <p className="sub" data-testid="step-points">
        {S.steps.points(step.wrongPoints, step.guessCorrectPoints)}
      </p>
      <p className="mt2" data-testid="step-reason">
        {reasons.join(' ')}
      </p>

      <h4 className="sub mt4">{S.steps.todoTitle}</h4>
      <ol className="stack gap2 mt2">
        <li data-testid="todo-today">1. {S.steps.todoToday(step.retryNos)}</li>
        {coordLines.length > 0 ? (
          <li data-testid="todo-coords">
            <div className="inline">
              <span>2. {S.steps.coordsTitle}</span>
              {exam.isSample ? <Badge>{S.steps.coordsSample}</Badge> : null}
            </div>
            <ul className="sub mt2 selectable">
              {coordLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <button
              type="button"
              className="btn btn--text btn--left"
              data-testid="copy-coords"
              onClick={() => {
                void platform.copy(coordLines.join('\n')).then((ok) => setCopyMsg(ok ? S.steps.copied : S.steps.copyFailed));
              }}
            >
              {S.steps.copy}
            </button>
            {copyMsg ? <Message plain>{copyMsg}</Message> : null}
          </li>
        ) : null}
      </ol>

      {retried.length > 0 ? (
        <div className="mt3" data-testid="retry-status">
          <h4 className="sub">{S.steps.retryStatusTitle}</h4>
          <ul className="mt2">
            {retried.map((r) => (
              <li key={r.no}>{S.steps.retryStatus(r.no, r.label)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <button
        type="button"
        className="btn btn--secondary btn--block mt3"
        data-testid="retry-btn"
        aria-label={S.steps.retryOf(step.name)}
        onClick={() => navigate(h.path(`/retry/${encodeURIComponent(step.typeId)}`))}
      >
        {S.steps.retry}
      </button>

      <details className="mt2">
        <summary>{S.steps.how}</summary>
        <p className="sub">{S.steps.howBody(step.wrongPoints, step.guessCorrectPoints, step.score)}</p>
      </details>
    </li>
  );
}

export function Steps({ h, grade }: { h: SessionHandle; grade: Grade }) {
  // 유형 분류 전(typesReady false)에는 계단을 셈하지 않고 계단 대신 안내를 보여 준다. 유형 이름도 보여 주지 않는다(작업 지시서 3의 4-3).
  const typesReady = typesReadyOf(h.exam);
  const steps = typesReady ? selectSteps(h.exam, grade) : [];
  // 찍음 표시가 붙은 모두 정답 처리 문항은 계단에 넣지 않는다. 그 사실을 계단 위에 적는다(작업 지시서 3의 4-2, 별도 검토 D1).
  const allCorrectGuess = typesReady && analyze(h.exam, grade).allCorrectGuessCount > 0;
  return (
    <Screen
      top={<TopBar back={h.path('/anatomy')} title={S.steps.top} />}
      tabs="current"
      // 넘겨받은 새 판으로 계단 카드가 바뀌면 카드의 자리가 옮겨 간다. 그때는 마지막 누름과 상관없이 잠깐 막는다(별도 검토 A3).
      shiftKey={examShiftKey(h.exam)}
    >
      <div className="inline">
        <h2 className="title">{steps.length > 0 ? S.steps.title(steps.length) : S.steps.emptyTitle}</h2>
        {h.exam.isSample ? <Badge>{S.common.sample}</Badge> : null}
      </div>
      {allCorrectGuess ? (
        <p className="sub mt2" data-testid="steps-all-correct">
          {S.steps.allCorrectGuess}
        </p>
      ) : null}
      {!typesReady ? (
        <p className="mt4" data-testid="steps-pending">
          {typesPendingText(h.exam)}
        </p>
      ) : steps.length === 0 ? (
        <p className="mt4" data-testid="steps-empty">
          {S.steps.empty}
        </p>
      ) : (
        <ol className="stack gap4 mt4">
          {steps.map((step, i) => (
            <StepCard key={step.typeId} h={h} grade={grade} step={step} index={i} />
          ))}
        </ol>
      )}
    </Screen>
  );
}
