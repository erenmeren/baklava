const EVENT = "baklava:open-command-palette";

export function openCommandPalette(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

export function onOpenCommandPalette(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
