import { useState } from 'react';
import { Chip, ConfirmDialog, Message, Screen, TopBar } from '../components/ui';
import { EXAMS, findExam } from '../exams';
import { navigate } from '../router';
import { finishTestRun, resetTestRuns, setRunAnswerKey, startTestRun, useAppData } from '../state/hooks';
import { exportCsv, exportJson, PARTICIPANT_PATTERN, parseAnswerKey, runMetrics, type RunExportRow } from '../state/testlog';
import { S } from '../strings';
import type { InputMode, TestRun } from '../types';

// (12) 테스트 진행자용 화면(#/test). 측정 기록은 이 기기 안에만 두고 네트워크로 보내지 않는다.

function downloadText(filename: string, text: string, type: string): boolean {
  try {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function RunCard({ row }: { row: RunExportRow }) {
  const { run, session, exam } = row;
  const [keyText, setKeyText] = useState(run.answerKeyText);
  const [keyMsg, setKeyMsg] = useState<string | null>(null);
  const m = runMetrics(run, session, exam);
  const sec = (v: number | null) => (v === null ? S.test.notYet : S.test.seconds(v));
  const keyExam = exam ?? findExam(run.plannedExamId);
  const keyId = `key-${run.id}`;

  const compare = () => {
    if (!keyExam) return;
    const parsed = parseAnswerKey(keyExam, keyText);
    if (!parsed.ok) {
      setKeyMsg(parsed.errorIndex > 0 ? S.test.keyValueError(parsed.errorIndex) : S.test.keyCountError(keyExam.items.length, parsed.got));
      return;
    }
    if (!session) {
      setKeyMsg(S.test.keyNoSession);
      return;
    }
    setKeyMsg(null);
    setRunAnswerKey(run.id, keyText);
  };

  return (
    <li className="card" data-testid="run-card" data-participant={run.participant} data-mode={run.inputMode}>
      <h3>{S.test.runTitle(run.participant, S.test.modes[run.inputMode], exam?.title ?? keyExam?.title ?? '')}</h3>
      {run.examId !== null && run.examId !== run.plannedExamId ? <p className="sub">{S.test.plannedMismatch}</p> : null}
      <dl className="kv mt3 sub">
        <dt>{S.test.metric.started}</dt>
        <dd>{fmtTime(run.startedAt)}</dd>
        <dt>{S.test.metric.input}</dt>
        <dd data-testid="m-input">{sec(m.inputSeconds)}</dd>
        <dt>{S.test.metric.inputCount}</dt>
        <dd data-testid="m-input-count">{S.test.times(m.inputCount)}</dd>
        <dt>{S.test.metric.reviewFixed}</dt>
        <dd data-testid="m-review-fixed">{S.test.count(m.reviewFixedCount)}</dd>
        <dt>{S.test.metric.marks}</dt>
        <dd data-testid="m-marks">{S.test.seconds(m.marksSeconds)}</dd>
        <dt>{S.test.metric.toScore}</dt>
        <dd data-testid="m-to-score">{sec(m.selectToScoreSeconds)}</dd>
        <dt>{S.test.metric.residual}</dt>
        <dd data-testid="m-residual">{m.residualErrors === null ? S.test.notYet : S.test.count(m.residualErrors)}</dd>
      </dl>

      <details className="mt2">
        <summary>{S.test.metric.screens}</summary>
        <ol className="sub" data-testid="run-screens">
          {run.screens.map((s, i) => (
            <li key={`${s.screen}-${s.at}-${i}`}>
              {fmtTime(s.at)} {s.screen}
            </li>
          ))}
        </ol>
      </details>

      {keyExam ? (
        <div className="field mt3">
          <label htmlFor={keyId}>
            {S.test.keyTitle}
          </label>
          <span className="sub">{S.test.keyHint(keyExam.items.length)}</span>
          <textarea
            id={keyId}
            className="field__input"
            aria-label={S.test.keyLabel}
            value={keyText}
            onChange={(e) => setKeyText(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <button type="button" className="btn btn--secondary btn--block" data-testid="key-compare" onClick={compare}>
            {S.test.keyCompare}
          </button>
          {keyMsg ? <Message>{keyMsg}</Message> : null}
          {m.residualErrors !== null ? (
            <p data-testid="key-result">
              {S.test.keyResult(m.residualErrors)}
            </p>
          ) : null}
          {m.residualNos.length > 0 ? <p className="sub">{S.test.keyDiff(m.residualNos)}</p> : null}
        </div>
      ) : null}
    </li>
  );
}

export function TestAdmin() {
  const data = useAppData();
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<InputMode>(data.inputMode);
  const [examId, setExamId] = useState(EXAMS[0]?.id ?? '');
  const [formMsg, setFormMsg] = useState<string | null>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const active = data.testRuns.find((r) => r.id === data.activeRunId) ?? null;
  const rows: RunExportRow[] = data.testRuns.map((run: TestRun) => {
    const session = data.sessions.find((s) => s.id === run.sessionId) ?? null;
    return { run, session, exam: findExam(session?.examId ?? run.examId) };
  });

  const start = () => {
    const c = code.trim().toUpperCase();
    if (!PARTICIPANT_PATTERN.test(c)) {
      setFormMsg(S.test.participantError);
      return;
    }
    if (!findExam(examId)) return;
    startTestRun(c, mode, examId);
    navigate('/');
  };

  const stamp = () => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  };

  return (
    <Screen
      top={<TopBar back="/history" title={S.test.title} />}
      actions={
        <>
          {formMsg ? <Message>{formMsg}</Message> : null}
          <button type="button" className="btn btn--primary" data-testid="start-run" onClick={start}>
            {S.test.start}
          </button>
        </>
      }
      layer={
        confirmReset ? (
          <ConfirmDialog
            title={S.test.resetConfirm}
            body={S.test.resetBody}
            yes={S.history.confirmYes}
            no={S.history.confirmNo}
            onNo={() => setConfirmReset(false)}
            onYes={() => {
              resetTestRuns();
              setConfirmReset(false);
            }}
          />
        ) : null
      }
    >
      <p className="sub">{S.test.intro}</p>

      {active ? (
        <section className="box mt4" aria-labelledby="active-title" data-testid="active-run">
          <h2 className="sub" id="active-title">
            {S.test.activeTitle}
          </h2>
          <p>{S.test.active(active.participant, S.test.modes[active.inputMode])}</p>
          <button type="button" className="btn btn--secondary btn--block mt3" data-testid="finish-run" onClick={finishTestRun}>
            {S.test.finish}
          </button>
        </section>
      ) : null}

      <section className="mt6" aria-labelledby="new-title">
        <h2 className="title" id="new-title">
          {S.test.newTitle}
        </h2>
        <div className="field mt3">
          <label htmlFor="participant">
            {S.test.participant}
          </label>
          <span className="sub" id="participant-hint">
            {S.test.participantHint}
          </span>
          <input
            id="participant"
            className="field__input"
            type="text"
            inputMode="text"
            maxLength={3}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-describedby="participant-hint"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setFormMsg(null);
            }}
          />
        </div>

        <h3 className="mt4" id="mode-q">
          {S.test.mode}
        </h3>
        <div className="chips mt2" role="radiogroup" aria-labelledby="mode-q">
          {(Object.keys(S.test.modes) as InputMode[]).map((k) => (
            <Chip key={k} testId={`mode-${k}`} checked={mode === k} onSelect={() => setMode(k)}>
              {S.test.modes[k]}
            </Chip>
          ))}
        </div>

        <h3 className="mt4" id="texam-q">
          {S.test.exam}
        </h3>
        <div className="chips mt2" role="radiogroup" aria-labelledby="texam-q">
          {EXAMS.map((e) => (
            <Chip key={e.id} testId={`texam-${e.id}`} checked={examId === e.id} onSelect={() => setExamId(e.id)}>
              {e.title}
            </Chip>
          ))}
        </div>

      </section>

      <section className="mt8" aria-labelledby="runs-title">
        <h2 className="title" id="runs-title">
          {S.test.runsTitle}
        </h2>
        {rows.length === 0 ? (
          <p className="mt3" data-testid="no-runs">
            {S.test.noRuns}
          </p>
        ) : (
          <ol className="stack gap4 mt3">
            {rows.map((row) => (
              <RunCard key={row.run.id} row={row} />
            ))}
          </ol>
        )}
      </section>

      <section className="mt8" aria-labelledby="export-title">
        <h2 className="title" id="export-title">
          {S.test.exportTitle}
        </h2>
        <p className="sub mt2">{S.test.noNetwork}</p>
        <div className="stack gap2 mt3">
          <div className="actions__row">
            <button
              type="button"
              className="btn btn--secondary grow"
              data-testid="save-json"
              onClick={() => setExportMsg(downloadText(`score-anatomy-test-${stamp()}.json`, exportJson(rows, Date.now()), 'application/json') ? S.test.saved : S.test.saveFailed)}
            >
              {S.test.saveJson}
            </button>
            <button
              type="button"
              className="btn btn--secondary grow"
              data-testid="save-csv"
              onClick={() => setExportMsg(downloadText(`score-anatomy-test-${stamp()}.csv`, exportCsv(rows), 'text/csv') ? S.test.saved : S.test.saveFailed)}
            >
              {S.test.saveCsv}
            </button>
          </div>
          <div className="actions__row">
            <button
              type="button"
              className="btn btn--secondary grow"
              data-testid="copy-json"
              onClick={() => void copyText(exportJson(rows, Date.now())).then((ok) => setExportMsg(ok ? S.test.copied : S.test.copyFailed))}
            >
              {S.test.copyJson}
            </button>
            <button
              type="button"
              className="btn btn--secondary grow"
              data-testid="copy-csv"
              onClick={() => void copyText(exportCsv(rows)).then((ok) => setExportMsg(ok ? S.test.copied : S.test.copyFailed))}
            >
              {S.test.copyCsv}
            </button>
          </div>
          {exportMsg ? <Message plain>{exportMsg}</Message> : null}
          <button type="button" className="btn btn--text btn--block" data-testid="reset-runs" onClick={() => setConfirmReset(true)}>
            {S.test.reset}
          </button>
        </div>
      </section>
    </Screen>
  );
}
