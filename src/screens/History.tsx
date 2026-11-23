import { useState } from 'react';
import { Badge, ConfirmDialog, Message, Screen } from '../components/ui';
import { findExam } from '../exams';
import { gradeExam } from '../logic/scoring';
import { navigate } from '../router';
import { deleteAllSessions, deleteSession, isTestDevice, openSession, useAppData } from '../state/hooks';
import { resumePath, stageOf } from '../state/session';
import { store } from '../state/store';
import { activeRun, isMine } from '../state/testlog';
import { formatDate, formatTime, S, S_TOOLS } from '../strings';
import { tools } from '#tools';
import type { Session } from '../types';

// (11) 기록 화면. 기록은 이 기기에만 있고, 여기서 지울 수 있다.
// 사용성 테스트 기기에서는 앞 참가자의 기록이 보이지 않게 한다.
// - 측정이 진행 중이면 이번 참가자의 기록만 보이고, "이 기기의 기록 모두 지우기"는 숨긴다.
// - 측정 기록이 남아 있는데 진행 중인 측정이 없으면 기록을 보여 주지 않고 안내만 한다.

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
  // 저장해 둔 기록: 정답 공개 전이면 "정답 공개 전", 공개된 뒤에는 "채점 전".
  if (stage === 'saved') return exam.answerReleased ? S.history.readyToGrade : S.common.unreleased;
  return S.history.inProgress;
}

export function History() {
  const data = useAppData();
  const Extras = tools.HistoryExtras;
  const [confirm, setConfirm] = useState<{ kind: 'one'; id: string; title: string; detail: string } | { kind: 'all' } | null>(null);
  const run = activeRun(data);
  const testDevice = isTestDevice(data);
  const sessions = [...data.sessions]
    .filter((s) => (run ? isMine(run, s) : !testDevice))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

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
            body={
              confirm.kind === 'one'
                ? S.history.confirmOneBody(confirm.title, confirm.detail)
                : __SA_TOOLS__ && data.testRuns.length > 0
                  ? S_TOOLS.confirmAllBodyWithRuns
                  : S.history.confirmBody
            }
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

      {/* __SA_TOOLS__ 를 함께 적어 두면 앱 배포용 묶음에서는 이 글자가 빌드할 때 빠진다. */}
      {__SA_TOOLS__ && testDevice ? (
        <p className="mt4" data-testid="history-test-device">
          {S_TOOLS.testDevice}
        </p>
      ) : sessions.length === 0 ? (
        <p className="mt4" data-testid="history-empty">
          {S.history.empty}
        </p>
      ) : (
        <>
          <ul className="rule-list mt4" aria-label={S.history.listLabel}>
            {sessions.map((s) => {
              const exam = findExam(s.examId);
              const title = exam?.title ?? s.examId;
              // 같은 시험의 기록이 여러 건이어도 구분되게, 접근성 이름에 날짜와 점수를 함께 넣는다.
              // 시험, 날짜, 점수가 모두 같은 기록이 또 있으면 넣은 시각(시, 분)도 적고, 분까지 같으면 초도 적는다.
              const plain = `${formatDate(s.createdAt)}, ${scoreText(s)}`;
              const twins = sessions.filter(
                (o) => o.id !== s.id && o.examId === s.examId && `${formatDate(o.createdAt)}, ${scoreText(o)}` === plain,
              );
              const sameMinute = twins.some((o) => formatTime(o.createdAt) === formatTime(s.createdAt));
              const detail = twins.length > 0 ? `${formatDate(s.createdAt)} ${formatTime(s.createdAt, sameMinute)}, ${scoreText(s)}` : plain;
              return (
                <li key={s.id} className="hitem" data-testid="history-item">
                  <button type="button" className="hitem__open" aria-label={S.history.open(title, detail)} onClick={() => open(s)}>
                    <span className="inline">
                      <span className="strong">{title}</span>
                      {exam?.isSample ? <Badge>{S.common.sample}</Badge> : null}
                    </span>
                    <span className="sub">{detail}</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn--text"
                    aria-label={S.history.removeOf(title, detail)}
                    data-testid="history-remove"
                    onClick={() => setConfirm({ kind: 'one', id: s.id, title, detail })}
                  >
                    {S.history.remove}
                  </button>
                </li>
              );
            })}
          </ul>
          {/* 측정 중에는 앞 참가자의 기록까지 지우지 않게 숨긴다. */}
          {run ? null : (
            <button type="button" className="btn btn--secondary btn--block mt4" data-testid="history-remove-all" onClick={() => setConfirm({ kind: 'all' })}>
              {S.history.removeAll}
            </button>
          )}
        </>
      )}

      {Extras ? <Extras /> : null}
    </Screen>
  );
}
