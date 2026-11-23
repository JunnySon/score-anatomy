import { href } from '../router';
import { S_TOOLS } from '../strings';

/**
 * 기록 화면 아래의 "준비 중인 기능" 목록과 "테스트 진행자용" 링크.
 * 사용성 테스트용 빌드에만 싣는다(src/tools). 앱 배포용 묶음에는 없다.
 */
export function HistoryExtras() {
  return (
    <>
      <section className="mt8" aria-labelledby="upcoming-title">
        <h2 className="sub" id="upcoming-title">
          {S_TOOLS.upcomingTitle}
        </h2>
        <ul className="rule-list mt2">
          {S_TOOLS.upcoming.map((u) => (
            <li key={u.name} className="upcoming">
              <span>{u.name}</span>
              <span className="sub">{u.note}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt6">
        <a className="btn btn--text btn--left link sub" href={href('/test')} data-testid="tester-link">
          {S_TOOLS.tester}
        </a>
      </p>
    </>
  );
}
