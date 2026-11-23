import { useState } from 'react';
import { platform } from '#platform';
import { Chip, ConfirmDialog, Message, Screen, TopBar } from '../components/ui';
import { EXAMS, findExam } from '../exams';
import { navigate } from '../router';
import { finishTestRun, resetTestRuns, setRunAnswerKey, startTestRun, useAppData } from '../state/hooks';
import { exportCsv, exportJson, finalAnswersOf, parseAnswerKey, PARTICIPANT_PATTERN, type RunExportRow, runMetrics, startOf } from '../state/testlog';
import { S, S_TEST } from '../strings';
import type { InputMode, TestRun } from '../types';
import './TestAdmin.css';

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

/**
 * 내보내기 복사. 앱에서는 다리(saCopy)로 한다. 브라우저에서는 1.1처럼 클립보드 API만 쓴다
 * (일반 웹 빌드의 진행자용 화면 동작을 바꾸지 않는다. 쓸 수 없으면 "파일 저장"을 쓰라고 안내한다).
 */
async function copyText(text: string): Promise<boolean> {
  if (platform.isApp) return platform.copy(text);
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
  const sec = (v: number | null) => (v === null ? S_TEST.notYet : S_TEST.seconds(v));
  const keyExam = exam ?? findExam(run.plannedExamId);
  const keyId = `key-${run.id}`;

  const compare = () => {
    if (!keyExam) return;
    const parsed = parseAnswerKey(keyExam, keyText);
    if (!parsed.ok) {
      setKeyMsg(parsed.errorIndex > 0 ? S_TEST.keyValueError(parsed.errorIndex) : S_TEST.keyCountError(keyExam.items.length, parsed.got));
      return;
    }
    // 시험 기록을 지웠어도 측정 기록에 옮겨 둔 최종 답이 있으면 대조한다.
    if (finalAnswersOf(run, session, exam) === null) {
      setKeyMsg(S_TEST.keyNoSession);
      return;
    }
    setKeyMsg(null);
    setRunAnswerKey(run.id, keyText);
  };

  return (
    <li className="card" data-testid="run-card" data-participant={run.participant} data-mode={run.inputMode}>
      <h3>{S_TEST.runTitle(run.participant, S_TEST.modes[run.inputMode], exam?.title ?? keyExam?.title ?? '')}</h3>
      {run.examId !== null && run.examId !== run.plannedExamId ? <p className="sub">{S_TEST.plannedMismatch}</p> : null}
      {run.examReselects > 0 ? (
        <p className="sub" data-testid="reselect-note">
          {S_TEST.examReselected(run.examReselects)}
        </p>
      ) : null}
      <dl className="kv mt3 sub">
        <dt>{S_TEST.metric.started}</dt>
        <dd data-testid="m-started">{startOf(run) === null ? S_TEST.notYet : fmtTime(run.startedAt)}</dd>
        <dt>{S_TEST.metric.input}</dt>
        <dd data-testid="m-input">{sec(m.inputSeconds)}</dd>
        <dt>{S_TEST.metric.inputCount}</dt>
        <dd data-testid="m-input-count">{S_TEST.times(m.inputCount)}</dd>
        <dt>{S_TEST.metric.reviewFixed}</dt>
        <dd data-testid="m-review-fixed">{S_TEST.count(m.reviewFixedCount)}</dd>
        <dt>{S_TEST.metric.marks}</dt>
        <dd data-testid="m-marks">{S_TEST.seconds(m.marksSeconds)}</dd>
        <dt>{S_TEST.metric.toScore}</dt>
        <dd data-testid="m-to-score">{sec(m.selectToScoreSeconds)}</dd>
        <dt>{S_TEST.metric.residual}</dt>
        <dd data-testid="m-residual">{m.residualErrors === null ? S_TEST.notYet : S_TEST.count(m.residualErrors)}</dd>
        <dt>{S_TEST.metric.discarded}</dt>
        <dd data-testid="m-discarded">{S_TEST.times(run.discardedTaps)}</dd>
      </dl>

      <details className="mt2">
        <summary>{S_TEST.metric.screens}</summary>
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
            {S_TEST.keyTitle}
          </label>
          <span className="sub">{S_TEST.keyHint(keyExam.items.length)}</span>
          <textarea
            id={keyId}
            className="field__input"
            aria-label={S_TEST.keyLabel}
            value={keyText}
            onChange={(e) => setKeyText(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <button type="button" className="btn btn--secondary btn--block" data-testid="key-compare" onClick={compare}>
            {S_TEST.keyCompare}
          </button>
          {keyMsg ? <Message>{keyMsg}</Message> : null}
          {m.residualErrors !== null ? (
            <p data-testid="key-result">
              {S_TEST.keyResult(m.residualErrors)}
            </p>
          ) : null}
          {m.residualNos.length > 0 ? <p className="sub">{S_TEST.keyDiff(m.residualNos)}</p> : null}
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
      setFormMsg(S_TEST.participantError);
      return;
    }
    if (!findExam(examId)) return;
    startTestRun(c, mode, examId);
    navigate('/');
  };

  /** 내보낼 글자를 만든다. 저장 값이 망가져 만들지 못하면 null. */
  const build = (kind: 'json' | 'csv'): string | null => {
    try {
      return kind === 'json' ? exportJson(rows, Date.now()) : exportCsv(rows);
    } catch {
      return null;
    }
  };
  const save = (kind: 'json' | 'csv') => {
    const text = build(kind);
    const ok = text !== null && downloadText(`score-anatomy-test-${stamp()}.${kind}`, text, kind === 'json' ? 'application/json' : 'text/csv');
    setExportMsg(ok ? S_TEST.saved : S_TEST.saveFailed);
  };
  const copy = (kind: 'json' | 'csv') => {
    const text = build(kind);
    if (text === null) {
      setExportMsg(platform.isApp ? S_TEST.copyFailedApp : S_TEST.copyFailed);
      return;
    }
    void copyText(text).then((ok) => setExportMsg(ok ? S_TEST.copied : platform.isApp ? S_TEST.copyFailedApp : S_TEST.copyFailed));
  };

  const stamp = () => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  };

  return (
    <Screen
      top={<TopBar back="/history" title={S_TEST.title} />}
      // "이 참가자 마치기"를 누르면 아래 내용이 위로 올라온다. 연달아 누른 것이 다른 버튼에 닿지 않게 한다.
      guardKey={active ? active.id : 'idle'}
      actions={
        <>
          {formMsg ? <Message>{formMsg}</Message> : null}
          <button type="button" className="btn btn--primary" data-testid="start-run" onClick={start}>
            {S_TEST.start}
          </button>
        </>
      }
      layer={
        confirmReset ? (
          <ConfirmDialog
            title={S_TEST.resetConfirm}
            body={S_TEST.resetBody}
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
      <p className="sub">{S_TEST.intro}</p>

      {active ? (
        <section className="box mt4" aria-labelledby="active-title" data-testid="active-run">
          <h2 className="sub" id="active-title">
            {S_TEST.activeTitle}
          </h2>
          <p>{S_TEST.active(active.participant, S_TEST.modes[active.inputMode])}</p>
          <button type="button" className="btn btn--secondary btn--block mt3" data-testid="finish-run" onClick={finishTestRun}>
            {S_TEST.finish}
          </button>
        </section>
      ) : null}

      <section className="mt6" aria-labelledby="new-title">
        <h2 className="title" id="new-title">
          {S_TEST.newTitle}
        </h2>
        <div className="field mt3">
          <label htmlFor="participant">
            {S_TEST.participant}
          </label>
          <span className="sub" id="participant-hint">
            {S_TEST.participantHint}
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
          {S_TEST.mode}
        </h3>
        <div className="chips mt2" role="radiogroup" aria-labelledby="mode-q">
          {(Object.keys(S_TEST.modes) as InputMode[]).map((k) => (
            <Chip key={k} testId={`mode-${k}`} checked={mode === k} onSelect={() => setMode(k)}>
              {S_TEST.modes[k]}
            </Chip>
          ))}
        </div>

        <h3 className="mt4" id="texam-q">
          {S_TEST.exam}
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
          {S_TEST.runsTitle}
        </h2>
        {rows.length === 0 ? (
          <p className="mt3" data-testid="no-runs">
            {S_TEST.noRuns}
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
          {S_TEST.exportTitle}
        </h2>
        <p className="sub mt2">{platform.canSaveFile ? S_TEST.noNetwork : S_TEST.noNetworkApp}</p>
        <div className="stack gap2 mt3">
          {platform.canSaveFile ? (
            <div className="actions__row">
              <button
                type="button"
                className="btn btn--secondary grow"
                data-testid="save-json"
                onClick={() => save('json')}
              >
                {S_TEST.saveJson}
              </button>
              <button
                type="button"
                className="btn btn--secondary grow"
                data-testid="save-csv"
                onClick={() => save('csv')}
              >
                {S_TEST.saveCsv}
              </button>
            </div>
          ) : null}
          <div className="actions__row">
            <button
              type="button"
              className="btn btn--secondary grow"
              data-testid="copy-json"
              onClick={() => copy('json')}
            >
              {S_TEST.copyJson}
            </button>
            <button
              type="button"
              className="btn btn--secondary grow"
              data-testid="copy-csv"
              onClick={() => copy('csv')}
            >
              {S_TEST.copyCsv}
            </button>
          </div>
          {exportMsg ? <Message plain>{exportMsg}</Message> : null}
          <button type="button" className="btn btn--text btn--block" data-testid="reset-runs" onClick={() => setConfirmReset(true)}>
            {S_TEST.reset}
          </button>
        </div>
      </section>
    </Screen>
  );
}
