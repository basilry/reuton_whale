"use client";

import type { ReactNode } from "react";
import type { MouseEvent } from "react";
import { useEffect, useMemo, useState } from "react";

import styles from "./insights-sidebar.module.css";

const SIDEBAR_LINKS = [
  { label: "시장 티커", href: "#market-ticker", icon: "monitoring" },
  { label: "브리핑", href: "#brief", icon: "article" },
  { label: "시그널", href: "#signals", icon: "notifications" },
  { label: "감시 지갑", href: "#watchlist", icon: "visibility" },
  { label: "텔레그램", href: "#telegram", icon: "send" },
] as const;

type SidebarHref = (typeof SIDEBAR_LINKS)[number]["href"];

type InsightsSidebarProps = {
  children?: ReactNode;
};

export function InsightsSidebar({ children }: InsightsSidebarProps) {
  const [activeHref, setActiveHref] = useState<SidebarHref>(SIDEBAR_LINKS[0].href);
  const sectionTargets = useMemo(
    () => SIDEBAR_LINKS.map((item) => ({ href: item.href, id: item.href.slice(1) })),
    [],
  );

  useEffect(() => {
    const sections = sectionTargets.reduce<Array<{ href: SidebarHref; element: HTMLElement }>>(
      (result, item) => {
        const element = document.getElementById(item.id);
        if (element instanceof HTMLElement) {
          result.push({ href: item.href, element });
        }
        return result;
      },
      [],
    );

    if (!sections.length) {
      return undefined;
    }

    const readAnchorOffset = () => {
      const rawOffset = getComputedStyle(document.documentElement)
        .getPropertyValue("--inset-navbar")
        .trim();
      const parsedOffset = Number.parseFloat(rawOffset);
      return Number.isFinite(parsedOffset) ? parsedOffset + 32 : 128;
    };

    const updateActiveSection = () => {
      const viewportTop = window.scrollY + readAnchorOffset();
      let nextActiveHref = sections[0].href;

      for (const section of sections) {
        if (section.element.offsetTop <= viewportTop) {
          nextActiveHref = section.href;
        }
      }

      if (
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 2
      ) {
        nextActiveHref = sections[sections.length - 1].href;
      }

      setActiveHref((prev) => (prev === nextActiveHref ? prev : nextActiveHref));
    };

    const updateFromHash = () => {
      const matched = sectionTargets.find((item) => item.href === window.location.hash);
      if (matched) {
        setActiveHref(matched.href);
      }
    };

    let frameId = 0;
    const requestUpdate = () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(updateActiveSection);
    };

    updateFromHash();
    updateActiveSection();

    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);
    window.addEventListener("hashchange", updateFromHash);

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
      window.removeEventListener("hashchange", updateFromHash);
    };
  }, [sectionTargets]);

  function handleAnchorClick(href: SidebarHref) {
    return (event: MouseEvent<HTMLAnchorElement>) => {
      const target = document.getElementById(href.slice(1));
      if (!target) {
        return;
      }

      event.preventDefault();

      const prefersReducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      setActiveHref(href);
      target.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "start",
      });
      window.history.pushState(null, "", href);
    };
  }

  return (
    <aside className={styles.sidebar} aria-label="인사이트 내비게이션">
      <div className={styles.brandBlock}>
        <span className={styles.brandTitle}>WhaleScope</span>
        <span className={styles.brandSubtitle}>User Home</span>
      </div>

      <nav className={styles.nav}>
        {SIDEBAR_LINKS.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className={styles.link}
            data-active={activeHref === item.href ? "true" : undefined}
            aria-current={activeHref === item.href ? "location" : undefined}
            onClick={handleAnchorClick(item.href)}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </a>
        ))}
      </nav>

      {children ? <div className={styles.footerSlot}>{children}</div> : null}
    </aside>
  );
}
