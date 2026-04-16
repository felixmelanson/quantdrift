import YahooFinance from "yahoo-finance2";

// v3 requires instantiation; suppress the one-time survey notice.
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export interface PriceData {
  ticker: string;
  close: number;
  change_pct: number;
}

export async function fetchEndOfDayPrices(tickers: string[]): Promise<PriceData[]> {
  if (tickers.length === 0) return [];

  console.log(`[prices] Fetching prices via yahoo-finance2 for: ${tickers.join(", ")}`);

  const results = await Promise.all(
    tickers.map(async (ticker): Promise<PriceData | null> => {
      try {
        const quote = await yf.quote(ticker);
        const price = quote.regularMarketPrice ?? 0;
        const changePct = quote.regularMarketChangePercent ?? 0;
        console.log(`[prices] ${ticker}: $${price.toFixed(2)} (${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%)`);
        return { ticker, close: price, change_pct: changePct };
      } catch (err) {
        console.warn(`[prices] Failed to fetch ${ticker}:`, err instanceof Error ? err.message : String(err));
        return null;
      }
    })
  );

  const entries = results.filter((r): r is PriceData => r !== null);
  console.log(`[prices] Got ${entries.length}/${tickers.length} prices`);
  return entries;
}
