import "server-only";
import { notFound } from "next/navigation";
import { getLoadTest, type LoadTest } from "./store";

export function requireLoadTest(id: string): LoadTest {
  const test = getLoadTest(id);
  if (!test) notFound();
  return test;
}
