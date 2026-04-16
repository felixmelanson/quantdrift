import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchEndOfDayPrices, PriceData } from "@/lib/prices";
import { fetchTopHeadlines } from "@/lib/news";
import { buildPrompt, ALLOWED_TICKERS, Holding, LeaderboardEntry } from "@/lib/buildPrompt";

// ── Model dispatch map ──────────────────────────────────────────────────────
type ModelCaller = (prompt: string) => Promise<string>;

async function getModelCaller(modelKey: string): Promise<ModelCaller> {
  const map: Record<string, () => Promise<{ callModel: ModelCaller }>> = {
    claude: () => import("@/lib/models/claude"),
    gpt: () => import("@/lib/models/gpt"),
    gemini: () => import("@/lib/models/gemini"),
    grok: () => import("@/lib/models/grok"),
    deepseek: () => import("@/lib/models/deepseek"),
    llama: () => import("@/lib/models/llama"),
    qwen: () => import("@/lib/models/qwen"),
  };
  const loader = map[modelKey.toLowerCase()];
  if (!loader) throw new Error(`Unknown model key: ${modelKey}`);
  const mod = await loader();
  return mod.callModel;
}

// ── Types ──────────────────────────────────────────────────────────────────
interface TradeDecision {
  action: "BUY" | "SELL" | "HOLD";
  ticker: string;
  shares: number;
  reasoning: string;
}

interface ModelResult {
  model_name: string;
  success: boolean;
  trades_executed: number;
  error?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)
    ),
  ]);
}

function stripMarkdownFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

function parseModelResponse(raw: string): TradeDecision[] {
  const cleaned = stripMarkdownFences(raw);
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed.decisions)) {
    throw new Error("Response missing 'decisions' array");
  }
  return parsed.decisions as TradeDecision[];
}

async function logTrade(params: {
  model_id: string;
  phase: number;
  action: string;
  ticker: string | null;
  shares: number | null;
  price: number | null;
  reasoning: string | null;
  full_prompt: string;
  full_response: string;
}) {
  console.log(`[log] trade_log phase value: ${params.phase} (type: ${typeof params.phase})`);
  const { error } = await supabase.from("trade_log").insert({
    model_id: params.model_id,
    phase: params.phase,
    action: params.action,
    ticker: params.ticker,
    shares: params.shares,
    price: params.price,
    reasoning: params.reasoning,
    full_prompt: params.full_prompt,
    full_response: params.full_response,
    timestamp: new Date().toISOString(),
  });
  if (error) console.error("[log] Failed to write trade_log:", error.message);
}

