import { supabase } from "@/lib/supabase";
import { UNIVERSE, UNIVERSE_TICKERS } from "@/lib/universe";

// ── Types ────────────────────────────────────────────────────────────────────

type ModelCaller = (system: string, user: string) => Promise<string>;

interface Holding {
  ticker: string;
  shares: number;
  avg_cost: number;
}

interface DailyPriceRow {
  ticker: string;
  date: string; // YYYY-MM-DD
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
  change_pct: number | null;
}

interface TradeInstruction {
  action: "buy" | "sell";
  ticker: string;
  shares: number;
  rationale: string;
}

interface ModelResponse {
  trades: TradeInstruction[];
  commentary: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getDateET(): string {
  const etStr = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  return new Date(etStr).toLocaleDateString("en-CA"); // YYYY-MM-DD
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)
    ),
  ]);
}

// ── Model dispatch ────────────────────────────────────────────────────────────

async function getModelCaller(slug: string): Promise<ModelCaller> {
  const map: Record<string, () => Promise<{ callModel: (prompt: string) => Promise<string> }>> = {
    claude:   () => import("@/lib/models/claude"),
    gpt:      () => import("@/lib/models/gpt"),
    gemini:   () => import("@/lib/models/gemini"),
    grok:     () => import("@/lib/models/grok"),
    deepseek: () => import("@/lib/models/deepseek"),
    llama:    () => import("@/lib/models/llama"),
    qwen:     () => import("@/lib/models/qwen"),
  };
  const loader = map[slug.toLowerCase()];
  if (!loader) throw new Error(`Unknown model slug: ${slug}`);
  const mod = await loader();
  return (system: string, user: string) => mod.callModel(`${system}\n\n${user}`);
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildUniverseBlock(): string {
  return UNIVERSE.map((u) => `${u.ticker.padEnd(6)} | ${u.name.padEnd(30)} | ${u.sector}`).join("\n");
}

function formatDailyContext(priceRows: DailyPriceRow[]): string {
  const byTicker = new Map<string, DailyPriceRow[]>();
  for (const row of priceRows) {
    const arr = byTicker.get(row.ticker) ?? [];
    arr.push(row);
    byTicker.set(row.ticker, arr);
  }

  const lines: string[] = ["DAILY CLOSES (last 5 sessions, newest first):"];
  lines.push("Ticker | " + Array.from({ length: 5 }, (_, i) => `Day-${i + 1}`).join(" | "));

  for (const ticker of UNIVERSE_TICKERS) {
    const rows = (byTicker.get(ticker) ?? [])
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5);
    if (rows.length === 0) continue;
    const closes = rows.map((r) => `$${r.close.toFixed(2)}`).join(" | ");
    lines.push(`${ticker.padEnd(6)} | ${closes}`);
  }

  return lines.join("\n");
}

