import "server-only";
import { notFound } from "next/navigation";
import { getConnection } from "./store";
import type { ConnectionRecord, TechId } from "./types";

export function requireConnection<C>(
  id: string,
  tech: TechId
): ConnectionRecord<C> {
  const record = getConnection(id);
  if (!record || record.tech !== tech) {
    notFound();
  }
  return record as ConnectionRecord<C>;
}
