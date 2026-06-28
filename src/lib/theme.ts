export const THEME_COOKIE = "baklava-theme";
export const PALETTE_COOKIE = "baklava-palette";

export type Theme = "light" | "dark" | "system";

/** Color palette family, independent of the light/dark mode. */
export type Palette = "classic" | "phosphor";

export function readTheme(value: string | undefined): Theme {
  if (value === "light" || value === "dark" || value === "system") return value;
  return "system";
}

export function readPalette(value: string | undefined): Palette {
  return value === "phosphor" ? "phosphor" : "classic";
}

/**
 * The `<html>` class list for a given mode + palette. Used by the server (to
 * avoid a flash of the wrong theme) and mirrored by ThemeProvider on the client.
 *
 * - Classic keeps today's behavior exactly: `dark`/`light`, or NEITHER in system
 *   mode (a `prefers-color-scheme` media query resolves it).
 * - Phosphor is dark-first and always carries an explicit `dark`/`light` class
 *   alongside `theme-phosphor`, so its tokens win over the high-specificity
 *   system-dark media block. In system mode the server defaults to dark (the
 *   client corrects on mount via `systemResolved`).
 */
export function htmlThemeClasses(
  theme: Theme,
  palette: Palette,
  systemResolved?: "dark" | "light",
): string {
  const cls: string[] = [];
  if (palette === "phosphor") {
    cls.push("theme-phosphor");
    const eff = theme === "system" ? (systemResolved ?? "dark") : theme;
    cls.push(eff);
  } else if (theme === "dark") {
    cls.push("dark");
  } else if (theme === "light") {
    cls.push("light");
  }
  return cls.join(" ");
}
