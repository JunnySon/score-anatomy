import { useState } from 'react';
import { DigitPad, EntryBox, McPad } from '../components/pads';
import { Badge, IconCross, IconRing, Message, Screen, TopBar } from '../components/ui';
import { choicesOf } from '../exams/validate';
import { entryValue, eraseDigit, pressDigit, type DigitEntry } from '../logic/entry';
import type { Grade } from '../logic/scoring';
import { rankTypes } from '../logic/steps';
import { retryLabel, retrySentence } from '../logic/text';
import { navigate } from '../router';
import type { SessionHandle } from '../state/hooks';
import { recordRetry } from '../state/session';
import { S } from '../strings';
import type { RetryRecord } from '../types';

// (10) 재풀이 화면. 고른 계단의 오늘 시험지 문항을 하나씩 다시 풀어 답을 받는다.
// 다시 맞혔다고 해서 처음 틀린 이유를 단정하지 않는다.

export function Retry({ h, grade, typeId }: { h: SessionHandle; grade: Grade; typeId: string | null }) {
  const { exam, session } = h;
  const step = rankTypes(exam, grade).find((s) => s.typeId === typeId) ?? null;
  const nos = step?.retryNos ?? [];
  const [index, setIndex] = useState(0);
  const [pick, setPick] = useState<number | null>(null);
  const [entry, setEntry] = useState<DigitEntry>({ text: '', fresh: false });
  const [result, setResult] = useState<RetryRecord | null>(null);
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
  // 정답 보기를 눌렀거나, 이미 채점한 경로이거나, 맞힌 문항이면 정답을 아는 상태로 본다.
  const answerKnown = session.answerViewed[no] === true || session.gradedBefore === 'already' || itemResult.correct;
  const isLast = index >= nos.length - 1;

  const check = () => {
    const value = item.kind === 'mc' ? pick : entryValue(entry);
    if (value === null) {
      setMsg(S.retry.needAnswer);
      return;
    }
    setMsg(null);
    const correct = value === item.answer;
    const prev = session.retries[no];
    const rec: RetryRecord = {
      correct,
      attempts: (prev?.attempts ?? 0) + 1,
      answerKnown: answerKnown || (prev?.answerKnown ?? false),
      at: new Date().toISOString(),
    };
    h.update((s) => recordRetry(s, no, correct, answerKnown, rec.at));
    setResult(rec);
  };

  const next = () => {
    if (isLast) {
      navigate(stepsPath);
      return;
    }
    setIndex(index + 1);
    setPick(null);
    setEntry({ text: '', fresh: false });
    setResult(null);
    setMsg(null);
  };

  let footer;
  let actions;
  if (result) {
    actions = (
      <button type="button" className="btn btn--primary" data-testid="retry-next" onClick={next}>
        {isLast ? S.retry.backToSteps : S.retry.nextItem}
      </button>
    );
  } else if (item.kind === 'mc') {
    footer = (
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
    footer = (
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

  return (
    <Screen top={<TopBar back={stepsPath} title={S.retry.top(step.name)} />} footer={footer} actions={actions} tabs={result ? 'current' : undefined}>
      <p className="sub" data-testid="retry-progress">
        {S.retry.progress(index + 1, nos.length)}
      </p>
      <div className="now">
        <div className="now__main" aria-live="polite">
          <span className="cap">{S.retry.nowLabel}</span>
          <span className="hero" data-testid="retry-no">
            {S.common.itemNo(no)}
          </span>
        </div>
        <span className="now__badge">
          <Badge>{S.common.points(item.points)}</Badge>
        </span>
        <EntryBox text={shown} label={S.retry.entryLabel} />
      </div>

      {msg ? (
        <div className="mt3">
          <Message>{msg}</Message>
        </div>
      ) : null}

      {result ? (
        <div className="card mt4" role="status" data-testid="retry-result" data-correct={result.correct ? 'true' : 'false'}>
          <p className="strong">{retrySentence(result)}</p>
          <p className="inline mt2">
            <span className="sub">{S.retry.recordLabel}</span>
            <span className={`tag ${result.correct ? 'tag--ok' : 'tag--bad'}`} data-testid="retry-label">
              {result.correct ? <IconRing /> : <IconCross />}
              {retryLabel(result, itemResult.cause)}
            </span>
          </p>
        </div>
      ) : null}
    </Screen>
  );
}
