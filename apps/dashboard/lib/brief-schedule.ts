import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type BriefSchedule = { fullBriefHoursKst: number[] };

const DEFAULT_HOURS: readonly number[] = [9, 15, 21];

let cached: readonly number[] | undefined;

export function getBriefScheduleHoursKst(): readonly number[] {
  if (cached) {
    return cached;
  }

  try {
    const path = resolve(process.cwd(), "..", "..", "config", "brief_schedule.json");
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as BriefSchedule;

    if (
      !Array.isArray(parsed.fullBriefHoursKst) ||
      !parsed.fullBriefHoursKst.every((h) => Number.isInteger(h) && h >= 0 && h <= 23)
    ) {
      throw new Error("invalid brief_schedule.json shape");
    }

    cached = [...parsed.fullBriefHoursKst].sort((a, b) => a - b);
    return cached;
  } catch (error) {
    console.warn("[brief-schedule] fallback to default", error);
    cached = DEFAULT_HOURS;
    return cached;
  }
}
