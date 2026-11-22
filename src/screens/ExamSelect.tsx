import { useEffect, useRef, useState } from 'react';
import { Badge, Message, Option, Screen, TopBar } from '../components/ui';
import { EXAMS } from '../exams';
import { navigate } from '../router';
import { startSession } from '../state/hooks';
import { S } from '../strings';
import type { GradedBefore, SeenBefore } from '../types';

// (2) 시험 선택 화면.

export function ExamSelect() {
  const [examId, setExamId] = useState<string | null>(null);
  const [graded, setGraded] = useState<GradedBefore | null>(null);
  const [seen, setSeen] = useState<SeenBefore | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const questionRef = useRef<HTMLDivElement>(null);
  const exam = EXAMS.find((e) => e.id === examId) ?? null;

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
        {EXAMS.map((e) => (
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
          </Option>
        ))}
      </div>

      {exam ? (
        <div ref={questionRef}>
          <h2 className="strong mt6" id="graded-q">
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
              <h2 className="strong mt6" id="seen-q">
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
