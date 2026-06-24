import { Card } from '../../components/ui.jsx';

// Placeholder for Shop sections that aren't built yet (Orders, Receipts).
export default function ComingSoon({ title }) {
  return (
    <section className="shop-section">
      <h1 className="products-page__title">{title}</h1>
      <Card className="card--pad">
        <div className="shop-comingsoon">
          <span className="shop-comingsoon__badge">Coming soon</span>
          <p className="text-sm text-muted">{title} will live here — we’re building it next.</p>
        </div>
      </Card>
    </section>
  );
}
