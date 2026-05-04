import type { Metadata } from "next";
import { Geist, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { THEME_COOKIE, readTheme } from "@/lib/theme";
import Link from "next/link";
import { Layers } from "lucide-react";

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
            <header className="border-b border-border/60 sticky top-0 z-30 backdrop-blur-md supports-[backdrop-filter]:bg-background/75">
              <div className="mx-auto max-w-7xl flex items-center justify-between px-6 h-14">
                <Link
                  href="/"
                  className="flex items-center gap-2 group"
                  aria-label="Baklava home"
                >
                  <Layers className="size-4 text-brand transition-transform group-hover:rotate-12" />
                  <span className="font-semibold tracking-tight">
                    Baklava<span className="text-brand">.</span>
                  </span>
                </Link>
                <nav className="flex items-center gap-1 text-sm text-muted-foreground">
                  <a
                    href="https://github.com/erenmeren/baklava"
                    target="_blank"
                    rel="noreferrer"
                    className="px-2 py-1 rounded-md hover:text-foreground hover:bg-foreground/5 transition-colors"
                  >
                    GitHub
                  </a>
                  <ThemeToggle />
                </nav>
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
