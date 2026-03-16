/**
 * bulk-update-tests.ts
 *
 * Bulk update test group prices/names or analyte display names / units
 * from an Excel file, using fuzzy (trigram) matching to find the right rows.
 *
 * Usage:
 *   npx ts-node scripts/bulk-update-tests.ts \
 *     --lab=<lab_uuid>           required
 *     --file=<path.xlsx|.csv>    required
 *     --mode=tests               'tests' (default) or 'analytes'
 *     --threshold=0.4            min similarity score 0-1 (default 0.4)
 *     --dry-run                  preview only, do not write to DB
 *
 * ── Excel column names ───────────────────────────────────────
 *
 * MODE = tests  (updates test_groups table)
 *   name              (required) – test name to fuzzy-match
 *   price             new price
 *   collection_charge new collection charge
 *   turnaround_time   e.g. "24 hours"
 *   new_name          rename the test group (careful – global record)
 *
 * MODE = analytes  (updates lab_analytes table)
 *   name              (required) – analyte name to fuzzy-match
 *   display_name      lab-level display name shown in PDF
 *   unit              lab-specific unit override
 *   reference_range   lab-specific reference range override
 *   reference_range_male
 *   reference_range_female
 * ─────────────────────────────────────────────────────────────
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";
import * as dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

// ── Config ────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || "https://api.limsapp.in";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!SUPABASE_SERVICE_KEY) {
  console.error("❌  SUPABASE_SERVICE_ROLE_KEY is not set in environment.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── CLI arg parsing ───────────────────────────────────────────
function getArg(name: string): string | undefined {
  const flag = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(flag));
  return arg ? arg.slice(flag.length) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const LAB_ID    = getArg("lab");
const FILE_PATH = getArg("file");
const MODE      = (getArg("mode") || "tests") as "tests" | "analytes";
const THRESHOLD = parseFloat(getArg("threshold") || "0.4");
const DRY_RUN   = hasFlag("dry-run");

if (!LAB_ID) { console.error("❌  --lab=<uuid> is required"); process.exit(1); }
if (!FILE_PATH) { console.error("❌  --file=<path> is required"); process.exit(1); }
if (!fs.existsSync(FILE_PATH)) { console.error(`❌  File not found: ${FILE_PATH}`); process.exit(1); }
if (MODE !== "tests" && MODE !== "analytes") {
  console.error("❌  --mode must be 'tests' or 'analytes'");
  process.exit(1);
}

// ── Colours ───────────────────────────────────────────────────
const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  red:    "\x1b[31m",
  cyan:   "\x1b[36m",
  grey:   "\x1b[90m",
  white:  "\x1b[37m",
};

function scoreColor(score: number): string {
  if (score >= 0.7) return C.green;
  if (score >= 0.4) return C.yellow;
  return C.red;
}

// ── Excel reader ──────────────────────────────────────────────
function readExcel(filePath: string): Record<string, any>[] {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, {
    defval: null,
    raw: false,       // convert numbers to strings so we can trim
  });
  // Normalise header keys: lowercase + trim
  return rows.map((row) => {
    const normalised: Record<string, any> = {};
    for (const [k, v] of Object.entries(row)) {
      normalised[k.trim().toLowerCase().replace(/\s+/g, "_")] =
        typeof v === "string" ? v.trim() : v;
    }
    return normalised;
  });
}

// ── Confirm prompt ────────────────────────────────────────────
async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`\n${C.bold}${question}${C.reset} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

// ── Pretty preview table ──────────────────────────────────────
function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] || "").replace(/\x1b\[[0-9;]*m/g, "").length))
  );
  const line = widths.map((w) => "─".repeat(w + 2)).join("┼");
  const fmt = (row: string[]) =>
    row.map((cell, i) => {
      const plain = (cell || "").replace(/\x1b\[[0-9;]*m/g, "");
      const pad = widths[i] - plain.length;
      return ` ${cell}${" ".repeat(pad)} `;
    }).join("│");

  console.log(`┌${line.replace(/┼/g, "┬")}┐`);
  console.log(`│${fmt(headers.map((h) => C.bold + h + C.reset))}│`);
  console.log(`├${line}┤`);
  for (const row of rows) {
    console.log(`│${fmt(row)}│`);
  }
  console.log(`└${line.replace(/┼/g, "┴")}┘`);
}

// ── TESTS mode ────────────────────────────────────────────────
// Fields from Excel that map to test_groups columns
const TEST_UPDATABLE_FIELDS: Record<string, string> = {
  price:             "price",
  collection_charge: "collection_charge",
  turnaround_time:   "turnaround_time",
};

async function runTestsMode(rows: Record<string, any>[]): Promise<void> {
  console.log(`\n${C.cyan}${C.bold}📋  MODE: Test Groups${C.reset}`);
  console.log(`${C.grey}Lab: ${LAB_ID}  |  Rows: ${rows.length}  |  Threshold: ${THRESHOLD}${C.reset}\n`);

  if (!rows[0]?.name) {
    console.error(`❌  Excel must have a "name" column for test group matching.`);
    process.exit(1);
  }

  // Call fuzzy match RPC
  console.log("🔍  Running fuzzy match against your test groups…");
  const { data, error } = await supabase.rpc("bulk_match_test_groups", {
    p_lab_id: LAB_ID,
    p_rows:   rows,
  });

  if (error) {
    console.error("❌  RPC error:", error.message);
    process.exit(1);
  }

  const matched: Array<{
    inputRow: Record<string, any>;
    match: Record<string, any>;
    updates: Record<string, any>;
    confidence: "high" | "medium" | "low" | "none";
  }> = [];

  const skipped: Array<{ input: string; reason: string }> = [];

  for (const entry of data as any[]) {
    const inputRow: Record<string, any> = entry.input;
    const candidates: any[] = entry.candidates || [];
    const best = candidates[0];

    if (!best || best.score < THRESHOLD) {
      skipped.push({
        input: inputRow.name,
        reason: best ? `best score ${best.score} < threshold ${THRESHOLD}` : "no candidates",
      });
      continue;
    }

    // Collect which fields actually change
    const updates: Record<string, any> = {};
    if (inputRow.new_name && inputRow.new_name !== best.name) {
      updates.name = inputRow.new_name;
    }
    for (const [col, dbCol] of Object.entries(TEST_UPDATABLE_FIELDS)) {
      const val = inputRow[col];
      if (val !== null && val !== undefined && val !== "") {
        const parsed = (col === "price" || col === "collection_charge")
          ? parseFloat(val)
          : val;
        if (!isNaN(parsed as any) && parsed !== best[col]) {
          updates[dbCol] = parsed;
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      skipped.push({ input: inputRow.name, reason: "no fields to update" });
      continue;
    }

    matched.push({
      inputRow,
      match: best,
      updates,
      confidence: best.score >= 0.7 ? "high" : best.score >= 0.4 ? "medium" : "low",
    });
  }

  // Preview table
  const tableHeaders = ["#", "Input Name", "Matched Name", "Score", "Conf", "Changes"];
  const tableRows = matched.map((m, i) => {
    const sc = scoreColor(m.match.score);
    const confLabel = m.confidence === "high" ? `${C.green}HIGH${C.reset}` :
                      m.confidence === "medium" ? `${C.yellow}MED${C.reset}` :
                      `${C.red}LOW${C.reset}`;
    const changeStr = Object.entries(m.updates)
      .map(([k, v]) => `${k}: ${C.grey}${m.match[k] ?? "—"}${C.reset} → ${C.green}${v}${C.reset}`)
      .join("  ");
    return [
      String(i + 1),
      m.inputRow.name,
      m.match.name,
      `${sc}${m.match.score}${C.reset}`,
      confLabel,
      changeStr,
    ];
  });

  if (tableRows.length === 0) {
    console.log(`${C.yellow}⚠  No rows matched above threshold.${C.reset}`);
  } else {
    printTable(tableHeaders, tableRows);
  }

  if (skipped.length > 0) {
    console.log(`\n${C.yellow}⚠  Skipped ${skipped.length} row(s):${C.reset}`);
    skipped.forEach((s) => console.log(`   ${C.grey}• "${s.input}" — ${s.reason}${C.reset}`));
  }

  if (matched.length === 0 || DRY_RUN) {
    if (DRY_RUN) console.log(`\n${C.yellow}🔍  Dry-run mode — no changes written.${C.reset}`);
    return;
  }

  const ok = await confirm(`Apply ${matched.length} update(s) to test_groups?`);
  if (!ok) { console.log("Aborted."); return; }

  // Apply updates
  let successCount = 0;
  let failCount = 0;
  for (const m of matched) {
    const { error: upErr } = await supabase
      .from("test_groups")
      .update({ ...m.updates, updated_at: new Date().toISOString() })
      .eq("id", m.match.id);

    if (upErr) {
      console.error(`  ❌  "${m.match.name}" — ${upErr.message}`);
      failCount++;
    } else {
      console.log(`  ${C.green}✓${C.reset}  "${m.match.name}"`);
      successCount++;
    }
  }

  console.log(`\n${C.bold}Done. ✅ ${successCount} updated  ❌ ${failCount} failed${C.reset}`);
}

// ── ANALYTES mode ─────────────────────────────────────────────
// Excel col → lab_analytes column
const ANALYTE_UPDATABLE_FIELDS: Record<string, string> = {
  display_name:            "display_name",
  unit:                    "lab_specific_unit",
  reference_range:         "lab_specific_reference_range",
  reference_range_male:    "reference_range_male",
  reference_range_female:  "reference_range_female",
};

async function runAnalytesMode(rows: Record<string, any>[]): Promise<void> {
  console.log(`\n${C.cyan}${C.bold}🧪  MODE: Analytes (lab_analytes)${C.reset}`);
  console.log(`${C.grey}Lab: ${LAB_ID}  |  Rows: ${rows.length}  |  Threshold: ${THRESHOLD}${C.reset}\n`);

  if (!rows[0]?.name) {
    console.error(`❌  Excel must have a "name" column for analyte matching.`);
    process.exit(1);
  }

  console.log("🔍  Running fuzzy match against your analytes…");
  const { data, error } = await supabase.rpc("bulk_match_analytes", {
    p_lab_id: LAB_ID,
    p_rows:   rows,
  });

  if (error) {
    console.error("❌  RPC error:", error.message);
    process.exit(1);
  }

  const matched: Array<{
    inputRow: Record<string, any>;
    match: Record<string, any>;
    updates: Record<string, any>;
    confidence: "high" | "medium" | "low" | "none";
  }> = [];

  const skipped: Array<{ input: string; reason: string }> = [];

  for (const entry of data as any[]) {
    const inputRow: Record<string, any> = entry.input;
    const candidates: any[] = entry.candidates || [];
    const best = candidates[0];

    if (!best || best.score < THRESHOLD) {
      skipped.push({
        input: inputRow.name,
        reason: best ? `best score ${best.score} < threshold ${THRESHOLD}` : "no candidates",
      });
      continue;
    }

    const updates: Record<string, any> = {};
    for (const [col, dbCol] of Object.entries(ANALYTE_UPDATABLE_FIELDS)) {
      const val = inputRow[col];
      if (val !== null && val !== undefined && val !== "") {
        updates[dbCol] = val;
      }
    }

    if (Object.keys(updates).length === 0) {
      skipped.push({ input: inputRow.name, reason: "no fields to update" });
      continue;
    }

    matched.push({
      inputRow,
      match: best,
      updates,
      confidence: best.score >= 0.7 ? "high" : best.score >= 0.4 ? "medium" : "low",
    });
  }

  const tableHeaders = ["#", "Input Name", "Matched Analyte", "Score", "Conf", "Changes"];
  const tableRows = matched.map((m, i) => {
    const sc = scoreColor(m.match.score);
    const confLabel = m.confidence === "high" ? `${C.green}HIGH${C.reset}` :
                      m.confidence === "medium" ? `${C.yellow}MED${C.reset}` :
                      `${C.red}LOW${C.reset}`;
    const changeStr = Object.entries(m.updates)
      .map(([k, v]) => `${k}: → ${C.green}${v}${C.reset}`)
      .join("  ");
    return [
      String(i + 1),
      m.inputRow.name,
      m.match.analyte_name,
      `${sc}${m.match.score}${C.reset}`,
      confLabel,
      changeStr,
    ];
  });

  if (tableRows.length === 0) {
    console.log(`${C.yellow}⚠  No rows matched above threshold.${C.reset}`);
  } else {
    printTable(tableHeaders, tableRows);
  }

  if (skipped.length > 0) {
    console.log(`\n${C.yellow}⚠  Skipped ${skipped.length} row(s):${C.reset}`);
    skipped.forEach((s) => console.log(`   ${C.grey}• "${s.input}" — ${s.reason}${C.reset}`));
  }

  if (matched.length === 0 || DRY_RUN) {
    if (DRY_RUN) console.log(`\n${C.yellow}🔍  Dry-run mode — no changes written.${C.reset}`);
    return;
  }

  const ok = await confirm(`Apply ${matched.length} update(s) to lab_analytes?`);
  if (!ok) { console.log("Aborted."); return; }

  let successCount = 0;
  let failCount = 0;
  for (const m of matched) {
    const { error: upErr } = await supabase
      .from("lab_analytes")
      .update(m.updates)
      .eq("lab_id", LAB_ID)
      .eq("analyte_id", m.match.analyte_id);

    if (upErr) {
      console.error(`  ❌  "${m.match.analyte_name}" — ${upErr.message}`);
      failCount++;
    } else {
      console.log(`  ${C.green}✓${C.reset}  "${m.match.analyte_name}"`);
      successCount++;
    }
  }

  console.log(`\n${C.bold}Done. ✅ ${successCount} updated  ❌ ${failCount} failed${C.reset}`);
}

// ── Entry point ───────────────────────────────────────────────
async function main(): Promise<void> {
  console.log(`\n${C.bold}${C.cyan}═══ Bulk Update Tool ═══${C.reset}`);
  if (DRY_RUN) console.log(`${C.yellow}  ⚡ DRY RUN — no changes will be written${C.reset}`);

  const rows = readExcel(FILE_PATH!);
  console.log(`📂  Loaded ${rows.length} row(s) from ${path.basename(FILE_PATH!)}`);

  if (rows.length === 0) {
    console.error("❌  Excel file has no rows.");
    process.exit(1);
  }

  if (MODE === "tests") {
    await runTestsMode(rows);
  } else {
    await runAnalytesMode(rows);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
