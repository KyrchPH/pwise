import { useMemo, useState } from 'react';
import * as productsApi from '../../services/products.service.js';
import { apiError } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import VaultPickerModal from '../../components/VaultPickerModal.jsx';
import { Button, Card, Field } from '../../components/ui.jsx';
import { generateCombinations, comboKey, variantLabel } from '../../config/variants.js';

const MAX_AXES = 4;

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
    <Card className="card--pad product-form">
      <div className="ct-form">
        <Field label="Name">
          <input className="input" value={form.name} onChange={setField('name')} placeholder="e.g. 5L Regular Dishwashing Liquid" />
        </Field>
        <div className="row gap-sm" style={{ flexWrap: 'wrap' }}>
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
        <Field label="Photo" hint="picked from the Vault">
          <div className="product-photo-field">
            {form.photoPreview ? (
              <img className="product-photo-field__preview" src={form.photoPreview} alt="" />
            ) : (
              <div className="product-photo-field__empty">No photo</div>
            )}
            <div className="row gap-sm">
              <Button type="button" variant="subtle" size="sm" onClick={() => setPickerTarget('product')}>
                {form.photoPreview ? 'Change photo' : 'Pick from Vault'}
              </Button>
              {form.photoPreview && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setForm((f) => ({ ...f, photoPreview: '', photoVaultItemId: undefined, photoRemoved: true }))}>
                  Remove
                </Button>
              )}
            </div>
          </div>
        </Field>

        {/* Variants (option matrix) */}
        <div className="variant-editor">
          <div className="variant-editor__head">
            <div>
              <span className="field__label">Variants</span>
              <p className="text-sm text-muted" style={{ margin: '2px 0 0' }}>
                Add option axes (e.g. Size, Scent) to sell this in priced variants. Leave empty for a single base price.
              </p>
            </div>
            <Button type="button" variant="subtle" size="sm" onClick={addAxis} disabled={form.options.length >= MAX_AXES}>
              Add option
            </Button>
          </div>

          {form.options.map((axis, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <div className="variant-axis" key={i}>
              <div className="variant-axis__row">
                <input className="input" placeholder="Option name (e.g. Size)" value={axis.name} onChange={(e) => setAxisName(i, e.target.value)} />
                <Button type="button" variant="ghost" size="sm" onClick={() => removeAxis(i)}>Remove</Button>
              </div>
              <div className="variant-axis__values">
                {axis.values.map((val) => (
                  <span className="chip" key={val}>
                    {val}
                    <button type="button" onClick={() => removeValue(i, val)} aria-label={`Remove ${val}`}>×</button>
                  </span>
                ))}
                <input
                  className="input variant-axis__add"
                  placeholder="Add value, press Enter"
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
            </div>
          ))}

          {hasAxes && (
            <div className="variant-table">
              <div className="variant-table__caption">
                {combinations.length} combination{combinations.length === 1 ? '' : 's'}
              </div>
              {combinations.map((optionValues) => {
                const key = comboKey(optionValues, form.options);
                const v = variantOf(key);
                return (
                  <div className="variant-row" key={key}>
                    <div className="variant-row__label">{variantLabel(optionValues, form.options)}</div>
                    <div className="variant-row__photo">
                      {v.photoPreview ? <img src={v.photoPreview} alt="" /> : <span className="variant-row__noimg">No photo</span>}
                      <Button type="button" variant="ghost" size="sm" onClick={() => setPickerTarget(key)}>
                        {v.photoPreview ? 'Change' : 'Photo'}
                      </Button>
                      {v.photoPreview && (
                        <Button type="button" variant="ghost" size="sm" onClick={() => setVariant(key, { photoPreview: '', photoVaultItemId: undefined, photoRemoved: true })}>
                          Remove
                        </Button>
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

        <div className="row gap-sm" style={{ justifyContent: 'flex-end' }}>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : product?.id ? 'Save' : 'Add product'}
          </Button>
        </div>
      </div>

      <VaultPickerModal
        open={pickerTarget !== null}
        onClose={() => setPickerTarget(null)}
        onAttach={onPick}
        initialFolderId={vaultFolderId ?? null}
      />
    </Card>
  );
}
