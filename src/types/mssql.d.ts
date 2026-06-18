// Minimal ambient declarations for the `mssql` package. The published package
// ships no .d.ts, and there is no @types/mssql for v12 at time of writing.
// Only the surface area used by src/lib/connections/sqlserver.ts is covered.

declare module "mssql" {
  export interface IOptions {
    encrypt?: boolean;
    trustServerCertificate?: boolean;
    [key: string]: unknown;
  }

  export interface ConnectionConfig {
    server: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    options?: IOptions;
    connectionTimeout?: number;
    requestTimeout?: number;
    [key: string]: unknown;
  }

  export interface IResult<T> {
    recordset: T[];
    recordsets: T[][];
    rowsAffected: number[];
    output: Record<string, unknown>;
  }

  export class Request {
    /** Enable row-by-row streaming via events instead of buffering recordsets. */
    stream: boolean;
    input(name: string, value: unknown): this;
    input(name: string, type: unknown, value: unknown): this;
    query<T = unknown>(command: string): Promise<IResult<T>>;
    batch<T = unknown>(command: string): Promise<IResult<T>>;
    /** Cancel an in-flight request. In stream mode the promise still resolves. */
    cancel(): boolean;
    pause(): boolean;
    resume(): boolean;
    on(
      event: "recordset",
      listener: (columns: Record<string, unknown>) => void
    ): this;
    on(event: "row", listener: (row: Record<string, unknown>) => void): this;
    on(event: "rowsaffected", listener: (count: number) => void): this;
    on(event: "info", listener: (info: { message?: string }) => void): this;
    on(
      event: "error",
      listener: (err: Error & { code?: string }) => void
    ): this;
    on(event: "done", listener: (result: IResult<unknown>) => void): this;
  }

  export class ConnectionPool {
    constructor(config: ConnectionConfig | string);
    connect(): Promise<ConnectionPool>;
    close(): Promise<void>;
    request(): Request;
    readonly connected: boolean;
  }

  export function connect(
    config: ConnectionConfig | string
  ): Promise<ConnectionPool>;

  export function close(): Promise<void>;

  const _default: {
    ConnectionPool: typeof ConnectionPool;
    Request: typeof Request;
    connect: typeof connect;
    close: typeof close;
  };
  export default _default;
}
