"use client";

import styles from "./error.module.css";

type ErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function Error({ error, reset }: ErrorProps) {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.panel}>
          <p className={styles.eyebrow}>Dashboard error</p>
          <h1 className={styles.title}>대시보드를 불러오지 못했습니다.</h1>
          <p className={styles.message}>
            {error.message || "알 수 없는 오류가 발생했습니다."}
          </p>
          {error.digest ? (
            <p className={styles.digest}>Digest: {error.digest}</p>
          ) : null}
          <button type="button" className={styles.retry} onClick={reset}>
            Retry
          </button>
        </section>
      </div>
    </main>
  );
}
