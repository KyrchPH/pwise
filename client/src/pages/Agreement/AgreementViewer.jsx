import { useEffect, useRef, useState } from 'react';
import { Button, Dropdown, Spinner } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { apiError } from '../../services/api.js';
import { getPublicAgreement, pingAgreement, confirmAgreement } from '../../services/orders.service.js';
import { AGREEMENT_LANGUAGES, agreementT } from '../../config/agreementI18n.js';
import AgreementDocument from '../Checkout/AgreementDocument.jsx';

const PING_MS = 7000; // heartbeat so the seller sees "customer is viewing"

function fmtCountdown(ms) {
  if (ms <= 0) return '0:00';
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function token() {
  return window.location.pathname.split('/').pop();
}

// Public, unauthenticated customer view of a shared order agreement (/agreement/:token).
// The customer reads the document, ticks the sworn-statement box and confirms — which
// creates the order. The link expires in 30 min and can't be reopened once confirmed.
export default function AgreementViewer() {
  const toast = useToast();
  const tok = token();
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState('active'); // active | expired | confirmed | cancelled | invalid | error
  const [agreement, setAgreement] = useState(null);
  const [lang, setLang] = useState('en');
  const [agreed, setAgreed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    document.title = 'Order agreement';
    (async () => {
      try {
        const r = await getPublicAgreement(tok);
        if (!mounted.current) return;
        setState(r.state);
        if (r.agreement) {
          setAgreement(r.agreement);
          setLang(r.agreement.language || 'en');
          setRemaining(new Date(r.agreement.expiresAt).getTime() - Date.now());
        }
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

  // "Still viewing" heartbeat + local countdown while the doc is open.
  useEffect(() => {
    if (state !== 'active' || !agreement) return undefined;
    const ping = setInterval(() => pingAgreement(tok).catch(() => {}), PING_MS);
    const tick = setInterval(() => {
      const left = new Date(agreement.expiresAt).getTime() - Date.now();
      setRemaining(left);
      if (left <= 0) setState('expired');
    }, 1000);
    return () => {
      clearInterval(ping);
      clearInterval(tick);
    };
  }, [state, agreement, tok]);

  const confirm = async () => {
    setConfirming(true);
    try {
      await confirmAgreement(tok);
      setState('confirmed');
    } catch (err) {
      const st = err?.response?.status;
      if (st === 410 || st === 409) {
        // Re-sync to the true end-state (expired vs already confirmed/cancelled).
        try {
          const r = await getPublicAgreement(tok);
          setState(r.state);
        } catch {
          setState('expired');
        }
      } else {
        toast.error(apiError(err));
      }
    } finally {
      setConfirming(false);
    }
  };

  const t = agreementT(lang);

  if (loading) {
    return (
      <div className="agreement-view">
        <div className="agreement-view__card"><Spinner label="Loading…" /></div>
      </div>
    );
  }

  if (state !== 'active' || !agreement) {
    const end = {
      confirmed: { icon: '✓', title: t.confirmedTitle, sub: t.confirmedSub, mod: 'ok' },
      expired: { icon: '⏳', title: t.expiredTitle, sub: t.expiredSub, mod: 'warn' },
      invalid: { icon: '∅', title: t.invalidTitle, sub: t.invalidSub, mod: 'warn' },
      error: { icon: '⚠️', title: t.invalidTitle, sub: t.invalidSub, mod: 'warn' },
    }[state] || { icon: '🔒', title: t.closedTitle, sub: t.closedSub, mod: 'warn' };
    return (
      <div className="agreement-view">
        <div className={`agreement-view__card agreement-view__end agreement-view__end--${end.mod}`}>
          <div className="agreement-view__end-icon" aria-hidden="true">{end.icon}</div>
          <h1 className="agreement-view__end-title">{end.title}</h1>
          <p className="agreement-view__end-sub">{end.sub}</p>
        </div>
      </div>
    );
  }

  const expired = remaining <= 0;
  return (
    <div className="agreement-view">
      <div className="agreement-view__card">
        <div className="agreement-view__bar">
          <div className={`agreement-view__timer${expired ? ' is-expired' : ''}`}>
            {expired ? t.expiredTitle : `${t.expiresIn} ${fmtCountdown(remaining)}`}
          </div>
          <div className="agreement-view__lang">
            <span className="agreement-view__lang-label">{t.language}</span>
            <Dropdown value={lang} onChange={setLang} options={AGREEMENT_LANGUAGES} ariaLabel={t.language} />
          </div>
        </div>

        <AgreementDocument agreement={agreement} lang={lang} />

        <div className="agreement-view__confirm">
          <label className="agreement-view__check">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} disabled={expired} />
            <span>{t.agreeCheckbox}</span>
          </label>
          <Button type="button" variant="primary" size="lg" className="btn--block" onClick={confirm} disabled={!agreed || confirming || expired}>
            {confirming ? t.confirming : t.confirmOrder}
          </Button>
        </div>
      </div>
    </div>
  );
}
