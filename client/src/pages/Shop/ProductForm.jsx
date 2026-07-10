import { useEffect, useMemo, useRef, useState } from 'react';
import * as productsApi from '../../services/products.service.js';
import { apiError } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import VaultPickerModal from '../../components/VaultPickerModal.jsx';
import { Button, Field, Modal } from '../../components/ui.jsx';
import { generateCombinations, comboKey, variantLabel } from '../../config/variants.js';

const MAX_AXES = 4;

function PlusIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}

// Build the form state from an existing product (edit) or blank (add). Variants are
// kept as a map keyed by comboKey so a price/photo survives when OTHER axes change.
function initialForm(product) {
  if (!product) {
    return {
      name: '', base_price: '', category: '', description: '', tags: '',
      photoPreview: '', photoVaultItemId: undefined, photoRemoved: false,
      options: [], variants: {},
    };
  }
  const variants = {};
  for (const v of product.variants || []) {
    variants[v.comboKey] = {
      price: v.price == null ? '' : String(v.price),
      active: v.active !== false,
      photoPreview: v.photoUrl || '',
      photoVaultItemId: undefined,
      photoRemoved: false,
    };
  }
  return {
    name: product.name || '',
    base_price: product.basePrice == null ? '' : String(product.basePrice),
    category: product.category || '',
    description: product.description || '',
    tags: (product.tags || []).join(', '),
    photoPreview: product.photoUrl || '',
    photoVaultItemId: undefined,
    photoRemoved: false,
    options: (product.options || []).map((a) => ({ name: a.name, values: [...a.values] })),
    variants,
  };
}

