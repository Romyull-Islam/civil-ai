import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "CivilMate: AI assistant for civil engineers",
  description: "CivilMate: AI assistant for civil & structural engineers and architects. BNBC/IS/ACI design, analysis, DXF drawings, quantities and code references.",
  applicationName: "CivilMate",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      {/* suppressHydrationWarning: browser extensions (e.g. Grammarly) add data-* attributes to <body> before React hydrates */}
      <body className="h-full" suppressHydrationWarning>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
