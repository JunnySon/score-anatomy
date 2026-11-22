import { useState } from 'react';
import { Badge, ConfirmDialog, Message, Screen } from '../components/ui';
import { findExam } from '../exams';
import { gradeExam } from '../logic/scoring';
import { href, navigate } from '../router';
import { deleteAllSessions, deleteSession, openSession, useAppData } from '../state/hooks';
import { resumePath, stageOf } from '../state/session';
import { store } from '../state/store';
import { formatDate, S } from '../strings';
import type { Session } from '../types';

// (11) 기록 화면. 기록은 이 기기에만 있고, 여기서 지울 수 있다.

function scoreText(session: Session): string {
  const exam = findExam(session.examId);
  if (!exam) return S.history.inProgress;
  const stage = stageOf(session, exam);
  if (stage === 'graded') {
    try {
      return S.common.points(gradeExam(exam, session).actual);
    } catch {
      return S.history.inProgress;
    }
  }
  if (!exam.answerReleased && stage === 'saved') return S.common.unreleased;
  return S.history.inProgress;
}

export function History() {
  const data = useAppData();
  const [confirm, setConfirm] = useState<{ kind: 'one'; id: string } | { kind: 'all' } | null>(null);
  const sessions = [...data.sessions].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  const open = (s: Session) => {
    const exam = findExam(s.examId);
    if (!exam) return;
    openSession(s.id);
    navigate(resumePath(s, exam));
  };

  return (
    <Screen
      tabs="history"
      layer={
        confirm ? (
          <ConfirmDialog
            title={confirm.kind === 'all' ? S.history.confirmAll : S.history.confirmOne}
            body={S.history.confirmBody}
            yes={S.history.confirmYes}
            no={S.history.confirmNo}
            onNo={() => setConfirm(null)}
            onYes={() => {
              if (confirm.kind === 'all') deleteAllSessions();
              else deleteSession(confirm.id);
              setConfirm(null);
            }}
          />
        ) : null
      }
    >
      <h1 className="title">{S.history.title}</h1>
      {!store.storageOk ? (
        <div className="mt3">
          <Message plain>{S.history.storageFailed}</Message>
        </div>
      ) : null}

      {sessions.length === 0 ? (
        <p className="mt4" data-testid="history-empty">
          {S.history.empty}
        </p>
      ) : (
        <>
          <ul className="rule-list mt4" aria-label={S.history.listLabel}>
            {sessions.map((s) => {
              const exam = findExam(s.examId);
              const title = exam?.title ?? s.examId;
              return (
                <li key={s.id} className="hitem" data-testid="history-item">
                  <button type="button" className="hitem__open" aria-label={S.history.open(title)} onClick={() => open(s)}>
                    <span className="inline">
                      <span className="strong">{title}</span>
                      {exam?.isSample ? <Badge>{S.common.sample}</Badge> : null}
                    </span>
                    <span className="sub">
                      {formatDate(s.createdAt)}, {scoreText(s)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn btn--text"
                    aria-label={S.history.removeOf(title)}
                    data-testid="history-remove"
                    onClick={() => setConfirm({ kind: 'one', id: s.id })}
                  >
                    {S.history.remove}
                  </button>
                </li>
              );
            })}
          </ul>
          <button type="button" className="btn btn--secondary btn--block mt4" data-testid="history-remove-all" onClick={() => setConfirm({ kind: 'all' })}>
            {S.history.removeAll}
          </button>
        </>
      )}

      <section className="mt8" aria-labelledby="upcoming-title">
        <h2 className="sub" id="upcoming-title">
          {S.history.upcomingTitle}
        </h2>
        <ul className="rule-list mt2">
          {S.history.upcoming.map((u) => (
            <li key={u.name} className="upcoming">
              <span>{u.name}</span>
              <span className="sub">{u.note}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt6">
        <a className="btn btn--text btn--left link sub" href={href('/test')} data-testid="tester-link">
          {S.history.tester}
        </a>
      </p>
    </Screen>
  );
}
