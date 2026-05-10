export type ApprovalValueCandidate = {
  id?: string;
  parameter?: string | null;
  value?: string | null;
  is_auto_calculated?: boolean;
};

const PLACEHOLDER_TOKENS = new Set([
  "-",
  "--",
  "---",
  "—",
  "na",
  "n/a",
  "n.a.",
  "null",
  "nil",
]);

export function normalizeApprovalValue(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

export function isValueBlockedForApproval(value: string | null | undefined): boolean {
  const normalized = normalizeApprovalValue(value);
  if (!normalized) return true;

  return PLACEHOLDER_TOKENS.has(normalized.toLowerCase());
}

export function getBlockedApprovalCandidates<T extends ApprovalValueCandidate>(items: T[]): T[] {
  return items.filter((item) => isValueBlockedForApproval(item.value));
}

export function buildBlockedApprovalMessage(
  scopeLabel: string,
  items: ApprovalValueCandidate[],
): string {
  const preview = items
    .slice(0, 6)
    .map((item) => {
      const name = item.parameter?.trim() || "Unnamed parameter";
      return item.is_auto_calculated ? `${name} (calculated)` : name;
    })
    .join(", ");

  const extraCount = items.length > 6 ? ` and ${items.length - 6} more` : "";

  return `Cannot approve ${scopeLabel} because some result values are blank or placeholder-only (${preview}${extraCount}). Please enter valid values first${items.some((item) => item.is_auto_calculated) ? " and recalculate calculated parameters where needed" : ""}.`;
}
