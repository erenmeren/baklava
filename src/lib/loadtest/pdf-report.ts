// Server-only: render a single load-test run as a polished PDF report.
// Uses pdfkit (declared in serverExternalPackages so Next doesn't bundle its
// font-metric assets). Lazy-imported so the rest of the app never pulls it in.
//
// SECURITY: this report describes auth by type only (via describeAuth) — it
// never prints token/password values.
import { formatBytes } from "@/components/workspace/format";
import { describeAuth, describeProfile, describeThresholds, profileLabel } from "./describe";
import type { LoadTest, LoadTestRun } from "./store";
import type { LatencyStats } from "./results";

const COLOR = {
  text: "#111827",
  muted: "#6b7280",
  faint: "#9ca3af",
  border: "#e5e7eb",
  pass: "#16a34a",
  fail: "#dc2626",
  accent: "#7c3aed",
} as const;

const PAGE_MARGIN = 50;

// pdfkit's standard Helvetica uses WinAnsi encoding, which lacks a few glyphs we
// use decoratively (→ ≥ ≤). Map them to ASCII so they don't render as mojibake.
// (em dash, middot and accented latin-1 ARE in WinAnsi, so we leave them.)
function san(s: string): string {
  return s.replace(/→/g, "->").replace(/≥/g, ">=").replace(/≤/g, "<=");
}

