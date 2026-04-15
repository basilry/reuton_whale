import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WhaleScope Dashboard",
  description: "WhaleScope operational dashboard backed by Google Sheets.",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
