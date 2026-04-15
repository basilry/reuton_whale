type MetricCardProps = {
  label: string;
  value: string;
  hint: string;
  tone?: "accent" | "good" | "warn" | "bad" | "neutral" | "soft";
};

export function MetricCard({ label, value, hint, tone = "neutral" }: MetricCardProps) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <p className="metric-card__label">{label}</p>
      <p className="metric-card__value">{value}</p>
      <p className="metric-card__hint">{hint}</p>
    </article>
  );
}
