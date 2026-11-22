import { useState } from 'react';
import { choicesOf } from '../exams/validate';
import { entryValue, eraseDigit, initEntry, pressDigit, type DigitEntry } from '../logic/entry';
import { S } from '../strings';
import type { AnswerValue, ExamItem } from '../types';
import { BottomSheet, Message } from './ui';

// 답 키패드. 기기 기본 자판은 띄우지 않는다.

export interface FnKey {
  key: 'skip' | 'erase' | 'go';
  label: string;
  onPress: () => void;
}

/** 5지선다 키패드: 1부터 보기 수까지의 키(높이 64px)와 그 아래 기능 키. */
export function McPad({
  choices,
  selected,
  selectedLabel,
  onPick,
  fn,
  inSheet,
}: {
  choices: number;
  selected?: number | null;
  /** 고른 키에 숫자와 함께 적는 글자(색과 테두리만으로 구분하지 않게). */
  selectedLabel?: string;
  onPick: (n: number) => void;
  fn: FnKey[];
  inSheet?: boolean;
}) {
  const nums = Array.from({ length: choices }, (_, i) => i + 1);
  return (
    <div className={`pad${inSheet ? ' pad--sheet' : ''}`} role="group" aria-label={S.input.keypadLabel}>
      <div className="pad__mc">
        {nums.map((n) => (
          <button
            key={n}
            type="button"
            className="key key--num"
            data-key={n}
            aria-pressed={selected === undefined ? undefined : selected === n}
            onClick={() => onPick(n)}
          >
            <span>{n}</span>
            {selectedLabel && selected === n ? <small>{selectedLabel}</small> : null}
          </button>
        ))}
      </div>
      <div className="pad__fn">
        {fn.map((f) => (
          <button key={f.key} type="button" className={`key key--fn${f.key === 'go' ? ' key--go' : ''}`} data-key={f.key} onClick={f.onPress}>
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 단답형 키패드: 0~9, 안 풂(없을 수도 있음), 지우기, 확정 키.
 * 5지선다 키패드와 같은 틀이다. 1~5 키는 같은 자리에 있고 그 아래에 6~0 줄이 더 붙는다.
 * 숫자를 두 줄로 둔 것은 브라우저 주소 줄을 뺀 실제 화면 높이(약 640px)에 안내문까지 들어가게 하려는 것이다.
 */
export function DigitPad({
  onDigit,
  onErase,
  onSkip,
  onGo,
  goLabel,
  inSheet,
}: {
  onDigit: (d: number) => void;
  onErase: () => void;
  onSkip?: () => void;
  onGo: () => void;
  goLabel: string;
  inSheet?: boolean;
}) {
  return (
    <div className={`pad${inSheet ? ' pad--sheet' : ''}`} role="group" aria-label={S.input.keypadLabel}>
      <div className="pad__digits">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d) => (
          <button key={d} type="button" className="key key--num" data-key={d} onClick={() => onDigit(d)}>
            {d}
          </button>
        ))}
      </div>
      <div className="pad__fn">
        {onSkip ? (
          <button type="button" className="key key--fn" data-key="skip" onClick={onSkip}>
            {S.common.skip}
          </button>
        ) : null}
        <button type="button" className="key key--fn" data-key="erase" onClick={onErase}>
          {S.common.erase}
        </button>
        <button type="button" className="key key--fn key--go" data-key="go" onClick={onGo}>
          {goLabel}
        </button>
      </div>
    </div>
  );
}

/** 넣고 있는 단답형 숫자를 크게 보여 주는 칸. */
export function EntryBox({ text, label, wide }: { text: string; label: string; wide?: boolean }) {
  return (
    <div className={`entry${wide ? ' entry--wide' : ''}`} data-testid="entry">
      <span className="sr-only">{label} </span>
      <span className="num">{text}</span>
    </div>
  );
}

/** 문항 하나의 답을 넣거나 고치는 바텀시트. 문항 유형에 맞는 키패드를 보여 준다. */
export function AnswerSheet({
  item,
  value,
  title,
  onSet,
  onClose,
}: {
  item: ExamItem;
  value: AnswerValue | undefined;
  title: string;
  onSet: (v: AnswerValue | undefined) => void;
  onClose: () => void;
}) {
  const [entry, setEntry] = useState<DigitEntry>(() => initEntry(value));
  const [msg, setMsg] = useState<string | null>(null);

  if (item.kind === 'mc') {
    return (
      <BottomSheet title={title} onClose={onClose}>
        <McPad
          inSheet
          choices={choicesOf(item)}
          selected={typeof value === 'number' ? value : null}
          selectedLabel={S.review.currentAnswer}
          onPick={(n) => {
            onSet(n);
            onClose();
          }}
          fn={[
            {
              key: 'skip',
              label: S.common.skip,
              onPress: () => {
                onSet('skip');
                onClose();
              },
            },
            {
              key: 'erase',
              label: S.common.erase,
              onPress: () => {
                onSet(undefined);
                onClose();
              },
            },
          ]}
        />
      </BottomSheet>
    );
  }

  const shown = entry.text !== '' ? entry.text : value === 'skip' ? S.common.skip : '';
  return (
    <BottomSheet title={title} onClose={onClose}>
      <div className="stack gap2">
        <EntryBox wide text={shown} label={S.input.entryLabel} />
        {msg ? <Message>{msg}</Message> : null}
        <DigitPad
          inSheet
          goLabel={S.common.put}
          onDigit={(d) => {
            const r = pressDigit(entry, d);
            setEntry(r.entry);
            setMsg(r.overflow ? S.common.shortRange : null);
          }}
          onErase={() => {
            setMsg(null);
            if (entry.text !== '') {
              setEntry(eraseDigit(entry));
            } else if (value !== undefined) {
              onSet(undefined);
            }
          }}
          onSkip={() => {
            onSet('skip');
            onClose();
          }}
          onGo={() => {
            const v = entryValue(entry);
            if (v === null) {
              if (value === 'skip') {
                onClose();
                return;
              }
              setMsg(S.common.emptyItem(item.no));
              return;
            }
            onSet(v);
            onClose();
          }}
        />
      </div>
    </BottomSheet>
  );
}
