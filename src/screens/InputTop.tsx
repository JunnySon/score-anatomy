import { TopBar } from '../components/ui';
import { navigate } from '../router';
import type { SessionHandle } from '../state/hooks';
import { S } from '../strings';

/** 답 입력 화면의 위쪽 줄. leave가 있으면 다른 화면으로 나가는 버튼이 그 함수를 거친다(확정하지 않은 숫자를 알릴 때 쓴다). */
export function InputTop({ h, leave }: { h: SessionHandle; leave?: (to: string) => void }) {
  const go = leave ?? navigate;
  return (
    <TopBar
      back="/exams"
      onBack={leave ? () => leave('/exams') : undefined}
      title={h.exam.title}
      right={
        <button type="button" className="btn btn--text" onClick={() => go(h.path('/review'))}>
          {S.input.showAll}
        </button>
      }
    />
  );
}
