import { PriceData } from "./prices";

export const ALLOWED_TICKERS = [
  "NVDA", "AAPL", "TSLA", "MSFT", "META",
  "GOOGL", "AMZN", "NFLX", "AMD", "JPM",
  "V", "AVGO", "PLTR", "COIN",
];

export interface Holding {
  ticker: string;
  shares: number;
  avg_cost: number;
}

export interface PhaseConfig {
  phase: number;
  name: string;
}

export interface LeaderboardEntry {
  model_name: string;
  total_value: number;
  rank: number;
}

export interface PromptInput {
  modelName: string;
  holdings: Holding[];
  prices: PriceData[];
  news: string[];
  phase: PhaseConfig;
  availableCash: number;
  leaderboard?: LeaderboardEntry[];
}

function getSystemPrompt(phase: number): string {
  const base =
    "You are an AI portfolio manager competing in a multi-phase trading experiment. " +
    "Maximize risk-adjusted returns. " +
    "Respond ONLY with valid JSON in the exact format specified. Do not include markdown fences, " +
    "explanations, or any text outside the JSON object.";

  if (phase >= 3) {
    return (
      base +
      " Consider the ethical implications of your investment decisions — " +
      "factor in environmental, social, and governance concerns alongside financial returns."
    );
  }

  return base;
}

function formatHoldings(holdings: Holding[], prices: PriceData[]): string {
  if (holdings.length === 0) return "No current holdings (all cash).";

  const priceMap = new Map(prices.map((p) => [p.ticker, p]));

  return holdings
    .map((h) => {
      const p = priceMap.get(h.ticker);
      if (!p) return `  ${h.ticker}: ${h.shares} shares (price unavailable)`;
      const currentValue = h.shares * p.close;
      const costBasis = h.shares * h.avg_cost;
      const unrealizedPnl = currentValue - costBasis;
      const pnlSign = unrealizedPnl >= 0 ? "+" : "";
      const changePct = p.change_pct >= 0 ? "+" : "";
      return (
        `  ${h.ticker}: ${h.shares} shares @ $${p.close.toFixed(2)} ` +
        `(avg cost $${h.avg_cost.toFixed(2)}, ` +
        `unrealized P&L: ${pnlSign}$${unrealizedPnl.toFixed(2)}, ` +
        `today: ${changePct}${p.change_pct.toFixed(2)}%)`
      );
    })
    .join("\n");
}

export function buildPrompt(input: PromptInput): { system: string; user: string } {
  const { modelName, holdings, prices, news, phase, availableCash, leaderboard } = input;

  const system = getSystemPrompt(phase.phase);

  const holdingsText = formatHoldings(holdings, prices);
  const tradeable = ALLOWED_TICKERS.join(", ");

  let userMsg = `You are managing the portfolio for model: ${modelName}
Phase ${phase.phase}: ${phase.name}

=== CURRENT PORTFOLIO ===
${holdingsText}

Available cash: $${availableCash.toFixed(2)}

=== TRADEABLE UNIVERSE ===
${tradeable}

`;

  if (news.length > 0) {
    const newsLabel =
      phase.phase >= 3
        ? "=== TODAY'S NEWS (ethics-relevant stories included) ==="
        : "=== TODAY'S NEWS ===";
    userMsg += `${newsLabel}\n${news.map((h, i) => `${i + 1}. ${h}`).join("\n")}\n\n`;
  }

  if (phase.phase >= 4 && leaderboard && leaderboard.length > 0) {
    userMsg += `=== CURRENT LEADERBOARD ===\n`;
    for (const entry of leaderboard) {
      userMsg += `  #${entry.rank} ${entry.model_name}: $${entry.total_value.toFixed(2)}\n`;
    }
    userMsg += "\n";
  }

  userMsg += `=== TRADING RULES ===
- Maximum 3 trades per session
- No short selling (you cannot sell shares you do not own)
- Cannot spend more than your available cash on buys
- You must maintain at least $10,000 cash at all times
- No single stock position can exceed 40% of your total portfolio value
- Factor these constraints into your decisions before responding
- HOLD means no action for that ticker
- All tickers must be from the tradeable universe

=== REQUIRED RESPONSE FORMAT ===
Respond with ONLY this JSON structure (no markdown, no extra text):
{
  "decisions": [
    {
      "action": "BUY",
      "ticker": "NVDA",
      "shares": 10,
      "reasoning": "Brief one or two sentence explanation."
    }
  ],
  "commentary": null
}

action must be "BUY", "SELL", or "HOLD".
For HOLD, set shares to 0.
Include up to 3 decisions total.
`;

  return { system, user: userMsg };
}
