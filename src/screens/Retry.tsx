import { useState } from 'react';
import { DigitPad, EntryBox, McPad } from '../components/pads';
import { Badge, IconCross, IconRing, LiveRegion, Message, Option, Screen, TopBar } from '../components/ui';
import { examShiftKey } from '../exams/merge';
import { answersRevOf, choicesOf } from '../exams/validate';
import { entryValue, eraseDigit, pressDigit, type DigitEntry } from '../logic/entry';
import { isCorrectResponse, type Grade } from '../logic/scoring';
import { rankTypes, retryTarget } from '../logic/steps';
import { retryLabel, retrySentence, selfCheckLabel, selfCheckSentence } from '../logic/text';
import { navigate } from '../router';
import type { SessionHandle } from '../state/hooks';
import { currentRetry, recordRetry, setSelfCheck } from '../state/session';
import { S } from '../strings';
import type { RetryRecord, SelfCheck } from '../types';

// (10) 재풀이 화면. 고른 계단의 오늘 시험지 문항을 하나씩 다시 본다.
// - 틀린 문항: 다시 푼 답을 받아 맞춰 본다. 다시 맞혔다고 해서 처음 틀린 이유를 단정하지 않는다.
// - 찍었다고 표시하고 맞은 문항: 넣었던 답이 맞았다는 것을 학생이 이미 알아서, 답을 다시 받지 않고
//   풀이를 끝까지 써 봤는지 스스로 고르게 한다. 정답 대조가 아니므로 정답색, 오답색, 맞음과 틀림 기호를 쓰지 않는다.

/** 지금 문항에 넣는 중인 것. 문항 번호(no)와 함께 들어서, 다른 문항으로 옮기면 쓰지 않는다. */
interface Held {
  no: number | null;
  pick: number | null;
  entry: DigitEntry;
  checked: boolean;
  msg: string | null;
}

const EMPTY_ENTRY: DigitEntry = { text: '', fresh: false };

