"use client";

import { useState } from "react";

import styles from "./language-selector.module.css";

const SUPPORTED = [
  { code: "ko", label: "한국어" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
] as const;

type LangCode = (typeof SUPPORTED)[number]["code"];

export type LanguageSelectorProps = {
  currentLang?: LangCode;
};

export function LanguageSelector({ currentLang = "ko" }: LanguageSelectorProps) {
  const [lang, setLang] = useState<LangCode>(currentLang);
  const [saving, setSaving] = useState(false);

  async function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value as LangCode;
    if (next === lang || saving) return;

    setSaving(true);
    setLang(next);

    // Persist via cookie for server-side reads AND hit the API for
    // the in-memory record (demo — future hook for per-user overrides).
    if (typeof document !== "undefined") {
      document.cookie = `dashboard_lang=${next}; path=/; max-age=31536000; SameSite=Lax`;
    }
    try {
      await fetch("/api/language", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang: next }),
      });
    } catch {
      // Non-critical: cookie already stored client-side.
    } finally {
      setSaving(false);
    }
  }

  return (
    <label className={styles.label} aria-label="대시보드 언어 선택">
      <span className="material-symbols-outlined" aria-hidden="true">
        language
      </span>
      <select
        id="dashboard-language-selector"
        name="dashboard_lang"
        aria-label="대시보드 언어"
        className={styles.select}
        value={lang}
        onChange={handleChange}
        disabled={saving}
      >
        {SUPPORTED.map((entry) => (
          <option key={entry.code} value={entry.code}>
            {entry.label}
          </option>
        ))}
      </select>
    </label>
  );
}
