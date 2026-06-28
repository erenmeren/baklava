"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  THEME_COOKIE,
  PALETTE_COOKIE,
  CRT_COOKIE,
  htmlThemeClasses,
  type Theme,
  type Palette,
} from "@/lib/theme";

export type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (t: Theme) => void;
  palette: Palette;
  setPalette: (p: Palette) => void;
  scanlines: boolean;
  setScanlines: (on: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function detectSystem(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

// Apply both axes (mode + palette) to <html>, mirroring htmlThemeClasses.
function applyClasses(theme: Theme, palette: Palette) {
  const root = document.documentElement;
  root.classList.remove("dark", "light", "theme-phosphor");
  const next = htmlThemeClasses(theme, palette, detectSystem())
    .split(" ")
    .filter(Boolean);
  for (const c of next) root.classList.add(c);
}

function writeCookie(name: string, value: string) {
  const oneYear = 60 * 60 * 24 * 365;
  document.cookie = `${name}=${value}; path=/; max-age=${oneYear}; SameSite=Lax`;
}

interface ProviderProps {
  initialTheme?: Theme;
  initialPalette?: Palette;
  initialScanlines?: boolean;
  children: React.ReactNode;
}

export function ThemeProvider({
  initialTheme = "system",
  initialPalette = "classic",
  initialScanlines = false,
  children,
}: ProviderProps) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const [palette, setPaletteState] = useState<Palette>(initialPalette);
  const [scanlines, setScanlinesState] = useState<boolean>(initialScanlines);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    initialTheme === "system" ? "light" : initialTheme
  );
  const paletteRef = useRef(palette);
  useEffect(() => {
    paletteRef.current = palette;
  }, [palette]);

  // Resolve + watch the system preference. Re-applies classes when in system
  // mode, because phosphor derives an explicit dark/light class from the OS.
  useEffect(() => {
    const compute = (): ResolvedTheme =>
      theme === "system" ? detectSystem() : theme;
    setResolvedTheme(compute());
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      setResolvedTheme(detectSystem());
      applyClasses("system", paletteRef.current);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    writeCookie(THEME_COOKIE, t);
    applyClasses(t, paletteRef.current);
  }, []);

  const setPalette = useCallback((p: Palette) => {
    setPaletteState(p);
    paletteRef.current = p;
    writeCookie(PALETTE_COOKIE, p);
    // Read the current mode via a functional setter to avoid a stale closure.
    setThemeState((curTheme) => {
      applyClasses(curTheme, p);
      return curTheme;
    });
  }, []);

  const setScanlines = useCallback((on: boolean) => {
    setScanlinesState(on);
    writeCookie(CRT_COOKIE, on ? "1" : "0");
  }, []);

  return (
    <ThemeContext.Provider
      value={{ theme, resolvedTheme, setTheme, palette, setPalette, scanlines, setScanlines }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      theme: "system",
      resolvedTheme: "light",
      setTheme: () => undefined,
      palette: "classic",
      setPalette: () => undefined,
      scanlines: false,
      setScanlines: () => undefined,
    };
  }
  return ctx;
}
