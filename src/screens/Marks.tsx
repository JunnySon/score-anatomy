import { useState } from 'react';
import { Badge, Chip, Message, Screen, TopBar } from '../components/ui';
import { GradeError } from '../logic/scoring';
import { navigate } from '../router';
import type { SessionHandle } from '../state/hooks';
import { answerText, clearMarks, cycleMark, isMarkedAfterGrading, markGraded, markSaved, setTimeFeel, toggleUnsure } from '../state/session';
import { S } from '../strings';
import type { TimeFeel } from '../types';

// (5) 표시 화면(찍음과 고민). 표시는 점수를 바꾸지 않는다.

export function Marks({ h }: { h: SessionHandle }) {
  const { exam, session } = h;
  const [msg, setMsg] = useState<string | null>(null);
  const mcItems = exam.items.filter((it) => it.kind === 'mc');
  const shortItems = exam.items.filter((it) => it.kind === 'short');
  const released = exam.answerReleased;
  const saved = !released && session.savedAt !== null;

  /** withoutMarks가 true면 표시를 모두 지우고 채점한다("없어요": 표시 없이 채점). */
  const grade = (withoutMarks: boolean) => {
    try {
      const nowIso = new Date().toISOString();
      h.update((s) => markGraded(withoutMarks ? clearMarks(s) : s, exam, nowIso));
      navigate(h.path('/score'));
    } catch (e) {
      if (e instanceof GradeError && e.reason === 'missing') navigate(h.path('/review'));
      else setMsg(S.common.gradeFailed);
    }
  };

  const save = () => {
    h.update((s) => markSaved(s, new Date().toISOString()));
  };

  let actions;
  if (!released) {
    actions = saved ? (
      <>
        <Message plain>{S.marks.unreleasedNotice}</Message>
        <button type="button" className="btn btn--primary" onClick={() => navigate('/history')}>
          {S.marks.toHistory}
        </button>
      </>
    ) : (
      <button type="button" className="btn btn--primary" onClick={save}>
        {S.marks.save}
      </button>
    );
  } else {
    actions = (
      <>
        {msg ? <Message>{msg}</Message> : null}
        <div className="actions__row">
          <button type="button" className="btn btn--secondary grow" onClick={() => grade(true)}>
            {S.marks.none2}
          </button>
          <button type="button" className="btn btn--primary grow2" onClick={() => grade(false)}>
            {S.marks.grade}
          </button>
        </div>
      </>
    );
  }

  return (
    <Screen
      top={<TopBar back={h.path('/review')} title={exam.title} />}
      actions={actions}
      tabs="current"
      // "답 저장하기"가 같은 자리의 "기록 보기"로 바뀔 때, 연달아 누른 것이 새 버튼에 닿지 않게 한다.
      guardKey={saved ? 'saved' : 'open'}
    >
      <div className="inline">
        <h2 className="title">{S.marks.title}</h2>
        {!released ? <Badge>{S.common.unreleased}</Badge> : null}
      </div>
      <p className="mt2">{S.marks.body}</p>
      <p className="sub mt2">{S.marks.help}</p>
      {isMarkedAfterGrading(session) ? (
        <p className="cap mt2" data-testid="after-grading-note">
          {S.common.afterGradingNote}
        </p>
      ) : null}

      <div className="grid5 mt4" role="group" aria-label={S.marks.gridLabel}>
        {mcItems.map((it) => {
          const v = session.answers[it.no];
          const mark = session.marks[it.no];
          const text = answerText(v, S.common.skip);
          if (v === 'skip' || v === undefined) {
            // 안 푼 문항에는 표시를 붙이지 않는다.
            return (
              <div key={it.no} className="mark-cell mark-cell--off" data-mark-cell={it.no} aria-label={S.marks.cellSkipped(it.no)} role="img">
                <span className="cell__no">{it.no}</span>
                <span className="cell__val cell__val--small">{text}</span>
                <span className="mark-cell__tag" />
              </div>
            );
          }
          const label = mark === 'guess' ? S.marks.guess : mark === 'doubt' ? S.marks.doubt : '';
          return (
            <button
              key={it.no}
              type="button"
              className={`mark-cell${mark === 'guess' ? ' mark-cell--guess' : mark === 'doubt' ? ' mark-cell--doubt' : ''}`}
              data-mark-cell={it.no}
              data-mark={mark ?? 'none'}
              aria-label={S.marks.cell(it.no, text, label || S.marks.none)}
              onClick={() => h.update((s) => cycleMark(s, it.no))}
            >
              <span className="cell__no">{it.no}</span>
              <span className="cell__val">{text}</span>
              <span className="mark-cell__tag">{label}</span>
            </button>
          );
        })}
      </div>
      <p className="sub mt2">{S.marks.legend}</p>

      {shortItems.length > 0 ? (
        <section className="mt6" aria-labelledby="short-marks-title">
          <h3 className="title" id="short-marks-title">
            {S.marks.shortTitle}
          </h3>
          <p className="sub">{S.marks.shortHint}</p>
          <div className="short-marks mt2">
            {shortItems.map((it) => {
              const v = session.answers[it.no];
              const on = session.marks[it.no] === 'unsure';
              const off = v === 'skip' || v === undefined;
              return (
                <button
                  key={it.no}
                  type="button"
                  className="short-mark"
                  data-short-mark={it.no}
                  aria-pressed={on}
                  aria-disabled={off ? 'true' : undefined}
                  aria-label={off ? S.marks.cellSkipped(it.no) : S.marks.shortCell(it.no, on)}
                  onClick={() => {
                    if (!off) h.update((s) => toggleUnsure(s, it.no));
                  }}
                >
                  <span>{it.no}</span>
                  {on ? <small>{S.marks.unsure}</small> : null}
                  {off ? <small>{S.common.skip}</small> : null}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="mt6" aria-labelledby="time-q">
        <h3 className="title" id="time-q">
          {S.marks.timeQ}
        </h3>
        <div className="chips mt2" role="radiogroup" aria-labelledby="time-q">
          {(Object.keys(S.marks.timeOptions) as TimeFeel[]).map((k) => (
            <Chip key={k} testId={`time-${k}`} checked={session.timeFeel === k} onSelect={() => h.update((s) => setTimeFeel(s, s.timeFeel === k ? null : k))}>
              {S.marks.timeOptions[k]}
            </Chip>
          ))}
        </div>
      </section>
    </Screen>
  );
}