export default function ProductForm({ product, accountId, vaultFolderId, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(() => initialForm(product));
  const [busy, setBusy] = useState(false);
  const [pickerTarget, setPickerTarget] = useState(null); // null | 'product' | comboKey
  const [valueDraft, setValueDraft] = useState({}); // axisIndex -> in-progress value text

  const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const combinations = useMemo(() => generateCombinations(form.options), [form.options]);
  const hasAxes = combinations.length > 0;

  // When "Add option" appends an axis, the new card lands below the fold of the
  // dialog's scrolling body — scroll it into view and put the cursor in its name
  // input. Everything runs synchronously in the effect (the DOM is committed by
  // then), and focus comes FIRST: Chromium cancels an in-flight smooth scroll
  // when focus() runs later, even with preventScroll.
  const variantEditorRef = useRef(null);
  const prevAxisCount = useRef(form.options.length);
  useEffect(() => {
    const count = form.options.length;
    const grew = count > prevAxisCount.current;
    prevAxisCount.current = count;
    if (!grew) return;
    const cards = variantEditorRef.current?.querySelectorAll('.variant-axis');
    const added = cards?.[cards.length - 1];
    if (!added) return;
    added.querySelector('input')?.focus({ preventScroll: true });
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    const modalBody = added.closest('.modal')?.querySelector('.card--pad');
    if (modalBody) {
      // Land the new card just under the body's top edge so the space below it
      // (where its values and the combination table grow) stays in view.
      const top = modalBody.scrollTop + added.getBoundingClientRect().top - modalBody.getBoundingClientRect().top - 12;
      modalBody.scrollTo({ top: Math.max(0, top), behavior });
    } else {
      added.scrollIntoView({ behavior, block: 'nearest' });
    }
  }, [form.options.length]);

  // ── Axis editing ──────────────────────────────────────────────────────────────
  const addAxis = () =>
    setForm((f) => (f.options.length >= MAX_AXES ? f : { ...f, options: [...f.options, { name: '', values: [] }] }));
  const removeAxis = (i) => setForm((f) => ({ ...f, options: f.options.filter((_, idx) => idx !== i) }));
  const setAxisName = (i, name) =>
    setForm((f) => ({ ...f, options: f.options.map((a, idx) => (idx === i ? { ...a, name } : a)) }));
  const addValue = (i, raw) => {
    const value = String(raw || '').trim();
    if (!value) return;
    setForm((f) => ({
      ...f,
      options: f.options.map((a, idx) => {
        if (idx !== i) return a;
        if (a.values.some((x) => x.toLowerCase() === value.toLowerCase())) return a;
        return { ...a, values: [...a.values, value] };
      }),
    }));
    setValueDraft((d) => ({ ...d, [i]: '' }));
  };
  const removeValue = (i, val) =>
    setForm((f) => ({
      ...f,
      options: f.options.map((a, idx) => (idx === i ? { ...a, values: a.values.filter((x) => x !== val) } : a)),
    }));

  // ── Variant cells (keyed by comboKey) ───────────────────────────────────────────
  const variantOf = (key) =>
    form.variants[key] || { price: '', active: true, photoPreview: '', photoVaultItemId: undefined, photoRemoved: false };
  const setVariant = (key, patch) =>
    setForm((f) => ({ ...f, variants: { ...f.variants, [key]: { ...variantOf(key), ...patch } } }));

  // ── Photo picking (product or a variant) ────────────────────────────────────────
  const onPick = (selected) => {
    const item = selected[0];
    if (item) {
      if (pickerTarget === 'product') {
        setForm((f) => ({ ...f, photoPreview: item.url, photoVaultItemId: item.id, photoRemoved: false }));
      } else if (pickerTarget) {
        setVariant(pickerTarget, { photoPreview: item.url, photoVaultItemId: item.id, photoRemoved: false });
      }
    }
    setPickerTarget(null);
  };

  const submit = async () => {
    const name = form.name.trim();
    if (!name) return toast.error('Give the product a name.');
    if (accountId == null) return toast.error('Select a page first.');

    // Keep only named axes that have at least one value.
    const options = form.options
      .map((a) => ({ name: a.name.trim(), values: a.values.map((v) => v.trim()).filter(Boolean) }))
      .filter((a) => a.name && a.values.length);

    setBusy(true);
    try {
      const base = {
        name,
        category: form.category.trim(),
        description: form.description.trim(),
        tags: form.tags,
      };
      if (form.photoVaultItemId !== undefined) base.vault_item_id = form.photoVaultItemId;
      else if (form.photoRemoved) base.photo_remove = true;

      if (options.length) {
        base.base_price = null; // variable product — price lives on each variant
        base.options = options;
        base.variants = generateCombinations(options).map((optionValues, idx) => {
          const key = comboKey(optionValues, options);
          const v = form.variants[key] || {};
          const variant = {
            option_values: optionValues,
            price: v.price == null || String(v.price).trim() === '' ? null : String(v.price).trim(),
            active: v.active !== false,
            sort_order: idx,
          };
          if (v.photoVaultItemId !== undefined) variant.vault_item_id = v.photoVaultItemId;
          else if (v.photoRemoved) variant.photo_remove = true;
          return variant;
        });
      } else {
        base.base_price = form.base_price.trim() === '' ? null : form.base_price.trim();
        base.options = [];
        base.variants = [];
      }

      const saved = product?.id
        ? await productsApi.update(product.id, base)
        : await productsApi.create({ ...base, account_id: accountId });
      toast.success(product?.id ? 'Product updated' : 'Product added');
      onSaved(saved, !product?.id);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open
        onClose={onClose}
        closeOnBackdrop={false}
        className="modal--product-form"
        title={
          <div className="product-form__heading">
            <span>{product?.id ? 'Edit product' : 'Add product'}</span>
            <span className="product-form__subtitle">
              {product?.id
                ? 'Update the details, photo, or variants.'
                : 'Add the details, a photo, and optional variants.'}
            </span>
          </div>
        }
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button className="btn--flat product-form__submit" onClick={submit} disabled={busy}>
              {busy ? 'Saving…' : product?.id ? 'Save changes' : 'Add product'}
            </Button>
          </>
        }
      >
      <div className="ct-form product-form">
        <Field label="Name">
          <input className="input" value={form.name} onChange={setField('name')} placeholder="e.g. 5L Regular Dishwashing Liquid" />
        </Field>
        <div className="product-form__grid">
          {!hasAxes && (
            <Field label="Base price">
              <input className="input" type="number" min="0" step="0.01" value={form.base_price} onChange={setField('base_price')} placeholder="0.00" />
            </Field>
          )}
          <Field label="Category">
            <input className="input" value={form.category} onChange={setField('category')} placeholder="e.g. Cleaning" />
          </Field>
        </div>
        <Field label="Description">
          <textarea className="textarea" rows={3} value={form.description} onChange={setField('description')} placeholder="Short product description" />
        </Field>
        <Field label="Tags" hint="comma-separated">
          <input className="input" value={form.tags} onChange={setField('tags')} placeholder="e.g. bestseller, bulk" />
        </Field>
        <Field label="Photo">
          <div className="product-photo-field">
            {form.photoPreview ? (
              <img className="product-photo-field__preview" src={form.photoPreview} alt="" />
            ) : (
              <div className="product-photo-field__empty">No photo</div>
            )}
            <div className="product-photo-field__body">
              <span className="product-photo-field__hint">Picked from the Vault. Shown on the product tile and in chats.</span>
              <div className="row gap-sm">
                <Button type="button" variant="subtle" size="sm" onClick={() => setPickerTarget('product')}>
                  {form.photoPreview ? 'Change photo' : 'Pick from Vault'}
                </Button>
                {form.photoPreview && (
                  <button
                    type="button"
                    className="pf-iconbtn pf-iconbtn--danger"
                    onClick={() => setForm((f) => ({ ...f, photoPreview: '', photoVaultItemId: undefined, photoRemoved: true }))}
                    title="Remove photo"
                    aria-label="Remove photo"
                  >
                    <TrashIcon />
                  </button>
                )}
              </div>
            </div>
          </div>
        </Field>

        {/* Variants (option matrix) */}
        <div className="variant-editor" ref={variantEditorRef}>
          <div className="variant-editor__head">
            <div>
              <span className="field__label">Variants</span>
              <p className="text-sm text-muted" style={{ margin: '2px 0 0' }}>
                Add option axes (e.g. Size, Scent) to sell this in priced variants. Leave empty for a single base price.
              </p>
            </div>
            <Button type="button" size="sm" className="btn--flat variant-editor__add" onClick={addAxis} disabled={form.options.length >= MAX_AXES}>
              <PlusIcon /> Add variant
            </Button>
          </div>

          {form.options.map((axis, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <div className="variant-axis" key={i}>
              <div className="variant-axis__head">
                <span className="variant-axis__tag">Option {i + 1}</span>
                <button
                  type="button"
                  className="variant-axis__remove"
                  onClick={() => removeAxis(i)}
                  title="Remove option"
                  aria-label={`Remove option ${axis.name || i + 1}`}
                >
                  <TrashIcon />
                </button>
              </div>
              <label className="variant-axis__field">
                <span className="variant-axis__label">Name</span>
                <input className="input" placeholder="e.g. Size, Color, Scent" value={axis.name} onChange={(e) => setAxisName(i, e.target.value)} />
              </label>
              <div className="variant-axis__field">
                <span className="variant-axis__label">Values</span>
                {/* Tag-input: chips live inside one input-styled well; clicking anywhere
                    in it puts the cursor in the bare input at the end. */}
                <div
                  className="variant-axis__well"
                  onClick={(e) => e.currentTarget.querySelector('.variant-axis__add')?.focus()}
                >
                  {axis.values.map((val) => (
                    <span className="tag-chip" key={val}>
                      {val}
                      <button type="button" onClick={() => removeValue(i, val)} aria-label={`Remove ${val}`}>×</button>
                    </span>
                  ))}
                  <input
                    className="variant-axis__add"
                    placeholder={axis.values.length ? 'Add another…' : 'Type a value, e.g. 1L'}
                    value={valueDraft[i] || ''}
                    onChange={(e) => setValueDraft((d) => ({ ...d, [i]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        addValue(i, valueDraft[i]);
                      }
                    }}
                    onBlur={() => addValue(i, valueDraft[i])}
                  />
                </div>
                <span className="variant-axis__hint">Each value becomes a variant — press Enter or comma to add it.</span>
              </div>
            </div>
          ))}

          {hasAxes && (
            <div className="variant-table">
              <div className="variant-table__head">
                <div className="variant-table__caption">
                  {combinations.length} combination{combinations.length === 1 ? '' : 's'}
                </div>
                <p className="variant-table__hint">Set a price for each — leave it empty to show “Quote”.</p>
              </div>
              {combinations.map((optionValues) => {
                const key = comboKey(optionValues, form.options);
                const v = variantOf(key);
                return (
                  <div className="variant-row" key={key}>
                    <div className="variant-row__label">{variantLabel(optionValues, form.options)}</div>
                    <div className="variant-row__photo">
                      {v.photoPreview ? <img src={v.photoPreview} alt="" /> : <span className="variant-row__noimg">No photo</span>}
                      <button
                        type="button"
                        className="pf-iconbtn"
                        onClick={() => setPickerTarget(key)}
                        title={v.photoPreview ? 'Change photo' : 'Choose photo from Vault'}
                        aria-label={`${v.photoPreview ? 'Change' : 'Choose'} photo for ${variantLabel(optionValues, form.options)}`}
                      >
                        <ImageIcon />
                      </button>
                      {v.photoPreview && (
                        <button
                          type="button"
                          className="pf-iconbtn pf-iconbtn--danger"
                          onClick={() => setVariant(key, { photoPreview: '', photoVaultItemId: undefined, photoRemoved: true })}
                          title="Remove photo"
                          aria-label={`Remove photo for ${variantLabel(optionValues, form.options)}`}
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </div>
                    <input
                      className="input variant-row__price"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Price"
                      value={v.price}
                      onChange={(e) => setVariant(key, { price: e.target.value })}
                    />
                    <label className="variant-row__active">
                      <input type="checkbox" checked={v.active !== false} onChange={(e) => setVariant(key, { active: e.target.checked })} />
                      Active
                    </label>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
      </Modal>

      <VaultPickerModal
        open={pickerTarget !== null}
        onClose={() => setPickerTarget(null)}
        onAttach={onPick}
        initialFolderId={vaultFolderId ?? null}
      />
    </>
  );
}
