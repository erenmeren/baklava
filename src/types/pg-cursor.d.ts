// Minimal ambient declarations for the `pg-cursor` package (no shipped types,
// no @types entry). Only the surface used by src/lib/connections/postgres.ts is
// covered: construct a cursor, read a bounded batch of rows, then close it.

declare module "pg-cursor" {
  interface CursorResult {
    fields: { name: string }[];
    rowCount: number | null;
    command: string;
  }

  export default class Cursor<R = unknown> {
    constructor(
      text: string,
      values?: unknown[],
      config?: { rowMode?: "array" }
    );
    /** Read up to `rowCount` rows. `result` carries fields / command metadata. */
    read(
      rowCount: number,
      cb: (err: Error | null, rows: R[], result: CursorResult) => void
    ): void;
    /** Close the portal (stops further server-side execution). */
    close(): Promise<void>;
    /** Submittable hook invoked by pg's Client.query(). */
    submit(connection: unknown): void;
  }
}
