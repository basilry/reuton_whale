import { cookies } from "next/headers";

import {
  DASHBOARD_LANGUAGE_COOKIE,
  resolveDashboardLanguage,
  type DashboardLanguage,
} from "./config";
import { getDashboardDictionary } from "./get-dictionary";

export async function getCurrentDashboardLanguage(): Promise<DashboardLanguage> {
  const cookieStore = await cookies();
  return resolveDashboardLanguage(cookieStore.get(DASHBOARD_LANGUAGE_COOKIE)?.value);
}

export async function getCurrentDashboardDictionary() {
  return getDashboardDictionary(await getCurrentDashboardLanguage());
}
