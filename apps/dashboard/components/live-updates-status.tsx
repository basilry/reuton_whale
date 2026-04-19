"use client";

type LiveUpdatesStatusProps = {
  ariaLabel: string;
  chipClassName: string;
  dotClassName: string;
  label: string;
  title: string;
  tone: "good" | "warn" | "bad";
};

export function LiveUpdatesStatus({
  ariaLabel,
  chipClassName,
  dotClassName,
  label,
  title,
  tone,
}: LiveUpdatesStatusProps) {
  return (
    <div
      aria-label={ariaLabel}
      className={chipClassName}
      data-tone={tone}
      role="status"
      title={title}
    >
      <span aria-hidden="true" className={dotClassName} data-tone={tone} />
      {label}
    </div>
  );
}
