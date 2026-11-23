import { Component, useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
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
import {
  countDiscardedTap,
  logScreenEvent,
  openSession,
  resumeCandidate,
  setInputMode,
  useAppData,
  useCurrentHandle,
  useDemoHandle,
  useGrade,
  type SessionHandle,
} from './state/hooks';
import { resumePath } from './state/session';
import { activeRun } from './state/testlog';
import { S } from './strings';
import { addDiscardListener } from './tapGuard';
import { platform } from '#platform';
import { store } from './state/store';
import { showFloatingNotice } from './tapNotice';
import { tools } from '#tools';

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
  // 사용성 테스트 도구가 없는 빌드(앱 배포용)에는 측정 기록 코드가 실리지 않는다.
  const run = __SA_TOOLS__ ? activeRun(data) : null;

  // 주소의 input 값(keypad, rows)으로 입력 방식을 바꾼다.
  // 테스트가 진행 중이면 진행자가 고른 방식이 우선이다. 사용성 테스트 도구가 없는 빌드(앱 배포용)는 늘 키패드 방식이다.
  const urlMode = __SA_TOOLS__ ? inputModeFromUrl(route) : null;
  useEffect(() => {
    if (urlMode && !run) setInputMode(urlMode);
  }, [urlMode, run]);
  const mode = !__SA_TOOLS__ ? 'keypad' : run ? run.inputMode : (urlMode ?? data.inputMode);

  const key = `${screenKey}/${route.param ?? ''}`;

  if (route.demo) {
    if (!demo) return <Redirect to="/" />;
    if (route.name === 'anatomy' || route.name === 'steps' || route.name === 'retry') {
      return <GradedScreen key={key} h={demo} route={route} />;
    }
    return <Redirect to="/demo/anatomy" />;
  }

  switch (route.name) {
    case 'start': {
      // 지금 보는 기록이 없어도 지난 기록이 남아 있으면 "이어서 보기"로 가장 최근 기록을 연다.
      const target = resumeCandidate(data);
      return (
        <Start
          key={key}
          resumeTo={target ? resumePath(target.session, target.exam) : null}
          onResume={target ? () => openSession(target.session.id) : undefined}
        />
      );
    }
    case 'exams':
      return <ExamSelect key={key} />;
    case 'history':
      return <History key={key} />;
    case 'test': {
      const Admin = tools.TestAdmin;
      return Admin ? <Admin key={key} /> : <Redirect to="/" />;
    }
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
  // 진행자용 화면도 적는다. 표시 화면에서 진행자용 화면으로 간 시간을 표시 화면에 머문 시간에 넣지 않으려는 것이다.
  const logName = route.name === 'unknown' ? null : screenKey;
  const onShown = useCallback(() => {
    if (logName) logScreenEvent(logName);
  }, [logName]);

  // 앱: 기록을 저장하지 못하면(껍데기의 storeFailed, 다리를 쓸 수 없음) 지금 화면에서도 한 번 알린다.
  // 이 실행에서 한 번만 띄우고, 기록 화면에는 저장하지 못한 동안 계속 보인다.
  useEffect(() => {
    const text = platform.appText?.storageFailed;
    if (!text) return undefined;
    let shown = false;
    const check = () => {
      if (shown || store.getStatus().ok) return;
      shown = true;
      showFloatingNotice(text, 'store-notice');
    };
    check();
    return store.subscribeStatus(check);
  }, []);

  // 측정 중에 연달아 누르기 보호가 버린 누름을 센다(진행자용 화면, 예시 결과, 측정에 묶이지 않은 기록의 화면은 빼고).
  const routeRef = useRef(route);
  routeRef.current = route;
  useEffect(
    () =>
      addDiscardListener(() => {
        const r = routeRef.current;
        countDiscardedTap(r.name, r.demo);
      }),
    [],
  );

  return (
    <ErrorBoundary key={route.raw}>
      <ScreenShownContext.Provider value={onShown}>
        <Routes route={route} screenKey={screenKey} />
      </ScreenShownContext.Provider>
    </ErrorBoundary>
  );
}
