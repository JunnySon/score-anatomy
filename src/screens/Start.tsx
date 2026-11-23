import { useMemo } from 'react';
import { ScoreBar } from '../components/ScoreBar';
import { Badge, Screen } from '../components/ui';
import { findBundledExam, SAMPLE_EXAM_ID } from '../exams';
import { typesReadyOf } from '../exams/validate';
import { exampleResponses } from '../logic/example';
import { analyze, gradeExam } from '../logic/scoring';
import { selectSteps } from '../logic/steps';
import { typesPendingText } from '../logic/text';
import { platform } from '#platform';
import { navigate } from '../router';
import { demoStore } from '../state/demo';
import { S } from '../strings';
import type { Exam } from '../types';

// (1) 시작 화면.

/**
 * 결과 미리보기(예시 시험에 검산 예시를 넣은 결과). 그릴 수 없으면 null.
 * 먼저 고칠 것은 유형 이름으로 적는데, 유형 분류 전(typesReady false)이면 이름 대신 안내를 적는다(작업 지시서 3의 4-3).
 */
export function startPreview(exam: Exam | null) {
  if (!exam || !exam.answerReleased) return null;
  try {
    const grade = gradeExam(exam, exampleResponses(exam));
    const stepsLine = typesReadyOf(exam) ? S.start.previewSteps(selectSteps(exam, grade).map((s) => s.name)) : typesPendingText(exam);
    return { exam, an: analyze(exam, grade), stepsLine };
  } catch {
    return null;
  }
}

/** 시작 화면의 미리보기는 묶음 안 예시 시험으로만 그린다(넘겨받은 자료로 검산 예시가 바뀌지 않게, 작업 지시서 3의 5부). */
function usePreview() {
  return useMemo(() => startPreview(findBundledExam(SAMPLE_EXAM_ID)), []);
}

export function Start({ resumeTo, onResume }: { resumeTo: string | null; onResume?: () => void }) {
  const preview = usePreview();
  const openSample = () => {
    demoStore.reset();
    navigate('/demo/anatomy');
  };
  return (
    <Screen
      tabs="current"
      actions={
        <>
          <div className="actions__row">
            {preview ? (
              <button type="button" className="btn btn--text grow" onClick={openSample}>
                {S.start.sampleResult}
              </button>
            ) : null}
            {resumeTo ? (
              <button
                type="button"
                className="btn btn--secondary grow"
                onClick={() => {
                  onResume?.();
                  navigate(resumeTo);
                }}
              >
                {S.start.resume}
              </button>
            ) : null}
          </div>
          <button type="button" className="btn btn--primary" onClick={() => navigate('/exams')}>
            {S.start.pick}
          </button>
        </>
      }
    >
      <h1 className="title">{S.appName}</h1>
      <p className="mt2">{S.start.lead}</p>
      {preview ? (
        <section className="card mt6" aria-labelledby="preview-title" data-testid="preview">
          <div className="inline">
            <h2 className="title" id="preview-title">
              {S.start.previewTitle}
            </h2>
            <Badge>{S.common.sample}</Badge>
          </div>
          <p className="num mt2">{S.common.points(preview.an.actual)}</p>
          <p className="sub">{S.common.correctOf(preview.an.itemCount, preview.an.correctCount)}</p>
          <div className="mt3">
            <ScoreBar an={preview.an} mini />
          </div>
          <p className="sub mt3">{preview.stepsLine}</p>
        </section>
      ) : null}
      <p className="cap mt4">{platform.appText?.privacy ?? S.start.privacy}</p>
    </Screen>
  );
}
