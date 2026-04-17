import styles from "./metric-card.module.css";

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
    <article className={styles.card} data-tone={tone}>
      <p className={styles.label}>{label}</p>
      <p className={styles.value}>{value}</p>
      <p className={styles.hint}>{hint}</p>
      {actions && actions.length > 0 && (
        <div className={styles.actions}>
          {actions.map((action) =>
            action.href ? (
              <a
                key={action.label}
                className={styles.actionBtn}
                href={action.href}
              >
                {action.label}
              </a>
            ) : (
              <button
                key={action.label}
                type="button"
                className={styles.actionBtn}
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
