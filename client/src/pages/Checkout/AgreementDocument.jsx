import { formatPrice } from '../../config/currency.js';
import { agreementT } from '../../config/agreementI18n.js';

// The read-only agreement document, shared by the staff control panel (AgreementPanel)
// and the public customer viewer (AgreementViewer). Renders the order summary, the
// delivery block and the sworn statement — nothing interactive. `lang` is 'en' | 'tl'.
export default function AgreementDocument({ agreement, lang = 'en' }) {
  const t = agreementT(lang);
  const cur = agreement.currency;
  const items = agreement.items || [];
  const discounts = agreement.discounts || [];
  const hasQuote = items.some((it) => it.unitPrice == null);
  const priceOrQuote = (v) => (v == null ? t.quote : formatPrice(v, cur));

  return (
    <div className="agreement-doc">
      <div className="agreement-doc__title">{t.docTitle}</div>

      <section className="agreement-doc__section">
        <div className="agreement-doc__heading">{t.orderSummary}</div>
        <div className="agreement-doc__table-wrap">
          <table className="agreement-doc__table">
            <thead>
              <tr>
                <th>{t.item}</th>
                <th className="agreement-doc__num">{t.unitPrice}</th>
                <th className="agreement-doc__num">{t.qty}</th>
                <th className="agreement-doc__num">{t.amount}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={`${it.productId ?? '_'}:${i}`}>
                  <td>
                    <span className="agreement-doc__item-name">{it.name}</span>
                    {it.variantLabel && <span className="agreement-doc__variant"> · {it.variantLabel}</span>}
                  </td>
                  <td className="agreement-doc__num">{priceOrQuote(it.unitPrice)}</td>
                  <td className="agreement-doc__num">{it.quantity}</td>
                  <td className="agreement-doc__num">{it.lineTotal == null ? t.quote : formatPrice(it.lineTotal, cur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="agreement-doc__totals">
          <div className="agreement-doc__total-row">
            <span>{t.subtotal}</span>
            <span>{formatPrice(agreement.subtotal, cur)}</span>
          </div>
          {discounts.map((d, i) => (
            <div className="agreement-doc__total-row agreement-doc__total-row--discount" key={`${d.id ?? '_'}:${i}`}>
              <span>{d.name}</span>
              <span>−{formatPrice(d.amount, cur)}</span>
            </div>
          ))}
          <div className="agreement-doc__total-row agreement-doc__total-row--grand">
            <span>{t.total}</span>
            <strong>{formatPrice(agreement.total, cur)}</strong>
          </div>
          {hasQuote && <p className="agreement-doc__quote-note">{t.quoteNote}</p>}
        </div>
      </section>

      <section className="agreement-doc__section">
        <p className="agreement-doc__statement">
          {t.stmtAuthorize} <strong>{agreement.customerName}</strong> {t.atWord} <strong>{agreement.deliveryAddress}</strong>.
        </p>
        <p className="agreement-doc__statement">
          {t.stmtCoordPre} <strong>{agreement.customerName}</strong> {t.stmtCoordPost}
        </p>
        <div className="agreement-doc__contact">
          <div>
            <strong>{t.stmtContact}</strong> {agreement.contactNumber}
          </div>
          {agreement.email && (
            <div>
              <strong>{t.stmtEmail}</strong> {agreement.email}
            </div>
          )}
        </div>
        <p className="agreement-doc__statement agreement-doc__statement--issued">{t.stmtIssued}</p>
        {agreement.notes && (
          <p className="agreement-doc__statement agreement-doc__statement--notes">
            {t.notes}: {agreement.notes}
          </p>
        )}
      </section>

      {agreement.terms && (
        <section className="agreement-doc__section">
          <div className="agreement-doc__heading">{t.terms}</div>
          <p className="agreement-doc__terms">{agreement.terms}</p>
        </section>
      )}

      <p className="agreement-doc__sworn">{t.swornStatement}</p>
    </div>
  );
}
