const EVENT = "baklava:open-assistant";
export function openAssistant(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}
export function onOpenAssistant(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