export function Retry({ h, grade, typeId }: { h: SessionHandle; grade: Grade; typeId: string | null }) {
  const { exam, session } = h;
  const step = rankTypes(exam, grade).find((s) => s.typeId === typeId) ?? null;
  const nos = step?.retryNos ?? [];
  // 지금 문항은 차례가 아니라 문항 번호로 든다. 화면이 열린 채 넘겨받은 새 판(정답 정정, 유형 재분류)으로 다시 풀 목록이 바뀌어도
  // 고른 답이 다른 문항의 기록으로 들어가지 않게 한다(작업 지시서 3의 별도 검토 A1, B4).
  const [held, setHeld] = useState<Held>(() => ({ no: nos[0] ?? null, pick: null, entry: EMPTY_ENTRY, checked: false, msg: null }));
  const stepsPath = h.path('/steps');
  const target = retryTarget(nos, held.no);

  if (!step || !target) {
    return (
      <Screen top={<TopBar back={stepsPath} title={S.steps.top} />} tabs="current">
        <p>{S.retry.nothing}</p>
      </Screen>
    );
  }

  const { no, index, moved } = target;
  // 들고 있던 문항이 목록에서 빠져 다른 문항으로 옮겼으면, 그 문항에 넣던 답과 맞춰 본 상태는 쓰지 않는다.
  const input: Held = moved ? { no, pick: null, entry: EMPTY_ENTRY, checked: false, msg: null } : held;
  const { pick, entry, checked, msg } = input;
  /** 지금 문항의 넣는 중인 것을 바꾼다. 늘 지금 문항 번호와 함께 적어서, 옮겨 온 문항이면 그때부터 그 문항의 것이 된다. */
  const put = (patch: Partial<Held>) => setHeld({ ...input, ...patch, no });
  const item = exam.items.find((it) => it.no === no)!;
  const itemResult = grade.items.find((it) => it.no === no)!;
  const selfMode = itemResult.correct;
  // 정답을 먼저 봤거나(정답 보기) "이미 했어요" 경로면 정답을 아는 상태로 적는다(지시서 8장 (10)).
  const answerKnown = session.answerViewed[no] === true || session.gradedBefore === 'already';
  const isLast = index >= nos.length - 1;
  const result: RetryRecord | null = !selfMode && checked ? currentRetry(session, no, exam) : null;
  const self = selfMode ? (session.selfChecks[no] ?? null) : null;

  const check = () => {
    const value = item.kind === 'mc' ? pick : entryValue(entry);
    if (value === null) {
      put({ msg: S.retry.needAnswer });
      return;
    }
    // 맞춰 보기도 채점과 같은 판정을 쓴다. 복수 정답이면 인정하는 답 가운데 하나면 맞힌 것이다(작업 지시서 3의 4-2).
    const correct = isCorrectResponse(item, value);
    // 기록에는 지금 정답 판 번호를 함께 남긴다. 정답이 정정되면 그 전의 기록은 화면에서만 빠진다(작업 지시서 3의 4-6).
    h.update((s) => recordRetry(s, no, correct, answerKnown, new Date().toISOString(), answersRevOf(exam)));
    put({ checked: true, msg: null });
  };

  const next = () => {
    if (isLast) {
      navigate(stepsPath);
      return;
    }
    setHeld({ no: nos[index + 1]!, pick: null, entry: EMPTY_ENTRY, checked: false, msg: null });
  };

  /** 스스로 확인한 결과를 고른다. "아직 안 풀어 봤어요"는 기록을 남기지 않고(앞서 남긴 것도 지우고) 다음으로 넘어간다. */
  const chooseSelf = (choice: SelfCheck | 'notYet') => {
    const nowIso = new Date().toISOString();
    if (choice === 'notYet') {
      h.update((s) => setSelfCheck(s, no, null, nowIso));
      next();
      return;
    }
    h.update((s) => setSelfCheck(s, no, choice, nowIso));
    put({});
  };

  let pad = null;
  let actions;
  if (selfMode) {
    actions = self ? (
      <button type="button" className="btn btn--primary" data-testid="retry-next" onClick={next}>
        {isLast ? S.retry.backToSteps : S.retry.nextItem}
      </button>
    ) : undefined;
  } else if (result) {
    actions = (
      <button type="button" className="btn btn--primary" data-testid="retry-next" onClick={next}>
        {isLast ? S.retry.backToSteps : S.retry.nextItem}
      </button>
    );
  } else if (item.kind === 'mc') {
    pad = (
      <McPad
        choices={choicesOf(item)}
        selected={pick}
        onPick={(n) => put({ pick: n, msg: null })}
        fn={[
          { key: 'erase', label: S.common.erase, onPress: () => put({ pick: null }) },
          { key: 'go', label: S.retry.check, onPress: check },
        ]}
      />
    );
  } else {
    pad = (
      <DigitPad
        goLabel={S.retry.check}
        onDigit={(d) => {
          const r = pressDigit(entry, d);
          put({ entry: r.entry, msg: r.overflow ? S.common.shortRange : null });
        }}
        onErase={() => put({ entry: eraseDigit(entry), msg: null })}
        onGo={check}
      />
    );
  }

  const shown = item.kind === 'mc' ? (pick === null ? '' : String(pick)) : entry.text;
  const done = selfMode ? self !== null : result !== null;

  return (
    <Screen
      top={<TopBar back={stepsPath} title={S.retry.top(step.name)} />}
      // 결과가 뜨거나 다음 문항으로 넘어갈 때 같은 자리를 연달아 눌러 건너뛰지 않게 한다. 열쇠에 문항 번호를 넣어
      // 넘겨받은 새 판으로 지금 문항이 바뀐 때도 막는다.
      guardKey={`${no}-${done ? 'result' : 'entry'}`}
      // 넘겨받은 새 판으로 다시 풀 목록이나 지금 문항이 바뀌면 마지막 누름과 상관없이 잠깐 막는다(별도 검토 A3).
      shiftKey={`${examShiftKey(exam)}/${nos.join(',')}`}
      footer={
        pad ? (
          <>
            {/* 키패드 위 안내문은 늘 붙어 있는 알림 영역으로 전하고, 보이는 안내문은 낭독에서 뺀다(결정기록 89번). */}
            <LiveRegion text={msg ?? ''} testId="retry-live" />
            {msg ? (
              <div className="pad-msg">
                <Message live={false}>{msg}</Message>
              </div>
            ) : null}
            {pad}
          </>
        ) : undefined
      }
      actions={actions}
      tabs={done || selfMode ? 'current' : undefined}
    >
      <div className="inline">
        <p className="sub" data-testid="retry-progress">
          {S.retry.progress(index + 1, nos.length)}
        </p>
        {exam.isSample ? <Badge>{S.common.sample}</Badge> : null}
      </div>
      {/* 넘겨받은 새 판으로 들고 있던 문항이 다시 풀 목록에서 빠졌으면 그 사실을 알린다. 그 문항에 넣던 답은 기록하지 않았다. */}
      {moved && held.no !== null ? (
        <div className="mt2">
          <Message plain testId="retry-moved">
            {S.retry.moved(held.no, !held.checked && (held.pick !== null || held.entry.text !== ''))}
          </Message>
        </div>
      ) : null}
      <div className="now">
        <div className="now__main" aria-live="polite">
          <span className="cap">{selfMode ? S.retry.selfNowLabel : S.retry.nowLabel}</span>
          <span className="hero" data-testid="retry-no">
            {S.common.itemNo(no)}
          </span>
        </div>
        <span className="now__badge">
          <Badge>{S.common.points(item.points)}</Badge>
        </span>
        {selfMode ? null : <EntryBox text={shown} label={S.retry.entryLabel} />}
      </div>

      {selfMode ? (
        <section className="mt4" data-testid="self-check">
          <h2 className="title" id="self-q">
            {S.retry.selfQ}
          </h2>
          <div className="opts mt3" role="radiogroup" aria-labelledby="self-q">
            <Option testId="self-solved" checked={self?.result === 'solved'} onSelect={() => chooseSelf('solved')}>
              {S.retry.selfOptions.solved}
            </Option>
            <Option testId="self-stuck" checked={self?.result === 'stuck'} onSelect={() => chooseSelf('stuck')}>
              {S.retry.selfOptions.stuck}
            </Option>
          </div>
          {/* 셋째 선택지는 기록을 남기지 않고 다음으로 넘어가서, 고른 상태로 남는 라디오가 아니라 버튼으로 둔다. */}
          <button type="button" className="btn btn--secondary btn--block mt2" data-testid="self-not-yet" onClick={() => chooseSelf('notYet')}>
            {S.retry.selfOptions.notYet}
          </button>
          {/* 결과 카드는 늘 붙어 있는 알림 영역 안에 넣어, 카드가 나타날 때 화면 낭독기에 전한다. */}
          <div role="status" aria-live="polite" aria-atomic="true">
            {self ? (
              <div className="card mt4" data-testid="retry-result" data-self={self.result}>
                <p>{selfCheckSentence(self.result)}</p>
                <p className="inline mt2">
                  <span className="sub">{S.retry.recordLabel}</span>
                  {/* 정답 대조가 아니므로 중립 표시로 둔다(정답색, 오답색, 맞음과 틀림 기호 없음). */}
                  <span className="tag tag--wrap" data-testid="retry-label">
                    {selfCheckLabel(self.result)}
                  </span>
                </p>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* 맞춰 본 결과도 늘 붙어 있는 알림 영역 안에 넣는다(글자를 담은 채 새로 붙는 알림 영역은 화면 낭독기가 읽지 않는 경우가 많다). */}
      <div role="status" aria-live="polite" aria-atomic="true">
        {result ? (
          <div className="card mt4" data-testid="retry-result" data-correct={result.correct ? 'true' : 'false'}>
            <p>{retrySentence(result)}</p>
            <p className="inline mt2">
              <span className="sub">{S.retry.recordLabel}</span>
              <span className={`tag ${result.correct ? 'tag--ok' : 'tag--bad'}`} data-testid="retry-label">
                {result.correct ? <IconRing /> : <IconCross />}
                {retryLabel(result, itemResult.cause)}
              </span>
            </p>
          </div>
        ) : null}
      </div>
    </Screen>
  );
}
