import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { fillOldGradedRecords } from './state/hooks';
import { installTapGuard } from './tapGuard';
import { installTapNotice } from './tapNotice';
import '#font';
import './styles/tokens.css';
import './styles/app.css';

installTapGuard();
installTapNotice();
// 채점 흔적이 없는 옛 채점 기록을 화면을 그리기 전에 채운다(정답 판 번호가 1인 시험만, 작업 지시서 3의 4-6).
fillOldGradedRecords();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
