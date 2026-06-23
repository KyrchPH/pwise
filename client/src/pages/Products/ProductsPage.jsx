import { useEffect, useState } from 'react';
import { usePages } from '../../context/PageContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import * as productsApi from '../../services/products.service.js';
import { apiError } from '../../services/api.js';
import VaultPickerModal from '../../components/VaultPickerModal.jsx';
import { Button, Card, Field, Spinner } from '../../components/ui.jsx';

// `photoVaultItemId === undefined` means "keep the current photo"; a picked id sets a
// new one; `photoRemoved` clears it.
const BLANK = {
  name: '',
  base_price: '',
  category: '',
  description: '',
  tags: '',
  photoPreview: '',
  photoVaultItemId: undefined,
  photoRemoved: false,
};

function formatPrice(value) {
  if (value == null) return '';
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function ProductsPage() {
  const { activeId, activePage } = usePages();
  const toast = useToast();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // BLANK-shaped (+ optional id)
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (activeId == null) {
      setProducts([]);
      setLoading(false);
      return undefined;
    }
    let live = true;
    setLoading(true);
    productsApi
      .list(activeId)
      .then((list) => live && setProducts(list))
      .catch((e) => live && toast.error(apiError(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const startAdd = () => setEditing({ ...BLANK });
  const startEdit = (p) =>
    setEditing({
      id: p.id,
      name: p.name || '',
      base_price: p.basePrice == null ? '' : String(p.basePrice),
      category: p.category || '',
      description: p.description || '',
      tags: (p.tags || []).join(', '),
      photoPreview: p.photoUrl || '',
      photoVaultItemId: undefined,
      photoRemoved: false,
    });
  const cancel = () => setEditing(null);
  const setField = (k) => (e) => setEditing((ed) => ({ ...ed, [k]: e.target.value }));

  // The Vault picker is multi-select; a product takes one photo, so use the first.
  const onPickPhoto = (selected) => {
    const item = selected[0];
    if (item) setEditing((ed) => ({ ...ed, photoPreview: item.url, photoVaultItemId: item.id, photoRemoved: false }));
    setPickerOpen(false);
  };
  const removePhoto = () =>
    setEditing((ed) => ({ ...ed, photoPreview: '', photoVaultItemId: undefined, photoRemoved: true }));

  const commit = async () => {
    const name = editing.name.trim();
    if (!name) return toast.error('Give the product a name.');
    if (activeId == null) return toast.error('Select a page first.');
    setBusy(true);
    try {
      const base = {
        name,
        base_price: editing.base_price.trim() === '' ? null : editing.base_price.trim(),
        category: editing.category.trim(),
        description: editing.description.trim(),
        tags: editing.tags,
      };
      if (editing.photoVaultItemId !== undefined) base.vault_item_id = editing.photoVaultItemId;
      else if (editing.photoRemoved) base.photo_remove = true;

      if (editing.id) {
        const updated = await productsApi.update(editing.id, base);
        setProducts((cur) => cur.map((p) => (p.id === updated.id ? updated : p)));
        toast.success('Product updated');
      } else {
        const created = await productsApi.create({ ...base, account_id: activeId });
        setProducts((cur) => [created, ...cur]);
        toast.success('Product added');
      }
      setEditing(null);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  const del = async (p) => {
    if (busy) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete "${p.name}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      await productsApi.remove(p.id);
      setProducts((cur) => cur.filter((x) => x.id !== p.id));
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
          <h1 className="products-page__title">Products</h1>
          <p className="text-sm text-muted">
            Products for {activePage?.account_name ? <strong>{activePage.account_name}</strong> : 'this page'} — drag
            them into a chat from the Products button in the message bar.
          </p>
        </div>
        {!editing && activeId != null && (
          <Button size="sm" onClick={startAdd}>
            + Add product
          </Button>
        )}
      </div>

      {activeId == null ? (
        <Card className="card--pad">
          <p className="text-sm text-muted">Select a page from the sidebar to manage its products.</p>
        </Card>
      ) : editing ? (
        <Card className="card--pad" style={{ maxWidth: 640 }}>
          <div className="ct-form">
            <Field label="Name">
              <input className="input" value={editing.name} onChange={setField('name')} placeholder="e.g. 5L Regular Dishwashing Liquid" />
            </Field>
            <div className="row gap-sm" style={{ flexWrap: 'wrap' }}>
              <Field label="Base price">
                <input className="input" type="number" min="0" step="0.01" value={editing.base_price} onChange={setField('base_price')} placeholder="0.00" />
              </Field>
              <Field label="Category">
                <input className="input" value={editing.category} onChange={setField('category')} placeholder="e.g. Cleaning" />
              </Field>
            </div>
            <Field label="Description">
              <textarea className="textarea" rows={3} value={editing.description} onChange={setField('description')} placeholder="Short product description" />
            </Field>
            <Field label="Tags" hint="comma-separated">
              <input className="input" value={editing.tags} onChange={setField('tags')} placeholder="e.g. bestseller, bulk" />
            </Field>
            <Field label="Photo" hint="picked from the Vault">
              <div className="product-photo-field">
                {editing.photoPreview ? (
                  <img className="product-photo-field__preview" src={editing.photoPreview} alt="" />
                ) : (
                  <div className="product-photo-field__empty">No photo</div>
                )}
                <div className="row gap-sm">
                  <Button type="button" variant="subtle" size="sm" onClick={() => setPickerOpen(true)}>
                    {editing.photoPreview ? 'Change photo' : 'Pick from Vault'}
                  </Button>
                  {editing.photoPreview && (
                    <Button type="button" variant="ghost" size="sm" onClick={removePhoto}>
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            </Field>
            <div className="row gap-sm" style={{ justifyContent: 'flex-end' }}>
              <Button variant="ghost" size="sm" onClick={cancel} disabled={busy}>
                Cancel
              </Button>
              <Button size="sm" onClick={commit} disabled={busy}>
                {busy ? 'Saving…' : editing.id ? 'Save' : 'Add product'}
              </Button>
            </div>
          </div>
        </Card>
      ) : loading ? (
        <Spinner label="Loading products…" />
      ) : products.length === 0 ? (
        <Card className="card--pad">
          <p className="text-sm text-muted">No products yet. Add one to start sharing it in chats.</p>
        </Card>
      ) : (
        <div className="products-grid">
          {products.map((p) => (
            <Card key={p.id} className="product-tile">
              <div className="product-tile__media">
                {p.photoUrl ? <img src={p.photoUrl} alt="" loading="lazy" /> : <span className="product-tile__noimg">No photo</span>}
              </div>
              <div className="product-tile__body">
                <div className="product-tile__name" title={p.name}>
                  {p.name}
                </div>
                {p.basePrice != null && <div className="product-tile__price">{formatPrice(p.basePrice)}</div>}
                {p.category && <div className="product-tile__cat">{p.category}</div>}
                {p.description && <p className="product-tile__desc">{p.description}</p>}
                {p.tags?.length > 0 && (
                  <div className="product-tile__tags">
                    {p.tags.map((t) => (
                      <span key={t} className="product-tile__tag">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="product-tile__actions">
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => startEdit(p)}>
                  Edit
                </button>
                <button type="button" className="btn btn--ghost btn--sm product-tile__del" onClick={() => del(p)}>
                  Delete
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <VaultPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onAttach={onPickPhoto}
        initialFolderId={activePage?.vault_folder_id ?? null}
      />
    </section>
  );
}