// ── Route handler ────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("\n══════════════════════════════════════════");
  console.log(" QuantDrift Daily Trade Execution Starting");
  console.log("══════════════════════════════════════════\n");

  try {
    // ── 1. Get active phase ──────────────────────────────────────────────
    const today = new Date().toISOString().split("T")[0];
    console.log(`[phase] Querying phase_config where start_date <= ${today}`);
    const { data: phaseRows, error: phaseErr } = await supabase
      .from("phase_config")
      .select("*")
      .lte("start_date", today)
      .order("start_date", { ascending: false })
      .limit(1);

    console.log("[phase] Raw query result:", JSON.stringify({ data: phaseRows, error: phaseErr }, null, 2));

    if (phaseErr) throw new Error(`Phase fetch failed: ${phaseErr.message}`);
    if (!phaseRows || phaseRows.length === 0) throw new Error("No active phase found");

    const phase = phaseRows[0];
    console.log(`[phase] Active: Phase ${phase.phase_number} — ${phase.system_prompt?.slice(0, 60)}`);

    // ── 2. Get active models ─────────────────────────────────────────────
    const { data: models, error: modelsErr } = await supabase
      .from("models")
      .select("*")
      .eq("active", true);

    if (modelsErr) throw new Error(`Models fetch failed: ${modelsErr.message}`);
    if (!models || models.length === 0) throw new Error("No active models found");

    console.log(`[models] Active: ${models.map((m: { name: string; slug: string }) => `${m.name} (${m.slug})`).join(", ")}`);

    // ── 3. Collect all tickers ───────────────────────────────────────────
    const { data: allHoldings } = await supabase
      .from("portfolios")
      .select("ticker")
      .in(
        "model_id",
        models.map((m: { id: string }) => m.id)
      );

    const heldTickers = new Set<string>(
      (allHoldings ?? []).map((h: { ticker: string }) => h.ticker)
    );
    const allTickers = Array.from(new Set(ALLOWED_TICKERS.concat(Array.from(heldTickers))));

    // ── 4. Fetch prices ──────────────────────────────────────────────────
    console.log("\n[prices] Fetching end-of-day prices...");
    const prices = await fetchEndOfDayPrices(allTickers);
    const priceMap = new Map<string, PriceData>(prices.map((p) => [p.ticker, p]));

    // ── 5. Fetch news (phase >= 2) ───────────────────────────────────────
    let news: string[] = [];
    if (phase.phase_number >= 2) {
      console.log("\n[news] Fetching headlines...");
      news = await fetchTopHeadlines(phase.phase_number >= 3);
    }

    // ── 6. Leaderboard (phase >= 4) ──────────────────────────────────────
    let leaderboard: LeaderboardEntry[] | undefined;
    if (phase.phase_number >= 4) {
      const { data: lb } = await supabase
        .from("leaderboard")
        .select("model_name, total_value, rank")
        .order("rank", { ascending: true });
      leaderboard = lb ?? undefined;
    }

    // ── 7. Process each model ─────────────────────────────────────────────
    const summary: ModelResult[] = [];

    for (const model of models) {
      console.log(`\n──────────────────────────────────────`);
      console.log(` Processing: ${model.name} (slug: ${model.slug})`);
      console.log(`──────────────────────────────────────`);

      let fullPromptText = "";
      let fullResponseText = "";

      try {
        // Fetch this model's portfolio
        const { data: holdingRows, error: holdErr } = await supabase
          .from("portfolios")
          .select("ticker, shares, avg_cost")
          .eq("model_id", model.id);

        if (holdErr) throw new Error(`Portfolio fetch failed: ${holdErr.message}`);

        const holdings: Holding[] = (holdingRows ?? []).map(
          (h: { ticker: string; shares: number; avg_cost: number }) => ({
            ticker: h.ticker,
            shares: h.shares,
            avg_cost: h.avg_cost,
          })
        );

        // Calculate available cash
        // Starting cash $100,000 minus total cost basis of all holdings
        const totalSpent = holdings.reduce(
          (sum, h) => sum + h.shares * h.avg_cost,
          0
        );
        const availableCash = 100_000 - totalSpent;

        console.log(
          `[${model.name}] Holdings: ${holdings.length} positions, Cash: $${availableCash.toFixed(2)}`
        );

        // Build prompt
        const { system, user } = buildPrompt({
          modelName: model.name,
          holdings,
          prices,
          news,
          phase: { phase: phase.phase_number, name: phase.system_prompt ?? "" },
          availableCash,
          leaderboard,
        });

        fullPromptText = `SYSTEM:\n${system}\n\nUSER:\n${user}`;

        // Call model with 45s timeout
        console.log(`[${model.name}] Calling model...`);
        const caller = await getModelCaller(model.slug);
        const combinedPrompt = `${system}\n\n${user}`;
        fullResponseText = await withTimeout(caller(combinedPrompt), 45_000);

        console.log(`[${model.name}] Response received (${fullResponseText.length} chars)`);

        // Parse decisions
        let decisions: TradeDecision[];
        try {
          decisions = parseModelResponse(fullResponseText);
        } catch (parseErr) {
          throw new Error(
            `JSON parse failed: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`
          );
        }

        // Validate and cap at 3 trades
        const validDecisions = decisions.slice(0, 3);
        let tradesExecuted = 0;
        const holdingsMap = new Map(holdings.map((h) => [h.ticker, h]));
        let cashRemaining = availableCash;

        for (const decision of validDecisions) {
          const { action, ticker, shares, reasoning } = decision;

          if (!["BUY", "SELL", "HOLD"].includes(action)) {
            console.warn(`[${model.name}] Invalid action "${action}" — skipping`);
            continue;
          }

          if (action === "HOLD") {
            await logTrade({
              model_id: model.id,
              phase: phase.phase_number,
              action: "HOLD",
              ticker: ticker ?? null,
              shares: 0,
              price: ticker ? (priceMap.get(ticker)?.close ?? null) : null,
              reasoning: reasoning ?? null,
              full_prompt: fullPromptText,
              full_response: fullResponseText,
            });
            continue;
          }

          // Validate ticker
          if (!ALLOWED_TICKERS.includes(ticker)) {
            console.warn(`[${model.name}] Ticker "${ticker}" not in allowed universe — skipping`);
            continue;
          }

          const price = priceMap.get(ticker)?.close;
          if (!price) {
            console.warn(`[${model.name}] No price for ${ticker} — skipping`);
            continue;
          }

          if (action === "SELL") {
            const holding = holdingsMap.get(ticker);
            if (!holding || holding.shares < shares) {
              console.warn(
                `[${model.name}] Cannot sell ${shares} ${ticker} — only ${holding?.shares ?? 0} held`
              );
              continue;
            }

            // Execute sell
            const newShares = holding.shares - shares;
            if (newShares === 0) {
              await supabase.from("portfolios").delete().eq("model_id", model.id).eq("ticker", ticker);
            } else {
              await supabase
                .from("portfolios")
                .update({ shares: newShares })
                .eq("model_id", model.id)
                .eq("ticker", ticker);
            }

            holding.shares = newShares;
            cashRemaining += shares * price;
            tradesExecuted++;
            console.log(`[${model.name}] SELL ${shares} ${ticker} @ $${price.toFixed(2)}`);
          }

          if (action === "BUY") {
            const cost = shares * price;
            if (cost > cashRemaining) {
              console.warn(
                `[${model.name}] Cannot buy ${shares} ${ticker} — costs $${cost.toFixed(2)}, only $${cashRemaining.toFixed(2)} available`
              );
              continue;
            }

            const existing = holdingsMap.get(ticker);
            if (existing) {
              // Update avg cost and shares
              const totalShares = existing.shares + shares;
              const newAvgCost =
                (existing.shares * existing.avg_cost + shares * price) / totalShares;

              await supabase
                .from("portfolios")
                .update({ shares: totalShares, avg_cost: newAvgCost })
                .eq("model_id", model.id)
                .eq("ticker", ticker);

              existing.shares = totalShares;
              existing.avg_cost = newAvgCost;
            } else {
              await supabase.from("portfolios").insert({
                model_id: model.id,
                ticker,
                shares,
                avg_cost: price,
              });
              holdingsMap.set(ticker, { ticker, shares, avg_cost: price });
            }

            cashRemaining -= cost;
            tradesExecuted++;
            console.log(`[${model.name}] BUY ${shares} ${ticker} @ $${price.toFixed(2)}`);
          }

          await logTrade({
            model_id: model.id,
            phase: phase.phase_number,
            action,
            ticker,
            shares,
            price,
            reasoning: reasoning ?? null,
            full_prompt: fullPromptText,
            full_response: fullResponseText,
          });
        }

        // Always write a record on inactive sessions so every model has a daily entry.
        if (tradesExecuted === 0) {
          console.log(`[${model.name}] No trades executed — writing HOLD record`);
          await logTrade({
            model_id: model.id,
            phase: phase.phase_number,
            action: "HOLD",
            ticker: null,
            shares: null,
            price: null,
            reasoning: "No trades executed this session",
            full_prompt: fullPromptText,
            full_response: fullResponseText,
          });
        }

        console.log(`[${model.name}] Done — ${tradesExecuted} trade(s) executed`);
        summary.push({ model_name: model.name, success: true, trades_executed: tradesExecuted });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[${model.name}] ERROR: ${message}`);

        await logTrade({
          model_id: model.id,
          phase: phase.phase_number,
          action: "ERROR",
          ticker: null,
          shares: null,
          price: null,
          reasoning: message,
          full_prompt: fullPromptText,
          full_response: fullResponseText,
        });

        summary.push({ model_name: model.name, success: false, trades_executed: 0, error: message });
      }
    }

    console.log("\n══════════════════════════════════════════");
    console.log(" QuantDrift Daily Trade Execution Complete");
    console.log("══════════════════════════════════════════\n");

    return NextResponse.json({ success: true, summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron] Fatal error:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
