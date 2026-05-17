// No-op stub for Next.js's `server-only` package, used by vitest only.
// At runtime, Next bundles the real `server-only` module which throws if
// imported from a client component. In tests, every module runs in Node,
// so we resolve it to this empty file via the vitest config alias.
export {};
