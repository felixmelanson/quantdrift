import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

const client = new GoogleGenAI({ apiKey });

export async function callModel(prompt: string): Promise<string> {
  const response = await client.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: prompt,
  });

  const text = response.text;
  if (!text) throw new Error("Empty response from Gemini");
  return text;
}
