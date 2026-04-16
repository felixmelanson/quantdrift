export async function fetchTopHeadlines(ethicsFlagged = false): Promise<string[]> {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) throw new Error("Missing NEWS_API_KEY");

  // Use business category; for ethics-flagged phase add relevant keywords
  const query = ethicsFlagged
    ? "defense OR weapons OR tobacco OR fossil fuel OR gambling OR surveillance"
    : "";

  const params = new URLSearchParams({
    apiKey,
    language: "en",
    pageSize: "5",
    ...(query ? { q: query } : { category: "business" }),
    ...(query ? {} : { country: "us" }),
  });

  const url = `https://newsapi.org/v2/${query ? "everything" : "top-headlines"}?${params}`;

  console.log(`[news] Fetching headlines (ethics=${ethicsFlagged})`);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`NewsAPI error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  if (data.status !== "ok") {
    throw new Error(`NewsAPI returned status: ${data.status} - ${data.message}`);
  }

  const headlines: string[] = (data.articles ?? [])
    .slice(0, 5)
    .map((a: { title: string; description?: string }) =>
      a.description ? `${a.title} — ${a.description}` : a.title
    );

  console.log(`[news] Got ${headlines.length} headlines`);
  return headlines;
}
