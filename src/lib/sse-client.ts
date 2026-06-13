/**
 * Canonical incremental SSE frame parser for `fetch`+ReadableStream consumers.
 *
 * Usage:
 *   const parser = new SseFrameParser();
 *   while (true) {
 *     const { value, done } = await reader.read();
 *     if (done) break;
 *     for (const frame of parser.push(dec.decode(value, { stream: true }))) {
 *       // frame.event — SSE event name (defaults to "message")
 *       // frame.data  — JSON-parsed payload (or raw string if JSON.parse failed)
 *     }
 *   }
 */
export interface SseFrame {
  event: string;
  data: unknown;
}

/** Incrementally parses an SSE byte stream's text into {event,data} frames. */
export class SseFrameParser {
  private buf = "";

  push(chunk: string): SseFrame[] {
    this.buf += chunk;
    const frames: SseFrame[] = [];
    let sep: number;
    while ((sep = this.buf.indexOf("\n\n")) !== -1) {
      const raw = this.buf.slice(0, sep);
      this.buf = this.buf.slice(sep + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith(":")) continue; // heartbeat / comment
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue; // comment-only block
      let data: unknown = dataLines.join("\n");
      try {
        data = JSON.parse(data as string);
      } catch {
        /* leave as string */
      }
      frames.push({ event, data });
    }
    return frames;
  }
}
