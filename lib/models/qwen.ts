import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://models.inference.ai.azure.com",
  apiKey: process.env.GITHUB_TOKEN!,
});

const DEFAULT_HOLD_RESPONSE = JSON.stringify({
  decisions: [
    {
      action: "HOLD",
      ticker: null,
      shares: 0,
      reasoning: "Model failed to produce valid JSON - defaulting to HOLD",
    },
  ],
  commentary: null,
});

export async function callModel(prompt: string): Promise<string> {
  const response = await client.chat.completions.create({
    model: "Qwen3-32B",
    // System message suppresses the think block so we get JSON immediately.
    messages: [
      {
        role: "system",
        content:
          "Do not use think tags. Output JSON immediately with no preamble.",
      },
      { role: "user", content: prompt },
    ],
    // Low token limit prevents runaway thinking; the JSON response is small.
    max_tokens: 400,
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) throw new Error("Empty response from Qwen");

  console.log("[qwen] Raw response:", raw);

  // Extract the substring between the outermost { and } to isolate the JSON object,
  // stripping any <think>…</think> preamble or trailing text.
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    console.warn("[qwen] No valid JSON object found in response — returning default HOLD");
    return DEFAULT_HOLD_RESPONSE;
  }

  return raw.slice(firstBrace, lastBrace + 1);
}
