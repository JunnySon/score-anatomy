import { correctionText } from '../logic/text';
import type { CorrectionNotice as Notice } from '../state/session';
import { S } from '../strings';

// 정답 정정 알림(작업 지시서 3의 4-6). 점수 화면과 점수 해부 화면 위쪽에 둔다(예시 결과에는 두지 않는다).
// 사실만 적는다. 경고색을 쓰지 않고 중립 안내 모양(왼쪽 줄이 윤곽색, 잠금 안내와 같은 모양)으로 둔다.
// 첫 줄은 바뀐 점수, 다음 줄은 시험 파일의 정정 안내(answersNote) 그대로다. "확인했어요"를 누르면 채점 흔적을 지금 값으로 바꾸고 알림이 닫힌다.

export function CorrectionNotice({ notice, onAck }: { notice: Notice; onAck: () => void }) {
  return (
    <div className="msg msg--plain notice" data-testid="correction-notice">
      <p data-testid="correction-text">{correctionText(notice)}</p>
      {notice.note ? (
        <p className="mt2" data-testid="correction-note">
          {notice.note}
        </p>
      ) : null}
      <button type="button" className="btn btn--text btn--left" data-testid="correction-ack" onClick={onAck}>
        {S.correction.ack}
      </button>
    </div>
  );
}
