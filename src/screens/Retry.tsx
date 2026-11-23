import { useState } from 'react';
import { DigitPad, EntryBox, McPad } from '../components/pads';
import { Badge, IconCross, IconRing, LiveRegion, Message, Option, Screen, TopBar } from '../components/ui';
import { choicesOf } from '../exams/validate';
import { entryValue, eraseDigit, pressDigit, type DigitEntry } from '../logic/entry';
import type { Grade } from '../logic/scoring';
import { rankTypes } from '../logic/steps';
import { retryLabel, retrySentence, selfCheckLabel, selfCheckSentence } from '../logic/text';
import { navigate } from '../router';
import type { SessionHandle } from '../state/hooks';
import { recordRetry, setSelfCheck } from '../state/session';
import { S } from '../strings';
import type { RetryRecord, SelfCheck } from '../types';

// (10) 재풀이 화면. 고른 계단의 오늘 시험지 문항을 하나씩 다시 본다.
// - 틀린 문항: 다시 푼 답을 받아 맞춰 본다. 다시 맞혔다고 해서 처음 틀린 이유를 단정하지 않는다.
// - 찍었다고 표시하고 맞은 문항: 넣었던 답이 맞았다는 것을 학생이 이미 알아서, 답을 다시 받지 않고
//   풀이를 끝까지 써 봤는지 스스로 고르게 한다. 정답 대조가 아니므로 정답색, 오답색, 맞음과 틀림 기호를 쓰지 않는다.

export function Retry({ h, grade, typeId }: { h: SessionHandle; grade: Grade; typeId: string | null }) {
  const { exam, session } = h;
  const step = rankTypes(exam, grade).find((s) => s.typeId === typeId) ?? null;
  const nos = step?.retryNos ?? [];
  const [index, setIndex] = useState(0);
  const [pick, setPick] = useState<number | null>(null);
  const [entry, setEntry] = useState<DigitEntry>({ text: '', fresh: false });
  const [checked, setChecked] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const stepsPath = h.path('/steps');

  if (!step || nos.length === 0) {
    return (
      <Screen top={<TopBar back={stepsPath} title={S.steps.top} />} tabs="current">
        <p>{S.retry.nothing}</p>
      </Screen>
    );
  }

  const no = nos[Math.min(index, nos.length - 1)]!;
  const item = exam.items.find((it) => it.no === no)!;
  const itemResult = grade.items.find((it) => it.no === no)!;
  const selfMode = itemResult.correct;
  // 정답을 먼저 봤거나(정답 보기) "이미 했어요" 경로면 정답을 아는 상태로 적는다(지시서 8장 (10)).
  const answerKnown = session.answerViewed[no] === true || session.gradedBefore === 'already';
  const isLast = index >= nos.length - 1;
  const result: RetryRecord | null = !selfMode && checked ? (session.retries[no] ?? null) : null;
  const self = selfMode ? (session.selfChecks[no] ?? null) : null;

  const check = () => {
    const value = item.kind === 'mc' ? pick : entryValue(entry);
    if (value === null) {
      setMsg(S.retry.needAnswer);
      return;
    }
    setMsg(null);
    const correct = value === item.answer;
    h.update((s) => recordRetry(s, no, correct, answerKnown, new Date().toISOString()));
    setChecked(true);
  };

  const next = () => {
    if (isLast) {
      navigate(stepsPath);
      return;
    }
    setIndex(index + 1);
    setPick(null);
    setEntry({ text: '', fresh: false });
    setChecked(false);
    setMsg(null);
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
        onPick={(n) => {
          setPick(n);
          setMsg(null);
        }}
        fn={[
          { key: 'erase', label: S.common.erase, onPress: () => setPick(null) },
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
          setEntry(r.entry);
          setMsg(r.overflow ? S.common.shortRange : null);
        }}
        onErase={() => {
          setEntry(eraseDigit(entry));
          setMsg(null);
        }}
        onGo={check}
      />
    );
  }

  const shown = item.kind === 'mc' ? (pick === null ? '' : String(pick)) : entry.text;
  const done = selfMode ? self !== null : result !== null;

  return (
    <Screen
      top={<TopBar back={stepsPath} title={S.retry.top(step.name)} />}
      // 결과가 뜨거나 다음 문항으로 넘어갈 때 같은 자리를 연달아 눌러 건너뛰지 않게 한다.
      guardKey={`${index}-${done ? 'result' : 'entry'}`}
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
