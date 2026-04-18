"use client";

import { useEffect, useMemo, useState } from "react";

import {
  DASHBOARD_LANGUAGE_COOKIE,
  DEFAULT_DASHBOARD_LANGUAGE,
  resolveDashboardLanguage,
  type DashboardLanguage,
} from "./config";
import { getDashboardDictionary } from "./get-dictionary";

const LANGUAGE_CHANGE_EVENT = "whalescope:language-change";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }

  const pattern = new RegExp(`(?:^|; )${name}=([^;]*)`);
  const match = document.cookie.match(pattern);
  return match ? decodeURIComponent(match[1]) : null;
}

function readDocumentLanguage(): DashboardLanguage {
  if (typeof document === "undefined") {
    return DEFAULT_DASHBOARD_LANGUAGE;
  }

  return resolveDashboardLanguage(
    document.documentElement.getAttribute("data-dashboard-lang") ??
      document.documentElement.lang ??
      readCookie(DASHBOARD_LANGUAGE_COOKIE),
  );
}

function applyDocumentLanguage(language: DashboardLanguage) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.lang = language;
  document.documentElement.setAttribute("data-dashboard-lang", language);
}

export function setClientDashboardLanguage(language: DashboardLanguage) {
  applyDocumentLanguage(language);

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(LANGUAGE_CHANGE_EVENT, {
        detail: { language },
      }),
    );
  }
}

export function useDashboardI18n(initialLanguage?: DashboardLanguage) {
  const [language, setLanguage] = useState<DashboardLanguage>(
    initialLanguage ?? DEFAULT_DASHBOARD_LANGUAGE,
  );

  useEffect(() => {
    setLanguage(readDocumentLanguage());

    const handleLanguageChange = (event: Event) => {
      const nextLanguage = resolveDashboardLanguage(
        (event as CustomEvent<{ language?: string }>).detail?.language,
      );
      setLanguage(nextLanguage);
      applyDocumentLanguage(nextLanguage);
    };

    window.addEventListener(LANGUAGE_CHANGE_EVENT, handleLanguageChange);

    return () => {
      window.removeEventListener(LANGUAGE_CHANGE_EVENT, handleLanguageChange);
    };
  }, []);

  const dictionary = useMemo(() => getDashboardDictionary(language), [language]);

  return {
    dictionary,
    language,
    setLanguage: setClientDashboardLanguage,
  };
}
