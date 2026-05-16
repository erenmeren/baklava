// Minimal ambient declarations for the `better-sqlite3` package. The published
// package ships no .d.ts, and we don't pull @types/better-sqlite3 here.
// Only the surface area used by src/lib/connections/sqlite.ts is covered.

declare module "better-sqlite3" {
  namespace Database {
    interface Options {
      readonly?: boolean;
      fileMustExist?: boolean;
      timeout?: number;
      verbose?: ((message?: unknown, ...optional: unknown[]) => void) | null;
    }

    interface Statement<P extends unknown[] = unknown[]> {
      run(...params: P): { changes: number; lastInsertRowid: number | bigint };
      get(...params: P): unknown;
      all(...params: P): unknown[];
      iterate(...params: P): IterableIterator<unknown>;
      pluck(toggle?: boolean): this;
      expand(toggle?: boolean): this;
      raw(toggle?: boolean): this;
      readonly source: string;
    }

    interface Database {
      readonly open: boolean;
      readonly inTransaction: boolean;
      readonly name: string;
      readonly memory: boolean;
      readonly readonly: boolean;
      prepare<P extends unknown[] = unknown[]>(source: string): Statement<P>;
      exec(source: string): this;
      transaction<T extends (...args: unknown[]) => unknown>(fn: T): T;
      pragma(source: string, options?: { simple?: boolean }): unknown;
      close(): this;
    }
  }

  interface DatabaseConstructor {
    new (filename: string, options?: Database.Options): Database.Database;
    (filename: string, options?: Database.Options): Database.Database;
  }

  const Database: DatabaseConstructor;
  export = Database;
}
