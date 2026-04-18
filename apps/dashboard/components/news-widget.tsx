import { loadNewsWidgetData, type NewsWidgetData } from "@/lib/news";
import { getCurrentDashboardLanguage } from "@/lib/i18n/server";

import { NewsWidgetClient } from "./news-widget-client";
import styles from "./news-widget.module.css";

type NewsWidgetProps = {
  limit?: number;
  data?: NewsWidgetData;
  mobileLimit?: number;
};
export async function NewsWidget({
  limit = 4,
  data,
  mobileLimit = 2,
}: NewsWidgetProps) {
  const resolved = data ?? (await loadNewsWidgetData(limit));
  const language = await getCurrentDashboardLanguage();

  return (
    <section className={styles.widget} aria-labelledby="news-widget-title">
      <NewsWidgetClient data={resolved} mobileLimit={mobileLimit} initialLanguage={language} />
    </section>
  );
}
