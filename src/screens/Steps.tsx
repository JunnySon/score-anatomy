import { useState } from 'react';
import { Badge, Message, Screen, TopBar } from '../components/ui';
import type { Grade } from '../logic/scoring';
import { selectSteps, type Step } from '../logic/steps';
import { retryLabel, stepReasons } from '../logic/text';
import { navigate } from '../router';
import type { SessionHandle } from '../state/hooks';
import { S } from '../strings';

// (9) 계단 화면. 먼저 고칠 유형을 내 기록만으로 정해 보여 준다.

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 아래의 다른 방법으로 넘어간다.
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function StepCard({ h, grade, step, index }: { h: SessionHandle; grade: Grade; step: Step; index: number }) {
  const { exam, session } = h;
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const reasons = stepReasons(step);
  const coordLines = step.coords.map((c) => S.steps.coord(c.label, c.itemNo));
  const retried = step.retryNos.filter((no) => session.retries[no] !== undefined);
  const titleId = `step-title-${step.typeId}`;
  return (
    <li className="card" data-testid={`step-${index + 1}`} data-type={step.typeId} aria-labelledby={titleId}>
      <div className="input-head__row">
        <h3 className="title" id={titleId}>
          {index + 1}. {step.name}
        </h3>
        <span className="sub nowrap" data-testid="step-points">
          {step.wrongPoints > 0 ? S.steps.missed(step.wrongPoints) : S.steps.guessOnly(step.guessCorrectPoints)}
        </span>
      </div>
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
            <ul className="sub mt2">
              {coordLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <button
              type="button"
              className="btn btn--text btn--left"
              data-testid="copy-coords"
              onClick={() => {
                void copyText(coordLines.join('\n')).then((ok) => setCopyMsg(ok ? S.steps.copied : S.steps.copyFailed));
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
            {retried.map((no) => {
              const cause = grade.items.find((it) => it.no === no)?.cause ?? null;
              return <li key={no}>{S.steps.retryStatus(no, retryLabel(session.retries[no]!, cause))}</li>;
            })}
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
  const steps = selectSteps(h.exam, grade);
  return (
    <Screen top={<TopBar back={h.path('/anatomy')} title={S.steps.top} />} tabs="current">
      <div className="inline">
        <h2 className="title">{steps.length > 0 ? S.steps.title(steps.length) : S.steps.emptyTitle}</h2>
        {h.exam.isSample ? <Badge>{S.common.sample}</Badge> : null}
      </div>
      {steps.length === 0 ? (
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
