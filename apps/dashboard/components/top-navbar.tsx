"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./theme-toggle";
import { LanguageSelector } from "./language-selector";
import styles from "./top-navbar.module.css";

const NAV_ITEMS = [
  { label: "대시보드", href: "/" },
  { label: "인사이트", href: "/insights" },
  { label: "시그널", href: "/insights#signals" },
  { label: "리포트", href: "/insights#transactions" },
] as const;

export function TopNavbar() {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    const path = href.split("#")[0];
    return pathname === path;
  }

  return (
    <header className={styles.navbar}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand} aria-label="WhaleScope 홈">
          WhaleScope
        </Link>

        <nav className={styles.tabNav} aria-label="주요 내비게이션">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={styles.tabLink}
              data-active={isActive(item.href) ? "true" : undefined}
              aria-current={isActive(item.href) ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className={styles.right}>
          <ThemeToggle className={styles.themeBtn} />
          <LanguageSelector />
        </div>
      </div>
    </header>
  );
}
