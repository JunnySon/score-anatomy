import { useState } from 'react';
import { Badge, Chip, Message, Screen, TopBar } from '../components/ui';
import { GradeError } from '../logic/scoring';
import { navigate } from '../router';
import type { SessionHandle } from '../state/hooks';
import { answerText, cycleMark, isMarkedAfterGrading, markGraded, markSaved, setTimeFeel, toggleUnsure } from '../state/session';
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
  // "채점한 뒤에 표시한 기록이에요" 줄. 채점한 기록이면 표시를 바꾸기 전에도 같은 글자로 줄의 자리를 잡아 두고 숨긴다(별도 검토 C10).
  // 표시를 처음 바꿀 때 이 줄이 새로 생기면 칸 격자가 줄 높이만큼 내려가서, 같은 칸을 빠르게 두 번 누른 둘째 누름이 윗줄의 다른 칸에 닿는다.
  // 같은 글자라 글자를 키워 두 줄이 되어도 높이가 같다. 연달아 누르기 보호로 막으면 둘째 누름이 버려져 "찍음"이 되지 않으므로 막지 않는다.
  const noteShown = isMarkedAfterGrading(session);

  /** 지금 붙어 있는 표시 그대로 채점한다. 표시를 지우지 않는다. */
  const grade = () => {
    try {
      const nowIso = new Date().toISOString();
      h.update((s) => markGraded(s, exam, nowIso));
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
    // 채점 버튼은 하나다. 표시가 하나도 없으면 "없어요, 채점하기", 하나라도 있으면 "채점하기"이고 자리와 크기는 같다.
    // 라벨이 바뀌는 것은 연달아 누르기 보호 대상에 넣지 않는다(같은 칸을 빠르게 두 번 눌러 붙이는 "찍음"의 둘째 누름이 버려지지 않게).
    const anyMark = Object.keys(session.marks).length > 0;
    actions = (
      <>
        {msg ? <Message>{msg}</Message> : null}
        <button type="button" className="btn btn--primary" data-testid="grade" onClick={grade}>
          {anyMark ? S.marks.grade : S.marks.gradeNone}
        </button>
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
      // 넘겨받은 새 판(정답 공개)으로 같은 자리의 "답 저장하기"나 "기록 보기"가 "채점하기"로 바뀌면, 학생이 누르지 않았어도 잠깐 막는다.
      // 바뀌기 전 버튼을 보고 누른 것이 되돌릴 수 없는 채점이 되지 않게 한다(별도 검토 2차 P2). 이 화면에서 새 판으로 자리나 뜻이
      // 바뀌는 것은 정답 공개 여부뿐이라 그것만 본다. 다른 새 판에도 막으면 같은 칸을 빠르게 두 번 눌러 붙이는 찍음의 둘째 누름이 버려진다(2차 뒤 확인 X1).
      shiftKey={released ? 'released' : 'unreleased'}
      // 맨 위에서는 단답형 칸이 아래 고정 띠에 가려지므로, 내용이 띠 밑으로 더 이어질 때 띠 위쪽에 옅은 그림자를 둔다(작업 지시서 3-1의 3-5).
      moreHint
    >
      <div className="inline">
        <h2 className="title">{S.marks.title}</h2>
        {!released ? <Badge>{S.common.unreleased}</Badge> : null}
      </div>
      <p className="mt2">{S.marks.body}</p>
      <p className="sub mt2">{S.marks.help}</p>
      {noteShown || session.firstGradedAt !== null ? (
        <p className={`cap mt2${noteShown ? '' : ' note--ghost'}`} data-testid={noteShown ? 'after-grading-note' : undefined} aria-hidden={noteShown ? undefined : 'true'}>
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
