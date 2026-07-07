import { useMemo, useState } from 'react';
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
        <Card className="card--pad mt-lg">
          <EmptyState icon="🧾" title="No orders yet" message="Confirmed order agreements will appear here." />
        </Card>
      ) : (
        <Card className="card--pad mt-lg">
          <div className="table-wrap">
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
                {filtered.map((o) => (
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
