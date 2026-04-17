type MetricCardAction = {
  label: string;
  onClick?: () => void;
  href?: string;
};

type MetricCardProps = {
  label: string;
  value: string;
  hint: string;
  tone?: "accent" | "good" | "warn" | "bad" | "neutral" | "soft";
  actions?: MetricCardAction[];
};

export function MetricCard({ label, value, hint, tone = "neutral", actions }: MetricCardProps) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <p className="metric-card__label">{label}</p>
      <p className="metric-card__value">{value}</p>
      <p className="metric-card__hint">{hint}</p>
      {actions && actions.length > 0 && (
        <div className="metric-card__actions">
          {actions.map((action) =>
            action.href ? (
              <a
                key={action.label}
                className="metric-card__action-btn"
                href={action.href}
              >
                {action.label}
              </a>
            ) : (
              <button
                key={action.label}
                type="button"
                className="metric-card__action-btn"
                onClick={action.onClick}
              >
                {action.label}
              </button>
            ),
          )}
        </div>
      )}
    </article>
  );
}
