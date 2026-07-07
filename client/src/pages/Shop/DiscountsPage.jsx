import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { usePages } from '../../context/PageContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { summarizeRule, SCOPE_OPTIONS } from '../../config/discounts.js';
import * as discountsApi from '../../services/discounts.service.js';
import * as productsApi from '../../services/products.service.js';
import { apiError } from '../../services/api.js';
import { Button, Card, Field, Modal, Spinner, Toggle } from '../../components/ui.jsx';

const BLANK = {
  name: '', description: '', active: true,
  valueType: 'percent', value: '', percentCap: '',
  scope: 'all', targetCategory: '', targetProductId: '', thresholdQty: '', minAmount: '',
  appliesTo: 'order', stackable: false,
  startsAt: '', endsAt: '', code: '',
};

// ISO/Date → "YYYY-MM-DDTHH:MM" for a datetime-local input (blank when unset).
function toLocalInput(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDiscount(d) {
  return {
    id: d.id,
    name: d.name || '',
    description: d.description || '',
    active: d.active !== false,
    valueType: d.valueType || 'percent',
    value: d.value == null ? '' : String(d.value),
    percentCap: d.percentCap == null ? '' : String(d.percentCap),
    scope: d.scope || 'all',
    targetCategory: d.targetCategory || '',
    targetProductId: d.targetProductId == null ? '' : String(d.targetProductId),
    thresholdQty: d.thresholdQty == null ? '' : String(d.thresholdQty),
    minAmount: d.minAmount == null ? '' : String(d.minAmount),
    appliesTo: d.appliesTo || 'order',
    stackable: !!d.stackable,
    startsAt: toLocalInput(d.startsAt),
    endsAt: toLocalInput(d.endsAt),
    code: d.code || '',
  };
}

const ITEM_SCOPES = ['category', 'product', 'product_qty'];

export default function DiscountsPage() {
  const { isAdmin } = useAuth();
  const { activeId, activePage } = usePages();
  const toast = useToast();
  const currency = activePage?.currency;

  const [discounts, setDiscounts] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // BLANK-shaped (+ optional id) or null
  const [busy, setBusy] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);

  useEffect(() => {
    if (activeId == null) {
      setDiscounts([]);
      setProducts([]);
      setLoading(false);
      return undefined;
    }
    let live = true;
    setLoading(true);
    Promise.all([discountsApi.list(activeId), productsApi.list(activeId)])
      .then(([d, p]) => {
        if (!live) return;
        setDiscounts(d);
        setProducts(p);
      })
      .catch((e) => live && toast.error(apiError(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [products],
  );

  const setField = (key) => (e) => setEditing((ed) => ({ ...ed, [key]: e.target.value }));

  const startAdd = () => isAdmin && setEditing({ ...BLANK });
  const startEdit = (d) => isAdmin && setEditing(fromDiscount(d));
  const cancel = () => setEditing(null);

  const commit = async () => {
    if (!isAdmin) return toast.error('Only admins can change discounts.');
    const name = editing.name.trim();
    if (!name) return toast.error('Give the discount a name.');
    if (!(Number(editing.value) > 0)) return toast.error('Enter a value greater than 0.');
    if (editing.scope === 'category' && !editing.targetCategory.trim()) return toast.error('Choose a category.');
    if (ITEM_SCOPES.includes(editing.scope) && editing.scope !== 'category' && !editing.targetProductId) return toast.error('Choose a product.');
    if ((editing.scope === 'cart_item_count' || editing.scope === 'product_qty') && !(Number(editing.thresholdQty) > 0)) return toast.error('Enter a quantity.');
    if (editing.scope === 'min_order_amount' && !(Number(editing.minAmount) > 0)) return toast.error('Enter a minimum amount.');
    if (activeId == null) return toast.error('Select a page first.');

    const isItemScope = ITEM_SCOPES.includes(editing.scope);
    const payload = {
      name,
      description: editing.description.trim(),
      active: editing.active,
      value_type: editing.valueType,
      value: editing.value,
      percent_cap: editing.valueType === 'percent' && String(editing.percentCap).trim() !== '' ? editing.percentCap : null,
      scope: editing.scope,
      target_category: editing.scope === 'category' ? editing.targetCategory.trim() : null,
      target_product_id: editing.scope === 'product' || editing.scope === 'product_qty' ? editing.targetProductId : null,
      threshold_qty: editing.scope === 'cart_item_count' || editing.scope === 'product_qty' ? editing.thresholdQty : null,
      min_amount: editing.scope === 'min_order_amount' ? editing.minAmount : null,
      applies_to: isItemScope ? editing.appliesTo : 'order',
      stackable: editing.stackable,
      starts_at: editing.startsAt || null,
      ends_at: editing.endsAt || null,
      code: editing.code.trim().toUpperCase() || null,
    };

    setBusy(true);
    try {
      if (editing.id) {
        const updated = await discountsApi.update(editing.id, payload);
        setDiscounts((cur) => cur.map((d) => (d.id === updated.id ? updated : d)));
        toast.success('Discount updated');
      } else {
        const created = await discountsApi.create({ ...payload, account_id: activeId });
        setDiscounts((cur) => [created, ...cur]);
        toast.success('Discount added');
      }
      setEditing(null);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  const del = async (d) => {
    if (!isAdmin || busy) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete "${d.name}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      await discountsApi.remove(d.id);
      setDiscounts((cur) => cur.filter((x) => x.id !== d.id));
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="products-page">
      <div className="row row--between products-page__head" style={{ gap: 12 }}>
        <div>
          <h1 className="products-page__title">Discounts</h1>
          <p className="text-sm text-muted">
            Cart discounts for {activePage?.account_name ? <strong>{activePage.account_name}</strong> : 'this page'}
          </p>
        </div>
        {isAdmin && activeId != null && (
          <Button size="sm" className="btn--flat" onClick={startAdd}>Add discount</Button>
        )}
      </div>

      {activeId == null ? (
        <Card className="card--pad">
          <p className="text-sm text-muted">Select a page from the sidebar to manage its discounts.</p>
        </Card>
      ) : loading ? (
        <Spinner label="Loading discounts…" />
      ) : discounts.length === 0 ? (
        <Card className="card--pad">
          <p className="text-sm text-muted">
            {isAdmin ? 'No discounts yet. Add one to apply it automatically in the cart.' : 'No discounts have been added yet.'}
          </p>
        </Card>
      ) : (
        <div className="discounts-grid">
          {discounts.map((d) => (
            <Card key={d.id} className={`discount-card${d.active ? '' : ' is-inactive'}${isAdmin ? ' has-menu' : ''}`}>
              {isAdmin && (
                <div
                  className="discount-card__menu"
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget)) setOpenMenuId((cur) => (cur === d.id ? null : cur));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setOpenMenuId(null);
                  }}
                >
                  <button
                    type="button"
                    className="discount-card__menu-btn"
                    aria-label={`Actions for ${d.name}`}
                    aria-haspopup="menu"
                    aria-expanded={openMenuId === d.id}
                    onClick={() => setOpenMenuId((cur) => (cur === d.id ? null : d.id))}
                  >
                    <span className="discount-card__menu-dots" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                  </button>
                  {openMenuId === d.id && (
                    <div className="discount-card__menu-list" role="menu">
                      <button
                        type="button"
                        className="discount-card__menu-item"
                        role="menuitem"
                        onClick={() => {
                          setOpenMenuId(null);
                          startEdit(d);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="discount-card__menu-item discount-card__menu-item--danger"
                        role="menuitem"
                        onClick={() => {
                          setOpenMenuId(null);
                          del(d);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              )}
              {(d.code || d.stackable || !d.active) && (
                <div className="discount-card__top">
                  {d.code && <span className="discount-card__flag discount-card__flag--code">Code: {d.code}</span>}
                  {d.stackable && <span className="discount-card__flag">Stackable</span>}
                  {!d.active && <span className="discount-card__flag discount-card__flag--off">Inactive</span>}
                </div>
              )}
              <div className="discount-card__name" title={d.name}>{d.name}</div>
              <div className="discount-card__rule">{summarizeRule(d, { products, currency })}</div>
              {d.description && <p className="discount-card__desc">{d.description}</p>}
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={!!editing}
        title={editing?.id ? 'Edit discount' : 'New discount'}
        onClose={cancel}
        footer={
          <div className="row gap-sm" style={{ justifyContent: 'flex-end' }}>
            <Button variant="ghost" size="sm" onClick={cancel} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={commit} disabled={busy}>{busy ? 'Saving…' : editing?.id ? 'Save' : 'Add discount'}</Button>
          </div>
        }
      >
        {editing && (
          <div className="ct-form">
            <Field label="Name">
              <input className="input" value={editing.name} onChange={setField('name')} placeholder="e.g. Summer 15% off Cleaning" />
            </Field>
            <Field label="Description" hint="optional">
              <input className="input" value={editing.description} onChange={setField('description')} placeholder="Shown on the discount card" />
            </Field>
            <Field label="Discount code" hint="optional — blank = applies automatically to every cart">
              <input
                className="input"
                value={editing.code}
                onChange={setField('code')}
                placeholder="e.g. SUMMER15 — shoppers enter/select this in the cart"
                maxLength={60}
                style={{ textTransform: 'uppercase' }}
              />
            </Field>

            <div className="row gap-sm" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Field label="Type">
                <select className="select" value={editing.valueType} onChange={setField('valueType')}>
                  <option value="percent">Percentage</option>
                  <option value="fixed">Fixed amount</option>
                </select>
              </Field>
              <Field label={editing.valueType === 'percent' ? 'Percent off' : 'Amount off'}>
                <input className="input" type="number" min="0" step="0.01" value={editing.value} onChange={setField('value')} placeholder={editing.valueType === 'percent' ? 'e.g. 15' : '0.00'} />
              </Field>
              {editing.valueType === 'percent' && (
                <Field label="Cap" hint="blank = no cap">
                  <input className="input" type="number" min="0" step="0.01" value={editing.percentCap} onChange={setField('percentCap')} placeholder="max amount off" />
                </Field>
              )}
            </div>

            <Field label="Applies to">
              <select className="select" value={editing.scope} onChange={setField('scope')}>
                {SCOPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>

            {editing.scope === 'category' && (
              <Field label="Category">
                {categories.length > 0 ? (
                  <select className="select" value={editing.targetCategory} onChange={setField('targetCategory')}>
                    <option value="">Select a category…</option>
                    {categories.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                ) : (
                  <input className="input" value={editing.targetCategory} onChange={setField('targetCategory')} placeholder="e.g. Cleaning" />
                )}
              </Field>
            )}

            {(editing.scope === 'product' || editing.scope === 'product_qty') && (
              <Field label="Product">
                <select className="select" value={editing.targetProductId} onChange={setField('targetProductId')}>
                  <option value="">Select a product…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </Field>
            )}

            {(editing.scope === 'cart_item_count' || editing.scope === 'product_qty') && (
              <Field label={editing.scope === 'cart_item_count' ? 'Minimum total items in cart' : 'Minimum quantity of that product'}>
                <input className="input" type="number" min="1" step="1" value={editing.thresholdQty} onChange={setField('thresholdQty')} placeholder="e.g. 3" />
              </Field>
            )}

            {editing.scope === 'min_order_amount' && (
              <Field label="Minimum order amount">
                <input className="input" type="number" min="0" step="0.01" value={editing.minAmount} onChange={setField('minAmount')} placeholder="e.g. 1000" />
              </Field>
            )}

            {ITEM_SCOPES.includes(editing.scope) && (
              <Field label="Discount target">
                <select className="select" value={editing.appliesTo} onChange={setField('appliesTo')}>
                  <option value="order">The whole order</option>
                  <option value="matching_items">Only the qualifying items</option>
                </select>
              </Field>
            )}

            <div className="row gap-sm" style={{ flexWrap: 'wrap' }}>
              <Toggle checked={editing.active} onChange={(v) => setEditing((ed) => ({ ...ed, active: v }))} label="Active" />
              <Toggle checked={editing.stackable} onChange={(v) => setEditing((ed) => ({ ...ed, stackable: v }))} label="Stackable (adds on top of the best discount)" />
            </div>

            <details className="discount-schedule">
              <summary>Schedule (optional)</summary>
              <div className="row gap-sm" style={{ flexWrap: 'wrap', marginTop: 8 }}>
                <Field label="Starts">
                  <input className="input" type="datetime-local" value={editing.startsAt} onChange={setField('startsAt')} />
                </Field>
                <Field label="Ends">
                  <input className="input" type="datetime-local" value={editing.endsAt} onChange={setField('endsAt')} />
                </Field>
              </div>
            </details>
          </div>
        )}
      </Modal>
    </section>
  );
}
