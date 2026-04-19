"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

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
  const [isOpen, setIsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listboxRef = useRef<HTMLUListElement | null>(null);
  const triggerId = useId();
  const listboxId = useId();
  const selectedIndex = Math.max(SUPPORTED_DASHBOARD_LANGUAGES.indexOf(language), 0);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);

  useEffect(() => {
    setActiveIndex(selectedIndex);
  }, [selectedIndex]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const focusFrame = window.requestAnimationFrame(() => {
      listboxRef.current?.focus();
    });

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) {
        return;
      }

      if (!containerRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isOpen]);

  function focusTrigger() {
    window.requestAnimationFrame(() => {
      triggerRef.current?.focus();
    });
  }

  function closeMenu(restoreFocus = false) {
    setIsOpen(false);
    if (restoreFocus) {
      focusTrigger();
    }
  }

  function openMenu(index = selectedIndex) {
    if (saving) {
      return;
    }

    setActiveIndex(index);
    setIsOpen(true);
  }

  async function persistLanguage(next: DashboardLanguage) {
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

  function handleSelect(next: DashboardLanguage) {
    closeMenu(true);
    void persistLanguage(next);
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    switch (event.key) {
      case "ArrowDown":
      case "Enter":
      case " ":
        event.preventDefault();
        openMenu(selectedIndex);
        break;
      case "ArrowUp":
        event.preventDefault();
        openMenu(selectedIndex);
        break;
      default:
        break;
    }
  }

  function handleListboxKeyDown(event: ReactKeyboardEvent<HTMLUListElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % SUPPORTED_DASHBOARD_LANGUAGES.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex(
          (current) =>
            (current - 1 + SUPPORTED_DASHBOARD_LANGUAGES.length) %
            SUPPORTED_DASHBOARD_LANGUAGES.length,
        );
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(SUPPORTED_DASHBOARD_LANGUAGES.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        handleSelect(SUPPORTED_DASHBOARD_LANGUAGES[activeIndex] ?? language);
        break;
      case "Escape":
        event.preventDefault();
        closeMenu(true);
        break;
      case "Tab":
        setIsOpen(false);
        break;
      default:
        break;
    }
  }

  function handleListboxBlur(event: ReactFocusEvent<HTMLUListElement>) {
    const nextFocused = event.relatedTarget;
    if (nextFocused instanceof Node && containerRef.current?.contains(nextFocused)) {
      return;
    }

    setIsOpen(false);
  }

  const activeLanguage = SUPPORTED_DASHBOARD_LANGUAGES[activeIndex] ?? language;

  return (
    <div
      ref={containerRef}
      className={styles.selector}
      data-saving={saving ? "true" : undefined}
    >
      <button
        id="dashboard-language-selector"
        ref={triggerRef}
        type="button"
        aria-controls={isOpen ? listboxId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={dictionary.languageSelector.controlAriaLabel}
        aria-disabled={saving || undefined}
        aria-busy={saving}
        className={styles.trigger}
        data-open={isOpen ? "true" : undefined}
        onClick={() => {
          if (isOpen) {
            closeMenu();
            return;
          }

          openMenu(selectedIndex);
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className={`${styles.icon} material-symbols-outlined`} aria-hidden="true">
          language
        </span>
        <span className={styles.text}>{dictionary.languageSelector.label}</span>
        <span className={styles.currentValue}>
          {dictionary.languageSelector.options[language]}
        </span>
        <span className={styles.triggerCode} aria-hidden="true">
          {language.toUpperCase()}
        </span>
        <span className={`${styles.caret} material-symbols-outlined`} aria-hidden="true">
          expand_more
        </span>
      </button>

      {isOpen ? (
        <ul
          ref={listboxRef}
          id={listboxId}
          aria-activedescendant={`${triggerId}-${activeLanguage}`}
          aria-label={dictionary.languageSelector.selectAriaLabel}
          aria-labelledby="dashboard-language-selector"
          className={styles.menu}
          role="listbox"
          tabIndex={-1}
          onBlur={handleListboxBlur}
          onKeyDown={handleListboxKeyDown}
        >
          {SUPPORTED_DASHBOARD_LANGUAGES.map((entry) => (
            <li
              id={`${triggerId}-${entry}`}
              key={entry}
              aria-selected={entry === language}
              className={styles.option}
              data-active={entry === activeLanguage ? "true" : undefined}
              data-selected={entry === language ? "true" : undefined}
              role="option"
              onClick={() => handleSelect(entry)}
              onMouseEnter={() => {
                setActiveIndex(SUPPORTED_DASHBOARD_LANGUAGES.indexOf(entry));
              }}
            >
              <span className={styles.optionLabel}>
                {dictionary.languageSelector.options[entry]}
              </span>
              {entry === language ? (
                <span className={`${styles.check} material-symbols-outlined`} aria-hidden="true">
                  check
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
