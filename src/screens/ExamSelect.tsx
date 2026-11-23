import { useEffect, useRef, useState } from 'react';
import { Badge, Message, Option, Screen, TopBar } from '../components/ui';
import { useCatalog, useExams } from '../exams';
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
            <span className="sub">{e.note}</span>
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
    </Screen>
  );
}
