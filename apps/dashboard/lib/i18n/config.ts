export const DASHBOARD_LANGUAGE_COOKIE = "dashboard_lang";

export const SUPPORTED_DASHBOARD_LANGUAGES = ["ko", "en"] as const;

export type DashboardLanguage = (typeof SUPPORTED_DASHBOARD_LANGUAGES)[number];

export const DEFAULT_DASHBOARD_LANGUAGE: DashboardLanguage = "ko";

export function isDashboardLanguage(value: string | null | undefined): value is DashboardLanguage {
  return SUPPORTED_DASHBOARD_LANGUAGES.includes(value as DashboardLanguage);
}

export function resolveDashboardLanguage(value: string | null | undefined): DashboardLanguage {
  return isDashboardLanguage(value) ? value : DEFAULT_DASHBOARD_LANGUAGE;
}
