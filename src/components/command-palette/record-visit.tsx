"use client";
import { useEffect } from "react";
import { recordVisit } from "@/lib/command-palette/recent";

export function RecordVisit({ connectionId }: { connectionId: string }) {
  useEffect(() => { recordVisit(connectionId); }, [connectionId]);
  return null;
}
