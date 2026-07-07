import { useState } from 'react';
import { Button, Dropdown } from '../../components/ui.jsx';
import { AGREEMENT_LANGUAGES } from '../../config/agreementI18n.js';

// Step 2 of checkout: the staff enters the customer's delivery details (gathered from the
// chat). Full name, address and contact are required; email + notes are optional. The
// language sets the agreement document's default language for the customer.
export default function DeliveryForm({ onSubmit, onBack, submitting = false }) {
  const [form, setForm] = useState({ customerName: '', deliveryAddress: '', contactNumber: '', email: '', notes: '', language: 'en' });
  const [touched, setTouched] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const missing = (v) => touched && !String(v).trim();
  const valid = form.customerName.trim() && form.deliveryAddress.trim() && form.contactNumber.trim();

  const submit = (e) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    onSubmit({
      customerName: form.customerName.trim(),
      deliveryAddress: form.deliveryAddress.trim(),
      contactNumber: form.contactNumber.trim(),
      email: form.email.trim() || null,
      notes: form.notes.trim() || null,
      language: form.language,
    });
  };

  return (
    <form className="checkout-details" onSubmit={submit} noValidate>
      <div className="checkout-details__head">
        <h2 className="checkout-details__title">Delivery details</h2>
        <p className="checkout-details__sub">Enter where this order should be delivered. The customer will review and confirm it next.</p>
      </div>

      <div className="checkout-details__grid">
        <label className="field">
          <span className="field__label">Full name *</span>
          <input className={`input${missing(form.customerName) ? ' input--error' : ''}`} value={form.customerName} onChange={set('customerName')} placeholder="e.g. Juan dela Cruz" autoFocus />
        </label>
        <label className="field">
          <span className="field__label">Contact number *</span>
          <input className={`input${missing(form.contactNumber) ? ' input--error' : ''}`} value={form.contactNumber} onChange={set('contactNumber')} placeholder="e.g. 0917 123 4567" />
        </label>
        <label className="field checkout-details__full">
          <span className="field__label">Delivery address *</span>
          <textarea className={`input${missing(form.deliveryAddress) ? ' input--error' : ''}`} rows={3} value={form.deliveryAddress} onChange={set('deliveryAddress')} placeholder="House/unit, street, barangay, city, province" />
        </label>
        <label className="field">
          <span className="field__label">Email (optional)</span>
          <input type="email" className="input" value={form.email} onChange={set('email')} placeholder="For emailing the order link" />
        </label>
        <div className="field">
          <span className="field__label">Agreement language</span>
          <Dropdown value={form.language} onChange={(v) => setForm((f) => ({ ...f, language: v }))} options={AGREEMENT_LANGUAGES} ariaLabel="Agreement language" />
        </div>
        <label className="field checkout-details__full">
          <span className="field__label">Notes (optional)</span>
          <textarea className="input" rows={2} value={form.notes} onChange={set('notes')} placeholder="Anything the customer should know about this order" />
        </label>
      </div>

      {touched && !valid && <p className="checkout-details__error">Please fill in the full name, delivery address and contact number.</p>}

      <div className="checkout-details__actions">
        <Button type="button" variant="subtle" onClick={onBack} disabled={submitting}>Back</Button>
        <Button type="submit" variant="primary" disabled={submitting}>{submitting ? 'Generating…' : 'Generate agreement'}</Button>
      </div>
    </form>
  );
}
