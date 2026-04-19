"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { DashboardLanguage } from "@/lib/i18n/config";
import { useDashboardI18n } from "@/lib/i18n/client";
import { ThemeToggle } from "./theme-toggle";
import { LanguageSelector } from "./language-selector";
import styles from "./top-navbar.module.css";

type TopNavbarProps = {
  initialLanguage?: DashboardLanguage;
};

export function TopNavbar({ initialLanguage }: TopNavbarProps) {
  const pathname = usePathname();
  const { dictionary, language } = useDashboardI18n(initialLanguage);

  const NAV_ITEMS = [
    { label: dictionary.navbar.userHome, href: "/" },
    { label: dictionary.navbar.admin, href: "/admin" },
  ] as const;

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
        <Link href="/" className={styles.brand} aria-label={dictionary.navbar.brandAriaLabel}>
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
            {' '}
            <span className={styles.brandSubtitle}>{dictionary.navbar.brandSubtitle}</span>
          </span>
        </Link>

        <nav className={styles.tabNav} aria-label={dictionary.navbar.primaryNavigation}>
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
          <ThemeToggle className={styles.themeBtn} initialLanguage={initialLanguage} />
          <LanguageSelector currentLang={language} />
        </div>
      </div>
    </header>
  );
}
