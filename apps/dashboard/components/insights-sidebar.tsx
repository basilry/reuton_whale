"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./insights-sidebar.module.css";

const SIDEBAR_LINKS = [
  { label: "대시보드", href: "/", icon: "dashboard" },
  { label: "분석", href: "/insights", icon: "insights" },
  { label: "고래 감시", href: "/insights#watchlist", icon: "visibility" },
  { label: "시그널 허브", href: "/insights#signals", icon: "notifications" },
] as const;

const DISABLED_LINKS = [
  { label: "설정", icon: "settings" },
] as const;

export function InsightsSidebar() {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    const path = href.split("#")[0];
    return pathname === path;
  }

  return (
    <aside className={styles.sidebar} aria-label="인사이트 내비게이션">
      <div className={styles.brandBlock}>
        <span className={styles.brandTitle}>WhaleScope</span>
        <span className={styles.brandSubtitle}>Insights</span>
      </div>

      <nav className={styles.nav}>
        {SIDEBAR_LINKS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={styles.link}
            data-active={isActive(item.href) ? "true" : undefined}
            aria-current={isActive(item.href) ? "page" : undefined}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </Link>
        ))}

        {DISABLED_LINKS.map((item) => (
          <span
            key={item.label}
            className={styles.linkDisabled}
            aria-disabled="true"
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </span>
        ))}
      </nav>
    </aside>
  );
}
