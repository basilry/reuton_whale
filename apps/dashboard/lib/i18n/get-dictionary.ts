import { DEFAULT_DASHBOARD_LANGUAGE, resolveDashboardLanguage, type DashboardLanguage } from "./config";
import { enDictionary } from "./dictionaries/en";
import { koDictionary } from "./dictionaries/ko";

const DICTIONARIES = {
  ko: koDictionary,
  en: enDictionary,
} as const;

export type DashboardDictionary = (typeof DICTIONARIES)[typeof DEFAULT_DASHBOARD_LANGUAGE];

export function getDashboardDictionary(
  language?: DashboardLanguage | string | null,
): DashboardDictionary {
  return DICTIONARIES[resolveDashboardLanguage(language)];
}

export function formatDashboardMessage(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
}
