"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);

  const NAV_ITEMS = [
    { label: dictionary.navbar.userHome, href: "/" },
    { label: dictionary.navbar.admin, href: "/admin" },
    { label: dictionary.navbar.about, href: "/about" },
  ] as const;

  function isActive(href: string): boolean {
    if (href.includes("#")) {
      return false;
    }
    const path = href.split("#")[0];
    return pathname === path;
  }

  function openDrawer() {
    setMobileOpen(true);
  }

  function closeDrawer() {
    setMobileOpen(false);
    hamburgerRef.current?.focus();
  }

  // Esc key + body scroll lock
  useEffect(() => {
    if (!mobileOpen) return;

    // Focus first link on open
    firstLinkRef.current?.focus();

    // Lock body scroll
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        closeDrawer();
      }
    }

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileOpen]);

  // Close drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

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

        {/* Desktop tab nav */}
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
          {/* Operational status chip — visible on ≥640px */}
          <span
            className={styles.opPill}
            role="status"
            aria-label={dictionary.navbar.operationalLabel}
          >
            <span className={styles.opDot} aria-hidden="true" />
            {dictionary.navbar.operational}
          </span>

          {/* Hamburger button — mobile only */}
          <button
            ref={hamburgerRef}
            className={styles.hamburger}
            aria-label="메뉴 열기"
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav-drawer"
            onClick={openDrawer}
          >
            <span className="material-symbols-outlined" aria-hidden="true">menu</span>
          </button>

          <ThemeToggle className={styles.themeBtn} initialLanguage={initialLanguage} />
          <LanguageSelector currentLang={language} />
        </div>
      </div>

      {/* Mobile drawer backdrop */}
      {mobileOpen && (
        <div
          className={styles.drawerBackdrop}
          aria-hidden="true"
          onClick={closeDrawer}
        />
      )}

      {/* Mobile nav drawer */}
      <div
        id="mobile-nav-drawer"
        className={styles.drawer}
        data-open={mobileOpen ? "true" : undefined}
        role="dialog"
        aria-modal="true"
        aria-label="모바일 내비게이션"
      >
        <div className={styles.drawerHeader}>
          <button
            className={styles.drawerClose}
            aria-label="메뉴 닫기"
            onClick={closeDrawer}
          >
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>

        <nav aria-label={dictionary.navbar.primaryNavigation}>
          {NAV_ITEMS.map((item, idx) => (
            <Link
              key={item.href}
              href={item.href}
              className={styles.drawerLink}
              data-active={isActive(item.href) ? "true" : undefined}
              aria-current={isActive(item.href) ? "page" : undefined}
              ref={idx === 0 ? firstLinkRef : undefined}
              onClick={closeDrawer}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
