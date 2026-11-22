import { useMemo } from 'react';
import { ScoreBar } from '../components/ScoreBar';
import { Badge, Screen } from '../components/ui';
import { findExam, SAMPLE_EXAM_ID } from '../exams';
import { exampleResponses } from '../logic/example';
import { analyze, gradeExam } from '../logic/scoring';
import { selectSteps } from '../logic/steps';
import { navigate } from '../router';
import { demoStore } from '../state/demo';
import { S } from '../strings';

// (1) 시작 화면.

function usePreview() {
  return useMemo(() => {
    const exam = findExam(SAMPLE_EXAM_ID);
    if (!exam || !exam.answerReleased) return null;
    try {
      const grade = gradeExam(exam, exampleResponses(exam));
      return { exam, an: analyze(exam, grade), steps: selectSteps(exam, grade) };
    } catch {
      return null;
    }
  }, []);
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
          <p className="sub mt3">{S.start.previewSteps(preview.steps.map((s) => s.name))}</p>
        </section>
      ) : null}
      <p className="cap mt4">{S.start.privacy}</p>
    </Screen>
  );
}
