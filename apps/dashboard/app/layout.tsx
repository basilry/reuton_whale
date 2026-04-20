/* eslint-disable @next/next/no-page-custom-font */
import type { Metadata } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { WrtnAssignmentChip } from "@/components/wrtn-assignment-chip";
import { getCurrentDashboardLanguage } from "@/lib/i18n/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "WhaleScope Dashboard",
  description: "WhaleScope operational dashboard backed by Google Sheets.",
};

/**
 * Theme-boot: runs synchronously before first paint to set `data-theme`
 * on <html>. The default theme is always light unless the user has already
 * stored an explicit override in localStorage.
 */
const themeBootScript = `
(() => {
  try {
    const stored = localStorage.getItem('whalescope.theme');
    const theme = stored === 'dark' || stored === 'light'
      ? stored
      : 'light';
    document.documentElement.setAttribute('data-theme', theme);
  } catch (_) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`.trim();

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const language = await getCurrentDashboardLanguage();

  return (
    <html lang={language} data-dashboard-lang={language} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <link rel="icon" href="/favicon.ico?v=1cfb8185" sizes="any" />
        <link rel="shortcut icon" href="/favicon.ico?v=1cfb8185" />
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&display=swap"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
        />
      </head>
      <body>
        {children}
        <WrtnAssignmentChip />
        <SpeedInsights />
      </body>
    </html>
  );
}
