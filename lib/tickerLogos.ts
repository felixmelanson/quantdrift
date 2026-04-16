export const TICKER_DOMAINS: Record<string, string> = {
  NVDA: "nvidia.com",
  AAPL: "apple.com",
  TSLA: "tesla.com",
  MSFT: "microsoft.com",
  META: "meta.com",
  GOOGL: "google.com",
  AMZN: "amazon.com",
  NFLX: "netflix.com",
  AMD: "amd.com",
  JPM: "jpmorganchase.com",
  V: "visa.com",
  AVGO: "broadcom.com",
  PLTR: "palantir.com",
  COIN: "coinbase.com",
};

/**
 * Returns a logo URL via logo.dev for a given ticker.
 * Falls back to undefined if the ticker is not in the map.
 */
export function getLogoUrl(ticker: string): string | undefined {
  const domain = TICKER_DOMAINS[ticker];
  if (!domain) return undefined;
  return `https://img.logo.dev/${domain}?token=pk_public&size=64`;
}
