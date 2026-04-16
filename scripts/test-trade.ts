/**
 * Test script: calls the daily-trade cron endpoint locally.
 * Run with: npx ts-node --project tsconfig.test.json scripts/test-trade.ts
 * Or:       npx tsx scripts/test-trade.ts
 */

import * as dotenv from "dotenv";
import * as path from "path";

// Load .env.local
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const CRON_SECRET = process.env.CRON_SECRET;

if (!CRON_SECRET) {
  console.error("ERROR: CRON_SECRET not set in .env.local");
  process.exit(1);
}

async function main() {
  const url = `${BASE_URL}/api/cron/daily-trade`;
  console.log(`\nCalling: ${url}`);
  console.log(`Auth: Bearer ${CRON_SECRET}\n`);

  const start = Date.now();
  let res: Response;

  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
  } catch (err) {
    console.error(
      "Failed to reach server. Is `npm run dev` running?\n",
      err instanceof Error ? err.message : err
    );
    process.exit(1);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const text = await res.text();

  console.log(`Status: ${res.status} (${elapsed}s)\n`);

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    console.log("Raw response:", text);
    process.exit(res.ok ? 0 : 1);
  }

  console.log("=== FULL RESPONSE ===");
  console.log(JSON.stringify(json, null, 2));

  const result = json as { success: boolean; summary?: Array<{ model_name: string; success: boolean; trades_executed: number; error?: string }> };

  if (result.summary) {
    console.log("\n=== SUMMARY ===");
    for (const m of result.summary) {
      const status = m.success ? "✓" : "✗";
      const detail = m.success
        ? `${m.trades_executed} trade(s)`
        : `ERROR: ${m.error}`;
      console.log(`  ${status} ${m.model_name}: ${detail}`);
    }
  }
}

main();
