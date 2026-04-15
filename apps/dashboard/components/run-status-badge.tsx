type RunStatusBadgeProps = {
  status: string;
  compact?: boolean;
};

function normalizeTone(status: string) {
  const value = status.toLowerCase();

  if (value.includes("completed_with_errors") || value.includes("warning")) {
    return "warn";
  }
  if (value.includes("failed") || value.includes("error")) {
    return "bad";
  }
  if (value.includes("completed") || value.includes("ok") || value.includes("healthy")) {
    return "good";
  }
  if (value.includes("running") || value.includes("active")) {
    return "accent";
  }

  return "neutral";
}

function labelForStatus(status: string) {
  const value = status.toLowerCase();

  if (value.includes("completed_with_errors")) {
    return "Completed with errors";
  }
  if (value.includes("completed")) {
    return "Completed";
  }
  if (value.includes("running")) {
    return "Running";
  }
  if (value.includes("failed")) {
    return "Failed";
  }
  if (value.includes("idle")) {
    return "Idle";
  }

  return status || "Unknown";
}

export function RunStatusBadge({ status, compact = false }: RunStatusBadgeProps) {
  const tone = normalizeTone(status);

  return (
    <span className={`run-status-badge run-status-badge--${tone} ${compact ? "run-status-badge--compact" : ""}`}>
      {compact ? labelForStatus(status) : `Run: ${labelForStatus(status)}`}
    </span>
  );
}
