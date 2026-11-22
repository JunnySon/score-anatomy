import { Component, useCallback, useEffect, useLayoutEffect, type ReactNode } from 'react';
import { ScreenShownContext } from './components/ui';
import { findMissing } from './logic/scoring';
import { href, inputModeFromUrl, useRoute, navigate, type Route } from './router';
import { Anatomy } from './screens/Anatomy';
import { Causes } from './screens/Causes';
import { ExamSelect } from './screens/ExamSelect';
import { History } from './screens/History';
import { InputScreen } from './screens/Input';
import { Marks } from './screens/Marks';
import { Retry } from './screens/Retry';
import { Review } from './screens/Review';
import { Score } from './screens/Score';
import { Start } from './screens/Start';
import { Steps } from './screens/Steps';
import { TestAdmin } from './screens/TestAdmin';
import { logScreenEvent, setInputMode, useAppData, useCurrentHandle, useDemoHandle, useGrade, type SessionHandle } from './state/hooks';
import { resumePath } from './state/session';
import { activeRun } from './state/testlog';
import { S } from './strings';

// 주소(#/...)에 맞는 화면을 고른다. 기록 상태와 맞지 않는 주소는 알맞은 화면으로 돌려보낸다.

function Redirect({ to }: { to: string }) {
  useEffect(() => {
    navigate(to, { replace: true });
  }, [to]);
  return null;
}

/** 화면을 그리다 오류가 나면 흰 화면 대신 돌아갈 길을 보여 준다. 저장된 값이 망가진 경우를 대비한다. */
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="app app--notop">
        <main className="body">
          <h1 className="title">{S.common.crashTitle}</h1>
          <p className="mt2">{S.common.crashBody}</p>
          <p className="mt4">
            <a className="btn btn--secondary" href={href('/')} data-testid="crash-back">
              {S.common.crashBack}
            </a>
          </p>
        </main>
      </div>
    );
  }
}

/** 채점 결과가 있어야 하는 화면들. */
function GradedScreen({ h, route }: { h: SessionHandle; route: Route }) {
  const grade = useGrade(h);
  if (!grade) {
    if (h.isDemo) return <Redirect to="/" />;
    const missing = findMissing(h.exam, h.session.answers);
    return <Redirect to={missing.length > 0 ? '/input' : '/marks'} />;
  }
  // 채점한 적이 없거나, 채점한 뒤 답을 고쳐서 다시 채점해야 하면 표시 화면으로 보낸다.
  if (!h.isDemo && h.session.gradedAt === null) return <Redirect to="/marks" />;
  switch (route.name) {
    case 'score':
      return <Score h={h} grade={grade} />;
    case 'causes':
      return <Causes h={h} grade={grade} />;
    case 'steps':
      return <Steps h={h} grade={grade} />;
    case 'retry':
      return <Retry key={route.param ?? ''} h={h} grade={grade} typeId={route.param} />;
    default:
      return <Anatomy h={h} grade={grade} />;
  }
}

function Routes({ route, screenKey }: { route: Route; screenKey: string }) {
  const data = useAppData();
  const current = useCurrentHandle();
  const demo = useDemoHandle();
  const run = activeRun(data);

  // 주소의 input 값(keypad, rows)으로 입력 방식을 바꾼다.
  // 테스트가 진행 중이면 진행자가 고른 방식이 우선이다.
  const urlMode = inputModeFromUrl(route);
  useEffect(() => {
    if (urlMode && !run) setInputMode(urlMode);
  }, [urlMode, run]);
  const mode = run ? run.inputMode : (urlMode ?? data.inputMode);

  const key = `${screenKey}/${route.param ?? ''}`;

  if (route.demo) {
    if (!demo) return <Redirect to="/" />;
    if (route.name === 'anatomy' || route.name === 'steps' || route.name === 'retry') {
      return <GradedScreen key={key} h={demo} route={route} />;
    }
    return <Redirect to="/demo/anatomy" />;
  }

  switch (route.name) {
    case 'start':
      return <Start key={key} resumeTo={current ? resumePath(current.session, current.exam) : null} />;
    case 'exams':
      return <ExamSelect key={key} />;
    case 'history':
      return <History key={key} />;
    case 'test':
      return <TestAdmin key={key} />;
    case 'unknown':
      return <Redirect to="/" />;
    default:
      break;
  }

  if (!current) return <Redirect to="/" />;

  switch (route.name) {
    case 'input':
      return <InputScreen key={`${key}/${mode}`} h={current} mode={mode} />;
    case 'review':
      return <Review key={key} h={current} />;
    case 'marks':
      if (findMissing(current.exam, current.session.answers).length > 0) return <Redirect to="/review" />;
      return <Marks key={key} h={current} />;
    default:
      return <GradedScreen key={key} h={current} route={route} />;
  }
}

export function App() {
  const route = useRoute();
  const screenKey = `${route.demo ? 'demo/' : ''}${route.name}`;

  // 지금 그려진 화면의 주소를 html에 적어 둔다. 화면 검사 도구가 화면 전환이 끝났는지 볼 때 쓴다.
  useLayoutEffect(() => {
    document.documentElement.dataset.route = route.raw.split('?')[0] || '/';
  }, [route.raw]);

  // 테스트가 진행 중이면 화면 진입 시각을 남긴다. 화면이 실제로 그려졌을 때만 불린다.
  const logName = route.name === 'test' || route.name === 'unknown' ? null : screenKey;
  const onShown = useCallback(() => {
    if (logName) logScreenEvent(logName);
  }, [logName]);

  return (
    <ErrorBoundary key={route.raw}>
      <ScreenShownContext.Provider value={onShown}>
        <Routes route={route} screenKey={screenKey} />
      </ScreenShownContext.Provider>
    </ErrorBoundary>
  );
}
