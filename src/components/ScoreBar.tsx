import type { Anatomy } from '../logic/scoring';
import { S } from '../strings';

// 100점 막대. 왼쪽부터 찍음 표시 없이 맞힌 점수(채움), 추측했다고 표시한 정답(빗금),
// 실수라고 표시한 오답(윤곽만), 그 외 오답(점선 윤곽). 색이 아니라 무늬로 가른다.

export function ScoreBar({ an, mini }: { an: Anatomy; mini?: boolean }) {
  const pct = (v: number) => (an.total > 0 ? (v / an.total) * 100 : 0);
  const segs: [string, number][] = [
    ['solid', an.plainCorrectPoints],
    ['hatch', an.guessCorrectPoints],
    ['outline', an.slipPoints],
    ['dashed', an.otherWrongPoints],
  ];
  const p = pct(an.actual);
  // 실제 점수 눈금 숫자는 눈금선에 붙여 둔다. 점수가 높아 100 숫자와 겹치게 되면 두 줄로 나눈다.
  const stacked = p > 85;
  let labelStyle: React.CSSProperties;
  if (stacked) labelStyle = { right: `${100 - p}%` };
  else if (p < 8) labelStyle = { left: 0 };
  else labelStyle = { left: `${p}%`, transform: 'translateX(-50%)' };
  return (
    <div>
      <div
        className={`bar${mini ? ' bar--mini' : ''}`}
        role="img"
        aria-label={S.anatomy.barLabel(an.total, an.plainCorrectPoints, an.guessCorrectPoints, an.slipPoints, an.otherWrongPoints, an.allCorrectGuessCount > 0)}
        data-testid="score-bar"
      >
        {segs
          .filter(([, v]) => v > 0)
          .map(([kind, v]) => (
            <span key={kind} className={`seg seg--${kind}`} style={{ width: `${pct(v)}%` }} data-seg={kind} data-points={v} />
          ))}
      </div>
      {mini ? null : (
        <div className={`ticks${stacked && an.actual < an.total ? ' ticks--stacked' : ''}`} aria-hidden="true">
          {an.actual < an.total ? (
            <>
              <span className="tick-mark" style={{ left: `min(${p}%, calc(100% - 1px))` }} />
              <span className="tick-label" style={labelStyle} data-testid="tick-actual">
                {an.actual}
              </span>
            </>
          ) : null}
          <span className="tick-mark" style={{ right: 0 }} />
          <span className="tick-label tick-label--total" style={{ right: 0 }} data-testid="tick-total">
            {an.total}
          </span>
        </div>
      )}
    </div>
  );
}
