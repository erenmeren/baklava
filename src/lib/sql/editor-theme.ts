import { EditorView } from "@codemirror/view";

// Shared CodeMirror theme overlay — layered on top of @uiw's base light/dark
// theme so the editor's floating chrome (autocomplete popup, search panel,
// tooltips, fold placeholders) inherits the app's OKLch tokens instead of
// CodeMirror's defaults. Both SQL editors (Postgres + SQL Server) load it.
export const editorTheme = EditorView.theme({
  // ─── Editor body ─────────────────────────────────────────────────────
  "&": { height: "100%", fontSize: "12.5px" },
  ".cm-scroller": { fontFamily: "var(--font-jetbrains-mono), monospace" },
  ".cm-content": { padding: "10px 0", caretColor: "var(--brand)" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    borderRight: "1px solid var(--border)",
    color: "var(--muted-foreground)",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in oklch, var(--brand) 5%, transparent)",
  },
  ".cm-activeLineGutter": { backgroundColor: "transparent" },

  // ─── Selection + cursor ─────────────────────────────────────────────
  // CodeMirror's selection is drawn on a layer behind the text, not via the
  // native ::selection pseudo — so the styled-class is the only thing that
  // matters here. The `&.cm-focused` variant has higher precedence than the
  // default light-theme rule.
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in oklch, var(--brand) 22%, transparent)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--brand)",
    borderLeftWidth: "1.5px",
  },

  // ─── Bracket matching ───────────────────────────────────────────────
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "color-mix(in oklch, var(--brand) 18%, transparent)",
    outline: "1px solid color-mix(in oklch, var(--brand) 35%, transparent)",
  },
  ".cm-nonmatchingBracket, &.cm-focused .cm-nonmatchingBracket": {
    backgroundColor: "color-mix(in oklch, var(--destructive) 18%, transparent)",
  },

  // ─── Floating tooltips (autocomplete, lint, hover) ──────────────────
  ".cm-tooltip": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    boxShadow:
      "0 8px 24px -6px rgb(0 0 0 / 0.18), 0 2px 6px -2px rgb(0 0 0 / 0.10)",
    fontFamily: "var(--font-jetbrains-mono), monospace",
    fontSize: "12px",
    overflow: "hidden",
  },
  ".cm-tooltip-autocomplete": { padding: "4px 0" },
  ".cm-tooltip-autocomplete > ul": {
    fontFamily: "inherit",
    maxHeight: "16rem",
    overflowY: "auto",
  },
  ".cm-tooltip-autocomplete > ul > li": {
    padding: "3px 10px",
    color: "var(--popover-foreground)",
    lineHeight: "1.4",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "color-mix(in oklch, var(--brand) 14%, transparent)",
    color: "var(--foreground)",
  },
  ".cm-completionLabel": { color: "inherit" },
  ".cm-completionMatchedText": {
    textDecoration: "none",
    color: "var(--brand)",
    fontWeight: "600",
  },
  ".cm-completionDetail": {
    color: "var(--muted-foreground)",
    fontStyle: "normal",
    marginLeft: "0.5rem",
  },
  ".cm-completionIcon": {
    color: "var(--muted-foreground)",
    width: "0.9em",
    marginRight: "0.4em",
    opacity: "0.8",
  },

  // ─── Search panel (⌘F / Ctrl+F) ─────────────────────────────────────
  // The panel renders `<input class="cm-textfield">` for search/replace,
  // `<button class="cm-button">` for actions (next/prev/all/replace/…), a
  // bare `<button name="close">×</button>`, plus three native checkboxes
  // (match case / regexp / by word) inside `<label>`s.
  ".cm-panels": {
    backgroundColor: "var(--card)",
    color: "var(--foreground)",
    borderTop: "1px solid var(--border)",
  },
  ".cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  ".cm-panel.cm-search": {
    padding: "8px 10px",
    backgroundColor: "transparent",
    fontFamily: "var(--font-jetbrains-mono), monospace",
    fontSize: "12px",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "6px",
  },
  // CodeMirror inserts a <br> between the search row and the replace row.
  // Promote it to a flex line break so spacing stays consistent.
  ".cm-panel.cm-search br": {
    flexBasis: "100%",
    height: "0",
    margin: "2px 0",
    border: "0",
  },

  // Text inputs (search + replace).
  ".cm-panel.cm-search .cm-textfield": {
    backgroundColor: "var(--background)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    color: "var(--foreground)",
    caretColor: "var(--brand)",
    padding: "4px 8px",
    margin: "0",
    minWidth: "180px",
    fontSize: "12px",
    fontFamily: "inherit",
    outline: "none",
    transition: "border-color 120ms ease, box-shadow 120ms ease",
  },
  ".cm-panel.cm-search .cm-textfield::placeholder": {
    color: "var(--muted-foreground)",
  },
  ".cm-panel.cm-search .cm-textfield:focus": {
    borderColor: "var(--brand)",
    boxShadow: "0 0 0 2px color-mix(in oklch, var(--brand) 22%, transparent)",
  },

  // Action buttons (next / prev / all / replace / replace all).
  ".cm-panel.cm-search .cm-button": {
    backgroundColor: "var(--card)",
    backgroundImage: "none",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    color: "var(--foreground)",
    padding: "3px 9px",
    fontSize: "11px",
    fontFamily: "inherit",
    fontWeight: "500",
    cursor: "pointer",
    margin: "0",
    transition: "background-color 120ms ease, color 120ms ease, border-color 120ms ease",
  },
  ".cm-panel.cm-search .cm-button:hover": {
    backgroundColor: "var(--muted)",
    color: "var(--foreground)",
    borderColor: "color-mix(in oklch, var(--border) 50%, var(--foreground) 12%)",
  },
  ".cm-panel.cm-search .cm-button:active": {
    backgroundColor: "color-mix(in oklch, var(--brand) 10%, var(--card))",
  },

  // The close button isn't `.cm-button` — bare <button name="close">.
  ".cm-panel.cm-search button[name='close']": {
    marginLeft: "auto",
    backgroundColor: "transparent",
    border: "none",
    borderRadius: "6px",
    color: "var(--muted-foreground)",
    fontSize: "16px",
    lineHeight: "1",
    padding: "0 6px",
    height: "22px",
    cursor: "pointer",
    transition: "background-color 120ms ease, color 120ms ease",
  },
  ".cm-panel.cm-search button[name='close']:hover": {
    backgroundColor: "var(--muted)",
    color: "var(--foreground)",
  },

  // Labels wrap each checkbox; style the row and the checkbox itself.
  ".cm-panel.cm-search label": {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    fontSize: "11px",
    color: "var(--muted-foreground)",
    margin: "0",
    cursor: "pointer",
    userSelect: "none",
  },
  ".cm-panel.cm-search label:hover": { color: "var(--foreground)" },
  ".cm-panel.cm-search input[type='checkbox']": {
    accentColor: "var(--brand)",
    width: "14px",
    height: "14px",
    margin: "0",
    cursor: "pointer",
  },

  // Match highlights in the document.
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in oklch, var(--brand) 25%, transparent)",
    outline: "1px solid color-mix(in oklch, var(--brand) 45%, transparent)",
    borderRadius: "2px",
  },
  ".cm-searchMatch-selected": {
    backgroundColor: "color-mix(in oklch, var(--brand) 50%, transparent)",
    outline: "1px solid var(--brand)",
  },

  // ─── Fold placeholder + diagnostics ─────────────────────────────────
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--muted)",
    color: "var(--muted-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "4px",
    padding: "0 6px",
    margin: "0 2px",
  },
  ".cm-tooltip.cm-tooltip-hover, .cm-tooltip-section": { maxWidth: "32rem" },
});
