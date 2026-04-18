"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./theme-toggle";
import { LanguageSelector } from "./language-selector";
import styles from "./top-navbar.module.css";

const NAV_ITEMS = [
  { label: "유저 홈", href: "/" },
  { label: "운영", href: "/admin" },
] as const;

export function TopNavbar() {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (href.includes("#")) {
      return false;
    }
    const path = href.split("#")[0];
    return pathname === path;
  }

  return (
    <header className={styles.navbar}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand} aria-label="WhaleScope 홈">
          <Image
            src="/logo.png"
            alt=""
            width={28}
            height={28}
            className={styles.brandLogo}
            priority
          />
          <span className={styles.brandTextBlock}>
            <span className={styles.brandTitle}>WhaleScope</span>
            <span className={styles.brandSubtitle}>Whale intelligence · v0.1</span>
          </span>
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
