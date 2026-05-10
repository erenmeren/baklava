import type { Metadata } from "next";
import { Geist, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { THEME_COOKIE, readTheme } from "@/lib/theme";
import { BrandMark } from "@/components/brand-mark";
import { ConnectionTabs } from "@/components/connection-tabs";
import Link from "next/link";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Baklava — one console for every layer of your stack",
  description:
    "Open-source unified UI for Docker, Kafka, PostgreSQL and the rest of your stack. Connect, browse, run.",
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

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${jetbrainsMono.variable} ${instrumentSerif.variable} ${themeClass} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider initialTheme={theme}>
          <TooltipProvider delay={150}>
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
                <div className="flex items-center gap-1 pl-2 shrink-0">
                  <ThemeToggle />
                </div>
              </div>
            </header>
            <main className="flex-1 w-full">{children}</main>
            <Toaster richColors position="top-right" />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
