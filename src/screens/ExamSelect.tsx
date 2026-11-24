import { Fragment, useEffect, useRef, useState } from 'react';
import { platform } from '#platform';
import { RemoteNotice, RemoteRefresh } from '../components/RemoteNotice';
import { Badge, Message, Option, Screen, TopBar } from '../components/ui';
import { catalog, useCatalog, useExams } from '../exams';
import { examListShiftKey } from '../exams/merge';
import { parseYmd } from '../logic/dates';
import { navigate } from '../router';
import { startSession } from '../state/hooks';
import { S } from '../strings';
import type { GradedBefore, SeenBefore } from '../types';

// (2) 시험 선택 화면.

/** 시행일 줄("2030년 1월 2일 시행"). 날짜는 Date 로 바꾸지 않고 문자열을 잘라 쓴다(시간대에 따라 하루가 밀리지 않게). */
export function heldText(examDate: string | undefined) {
  const d = parseYmd(examDate);
  return d ? (
    <span className="sub" data-testid="exam-date">
      {S.exams.held(d.y, d.m, d.d)}
    </span>
  ) : null;
}

/**
 * 시험 설명("1~21번 5지선다, 22~30번 단답형"). 쉼표로 나뉜 조각은 조각 안에서 끊기지 않고 통째로 다음 줄로 내려가게 한다.
 * 조각마다 줄 안 덩어리(inline-block)로 두어서, 조각 하나가 한 줄보다 길면 그 안에서 평소대로 끊긴다(작업 지시서 3-1의 3-5).
 * 글자는 시험 파일 그대로다. 선택지 버튼 안이라 화면 낭독기는 버튼 이름으로 한 번에 읽는다.
 */
export function noteChunks(note: string) {
  // 쉼표 뒤의 빈칸에서 나누고 쉼표는 앞 조각에 붙여 둔다(뒤를 보는 정규식은 옛 사파리가 읽지 못해서 쓰지 않는다).
  const parts = note.split(/, +/).map((part, i, all) => (i < all.length - 1 ? `${part},` : part));
  if (parts.length < 2) return note;
  return parts.map((part, i) => (
    <Fragment key={i}>
      {i > 0 ? ' ' : null}
      <span className="keep" data-testid="note-chunk">
        {part}
      </span>
    </Fragment>
  ));
}

export function ExamSelect() {
  const [examId, setExamId] = useState<string | null>(null);
  const [graded, setGraded] = useState<GradedBefore | null>(null);
  const [seen, setSeen] = useState<SeenBefore | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const questionRef = useRef<HTMLDivElement>(null);
  // 시험 목록은 넘겨받은 새 자료가 오면 바뀐다(작업 지시서 3의 5-3). 고른 시험도 지금 목록에서 찾는다.
  const exams = useExams();
  const { remote } = useCatalog();
  const exam = exams.find((e) => e.id === examId) ?? null;
  // 받은 시험 자료 안내와 "새로 확인"(작업 지시서 3의 5-4): 앱에서 다리 규격 2 이상이고 넘겨받은 자료가 있을 때만 본문 끝에 둔다.
  // 규격 1 껍데기, 브라우저, 넘겨받은 자료가 없으면 그리지 않아서 지금과 같다.
  const appText = platform.remoteBridge ? platform.appText : null;
  // 버튼 상태는 화면을 열 때마다 새로 만든다(화면을 떠났다 오면 결과 문구가 없다).
  const [refresh] = useState(() => new RemoteRefresh(catalog));

  useEffect(() => {
    if (examId) questionRef.current?.scrollIntoView({ block: 'nearest' });
  }, [examId, graded]);

  const go = () => {
    if (!exam) {
      setMsg(S.exams.needExam);
      return;
    }
    if (!graded) {
      setMsg(S.exams.needGraded);
      return;
    }
    if (exam.isPast && !seen) {
      setMsg(S.exams.needSeen);
      return;
    }
    startSession(exam.id, graded, exam.isPast ? seen : null);
    navigate('/input');
  };

  return (
    <Screen
      top={<TopBar back="/" title={S.start.pick} />}
      tabs="current"
      // 고를 때마다 아래 질문이 나타나고 화면이 저절로 스크롤된다. 연달아 누른 것이 그 자리에 온 다른 선택지에 닿지 않게 한다.
      // 넘겨받은 새 자료로 시험 목록이 바뀌면(seq) 선택지의 자리가 옮겨 갈 수 있어서 그때도 막는다.
      guardKey={`${examId ?? ''}/${graded ?? ''}/${seen ?? ''}/${remote?.seq ?? ''}`}
      // 학생이 누르지 않았어도 넘겨받은 새 자료로 목록이 바뀌면 선택지의 자리가 옮겨 가서, 그때는 마지막 누름과 상관없이 잠깐 막는다(별도 검토 A3).
      shiftKey={examListShiftKey(exams)}
      actions={
        <>
          {msg ? <Message>{msg}</Message> : null}
          <button type="button" className="btn btn--primary" onClick={go}>
            {S.exams.go}
          </button>
        </>
      }
    >
      <h2 className="title" id="exam-q">
        {S.exams.title}
      </h2>
      <div className="opts mt4" role="radiogroup" aria-labelledby="exam-q">
        {exams.map((e) => (
          <Option
            key={e.id}
            testId={`exam-${e.id}`}
            checked={e.id === examId}
            onSelect={() => {
              setExamId(e.id);
              setMsg(null);
              if (!e.isPast) setSeen(null);
            }}
            badges={
              <>
                {e.isSample ? <Badge>{S.common.sample}</Badge> : null}
                {!e.answerReleased ? <Badge>{S.common.unreleased}</Badge> : null}
              </>
            }
          >
            <span>{e.title}</span>
            <span className="sub" data-testid="exam-note">
              {noteChunks(e.note)}
            </span>
            {heldText(e.examDate)}
          </Option>
        ))}
      </div>

      {exam ? (
        <div ref={questionRef}>
          <h2 className="title mt6" id="graded-q">
            {S.exams.gradedQ}
          </h2>
          <div className="opts mt2" role="radiogroup" aria-labelledby="graded-q">
            {(Object.keys(S.exams.gradedOptions) as GradedBefore[]).map((k) => (
              <Option
                key={k}
                testId={`graded-${k}`}
                checked={graded === k}
                onSelect={() => {
                  setGraded(k);
                  setMsg(null);
                }}
              >
                {S.exams.gradedOptions[k]}
              </Option>
            ))}
          </div>
          {exam.isPast ? (
            <>
              <h2 className="title mt6" id="seen-q">
                {S.exams.seenQ}
              </h2>
              <div className="opts mt2" role="radiogroup" aria-labelledby="seen-q">
                {(Object.keys(S.exams.seenOptions) as SeenBefore[]).map((k) => (
                  <Option
                    key={k}
                    testId={`seen-${k}`}
                    checked={seen === k}
                    onSelect={() => {
                      setSeen(k);
                      setMsg(null);
                    }}
                  >
                    {S.exams.seenOptions[k]}
                  </Option>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {appText && remote ? <RemoteNotice text={appText} remote={remote} refresh={refresh} /> : null}
    </Screen>
  );
}
