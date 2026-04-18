"use client";

import { useState } from "react";

import {
  SUPPORTED_DASHBOARD_LANGUAGES,
  type DashboardLanguage,
} from "@/lib/i18n/config";
import { useDashboardI18n } from "@/lib/i18n/client";
import styles from "./language-selector.module.css";

export type LanguageSelectorProps = {
  currentLang?: DashboardLanguage;
};

export function LanguageSelector({ currentLang = "ko" }: LanguageSelectorProps) {
  const { dictionary, language, setLanguage } = useDashboardI18n(currentLang);
  const [saving, setSaving] = useState(false);

  async function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value as DashboardLanguage;
    if (next === language || saving) return;

    setSaving(true);
    setLanguage(next);

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
    <label
      className={styles.label}
      aria-label={dictionary.languageSelector.controlAriaLabel}
      data-saving={saving ? "true" : undefined}
    >
      <span className={`${styles.icon} material-symbols-outlined`} aria-hidden="true">
        language
      </span>
      <span className={styles.text}>{dictionary.languageSelector.label}</span>
      <select
        id="dashboard-language-selector"
        name="dashboard_lang"
        aria-label={dictionary.languageSelector.selectAriaLabel}
        className={styles.select}
        value={language}
        onChange={handleChange}
        disabled={saving}
        aria-busy={saving}
      >
        {SUPPORTED_DASHBOARD_LANGUAGES.map((entry) => (
          <option key={entry} value={entry}>
            {dictionary.languageSelector.options[entry]}
          </option>
        ))}
      </select>
      <span className={`${styles.caret} material-symbols-outlined`} aria-hidden="true">
        expand_more
      </span>
    </label>
  );
}