function buildPrompt(params: {
  modelName: string;
  session: "morning" | "afternoon";
  dateET: string;
  holdings: Holding[];
  cash: number;
  totalValue: number;
  priceRows: DailyPriceRow[];
  latestCloseMap: Map<string, number>;
}): { system: string; user: string } {
  const { modelName, session, dateET, holdings, cash, totalValue, priceRows, latestCloseMap } = params;

  const holdingsBlock =
    holdings.length === 0
      ? "  (no positions — fully in cash)"
      : holdings
          .map((h) => {
            const price = latestCloseMap.get(h.ticker) ?? h.avg_cost;
            const unrealizedPnl = (price - h.avg_cost) * h.shares;
            const sign = unrealizedPnl >= 0 ? "+" : "";
            return `  ${h.ticker.padEnd(6)} | ${h.shares} shares | avg $${h.avg_cost.toFixed(2)} | now $${price.toFixed(2)} | P&L: ${sign}$${unrealizedPnl.toFixed(2)}`;
          })
          .join("\n");

  const system =
    `You are ${modelName} competing in a live AI stock trading competition. You started with $100,000.\n\n` +
    `COMPETITION RULES:\n` +
    `- You trade twice daily: morning session (9:45am ET) and afternoon session (3:45pm ET)\n` +
    `- You may hold positions overnight\n` +
    `- Maximum 25% of portfolio in any single stock\n` +
    `- You can hold cash — no requirement to be fully invested\n` +
    `- Your goal is to maximize total portfolio value over the competition period\n\n` +
    `UNIVERSE: You may only trade tickers from this list:\n` +
    buildUniverseBlock() +
    "\n\n" +
    `Respond ONLY with valid JSON matching the exact schema specified. No markdown, no preamble, no explanation outside the JSON.`;

  const user =
    `YOUR CURRENT STATE:\n` +
    `Cash:              $${cash.toFixed(2)}\n` +
    `Total value:       $${totalValue.toFixed(2)}\n` +
    `Holdings:\n${holdingsBlock}\n\n` +
    `MARKET CONTEXT:\n` +
    formatDailyContext(priceRows) +
    `\n\nSESSION: ${session}, ${dateET}\n\n` +
    `REQUIRED RESPONSE FORMAT (JSON only, no markdown):\n` +
    `{\n` +
    `  "trades": [\n` +
    `    { "action": "buy", "ticker": "AAPL", "shares": 10, "rationale": "..." },\n` +
    `    { "action": "sell", "ticker": "MSFT", "shares": 5, "rationale": "..." }\n` +
    `  ],\n` +
    `  "commentary": "One sentence about overall strategy this session."\n` +
    `}\n` +
    `trades may be empty if you wish to hold. action must be "buy" or "sell" (lowercase).`;

  return { system, user };
}

// ── Response parsing ──────────────────────────────────────────────────────────

