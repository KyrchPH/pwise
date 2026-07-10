import { useEffect, useRef, useState } from 'react';
import { Button, Spinner } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { apiError } from '../../services/api.js';
import { getPublicSurvey, submitPublicSurvey } from '../../services/surveys.service.js';

// The two questions, in the customer's words. Satisfaction rates how the agent
// handled the conversation (CSAT 1-5); recommend is the classic NPS 0-10.
const SATISFACTION = [
  { value: 1, emoji: '😞', label: 'Very unsatisfied' },
  { value: 2, emoji: '😕', label: 'Unsatisfied' },
  { value: 3, emoji: '😐', label: 'Neutral' },
  { value: 4, emoji: '🙂', label: 'Satisfied' },
  { value: 5, emoji: '😍', label: 'Very satisfied' },
];

function token() {
  return window.location.pathname.split('/').pop();
}

// Public, unauthenticated customer survey (/survey/:token) — opened from the email
// sent after their conversation. Two questions + an optional comment; one-shot.
export default function SurveyPage() {
  const toast = useToast();
  const tok = token();
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState('active'); // active | submitted | expired | invalid | error | done
  const [survey, setSurvey] = useState(null);
  const [satisfaction, setSatisfaction] = useState(null); // 1-5
  const [recommend, setRecommend] = useState(null); // 0-10
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    document.title = 'Rate your experience';
    (async () => {
      try {
        const r = await getPublicSurvey(tok);
        if (!mounted.current) return;
        setState(r.state);
        setSurvey(r.survey || null);
      } catch (err) {
        if (mounted.current) setState(err?.response?.status === 404 ? 'invalid' : 'error');
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, [tok]);

  const submit = async () => {
    if (satisfaction == null || recommend == null || sending) return;
    setSending(true);
    try {
      await submitPublicSurvey(tok, { satisfaction, recommend, comment: comment.trim() });
      setState('done');
    } catch (err) {
      const st = err?.response?.status;
      if (st === 409) setState('submitted');
      else if (st === 410) setState('expired');
      else toast.error(apiError(err));
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="survey-view">
        <div className="survey-view__card"><Spinner label="Loading…" /></div>
      </div>
    );
  }

  if (state !== 'active') {
    const end = {
      done: { icon: '✓', title: 'Thank you!', sub: 'Your feedback helps us serve you better.', mod: 'ok' },
      submitted: { icon: '✓', title: 'Already answered', sub: 'This survey has already been submitted — thank you!', mod: 'ok' },
      expired: { icon: '⏳', title: 'This link has expired', sub: 'Sorry, this survey is no longer open.', mod: 'warn' },
      invalid: { icon: '∅', title: 'Survey not found', sub: 'This link is invalid or no longer exists.', mod: 'warn' },
      error: { icon: '⚠️', title: 'Something went wrong', sub: 'Please try opening the link again in a moment.', mod: 'warn' },
    }[state] || { icon: '∅', title: 'Survey not found', sub: 'This link is invalid or no longer exists.', mod: 'warn' };
    return (
      <div className="survey-view">
        <div className={`survey-view__card survey-view__end survey-view__end--${end.mod}`}>
          <div className="survey-view__end-icon" aria-hidden="true">{end.icon}</div>
          <h1 className="survey-view__end-title">{end.title}</h1>
          <p className="survey-view__end-sub">{end.sub}</p>
        </div>
      </div>
    );
  }

  const pageName = survey?.pageName || 'our team';
  return (
    <div className="survey-view">
      <div className="survey-view__card">
        <header className="survey-view__head">
          <div className="survey-view__brand">{pageName}</div>
          <h1 className="survey-view__title">How did we do?</h1>
          <p className="survey-view__sub">
            Thanks for chatting with us{survey?.customerName ? `, ${survey.customerName}` : ''}. Two quick questions —
            it takes less than a minute.
          </p>
        </header>

        <section className="survey-q">
          <h2 className="survey-q__label">How satisfied are you with how we handled your conversation?</h2>
          <div className="survey-faces" role="radiogroup" aria-label="Satisfaction rating">
            {SATISFACTION.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={satisfaction === o.value}
                className={`survey-face${satisfaction === o.value ? ' is-active' : ''}`}
                onClick={() => setSatisfaction(o.value)}
              >
                <span className="survey-face__emoji" aria-hidden="true">{o.emoji}</span>
                <span className="survey-face__label">{o.label}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="survey-q">
          <h2 className="survey-q__label">How likely are you to recommend {pageName} to a friend?</h2>
          <div className="survey-nps" role="radiogroup" aria-label="Recommendation score from 0 to 10">
            {Array.from({ length: 11 }, (_, n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={recommend === n}
                className={`survey-nps__btn${recommend === n ? ' is-active' : ''}`}
                onClick={() => setRecommend(n)}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="survey-nps__legend">
            <span>Not likely at all</span>
            <span>Extremely likely</span>
          </div>
        </section>

        <section className="survey-q">
          <h2 className="survey-q__label">
            Anything else you&rsquo;d like to tell us? <span className="survey-q__optional">(optional)</span>
          </h2>
          <textarea
            className="input survey-comment"
            rows={4}
            maxLength={2000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Your feedback…"
          />
        </section>

        <Button
          type="button"
          variant="primary"
          size="lg"
          className="btn--block btn--flat"
          onClick={submit}
          disabled={satisfaction == null || recommend == null || sending}
        >
          {sending ? 'Sending…' : 'Send feedback'}
        </Button>
        <p className="survey-view__foot">Your answers are shared with the team as anonymous, aggregated feedback.</p>
      </div>
    </div>
  );
}
