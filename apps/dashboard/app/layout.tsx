/* eslint-disable @next/next/no-page-custom-font */
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WhaleScope Dashboard",
  description: "WhaleScope operational dashboard backed by Google Sheets.",
  icons: {
    icon: "/icon.svg",
  },
};

/**
 * Theme-boot: runs synchronously before first paint to set `data-theme`
 * on <html>. Prevents FOUC on dark-mode page loads. See DESIGN.md §12.
 * Order of precedence:
 *   1. localStorage['whalescope.theme'] ('light' | 'dark')
 *   2. prefers-color-scheme media query
 *   3. 'light' fallback
 */
const themeBootScript = `
(() => {
  try {
    const stored = localStorage.getItem('whalescope.theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = stored === 'dark' || stored === 'light'
      ? stored
      : (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (_) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`.trim();

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
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
      <body>{children}</body>
    </html>
  );
}
