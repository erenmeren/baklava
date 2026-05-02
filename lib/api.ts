/**
 * Helpers shared by Next.js API routes. Wraps every handler with:
 *   - the CSRF / DNS-rebinding security gate
 *   - structured BaklavaError responses
 *   - JSON envelope so the frontend always gets the same shape
 */

import { NextResponse } from "next/server";
import { BaklavaException, isBaklavaError, makeError } from "./errors";
import { checkRequestSecurity } from "./security";

export const BAKLAVA_PORT = Number(process.env.BAKLAVA_PORT ?? process.env.PORT ?? 3000);

export interface ApiOk<T> {
  ok: true;
  data: T;
  meta: { api_version: "v1" };
}

export interface ApiErr {
  ok: false;
  error: {
    code: string;
    what: string;
    why: string;
    fix: string;
    docs: string;
    raw?: unknown;
  };
  meta: { api_version: "v1" };
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse<ApiOk<T>> {
  return NextResponse.json(
    { ok: true, data, meta: { api_version: "v1" as const } },
    init
  );
}

export function err(
  exception: BaklavaException | unknown,
  init?: ResponseInit
): NextResponse<ApiErr> {
  let payload;
  if (exception instanceof BaklavaException) {
    payload = exception.error;
  } else if (isBaklavaError(exception)) {
    payload = exception;
  } else {
    payload = makeError({
      code: "E_INTERNAL",
      what: "Unhandled error in API route.",
      why: (exception as Error).message ?? String(exception),
      fix: "Check the server logs.",
    });
  }
  return NextResponse.json(
    { ok: false as const, error: payload, meta: { api_version: "v1" as const } },
    { status: init?.status ?? 400 }
  );
}

/** Wrap a route handler with the security gate. */
export function secured<T>(
  handler: (req: Request) => Promise<NextResponse<T>>
): (req: Request) => Promise<NextResponse<T | ApiErr>> {
  return async (req: Request) => {
    const result = checkRequestSecurity({
      origin: req.headers.get("origin"),
      host: req.headers.get("host"),
      token: req.headers.get("x-baklava-token"),
      expectedPort: BAKLAVA_PORT,
    });
    if (!result.ok) {
      return err(
        new BaklavaException(
          makeError({
            code: result.code,
            what: "Request rejected by the security gate.",
            why: result.reason,
            fix:
              result.code === "E_CSRF_MISSING_TOKEN"
                ? "The browser frontend includes the token automatically. CLI scripts must read ~/.baklava/instance.key and send it as X-Baklava-Token."
                : "baklava only accepts http://localhost:<port> traffic with a matching token.",
          })
        ),
        { status: 403 }
      );
    }
    try {
      return await handler(req);
    } catch (e) {
      return err(e, { status: 400 });
    }
  };
}
