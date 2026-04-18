"use client";

import { useEffect, useState } from "react";
import type { DashboardLanguage } from "@/lib/i18n/config";
import { useDashboardI18n } from "@/lib/i18n/client";

type Theme = "light" | "dark";

/**
 * Theme toggle — writes `data-theme` on <html> and persists to localStorage.
 * Complements the pre-paint script in `app/layout.tsx`.
 */
export function ThemeToggle({
  className,
  initialLanguage,
}: {
  className?: string;
  initialLanguage?: DashboardLanguage;
}) {
  const { language } = useDashboardI18n(initialLanguage);
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const attr = document.documentElement.getAttribute("data-theme");
    setTheme(attr === "dark" ? "dark" : "light");
    setMounted(true);
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("whalescope.theme", next);
    } catch {
      /* storage disabled — theme still toggles for this session */
    }
    setTheme(next);
  };

  // Prevent hydration flash: render placeholder until mounted so SSR matches.
  if (!mounted) {
    return (
      <button
        type="button"
        aria-hidden="true"
        className={className}
        style={{ visibility: "hidden" }}
        tabIndex={-1}
      >
        <span className="material-symbols-outlined">dark_mode</span>
      </button>
    );
  }

  const isDark = theme === "dark";
  const toggleToLight = language === "ko" ? "라이트 모드로 전환" : "Switch to light mode";
  const toggleToDark = language === "ko" ? "다크 모드로 전환" : "Switch to dark mode";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? toggleToLight : toggleToDark}
      aria-pressed={isDark}
      className={className}
    >
      <span className="material-symbols-outlined" aria-hidden="true">
        {isDark ? "light_mode" : "dark_mode"}
      </span>
    </button>
  );
}
