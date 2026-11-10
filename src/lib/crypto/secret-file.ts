import fs from "node:fs";
import path from "node:path";

// Older versions encrypted these files under a master key. That is gone, so
// such a file can't be read any more — but it must never be mistaken for an
// empty store and silently overwritten either.
export function isLegacyEncrypted(text: string): boolean {
  try {
    return (JSON.parse(text) as { magic?: unknown } | null)?.magic === "baklava-enc";
  } catch {
    return false;
  }
}

export function readSecretFileSync(file: string): string | null {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  if (isLegacyEncrypted(text)) {
    throw new Error(
      `${file} was encrypted by an older Baklava version and can't be read by this one. ` +
        "Move it aside to start fresh.",
    );
  }
  return text;
}

/** Atomic 0600 write: the file holds credentials in plain JSON. */
export function writeSecretFileSync(file: string, plaintext: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });

  // Never overwrite a file we cannot reproduce: keep a legacy encrypted one.
  // Only the read may be absent (ENOENT); a backup-write failure must NOT be
  // swallowed — let it throw so we never overwrite without having backed up.
  let existing: string | undefined;
  try {
    existing = fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const bak = `${file}.unreadable.bak`;
  if (existing !== undefined && isLegacyEncrypted(existing) && !fs.existsSync(bak)) {
    fs.writeFileSync(bak, existing, { mode: 0o600 });
  }

  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, plaintext, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
