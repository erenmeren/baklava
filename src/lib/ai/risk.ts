export type RiskLevel = "low" | "medium" | "high";

export interface RiskAssessment {
  level: RiskLevel;
  reasons: string[];
}

function argStrings(args: unknown): string[] {
  if (!args || typeof args !== "object") return [];
  return Object.values(args as Record<string, unknown>).filter(
    (v): v is string => typeof v === "string",
  );
}

export function scoreAction(
  toolName: string,
  category: "read" | "write" | "destructive",
  args: unknown,
): RiskAssessment {
  if (category === "read") return { level: "low", reasons: [] };

  if (category === "write") {
    return { level: "medium", reasons: [`Write action (${toolName})`] };
  }

  // destructive
  const reasons: string[] = [`Destructive operation (${toolName})`];
  const strings = argStrings(args);

  for (const s of strings) {
    if (/\b(delete|update)\b/i.test(s) && !/\bwhere\b/i.test(s)) {
      reasons.push("SQL statement has no WHERE clause — affects all rows");
      break;
    }
  }
  if (strings.some((s) => s === "*" || s.includes("*"))) {
    reasons.push("Argument contains a wildcard (*) — may match many objects");
  }

  return { level: "high", reasons };
}
