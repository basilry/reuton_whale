import styles from "./wrtn-assignment-chip.module.css";

export function WrtnAssignmentChip() {
  return (
    <a
      href="https://wrtn.ai/"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open Wrtn assignment page"
      className={styles.chip}
    >
      <span className={styles.logo} aria-hidden="true">
        wrtn
      </span>
      <span className={styles.label}>Assignment</span>
      <span className={styles.arrow} aria-hidden="true">↗</span>
    </a>
  );
}
