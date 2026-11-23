import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { Catalog, RefreshResult, RemoteInfo } from '../exams';
import { parseYmdHm } from '../logic/dates';
import type { S_APP } from '../strings';
import { markUiChanged } from '../tapGuard';
import { LiveRegion, Message } from './ui';

// 시험 선택 화면의 받은 시험 자료 안내(작업 지시서 3의 5-4, docs/앱_다리_규격.md 7장).
// 앱에서 다리 규격 2 이상이고 넘겨받은 자료가 있을 때만 시험 선택 화면 본문 끝에 둔다(그 조건은 src/screens/ExamSelect.tsx 가 본다).
// - 자료를 받는 곳과 보내지 않는다는 것, 받은 자료 기준 시각(issuedAt, 한국 시간), "새로 확인" 버튼을 정정 알림과 같은 중립 안내 모양으로 둔다.
// - "새로 확인"을 누르면 시험 목록 저장소의 새로 확인(catalog.refresh)을 부르고, 응답이 올 때까지 버튼을 쓸 수 없게 둔다.
//   잠긴 키처럼 aria-disabled 로 알리고(결정기록 2장 78번), 그동안 눌러도 새로 확인을 또 보내지 않는다.
// - 결과 문구는 안내 아래에 두고, 늘 붙어 있는 알림 영역(LiveRegion)으로 화면 낭독기에 전한다. 보이는 문구는 낭독에서 뺀다(결정기록 2장 89번).
// - 결과 문구는 그 결과가 나온 때의 넘겨받은 자료(seq)에 대한 것이라, 그 뒤에 자료가 바뀌면 보여 주지 않는다.
// - 버튼 상태(RemoteRefresh)는 시험 선택 화면을 열 때마다 새로 만들어서, 화면을 떠났다 오면 결과 문구가 없다.

/** 새로 확인을 부르는 곳. 앱에서는 시험 목록 저장소(src/exams/index.ts 의 catalog)이고, 단위 테스트는 따로 만든 저장소를 넣는다. */
export interface RefreshSource {
  /** 새로 확인을 보내고 결과를 기다린다(응답이 10초 동안 없으면 failed). */
  refresh(): Promise<RefreshResult>;
  /** 지금 쓰는 시험 목록. 결과가 나온 때의 넘겨받은 자료 판(seq)을 읽는다. */
  get(): Catalog;
}

/** "새로 확인" 버튼의 상태. */
export interface RefreshState {
  /** 응답을 기다리는 중. 이 동안 버튼을 쓸 수 없다. */
  waiting: boolean;
  /** 마지막 결과와 그 결과가 나온 때의 넘겨받은 자료 판(seq). 누른 적이 없거나 기다리는 중이면 null. */
  result: { kind: RefreshResult; seq: number | null } | null;
}

/**
 * "새로 확인" 버튼의 상태를 들고 있는 작은 저장소. 시험 선택 화면을 열 때마다 새로 만든다.
 * press 는 기다리는 중이 아니면 새로 확인을 부르고, 결과가 오면 기다리는 중을 끝내고 결과를 적는다.
 * 기다리는 중에 다시 누르면 또 부르지 않고 기다리던 것을 돌려준다. 누를 때 앞 결과는 지운다(같은 결과가 와도 다시 알리게).
 */
export class RemoteRefresh {
  private state: RefreshState = { waiting: false, result: null };
  private pending: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly source: RefreshSource;

  constructor(source: RefreshSource) {
    this.source = source;
  }

  get = (): RefreshState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** 버튼을 눌렀을 때. 결과를 적고 나면 끝나는 Promise 를 돌려준다. */
  press = (): Promise<void> => {
    if (this.pending) return this.pending;
    this.set({ waiting: true, result: null });
    // 저장소의 새로 확인은 보내지 못해도, 응답이 없어도 failed 로 끝난다. 그 밖의 일로 던지거나 실패로 끝나도
    // 버튼이 막힌 채로 남지 않게 받지 못한 것으로 본다.
    let asked: Promise<RefreshResult>;
    try {
      asked = this.source.refresh();
    } catch {
      asked = Promise.resolve('failed');
    }
    this.pending = asked
      .catch((): RefreshResult => 'failed')
      .then((kind) => {
        this.pending = null;
        this.set({ waiting: false, result: { kind, seq: this.source.get().remote?.seq ?? null } });
      });
    return this.pending;
  };

  private set(next: RefreshState): void {
    this.state = next;
    for (const l of this.listeners) l();
  }
}

/** 받은 시험 자료 안내와 "새로 확인". remote 는 지금 쓰는 넘겨받은 자료의 판, refresh 는 이 화면의 버튼 상태다. */
export function RemoteNotice({ text, remote, refresh }: { text: typeof S_APP; remote: RemoteInfo; refresh: RemoteRefresh }) {
  const state = useSyncExternalStore(refresh.subscribe, refresh.get, refresh.get);
  const resultRef = useRef<HTMLDivElement>(null);
  // 결과가 나온 뒤에 자료가 바뀌었으면(늦게 온 자료, 껍데기가 새로 넘겨준 자료) 그 결과 문구는 지금 자료에 맞지 않아 보여 주지 않는다.
  const kind = state.result !== null && state.result.seq === remote.seq ? state.result.kind : null;
  const message = kind ? text.remoteResult[kind] : null;
  const at = parseYmdHm(remote.issuedAt);
  // 결과가 나오면 안내 아래에 문구가 생겨 화면이 바뀐다. 같은 자리를 연달아 누른 것이 받아지지 않게 한다(src/tapGuard.ts).
  useLayoutEffect(() => {
    if (state.result) markUiChanged();
  }, [state.result]);
  // 본문 끝이라 문구가 화면 아래로 벗어날 수 있어서, 문구가 생기면 보이게 스크롤한다.
  useEffect(() => {
    if (message) resultRef.current?.scrollIntoView({ block: 'nearest' });
  }, [message]);
  return (
    <div className="mt6" data-testid="remote-notice">
      <div className="msg msg--plain remote-notice">
        <p>{text.remoteSource}</p>
        {at ? (
          <p className="mt2" data-testid="remote-issued">
            {text.remoteIssued(at.y, at.m, at.d, at.h, at.mi)}
          </p>
        ) : null}
        <button
          type="button"
          className="btn btn--text btn--left"
          data-testid="remote-refresh"
          aria-disabled={state.waiting ? 'true' : undefined}
          onClick={refresh.press}
        >
          {text.remoteRefresh}
        </button>
      </div>
      {/* 결과 문구는 늘 붙어 있는 이 알림 영역으로 화면 낭독기에 전한다. 보이는 문구는 낭독에서 뺀다(aria-hidden, 두 번 읽히지 않게). */}
      <LiveRegion text={message ?? ''} testId="remote-live" />
      {message ? (
        <div className="mt2" ref={resultRef}>
          <Message plain live={false} testId="remote-result">
            {message}
          </Message>
        </div>
      ) : null}
    </div>
  );
}
