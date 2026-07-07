import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Dropdown } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { apiError } from '../../services/api.js';
import { sendAgreementEmail, agreementStreamUrl } from '../../services/orders.service.js';
import { AGREEMENT_LANGUAGES } from '../../config/agreementI18n.js';
import AgreementDocument from './AgreementDocument.jsx';

function fmtCountdown(ms) {
  if (ms <= 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Staff control panel shown in the checkout tab after the agreement is generated. Watches
// the agreement over SSE for "customer viewing" + "confirmed", counts down the 30-min
// expiry, and lets the staff share the link (email or copy). The agreement is immutable.
export default function AgreementPanel({ agreement }) {
  const toast = useToast();
  const [lang, setLang] = useState(agreement.language || 'en');
  const [status, setStatus] = useState(agreement.status || 'active');
  const [orderId, setOrderId] = useState(agreement.orderId || null);
  const [viewing, setViewing] = useState(false);
  const [remaining, setRemaining] = useState(() => new Date(agreement.expiresAt).getTime() - Date.now());
  const [emailBusy, setEmailBusy] = useState(false);
  const viewingTimer = useRef(null);

  const link = `${window.location.origin}/agreement/${agreement.token}`;
  const expired = status === 'expired' || (status === 'active' && remaining <= 0);
  const confirmed = status === 'confirmed';

  // Live updates from the customer's public page (viewing pings + confirmation).
  useEffect(() => {
    if (confirmed) return undefined;
    const es = new EventSource(agreementStreamUrl(agreement.id));
    es.onmessage = (evt) => {
      let data;
      try {
        data = JSON.parse(evt.data);
      } catch {
        return;
      }
      if (data.type === 'agreement:viewing') {
        setViewing(true);
        if (viewingTimer.current) clearTimeout(viewingTimer.current);
        // The customer pings every few seconds; treat a ~15s gap as "left the page".
        viewingTimer.current = setTimeout(() => setViewing(false), 15000);
      } else if (data.type === 'agreement:confirmed') {
        setStatus('confirmed');
        setOrderId(data.orderId);
        setViewing(false);
      }
    };
    es.onerror = () => {}; // EventSource auto-reconnects
    return () => {
      es.close();
      if (viewingTimer.current) clearTimeout(viewingTimer.current);
    };
  }, [agreement.id, confirmed]);

  // 30-minute countdown.
  useEffect(() => {
    if (confirmed) return undefined;
    const tick = () => setRemaining(new Date(agreement.expiresAt).getTime() - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [agreement.expiresAt, confirmed]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copied — paste it in the chat with the customer.');
    } catch {
      toast.error('Could not copy — select the link and copy it manually.');
    }
  };

  const emailLink = async () => {
    setEmailBusy(true);
    try {
      await sendAgreementEmail(agreement.id);
      toast.success(`Order link emailed to ${agreement.email}.`);
    } catch (err) {
      const status503 = err?.response?.status === 503;
      toast.error(status503 ? 'Email isn’t set up on the server — copy the link and send it via chat instead.' : apiError(err));
    } finally {
      setEmailBusy(false);
    }
  };

  if (confirmed) {
    return (
      <div className="agreement-panel agreement-panel--confirmed">
        <div className="agreement-panel__result">
          <div className="agreement-panel__result-icon" aria-hidden="true">✓</div>
          <h2 className="agreement-panel__result-title">Order confirmed</h2>
          <p className="agreement-panel__result-sub">The customer agreed and confirmed. Order #{orderId} was created and is now pending.</p>
          <div className="agreement-panel__result-actions">
            <Link to="/shop/orders" className="btn btn--primary btn--flat">View order</Link>
            <Link to="/shop/products" className="btn btn--subtle">New cart</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="agreement-panel">
      <div className="agreement-panel__bar">
        <div className={`agreement-panel__viewing${viewing ? ' is-on' : ''}`}>
          <span className="agreement-panel__dot" aria-hidden="true" />
          {viewing ? 'Customer is viewing' : 'Waiting for the customer'}
        </div>
        <div className={`agreement-panel__timer${expired ? ' is-expired' : ''}`}>
          {expired ? 'Expired' : `Expires in ${fmtCountdown(remaining)}`}
        </div>
      </div>

      {expired ? (
        <div className="agreement-panel__expired">
          This agreement has expired and can no longer be confirmed. Start a new cart to place the order.
          <div className="mt-lg"><Link to="/shop/products" className="btn btn--primary btn--flat">Start a new cart</Link></div>
        </div>
      ) : (
        <div className="agreement-panel__share">
          <label className="field agreement-panel__link">
            <span className="field__label">Customer link</span>
            <div className="agreement-panel__link-row">
              <input className="input" value={link} readOnly onFocus={(e) => e.target.select()} />
              <Button type="button" variant="primary" onClick={copyLink}>Copy</Button>
            </div>
          </label>
          <div className="agreement-panel__share-actions">
            <Button type="button" variant="subtle" onClick={emailLink} disabled={!agreement.email || !agreement.emailEnabled || emailBusy}>
              {emailBusy ? 'Sending…' : agreement.email ? 'Send via email' : 'No email on file'}
            </Button>
            <div className="agreement-panel__lang">
              <span className="agreement-panel__lang-label">Preview language</span>
              <Dropdown value={lang} onChange={setLang} options={AGREEMENT_LANGUAGES} ariaLabel="Preview language" />
            </div>
          </div>
        </div>
      )}

      <AgreementDocument agreement={agreement} lang={lang} />

      <p className="agreement-panel__immutable">
        This agreement can’t be edited. If anything needs to change, <Link to="/shop/products">start a new cart</Link>.
      </p>
    </div>
  );
}
