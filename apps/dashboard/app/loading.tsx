import styles from "./loading.module.css";

export default function Loading() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={`${styles.panel} ${styles.hero}`}>
          <div className={`${styles.skeleton} ${styles.eyebrow}`} />
          <div className={`${styles.skeleton} ${styles.title}`} />
          <div className={`${styles.skeleton} ${styles.copy}`} />
          <div className={styles.heroChips}>
            <div className={`${styles.skeleton} ${styles.chip}`} />
            <div className={`${styles.skeleton} ${styles.chip}`} />
            <div className={`${styles.skeleton} ${styles.chip}`} />
          </div>
        </header>

        <section className={styles.metricGrid} aria-label="Loading metrics">
          {Array.from({ length: 5 }).map((_, index) => (
            <article key={index} className={styles.metricCard}>
              <div className={`${styles.skeleton} ${styles.metricLabel}`} />
              <div className={`${styles.skeleton} ${styles.metricValue}`} />
              <div className={`${styles.skeleton} ${styles.metricHint}`} />
            </article>
          ))}
        </section>

        <section className={styles.primaryGrid}>
          <div className={styles.main}>
            <div className={styles.panel}>
              <div className={`${styles.skeleton} ${styles.sectionTitle}`} />
              <div className={`${styles.skeleton} ${styles.sectionCopy}`} />
              <div className={styles.cardGrid}>
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className={`${styles.skeleton} ${styles.card}`} />
                ))}
              </div>
            </div>
            <div className={styles.panel}>
              <div className={`${styles.skeleton} ${styles.sectionTitle}`} />
              <div className={styles.tableRows}>
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className={`${styles.skeleton} ${styles.tableRow}`} />
                ))}
              </div>
            </div>
          </div>
          <aside className={styles.rail}>
            <div className={styles.panel}>
              <div className={`${styles.skeleton} ${styles.sectionTitle}`} />
              <div className={styles.tableRows}>
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className={`${styles.skeleton} ${styles.tableRow}`} />
                ))}
              </div>
            </div>
            <div className={styles.panel}>
              <div className={`${styles.skeleton} ${styles.sectionTitle}`} />
              <div className={styles.tableRows}>
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className={`${styles.skeleton} ${styles.tableRow}`} />
                ))}
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
