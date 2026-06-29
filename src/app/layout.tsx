import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { THEME_COOKIE, readTheme } from "@/lib/theme";
import { BrandMark } from "@/components/brand-mark";
import { ConnectionTabs } from "@/components/connection-tabs";
import { GlobalCommandPalette } from "@/components/command-palette/global-command-palette";
import { PaletteTrigger } from "@/components/command-palette/palette-trigger";
import { AssistantTrigger } from "@/components/ai/assistant-trigger";
import { SettingsTrigger } from "@/components/settings-trigger";
import { DashboardTrigger } from "@/components/dashboard-trigger";
import { LockButton } from "@/components/lock-button";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";
import { needsSetup, isAuthEnabled } from "@/lib/auth/store";
import Link from "next/link";

// Fonts are vendored into public/fonts/ so builds never reach out to
// Google Fonts. Geist + JetBrains Mono ship as full upstream variable
// fonts (latin + latin-ext both covered in a single file).
// Instrument Serif lives in 4 subsetted files (latin / latin-ext × normal
// / italic) and is declared as @font-face in globals.css because
// next/font/local doesn't support per-face unicode-range.
const geistSans = localFont({
  src: "../../public/fonts/Geist-Variable.woff2",
  variable: "--font-geist-sans",
  display: "swap",
  weight: "100 900",
});

const jetbrainsMono = localFont({
  src: "../../public/fonts/JetBrainsMono-Variable.woff2",
  variable: "--font-jetbrains-mono",
  display: "swap",
  weight: "100 800",
});

export const metadata: Metadata = {
  title: "Baklava — one console for every layer of your stack",
  description:
    "Open-source unified UI for Docker, Kafka, PostgreSQL and the rest of your stack. Connect, browse, run.",
  openGraph: {
    title: "Baklava — one console for every layer of your stack",
    description:
      "Open-source unified UI for Docker, Kafka, PostgreSQL and the rest of your stack. Connect, browse, run.",
    images: ["/og-image.png"],
  },
};

// Brand "ink" background (#1E2327) from the brand pack (baklava-brand/README.md).
export const viewport: Viewport = {
  themeColor: "#1E2327",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const theme = readTheme(cookieStore.get(THEME_COOKIE)?.value);
  const themeClass =
    theme === "dark" ? "dark" : theme === "light" ? "light" : "";

  // App chrome (tabs, palette, settings…) renders when the gate is off, or for
  // an authenticated session on a configured console — the /login screen and the
  // first-run create-password flow show a bare card instead.
  const authEnabled = isAuthEnabled();
  const showChrome =
    !authEnabled ||
    (verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value) &&
      !needsSetup());

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${jetbrainsMono.variable} ${themeClass} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider initialTheme={theme}>
          <TooltipProvider delay={150}>
            {showChrome ? (
            <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/65">
              <div className="flex items-stretch h-12 pr-3">
                <Link
                  href="/"
                  aria-label="Baklava home"
                  className="inline-flex items-center gap-2 px-4 text-foreground/90 hover:text-brand transition-colors shrink-0"
                >
                  <BrandMark size={20} />
                  <span className="font-semibold tracking-tight text-[13.5px] hidden sm:inline">
                    baklava
                  </span>
                </Link>
                <span
                  className="self-center h-5 w-px bg-border/70 mr-1"
                  aria-hidden
                />
                <ConnectionTabs />
                <div className="flex items-center pl-3 shrink-0">
                  <PaletteTrigger />
                  <span
                    className="self-center h-5 w-px bg-border/70 mx-2"
                    aria-hidden
                  />
                  {/* Destinations read as one group */}
                  <div className="flex items-center gap-0.5">
                    <DashboardTrigger />
                    <AssistantTrigger />
                    <SettingsTrigger />
                    {authEnabled ? <LockButton /> : null}
                  </div>
                  {/* Appearance is a preference, not a destination — detached */}
                  <div className="ml-1.5">
                    <ThemeToggle />
                  </div>
                </div>
              </div>
            </header>
            ) : null}
            <main className="flex-1 w-full">{children}</main>
            <Toaster richColors position="top-right" />
            <GlobalCommandPalette />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
