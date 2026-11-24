import { StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { watchOldGradedRecords } from './state/hooks';
import { installTapGuard, setFillFlush } from './tapGuard';
import { installTapNotice } from './tapNotice';
import '#font';
import './styles/tokens.css';
import './styles/app.css';

installTapGuard();
// 빠진 누름을 채울 때 만들어 보낸 click 의 화면 그리기를 지금 click 보다 먼저 끝낸다(src/tapGuard.ts).
setFillFlush((run) => flushSync(run));
installTapNotice();
// 채점 흔적이 없는 옛 채점 기록을 화면을 그리기 전에 채우고(정답 판 번호가 1인 시험만, 작업 지시서 3의 4-6),
// 시험 목록이 바뀔 때마다(앱 껍데기가 넘겨준 새 자료, 작업 지시서 3의 5부) 다시 채운다.
watchOldGradedRecords();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
