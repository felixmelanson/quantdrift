import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://models.inference.ai.azure.com",
  apiKey: process.env.GITHUB_TOKEN!,
});

// Try GPT-5 first; fall back to gpt-4o if unavailable on this tier.
async function tryModel(modelId: string, prompt: string): Promise<string | null> {
  try {
    const response = await client.chat.completions.create({
      model: modelId,
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 1024,
    });
    console.log(`[gpt] Raw response from ${modelId}:`, JSON.stringify(response, null, 2));
    return response.choices[0]?.message?.content ?? null;
  } catch (err) {
    console.warn(`[gpt] ${modelId} failed:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

export async function callModel(prompt: string): Promise<string> {
  let content = await tryModel("gpt-5", prompt);
  if (!content) {
    console.log("[gpt] Falling back to gpt-4o");
    content = await tryModel("gpt-4o", prompt);
  }
  if (!content) throw new Error("Empty response from GPT (tried gpt-5 and gpt-4o)");
  return content;
}