function fmtDate(ms: number | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function fmtDuration(run: LoadTestRun): string {
  if (!run.finishedAt) return "—";
  const s = Math.max(0, (run.finishedAt - run.startedAt) / 1000);
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

export async function renderRunPdf(test: LoadTest, run: LoadTestRun): Promise<Buffer> {
  const { default: PDFDocument } = await import("pdfkit");
  const doc = new PDFDocument({ size: "A4", margin: PAGE_MARGIN, bufferPages: true });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentWidth = right - left;
  const result = run.result;

  // ---- Header -------------------------------------------------------------
  doc.fillColor(COLOR.accent).font("Helvetica-Bold").fontSize(9).text("BAKLAVA · LOAD TEST REPORT", left, PAGE_MARGIN);
  doc.moveDown(0.3);
  doc.fillColor(COLOR.text).font("Helvetica-Bold").fontSize(22).text(test.name, { width: contentWidth - 110 });
  const titleBottom = doc.y;
  doc.fillColor(COLOR.muted).font("Helvetica").fontSize(10).text(test.config.target.baseUrl, { width: contentWidth - 110 });

  // Verdict pill, top-right.
  const verdict = run.status === "error" ? "ERROR" : result?.passed ? "PASS" : "FAIL";
  const pillColor = verdict === "PASS" ? COLOR.pass : verdict === "FAIL" ? COLOR.fail : COLOR.faint;
  const pillW = 84;
  const pillX = right - pillW;
  doc.roundedRect(pillX, PAGE_MARGIN, pillW, 30, 6).fill(pillColor);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(15).text(verdict, pillX, PAGE_MARGIN + 8, { width: pillW, align: "center" });

  doc.y = Math.max(doc.y, titleBottom) + 18;
  rule(doc, left, right);
  doc.moveDown(0.8);

  // ---- Run metadata -------------------------------------------------------
  metaRow(doc, left, contentWidth, [
    ["Status", run.status],
    ["Started", fmtDate(run.startedAt)],
    ["Duration", fmtDuration(run)],
  ]);
  doc.moveDown(1);

  // ---- What was tested ----------------------------------------------------
  sectionHeading(doc, "What was tested", left);
  const cfg = test.config;
  field(doc, "Target", cfg.target.baseUrl, left, contentWidth);
  field(doc, "Load profile", `${profileLabel(cfg.profile)} — ${describeProfile(cfg.profile)}`, left, contentWidth);
  field(doc, "Authentication", describeAuth(cfg.auth), left, contentWidth);
  field(doc, "Requests", `${cfg.requests.length} step${cfg.requests.length === 1 ? "" : "s"}`, left, contentWidth);
  for (const r of cfg.requests) {
    doc.fillColor(COLOR.muted).font("Helvetica").fontSize(9)
      .text(`•  ${r.method}  ${r.path}   (${r.name})`, left + 12, doc.y, { width: contentWidth - 12 });
    doc.moveDown(0.15);
  }
  const thr = describeThresholds(cfg.thresholds);
  if (thr.length) {
    doc.moveDown(0.3);
    field(doc, "Thresholds", thr.join("   ·   "), left, contentWidth);
  }
  doc.moveDown(1);

  // ---- Results ------------------------------------------------------------
  if (result) {
    sectionHeading(doc, "Results", left);
    metricGrid(doc, left, contentWidth, [
      ["Requests", String(result.totalRequests)],
      ["Throughput", `${result.rps.toFixed(1)} req/s`],
      ["Error rate", `${(result.errorRate * 100).toFixed(2)}%`],
      ["Max VUs", String(result.vusMax)],
    ]);
    doc.moveDown(0.5);
    doc.fillColor(COLOR.muted).font("Helvetica").fontSize(9)
      .text(`Data sent ${formatBytes(result.dataSent)}  ·  received ${formatBytes(result.dataReceived)}`, left, doc.y);
    doc.moveDown(1);

    // Latency percentiles
    sectionHeading(doc, "Latency (overall)", left, 11);
    latencyTable(doc, left, contentWidth, result.latency);
    doc.moveDown(1);

    // Per-request
    if (result.requests.length) {
      sectionHeading(doc, "Per request", left, 11);
      perRequestTable(doc, left, contentWidth, result.requests);
      doc.moveDown(1);
    }

    // Thresholds pass/fail
    if (result.thresholds.length) {
      sectionHeading(doc, "Threshold checks", left, 11);
      for (const t of result.thresholds) {
        ensureSpace(doc, 16);
        doc.font("Helvetica-Bold").fontSize(9).fillColor(t.passed ? COLOR.pass : COLOR.fail)
          .text(t.passed ? "PASS" : "FAIL", left, doc.y, { continued: true });
        doc.font("Helvetica").fillColor(COLOR.muted).text(`   ${t.name}`);
        doc.moveDown(0.1);
      }
    }
  } else if (run.error) {
    sectionHeading(doc, "Error", left);
    doc.fillColor(COLOR.fail).font("Helvetica").fontSize(9).text(run.error, left, doc.y, { width: contentWidth });
  } else {
    doc.fillColor(COLOR.muted).font("Helvetica").fontSize(10).text(`This run produced no results (${run.status}).`, left, doc.y);
  }

  // ---- Footer (page numbers + generated stamp) ----------------------------
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing below the bottom margin would otherwise make pdfkit auto-insert a
    // blank page — drop the margin so the footer stays on its own page.
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 35;
    doc.fillColor(COLOR.faint).font("Helvetica").fontSize(8)
      .text(`Generated ${fmtDate(Date.now())}`, left, y, { width: contentWidth / 2, lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, left + contentWidth / 2, y, { width: contentWidth / 2, align: "right", lineBreak: false });
  }

  doc.end();
  return done;
}

// --- drawing helpers -------------------------------------------------------

type Doc = PDFKit.PDFDocument;

function rule(doc: Doc, left: number, right: number) {
  doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(1).strokeColor(COLOR.border).stroke();
}

function ensureSpace(doc: Doc, needed: number) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

function sectionHeading(doc: Doc, text: string, left: number, size = 13) {
  ensureSpace(doc, 28);
  doc.fillColor(COLOR.text).font("Helvetica-Bold").fontSize(size).text(text, left, doc.y);
  doc.moveDown(0.4);
}

function field(doc: Doc, label: string, value: string, left: number, width: number) {
  ensureSpace(doc, 16);
  const labelW = 110;
  const y = doc.y;
  doc.fillColor(COLOR.faint).font("Helvetica-Bold").fontSize(9).text(label.toUpperCase(), left, y, { width: labelW });
  doc.fillColor(COLOR.text).font("Helvetica").fontSize(10).text(san(value), left + labelW, y, { width: width - labelW });
  doc.moveDown(0.25);
}

function metaRow(doc: Doc, left: number, width: number, items: Array<[string, string]>) {
  const colW = width / items.length;
  const y = doc.y;
  items.forEach(([label, value], i) => {
    const x = left + i * colW;
    doc.fillColor(COLOR.faint).font("Helvetica-Bold").fontSize(8).text(label.toUpperCase(), x, y);
    doc.fillColor(COLOR.text).font("Helvetica").fontSize(11).text(value, x, y + 12, { width: colW - 8 });
  });
  doc.y = y + 32;
}

function metricGrid(doc: Doc, left: number, width: number, items: Array<[string, string]>) {
  const gap = 10;
  const colW = (width - gap * (items.length - 1)) / items.length;
  const h = 52;
  const y = doc.y;
  ensureSpace(doc, h + 4);
  items.forEach(([label, value], i) => {
    const x = left + i * (colW + gap);
    doc.roundedRect(x, y, colW, h, 6).lineWidth(1).strokeColor(COLOR.border).stroke();
    doc.fillColor(COLOR.faint).font("Helvetica-Bold").fontSize(8).text(label.toUpperCase(), x + 10, y + 10, { width: colW - 20 });
    doc.fillColor(COLOR.text).font("Helvetica-Bold").fontSize(18).text(value, x + 10, y + 24, { width: colW - 20 });
  });
  doc.y = y + h;
}

function latencyTable(doc: Doc, left: number, width: number, l: LatencyStats) {
  const rows: Array<[string, string]> = [
    ["avg", `${l.avg}ms`],
    ["p50", `${l.p50}ms`],
    ["p90", `${l.p90}ms`],
    ["p95", `${l.p95}ms`],
    ["p99", `${l.p99}ms`],
    ["max", `${l.max}ms`],
  ];
  const colW = width / rows.length;
  const y = doc.y;
  ensureSpace(doc, 40);
  rows.forEach(([k], i) => {
    doc.fillColor(COLOR.faint).font("Helvetica-Bold").fontSize(8).text(k.toUpperCase(), left + i * colW, y, { width: colW - 6 });
  });
  rows.forEach(([, v], i) => {
    doc.fillColor(COLOR.text).font("Helvetica").fontSize(12).text(v, left + i * colW, y + 13, { width: colW - 6 });
  });
  doc.y = y + 34;
}

function perRequestTable(doc: Doc, left: number, width: number, requests: Array<{ name: string; latency: LatencyStats }>) {
  const cols = [
    { key: "name", label: "Request", w: 0.34, align: "left" as const },
    { key: "avg", label: "avg", w: 0.11, align: "right" as const },
    { key: "p90", label: "p90", w: 0.11, align: "right" as const },
    { key: "p95", label: "p95", w: 0.11, align: "right" as const },
    { key: "p99", label: "p99", w: 0.11, align: "right" as const },
    { key: "max", label: "max", w: 0.22, align: "right" as const },
  ];
  const xOf = (idx: number) => left + cols.slice(0, idx).reduce((a, c) => a + c.w * width, 0);

  // header
  ensureSpace(doc, 24);
  const hy = doc.y;
  cols.forEach((c, i) => {
    doc.fillColor(COLOR.faint).font("Helvetica-Bold").fontSize(8)
      .text(c.label.toUpperCase(), xOf(i), hy, { width: c.w * width - 4, align: c.align });
  });
  doc.y = hy + 14;
  rule(doc, left, left + width);
  doc.moveDown(0.3);

  for (const r of requests) {
    ensureSpace(doc, 16);
    const y = doc.y;
    const l = r.latency;
    const vals = [r.name, `${l.avg}`, `${l.p90}`, `${l.p95}`, `${l.p99}`, `${l.max}`];
    cols.forEach((c, i) => {
      const isName = c.key === "name";
      doc.fillColor(isName ? COLOR.text : COLOR.muted).font(isName ? "Helvetica" : "Helvetica").fontSize(9)
        .text(vals[i], xOf(i), y, { width: c.w * width - 4, align: c.align, lineBreak: isName });
    });
    doc.y = y + 14;
  }
}
