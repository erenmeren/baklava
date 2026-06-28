export const THEME_COOKIE = "baklava-theme";

export type Theme = "light" | "dark" | "system";

export function readTheme(value: string | undefined): Theme {
  if (value === "light" || value === "dark" || value === "system") return value;
  return "system";
}
