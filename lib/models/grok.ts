import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://models.inference.ai.azure.com",
  apiKey: process.env.GITHUB_TOKEN!,
});

export async function callModel(prompt: string): Promise<string> {
  const response = await client.chat.completions.create({
    model: "grok-3",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 1024,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Empty response from Grok-3");
  return content;
}
