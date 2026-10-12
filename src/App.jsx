import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import "./styles.css";

const DEFAULT_QUESTIONS = 30;
const EXAM_DURATION_MINUTES = 60;
const PROGRESS_KEY = "exam-practice-mastered";

function normalize(value) {
  return String(value ?? "")
    .replace(/^[a-d]\s*[.)-]\s*/i, "")
    .replace(/^[a-d]\s+/i, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function optionEntries(options) {
  if (!options) return [];
  if (Array.isArray(options)) {
    return options.map((item, index) => {
      if (typeof item === "string") return [String.fromCharCode(97 + index), item];
      return [String(item.label_in_source || item.label || String.fromCharCode(97 + index)).toLowerCase(), item.text || item.value || ""];
    }).filter(([, value]) => String(value).trim());
  }
  return Object.entries(options).filter(([, value]) => String(value ?? "").trim());
}

function isCorrectOption(question, key, value) {
  const answer = normalize(question.correct_answer);
  return answer === normalize(`${key}. ${value}`) ||
    answer === normalize(`${key}) ${value}`) ||
    answer === normalize(key) ||
    answer === normalize(value);
}

function readMastered() {
  try {
    return new Set(JSON.parse(localStorage.getItem(PROGRESS_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

export default function App() {
  const [questions, setQuestions] = useState([]);
  const [masteredIds, setMasteredIds] = useState(() => readMastered());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [examStarted, setExamStarted] = useState(false);
  const [examQuestions, setExamQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [marked, setMarked] = useState(new Set());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [duration, setDuration] = useState(EXAM_DURATION_MINUTES);
  const [secondsLeft, setSecondsLeft] = useState(EXAM_DURATION_MINUTES * 60);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [filterSession, setFilterSession] = useState("all");
  const [questionCount, setQuestionCount] = useState(DEFAULT_QUESTIONS);

  useEffect(() => {
    let active = true;
    async function fetchQuestions() {
      setLoading(true);
      setLoadError("");
      const { data, error } = await supabase
        .from("questions")
        .select("id, session, week, question_number, question, options, correct_answer, detailed_solution")
        .order("session", { ascending: true })
        .order("week", { ascending: true })
        .order("question_number", { ascending: true });
      if (!active) return;
      if (error) {
        setLoadError(`Could not load questions: ${error.message}`);
        setQuestions([]);
      } else {
        setQuestions(data || []);
      }
      setLoading(false);
    }
    fetchQuestions();
    return () => { active = false; };
  }, []);

  const sessions = useMemo(
    () => [...new Set(questions.map(q => q.session).filter(Boolean))].sort(),
    [questions]
  );

  const availableQuestions = useMemo(() => questions.filter(q =>
    (filterSession === "all" || q.session === filterSession) && !masteredIds.has(q.id)
  ), [questions, filterSession, masteredIds]);

  const currentQuestion = examQuestions[currentIndex];
  const answeredCount = examQuestions.filter(q => answers[q.id] !== undefined).length;
  const markedCount = marked.size;
  const unansweredCount = examQuestions.length - answeredCount;
  const correctCount = submitted
    ? examQuestions.filter(q => answers[q.id] && isCorrectOption(q, ...(
      optionEntries(q.options).find(([key, value]) => answers[q.id] === `${key}. ${value}`) || ["", ""]
    ))).length
    : 0;

  const formatTime = seconds => {
    const safe = Math.max(0, seconds);
    return `${String(Math.floor(safe / 3600)).padStart(2, "0")}:${String(Math.floor((safe % 3600) / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
  };

  const startExam = () => {
    const pool = [...availableQuestions];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const selected = pool.slice(0, Math.max(1, Math.min(Number(questionCount) || 1, pool.length)));
    if (!selected.length) {
      setLoadError("No questions available for this session. Change the session or reset mastered questions.");
      return;
    }
    setExamQuestions(selected);
    setAnswers({});
    setMarked(new Set());
    setCurrentIndex(0);
    setSecondsLeft(duration * 60);
    setSubmitted(false);
    setShowSubmitDialog(false);
    setExamStarted(true);
    setLoadError("");
  };

  const finishExam = useCallback(() => {
    setSubmitted(true);
    setShowSubmitDialog(false);
    const next = new Set(masteredIds);
    examQuestions.forEach(q => {
      const chosen = optionEntries(q.options).find(([key, value]) => answers[q.id] === `${key}. ${value}`);
      if (chosen && isCorrectOption(q, chosen[0], chosen[1])) next.add(q.id);
    });
    setMasteredIds(next);
    localStorage.setItem(PROGRESS_KEY, JSON.stringify([...next]));
  }, [answers, examQuestions, masteredIds]);

  useEffect(() => {
    if (!examStarted || submitted) return undefined;
    if (secondsLeft <= 0) {
      finishExam();
      return undefined;
    }
    const timer = window.setTimeout(() => setSecondsLeft(value => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [examStarted, submitted, secondsLeft, finishExam]);

  const chooseAnswer = (key, value) => {
    if (submitted || !currentQuestion) return;
    setAnswers(previous => ({ ...previous, [currentQuestion.id]: `${key}. ${value}` }));
  };

  const toggleMarked = () => {
    if (!currentQuestion || submitted) return;
    setMarked(previous => {
      const next = new Set(previous);
      if (next.has(currentQuestion.id)) next.delete(currentQuestion.id);
      else next.add(currentQuestion.id);
      return next;
    });
  };

  const goToQuestion = index => setCurrentIndex(Math.max(0, Math.min(index, examQuestions.length - 1)));
  const questionState = q => {
    const answered = answers[q.id] !== undefined;
    const review = marked.has(q.id);
    if (answered && review) return "answered-review";
    if (review) return "review";
    if (answered) return "answered";
    return "not-visited";
  };

  if (loading) {
    return <div className="exam-loading"><div className="loading-mark">Q</div><h2>Preparing your exam</h2><p>Loading your question paper…</p></div>;
  }

  if (!examStarted) {
    return (
      <div className="exam-app landing-page">
        <header className="exam-topbar">
          <div className="exam-brand"><div className="brand-icon">Q</div><div><strong>ExamDesk</strong><span>Practice examination portal</span></div></div>
          <div className="secure-label"><span className="secure-dot" /> Practice mode</div>
        </header>
        <main className="landing-content">
          <div className="landing-copy">
            <div className="kicker">MOCK TEST CENTER</div>
            <h1>Prepare like it’s<br /><em>exam day.</em></h1>
            <p>Attempt a timed mock test in a focused, distraction-free exam interface. Your progress is saved in this browser.</p>
            <div className="landing-points">
              <div><span>✓</span><section><strong>Real exam layout</strong><small>Question palette, navigation and timer</small></section></div>
              <div><span>✓</span><section><strong>Instant result review</strong><small>Score, correct answers and explanations</small></section></div>
              <div><span>✓</span><section><strong>Smart revision</strong><small>Correctly answered questions are mastered</small></section></div>
            </div>
          </div>
          <section className="setup-card">
            <div className="setup-card-heading"><div className="setup-icon">▤</div><div><h2>Configure your test</h2><p>Choose your paper before starting.</p></div></div>
            {loadError && <div className="alert-error">{loadError}</div>}
            <label className="form-label" htmlFor="session">Exam session</label>
            <select id="session" value={filterSession} onChange={e => setFilterSession(e.target.value)}>
              <option value="all">All sessions</option>
              {sessions.map(session => <option key={session} value={session}>{session}</option>)}
            </select>
            <label className="form-label" htmlFor="questionCount">Number of questions</label>
            <select id="questionCount" value={questionCount} onChange={e => setQuestionCount(Number(e.target.value))}>
              {[10, 20, 30, 50, 75, 100].map(n => <option key={n} value={n}>{n} questions</option>)}
            </select>
            <label className="form-label" htmlFor="duration">Time limit</label>
            <select id="duration" value={duration} onChange={e => setDuration(Number(e.target.value))}>
              {[15, 30, 45, 60, 90, 120].map(n => <option key={n} value={n}>{n} minutes</option>)}
            </select>
            <div className="paper-summary">
              <div><span>Questions available</span><strong>{availableQuestions.length}</strong></div>
              <div><span>Previously mastered</span><strong>{masteredIds.size}</strong></div>
            </div>
            <button className="start-exam-btn" disabled={availableQuestions.length === 0} onClick={startExam}>Start examination <span>→</span></button>
            <p className="setup-note">The timer starts when you enter the exam. You can submit early at any time.</p>
          </section>
        </main>
        <footer className="landing-footer">ExamDesk <span>•</span> Personal exam practice</footer>
      </div>
    );
  }

  if (submitted) {
    const accuracy = examQuestions.length ? Math.round((correctCount / examQuestions.length) * 100) : 0;
    return (
      <div className="exam-app results-page">
        <header className="exam-topbar"><div className="exam-brand"><div className="brand-icon">Q</div><div><strong>ExamDesk</strong><span>Examination report</span></div></div><div className="secure-label">Test completed</div></header>
        <main className="results-wrap">
          <div className="results-icon">✓</div><div className="kicker">EXAM SUBMITTED</div><h1>Your test is complete</h1><p className="results-subtitle">Review your performance and the answers below.</p>
          <div className="score-grid">
            <div><span>Correct</span><strong className="score-green">{correctCount}</strong></div>
            <div><span>Incorrect</span><strong className="score-red">{answeredCount - correctCount}</strong></div>
            <div><span>Unanswered</span><strong>{unansweredCount}</strong></div>
            <div><span>Accuracy</span><strong>{accuracy}%</strong></div>
          </div>
          <div className="results-actions"><button className="start-exam-btn" onClick={() => { setExamStarted(false); setExamQuestions([]); }}>Back to exam setup</button></div>
          <div className="review-heading"><h2>Answer review</h2><span>{examQuestions.length} questions</span></div>
          <div className="review-list">
            {examQuestions.map((q, index) => {
              const picked = answers[q.id];
              const chosen = optionEntries(q.options).find(([key, value]) => picked === `${key}. ${value}`);
              const correct = chosen && isCorrectOption(q, chosen[0], chosen[1]);
              return <article className="review-question" key={q.id}>
                <div className="review-number">{String(index + 1).padStart(2, "0")}</div>
                <div className="review-body"><h3>{q.question || "Question text unavailable"}</h3>
                  <p className={correct ? "review-picked good" : "review-picked bad"}>{picked ? `Your answer: ${picked}` : "Not answered"}</p>
                  <p className="review-correct">Correct answer: {q.correct_answer || "Not provided"}</p>
                  {q.detailed_solution && <p className="review-explanation">{q.detailed_solution}</p>}
                </div><span className={`review-result ${correct ? "pass" : "fail"}`}>{correct ? "Correct" : picked ? "Incorrect" : "Skipped"}</span>
              </article>;
            })}
          </div>
        </main>
      </div>
    );
  }

  const entries = optionEntries(currentQuestion?.options);
  const selectedAnswer = currentQuestion ? answers[currentQuestion.id] : undefined;
  const timerWarning = secondsLeft <= 300;

  return (
    <div className="exam-app live-exam">
      <header className="live-header">
        <div className="exam-brand"><div className="brand-icon">Q</div><div><strong>ExamDesk</strong><span>Mock examination</span></div></div>
        <div className="exam-title-center"><strong>Introduction to Internet of Things</strong><span>{currentQuestion?.session || "Practice paper"} · Week {currentQuestion?.week ?? "—"}</span></div>
        <div className={`exam-timer ${timerWarning ? "timer-warning" : ""}`}><span className="timer-label">TIME LEFT</span><strong>{formatTime(secondsLeft)}</strong></div>
      </header>
      <div className="exam-instructions"><span className="instruction-dot" /> Select one answer for each question. Use the question palette to navigate.</div>
      <main className="live-layout">
        <section className="question-workspace">
          <div className="paper-strip"><span>QUESTION {String(currentIndex + 1).padStart(2, "0")} <i>of {examQuestions.length}</i></span><span className="marks-label">Single correct answer</span></div>
          <div className="question-workspace-body">
            <div className="question-number-large">{String(currentIndex + 1).padStart(2, "0")}</div>
            <h1 className="live-question-text">{currentQuestion?.question || "Question text unavailable"}</h1>
            <div className="answer-instruction">Choose the most appropriate answer.</div>
            <div className="live-options">
              {entries.map(([key, value]) => {
                const chosen = selectedAnswer === `${key}. ${value}`;
                return <button key={key} className={`live-option ${chosen ? "is-selected" : ""}`} onClick={() => chooseAnswer(key, value)}>
                  <span className="live-option-key">{key.toUpperCase()}</span><span className="live-option-text">{value}</span><span className="radio-mark">{chosen ? "✓" : ""}</span>
                </button>;
              })}
            </div>
          </div>
          <div className="question-controls">
            <button className="control-btn light" onClick={() => { if (currentQuestion) setAnswers(a => { const next = {...a}; delete next[currentQuestion.id]; return next; }); }}>Clear response</button>
            <button className={`control-btn review-btn ${currentQuestion && marked.has(currentQuestion.id) ? "is-marked" : ""}`} onClick={toggleMarked}>{currentQuestion && marked.has(currentQuestion.id) ? "★ Marked for review" : "☆ Mark for review"}</button>
            <div className="controls-spacer" />
            <button className="control-btn secondary" disabled={currentIndex === 0} onClick={() => goToQuestion(currentIndex - 1)}>← Previous</button>
            {currentIndex < examQuestions.length - 1
              ? <button className="control-btn next-btn" onClick={() => goToQuestion(currentIndex + 1)}>Save & Next <span>→</span></button>
              : <button className="control-btn next-btn" onClick={() => setShowSubmitDialog(true)}>Submit test <span>✓</span></button>}
          </div>
        </section>
        <aside className="question-sidebar">
          <div className="candidate-card"><div className="candidate-avatar">C</div><div><strong>Candidate</strong><span>Practice session</span></div><span className="candidate-status">● Active</span></div>
          <div className="palette-heading"><h2>Question palette</h2><span>{examQuestions.length} total</span></div>
          <div className="palette-legend">
            <div><span className="legend-box legend-answered">{answeredCount}</span><span>Answered</span></div>
            <div><span className="legend-box legend-unanswered">{unansweredCount}</span><span>Not answered</span></div>
            <div><span className="legend-box legend-review">{markedCount}</span><span>Review</span></div>
          </div>
          <div className="palette-grid">
            {examQuestions.map((q, index) => <button key={q.id} aria-label={`Go to question ${index + 1}`} title={`Question ${index + 1}`} className={`palette-number ${questionState(q)} ${index === currentIndex ? "current" : ""}`} onClick={() => goToQuestion(index)}>{index + 1}</button>)}
          </div>
          <div className="palette-note"><span className="palette-current-dot" /> Current question</div>
          <div className="sidebar-progress"><div><span>Progress</span><strong>{Math.round((answeredCount / examQuestions.length) * 100)}%</strong></div><div className="sidebar-progress-track"><span style={{width: `${(answeredCount / examQuestions.length) * 100}%`}} /></div><small>{answeredCount} of {examQuestions.length} answered</small></div>
          <button className="finish-exam-btn" onClick={() => setShowSubmitDialog(true)}>Submit examination <span>→</span></button>
          <p className="sidebar-reminder">Review unanswered questions before submitting your test.</p>
        </aside>
      </main>
      {showSubmitDialog && <div className="dialog-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setShowSubmitDialog(false); }}>
        <section className="submit-dialog" role="dialog" aria-modal="true" aria-labelledby="submit-title">
          <div className="dialog-icon">?</div><h2 id="submit-title">Submit your examination?</h2><p>Once submitted, you’ll see your score and answer review.</p>
          <div className="dialog-stats"><div><strong>{answeredCount}</strong><span>Answered</span></div><div><strong>{unansweredCount}</strong><span>Unanswered</span></div><div><strong>{markedCount}</strong><span>For review</span></div></div>
          {unansweredCount > 0 && <div className="dialog-warning">You still have {unansweredCount} unanswered question{unansweredCount === 1 ? "" : "s"}.</div>}
          <div className="dialog-actions"><button className="control-btn light" onClick={() => setShowSubmitDialog(false)}>Return to test</button><button className="control-btn next-btn" onClick={finishExam}>Submit now</button></div>
        </section>
      </div>}
    </div>
  );
}
