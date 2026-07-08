import { useEffect, useMemo, useState } from 'react';
import { usePages } from '../../context/PageContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useCachedResource } from '../../hooks/useCachedResource.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Card, Spinner, EmptyState, Dropdown, Modal } from '../../components/ui.jsx';
import { apiError } from '../../services/api.js';
import { formatPrice } from '../../config/currency.js';
import { listOrders, getOrder, updateOrderStatus, ORDER_STATUSES, ORDER_STATUS_LABELS } from '../../services/orders.service.js';

const fmtDate = (d) =>
  d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

const STATUS_OPTIONS = [{ value: 'all', label: 'All statuses' }, ...ORDER_STATUSES.map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] }))];

const PAGE_SIZE = 10;

// Page numbers to show, collapsing long runs to an ellipsis (e.g. 1 … 4 5 6 … 20).
function pageWindow(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const wanted = [1, total, current, current - 1, current + 1].filter((p) => p >= 1 && p <= total);
  const sorted = [...new Set(wanted)].sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push('…');
    out.push(p);
    prev = p;
  }
  return out;
}

function StatusBadge({ status }) {
  return <span className={`order-badge order-badge--${status}`}>{ORDER_STATUS_LABELS[status] || status}</span>;
}

export default function OrdersPage() {
  const { activeId, activePage } = usePages();
  const { isAdmin } = useAuth();
  const toast = useToast();
  const currency = activePage?.currency || 'PHP';

  const { data, loading, error, refresh } = useCachedResource(
    activeId ? `orders:${activeId}` : null,
    () => listOrders(activeId),
  );

  const [statusFilter, setStatusFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [savingId, setSavingId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const orders = data || [];

  // Admins can filter by who processed the order — options are the distinct owners present.
  const ownerOptions = useMemo(() => {
    const seen = new Map();
    for (const o of orders) if (o.createdBy != null && !seen.has(o.createdBy)) seen.set(o.createdBy, o.createdByName || `User ${o.createdBy}`);
    return [{ value: 'all', label: 'All staff' }, ...[...seen].map(([id, name]) => ({ value: String(id), label: name }))];
  }, [orders]);

  const filtered = orders.filter(
    (o) => (statusFilter === 'all' || o.status === statusFilter) && (ownerFilter === 'all' || String(o.createdBy) === ownerFilter),
  );

  // Client-side pagination. Reset to page 1 whenever the filters or the active page change.
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [statusFilter, ownerFilter, activeId]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const rangeStart = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(safePage * PAGE_SIZE, filtered.length);

  const changeStatus = async (id, status) => {
    setSavingId(id);
    try {
      await updateOrderStatus(id, status);
      await refresh();
      setDetail((d) => (d && d.id === id ? { ...d, status } : d));
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSavingId(null);
    }
  };

  const openDetail = async (id) => {
    setDetailLoading(true);
    try {
      setDetail(await getOrder(id));
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setDetailLoading(false);
    }
  };

  if (!activeId) {
    return <EmptyState icon="🏬" title="No page selected" message="Choose a connected page to see its orders." />;
  }
  if (loading && !data) return <Spinner label="Loading orders…" />;
  if (error && !data) return <EmptyState icon="⚠️" title="Couldn't load orders" message={apiError(error)} />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Orders</h1>
          <div className="page-head__sub">{isAdmin ? 'Orders across your team for this page.' : 'Orders you processed for this page.'}</div>
        </div>
        <div className="orders-filters">
          <Dropdown value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} ariaLabel="Filter by status" />
          {isAdmin && <Dropdown value={ownerFilter} onChange={setOwnerFilter} options={ownerOptions} ariaLabel="Filter by staff" />}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card className="orders-panel orders-panel--empty card--pad mt-lg">
          <EmptyState icon="🧾" title="No orders yet" message="Confirmed order agreements will appear here." />
        </Card>
      ) : (
        <Card className="orders-panel card--pad mt-lg">
          <div className="table-wrap table-wrap--menu orders-panel__body">
            <table className="table table--stack orders-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Items</th>
                  <th>Total</th>
                  {isAdmin && <th>Processed by</th>}
                  <th>Placed</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {pageItems.map((o) => (
                  <tr key={o.id}>
                    <td data-label="Order"><strong>#{o.id}</strong></td>
                    <td data-label="Customer" className="cell-truncate">{o.customerName}</td>
                    <td data-label="Items">{o.itemCount ?? '—'}</td>
                    <td data-label="Total">{formatPrice(o.total, o.currency || currency)}</td>
                    {isAdmin && <td data-label="Processed by" className="cell-truncate">{o.createdByName || '—'}</td>}
                    <td data-label="Placed">{fmtDate(o.confirmedAt || o.createdAt)}</td>
                    <td data-label="Status">
                      <div className="orders-table__status">
                        <StatusBadge status={o.status} />
                        <Dropdown
                          value={o.status}
                          onChange={(v) => changeStatus(o.id, v)}
                          options={ORDER_STATUSES.map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] }))}
                          ariaLabel={`Change status of order ${o.id}`}
                          className={savingId === o.id ? 'is-busy' : ''}
                        />
                      </div>
                    </td>
                    <td data-label="">
                      <button type="button" className="btn btn--subtle btn--sm" onClick={() => openDetail(o.id)}>View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="orders-pager">
            <span className="orders-pager__info">
              {rangeStart}–{rangeEnd} of {filtered.length} {filtered.length === 1 ? 'order' : 'orders'}
            </span>
            <div className="orders-pager__controls">
              <button type="button" className="orders-pager__btn" onClick={() => setPage(safePage - 1)} disabled={safePage <= 1} aria-label="Previous page">‹</button>
              {pageWindow(safePage, totalPages).map((p, i) =>
                p === '…' ? (
                  <span key={`gap-${i}`} className="orders-pager__ellipsis">…</span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    className={`orders-pager__btn${p === safePage ? ' is-active' : ''}`}
                    onClick={() => setPage(p)}
                    aria-current={p === safePage ? 'page' : undefined}
                  >
                    {p}
                  </button>
                ),
              )}
              <button type="button" className="orders-pager__btn" onClick={() => setPage(safePage + 1)} disabled={safePage >= totalPages} aria-label="Next page">›</button>
            </div>
          </div>
        </Card>
      )}

      <Modal open={!!detail} title={detail ? `Order #${detail.id}` : 'Order'} onClose={() => setDetail(null)}>
        {detailLoading && !detail ? (
          <Spinner label="Loading…" />
        ) : detail ? (
          <div className="order-detail">
            <div className="order-detail__status">
              <StatusBadge status={detail.status} />
              <Dropdown
                value={detail.status}
                onChange={(v) => changeStatus(detail.id, v)}
                options={ORDER_STATUSES.map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] }))}
                ariaLabel="Change order status"
              />
            </div>

            <div className="table-wrap">
              <table className="table order-detail__items">
                <thead>
                  <tr><th>Item</th><th className="ta-r">Unit</th><th className="ta-r">Qty</th><th className="ta-r">Amount</th></tr>
                </thead>
                <tbody>
                  {detail.items.map((it) => (
                    <tr key={it.id}>
                      <td>{it.name}{it.variantLabel ? <span className="text-muted"> · {it.variantLabel}</span> : null}</td>
                      <td className="ta-r">{it.unitPrice == null ? 'Quote' : formatPrice(it.unitPrice, detail.currency || currency)}</td>
                      <td className="ta-r">{it.quantity}</td>
                      <td className="ta-r">{it.lineTotal == null ? 'Quote' : formatPrice(it.lineTotal, detail.currency || currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="order-detail__totals">
              <div className="order-detail__row"><span>Subtotal</span><span>{formatPrice(detail.subtotal, detail.currency || currency)}</span></div>
              {detail.discounts.map((d) => (
                <div className="order-detail__row order-detail__row--discount" key={d.id}><span>{d.name}</span><span>−{formatPrice(d.amount, detail.currency || currency)}</span></div>
              ))}
              <div className="order-detail__row order-detail__row--total"><span>Total</span><strong>{formatPrice(detail.total, detail.currency || currency)}</strong></div>
            </div>

            <dl className="order-detail__fields">
              <div><dt>Customer</dt><dd>{detail.customerName}</dd></div>
              <div><dt>Address</dt><dd>{detail.deliveryAddress}</dd></div>
              <div><dt>Contact</dt><dd>{detail.contactNumber}</dd></div>
              {detail.email && <div><dt>Email</dt><dd>{detail.email}</dd></div>}
              {detail.notes && <div><dt>Notes</dt><dd>{detail.notes}</dd></div>}
              {isAdmin && <div><dt>Processed by</dt><dd>{detail.createdByName || '—'}</dd></div>}
              <div><dt>Placed</dt><dd>{fmtDate(detail.confirmedAt || detail.createdAt)}</dd></div>
            </dl>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
