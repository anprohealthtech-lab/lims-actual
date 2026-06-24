export type CalculationResultType = 'numeric' | 'text';

export interface TextCalculationRule {
  when?: string;
  value?: string;
  result?: string;
}

export interface TextCalculationOutcome {
  success: boolean;
  value: string;
  error?: string;
}

export const normalizeCalculationResultType = (value: unknown): CalculationResultType => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'text' || normalized === 'rule_based_text' ? 'text' : 'numeric';
};

export const isTextCalculation = (value: unknown): boolean =>
  normalizeCalculationResultType(value) === 'text';

const coerceRules = (formula: string): { rules: TextCalculationRule[]; defaultValue: string } | null => {
  const trimmed = formula.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return { rules: parsed, defaultValue: '' };
    }
    if (parsed && typeof parsed === 'object') {
      const rules = Array.isArray(parsed.rules) ? parsed.rules : [];
      const defaultValue =
        typeof parsed.default === 'string'
          ? parsed.default
          : typeof parsed.defaultValue === 'string'
            ? parsed.defaultValue
            : '';
      return { rules, defaultValue };
    }
  } catch {
    // JSON is the preferred format. A simple line format is accepted below
    // to make quick setup easier during lab configuration.
  }

  const rules = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [when, ...valueParts] = line.split(/\s*=>\s*/);
      return { when, value: valueParts.join('=>') };
    })
    .filter((rule) => rule.when && rule.value);

  return rules.length > 0 ? { rules, defaultValue: '' } : null;
};

const resolveCondition = (condition: string, scope: Record<string, number>): string | null => {
  let resolved = condition
    .replace(/\bAND\b/gi, '&&')
    .replace(/\bOR\b/gi, '||')
    .replace(/\bNOT\b/gi, '!');

  const tokens = resolved.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) || [];
  for (const token of tokens) {
    const value =
      scope[token] ??
      scope[token.toUpperCase()] ??
      scope[token.toLowerCase()];

    if (value === undefined || !Number.isFinite(value)) {
      return null;
    }

    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    resolved = resolved.replace(new RegExp(`\\b${escaped}\\b`, 'g'), String(value));
  }

  if (!/^[0-9+\-*/().\s<>=!&|]+$/.test(resolved)) {
    return null;
  }

  return resolved;
};

const evaluateCondition = (condition: string, scope: Record<string, number>): boolean | null => {
  const resolved = resolveCondition(condition, scope);
  if (!resolved) return null;

  try {
    // eslint-disable-next-line no-new-func
    return Boolean(Function(`"use strict"; return (${resolved});`)());
  } catch {
    return null;
  }
};

export const evaluateTextCalculation = (
  formula: string,
  scope: Record<string, number>,
): TextCalculationOutcome => {
  const parsed = coerceRules(formula);
  if (!parsed) {
    return { success: false, value: '', error: 'Text calculation rules must be valid JSON or condition => value lines' };
  }

  for (const rule of parsed.rules) {
    const condition = String(rule.when || '').trim();
    const value = typeof rule.value === 'string' ? rule.value : rule.result;
    if (!condition || typeof value !== 'string') continue;

    const matched = evaluateCondition(condition, scope);
    if (matched === true) {
      return { success: true, value };
    }
    if (matched === null) {
      return { success: false, value: '', error: `Could not evaluate condition: ${condition}` };
    }
  }

  return parsed.defaultValue
    ? { success: true, value: parsed.defaultValue }
    : { success: false, value: '', error: 'No text calculation rule matched' };
};
