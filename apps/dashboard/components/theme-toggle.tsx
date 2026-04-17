"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

/**
 * Theme toggle — writes `data-theme` on <html> and persists to localStorage.
 * Complements the pre-paint script in `app/layout.tsx`.
 */
export function ThemeToggle({ className }: { className?: string }) {
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
        aria-label="테마 전환"
        className={className}
        style={{ visibility: "hidden" }}
      >
        <span className="material-symbols-outlined">dark_mode</span>
      </button>
    );
  }

  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "라이트 모드로 전환" : "다크 모드로 전환"}
      aria-pressed={isDark}
      className={className}
    >
      <span className="material-symbols-outlined" aria-hidden="true">
        {isDark ? "light_mode" : "dark_mode"}
      </span>
    </button>
  );
}
