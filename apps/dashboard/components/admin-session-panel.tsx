"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import styles from "./admin-session-panel.module.css";

type AdminSessionPanelProps = {
  message?: string;
  mode: "locked" | "login" | "session";
  logoutDisabled?: boolean;
};

export function AdminSessionPanel({
  message,
  mode,
  logoutDisabled = false,
}: AdminSessionPanelProps) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function syncSession(action: "login" | "logout") {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/session", {
        method: action === "login" ? "POST" : "DELETE",
        headers:
          action === "login"
            ? { "Content-Type": "application/json" }
            : undefined,
        body:
          action === "login"
            ? JSON.stringify({ password })
            : undefined,
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        setError(
          payload?.error === "missing-production-password"
            ? "프로덕션 환경에서 `DASHBOARD_PASSWORD`가 설정되지 않았습니다."
            : action === "login"
              ? "운영 비밀번호가 올바르지 않습니다."
              : "로그아웃에 실패했습니다.",
        );
        return;
      }

      if (action === "login") {
        setPassword("");
      }

      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "locked") {
    return (
      <section className={styles.panel}>
        <div className={styles.badge}>Admin locked</div>
        <h1 className={styles.title}>운영 대시보드를 열 수 없습니다.</h1>
        <p className={styles.copy}>
          {message ??
            "현재 배포는 운영 비밀번호 없이 시작되었고, 프로덕션 정책상 /admin 은 비공개 상태로 유지됩니다."}
        </p>
        <p className={styles.meta}>
          환경 변수를 정리한 뒤 다시 접속하거나, <Link className={styles.link} href="/">
            사용자 홈
          </Link>
          으로 돌아가세요.
        </p>
      </section>
    );
  }

  if (mode === "session") {
    return (
      <section className={styles.panel}>
        <div className={styles.headerRow}>
          <div>
            <div className={styles.badge}>Admin session</div>
            <h1 className={styles.title}>운영 세션이 활성화되었습니다.</h1>
          </div>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={logoutDisabled ? undefined : () => void syncSession("logout")}
            disabled={busy || logoutDisabled}
            aria-disabled={busy || logoutDisabled}
          >
            {busy ? "처리 중..." : logoutDisabled ? "로그아웃 비활성화" : "로그아웃"}
          </button>
        </div>
        <p className={styles.copy}>
          {message ??
            "브라우저 쿠키가 자동으로 포함되어 admin API를 바로 사용할 수 있습니다."}
        </p>
        {error ? <p className={styles.error}>{error}</p> : null}
      </section>
    );
  }

  return (
    <section className={styles.panel}>
      <div className={styles.badge}>Admin login</div>
      <h1 className={styles.title}>운영 대시보드 접근 확인</h1>
      <p className={styles.copy}>
        {message ??
          "운영 비밀번호를 입력하면 httpOnly 쿠키 세션이 생성되고, 이후 admin API 요청에도 자동으로 사용됩니다."}
      </p>

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void syncSession("login");
        }}
      >
        <label className={styles.field}>
          <span className={styles.label}>운영 비밀번호</span>
          <input
            className={styles.input}
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="DASHBOARD_PASSWORD"
          />
        </label>

        {error ? <p className={styles.error}>{error}</p> : null}

        <div className={styles.actions}>
          <button className={styles.primaryButton} type="submit" disabled={busy}>
            {busy ? "확인 중..." : "로그인"}
          </button>
        </div>
      </form>
    </section>
  );
}