function parseResponse(raw: string): ModelResponse {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first === -1 || last === -1) throw new Error("No JSON object found in response");
  const parsed = JSON.parse(cleaned.slice(first, last + 1));
  if (!Array.isArray(parsed.trades)) throw new Error("Missing 'trades' array");
  return parsed as ModelResponse;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function runTrades(session: "morning" | "afternoon"): Promise<{
  success: boolean;
  session: string;
  date: string;
  summary: { model: string; success: boolean; trades: number; error?: string }[];
}> {
  const dateET = getDateET();

  console.log(`\n${"═".repeat(50)}`);
  console.log(` QuantDrift Execute-Trades — ${session} — ${dateET}`);
  console.log(`${"═".repeat(50)}\n`);

  // ── 1. Load models (no active filter — old schema has no active column) ───
  const { data: models, error: modelsErr } = await supabase
    .from("models")
    .select("id, name, slug");

  if (modelsErr) throw new Error(`Models fetch failed: ${modelsErr.message}`);
  if (!models?.length) throw new Error("No models found");

  // ── 2. Fetch market data from daily_prices (old schema, has real data) ────
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data: priceData, error: pricesErr } = await supabase
    .from("daily_prices")
    .select("ticker, date, open, high, low, close, volume, change_pct")
    .in("ticker", UNIVERSE_TICKERS)
    .gte("date", sevenDaysAgo)
    .order("ticker")
    .order("date", { ascending: true });

  if (pricesErr) {
    console.error("[execute-trades] daily_prices fetch failed:", pricesErr.message);
  }

  const allPriceRows: DailyPriceRow[] = (priceData ?? []) as DailyPriceRow[];

  // Latest close per ticker (rows asc by date → last write wins)
  const latestCloseMap = new Map<string, number>();
  for (const r of allPriceRows) {
    latestCloseMap.set(r.ticker, r.close);
  }

  // ── 3. Process each model ────────────────────────────────────────────────
  const summary: { model: string; success: boolean; trades: number; error?: string }[] = [];
  const universeMap = new Map(UNIVERSE.map((u) => [u.ticker, u]));
  const universeSet = new Set(UNIVERSE_TICKERS);

  for (const model of models) {
    console.log(`\n${"─".repeat(40)}`);
    console.log(` ${model.name} (${model.slug})`);
    console.log(`${"─".repeat(40)}`);

    const nowIso = new Date().toISOString();
    let promptText = "";
    let responseText = "";

    try {
      // Holdings from portfolios (old schema, keyed by model uuid)
      const { data: holdingRows, error: holdErr } = await supabase
        .from("portfolios")
        .select("ticker, shares, avg_cost")
        .eq("model_id", model.id);

      if (holdErr) throw new Error(`Holdings fetch failed: ${holdErr.message}`);

      const holdings: Holding[] = (holdingRows ?? []).map((h) => ({
        ticker: h.ticker,
        shares: h.shares,
        avg_cost: h.avg_cost,
      }));

      // Cash from model_accounts (new schema, keyed by model_slug)
      const { data: accountRow } = await supabase
        .from("model_accounts")
        .select("cash")
        .eq("model_slug", model.slug)
        .single();

      // Fall back to cost-basis calculation when account row is missing
      const totalCostBasis = holdings.reduce((s, h) => s + h.shares * h.avg_cost, 0);
      const cash = accountRow?.cash ?? 100_000 - totalCostBasis;

      const equityValue = holdings.reduce((s, h) => {
        const price = latestCloseMap.get(h.ticker) ?? h.avg_cost;
        return s + h.shares * price;
      }, 0);
      const totalValue = cash + equityValue;

      console.log(
        `[${model.slug}] Cash: $${cash.toFixed(2)} | Equity: $${equityValue.toFixed(2)} | Total: $${totalValue.toFixed(2)}`
      );

      // Build + call model
      const { system, user } = buildPrompt({
        modelName: model.name,
        session,
        dateET,
        holdings,
        cash,
        totalValue,
        priceRows: allPriceRows,
        latestCloseMap,
      });

      promptText = `SYSTEM:\n${system}\n\nUSER:\n${user}`;
      const caller = await getModelCaller(model.slug);
      responseText = await withTimeout(caller(system, user), 60_000);
      console.log(`[${model.slug}] Response (${responseText.length} chars)`);

      // Parse response
      let parsed: ModelResponse;
      try {
        parsed = parseResponse(responseText);
      } catch (e) {
        throw new Error(`Parse failed: ${e instanceof Error ? e.message : String(e)}`);
      }

      // Validate & execute trades
      const holdingsMap = new Map(holdings.map((h) => [h.ticker, { ...h }]));
      let cashRemaining = cash;
      let tradesExecuted = 0;

      for (const trade of parsed.trades) {
        const { action, ticker, shares, rationale } = trade;

        if (!["buy", "sell"].includes(action)) {
          console.warn(`[${model.slug}] Invalid action "${action}" — skipped`);
          continue;
        }
        if (!universeSet.has(ticker)) {
          console.warn(`[${model.slug}] "${ticker}" not in universe — skipped`);
          continue;
        }
        if (typeof shares !== "number" || shares <= 0 || !Number.isFinite(shares)) {
          console.warn(`[${model.slug}] Invalid share count ${shares} for ${ticker} — skipped`);
          continue;
        }

        const price = latestCloseMap.get(ticker);
        if (!price) {
          console.warn(`[${model.slug}] No price data for ${ticker} — skipped`);
          continue;
        }

        const u = universeMap.get(ticker);

        if (action === "sell") {
          const held = holdingsMap.get(ticker);
          if (!held || held.shares < shares) {
            console.warn(
              `[${model.slug}] Cannot sell ${shares} ${ticker} — only ${held?.shares ?? 0} held`
            );
            continue;
          }

          const newShares = held.shares - shares;

          if (newShares === 0) {
            await supabase.from("portfolios").delete().eq("model_id", model.id).eq("ticker", ticker);
            await supabase.from("holdings").delete().eq("model_slug", model.slug).eq("ticker", ticker);
            holdingsMap.delete(ticker);
          } else {
            await supabase
              .from("portfolios")
              .update({ shares: newShares })
              .eq("model_id", model.id)
              .eq("ticker", ticker);
            await supabase
              .from("holdings")
              .update({ shares: newShares })
              .eq("model_slug", model.slug)
              .eq("ticker", ticker);
            held.shares = newShares;
          }

          cashRemaining += shares * price;
          tradesExecuted++;
          console.log(`[${model.slug}] SELL ${shares} ${ticker} @ $${price.toFixed(2)}`);
        } else if (action === "buy") {
          const cost = shares * price;
          if (cost > cashRemaining) {
            console.warn(
              `[${model.slug}] Insufficient cash — need $${cost.toFixed(2)}, have $${cashRemaining.toFixed(2)}`
            );
            continue;
          }

          const existingShares = holdingsMap.get(ticker)?.shares ?? 0;
          if ((existingShares + shares) * price > totalValue * 0.25) {
            console.warn(`[${model.slug}] ${ticker} would exceed 25% limit — skipped`);
            continue;
          }

          const existing = holdingsMap.get(ticker);
          if (existing) {
            const totalShares = existing.shares + shares;
            const newAvgCost =
              (existing.shares * existing.avg_cost + shares * price) / totalShares;

            await supabase
              .from("portfolios")
              .update({ shares: totalShares, avg_cost: newAvgCost })
              .eq("model_id", model.id)
              .eq("ticker", ticker);
            await supabase
              .from("holdings")
              .update({ shares: totalShares, avg_cost: newAvgCost })
              .eq("model_slug", model.slug)
              .eq("ticker", ticker);

            existing.shares = totalShares;
            existing.avg_cost = newAvgCost;
          } else {
            const sector = u?.sector ?? "Other";

            await supabase
              .from("portfolios")
              .insert({ model_id: model.id, ticker, shares, avg_cost: price });
            await supabase
              .from("holdings")
              .insert({ model_slug: model.slug, ticker, shares, avg_cost: price, sector });

            holdingsMap.set(ticker, { ticker, shares, avg_cost: price });
          }

          cashRemaining -= cost;
          tradesExecuted++;
          console.log(`[${model.slug}] BUY ${shares} ${ticker} @ $${price.toFixed(2)}`);
        }

        // Log to trade_log (old schema)
        await supabase.from("trade_log").insert({
          model_id: model.id,
          phase: session === "morning" ? 1 : 2,
          action: action.toUpperCase(),
          ticker,
          shares,
          price,
          reasoning: rationale ?? null,
          full_prompt: promptText,
          full_response: responseText,
          timestamp: nowIso,
        });
      }

      // Update model_accounts cash balance
      await supabase
        .from("model_accounts")
        .upsert({ model_slug: model.slug, cash: cashRemaining }, { onConflict: "model_slug" });

      // Portfolio snapshot after this session
      const finalEquity = Array.from(holdingsMap.values()).reduce((s, h) => {
        const price = latestCloseMap.get(h.ticker) ?? h.avg_cost;
        return s + h.shares * price;
      }, 0);
      await supabase.from("portfolio_snapshots").insert({
        model_slug: model.slug,
        timestamp: nowIso,
        total_value: cashRemaining + finalEquity,
        cash: cashRemaining,
        invested: finalEquity,
      });

      // Activity feed entry
      await supabase.from("activity_feed").insert({
        model_slug: model.slug,
        ts: nowIso,
        session,
        message: parsed.commentary ?? null,
        trades_json: parsed.trades,
      });

      console.log(`[${model.slug}] Done — ${tradesExecuted} trade(s) executed`);
      summary.push({ model: model.name, success: true, trades: tradesExecuted });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[${model.slug}] ERROR: ${message}`);

      await supabase.from("trade_log").insert({
        model_id: model.id,
        phase: session === "morning" ? 1 : 2,
        action: "ERROR",
        ticker: null,
        shares: null,
        price: null,
        reasoning: message,
        full_prompt: promptText,
        full_response: responseText,
        timestamp: new Date().toISOString(),
      });

      summary.push({ model: model.name, success: false, trades: 0, error: message });
    }
  }

  console.log(`\n${"═".repeat(50)}`);
  console.log(` Execute-Trades Complete`);
  console.log(`${"═".repeat(50)}\n`);

  return { success: true, session, date: dateET, summary };
}
