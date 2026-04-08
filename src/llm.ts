import OpenAI from 'openai';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type StreamEvent =
  | { type: 'thinking'; text: string }
  | { type: 'content'; text: string };

/**
 * Stream chat completion events, separating thinking from content.
 *
 * Handles two thinking formats:
 *  1. `reasoning_content` delta field — used by DeepSeek API, xAI, some Ollama builds.
 *  2. `<think>...</think>` tags embedded in content — used by DeepSeek R1, Qwen3, etc.
 */
export async function* streamChatEvents(
  messages: Message[],
  endpoint: string,
  apiKey: string,
  model: string,
  temperature: number,
  maxTokens: number,
): AsyncGenerator<StreamEvent> {
  const client = new OpenAI({ apiKey: apiKey || 'none', baseURL: endpoint });

  const stream = await client.chat.completions.create({
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: true,
  });

  let inThink = false;
  let buf = '';

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta as Record<string, unknown> & { content?: string };

    // Format 1: reasoning_content field
    const reasoning = delta?.reasoning_content as string | undefined;
    if (reasoning) yield { type: 'thinking', text: reasoning };

    const raw = delta?.content;
    if (!raw) continue;

    buf += raw;

    // Format 2: <think>...</think> tags in content
    while (buf.length > 0) {
      if (!inThink) {
        const idx = buf.indexOf('<think>');
        if (idx === -1) {
          // No tag; hold back enough chars to catch a tag split across chunks
          const safe = buf.slice(0, Math.max(0, buf.length - ('<think>'.length - 1)));
          if (safe) { yield { type: 'content', text: safe }; buf = buf.slice(safe.length); }
          break;
        }
        if (idx > 0) yield { type: 'content', text: buf.slice(0, idx) };
        buf = buf.slice(idx + '<think>'.length);
        inThink = true;
      } else {
        const idx = buf.indexOf('</think>');
        if (idx === -1) {
          const safe = buf.slice(0, Math.max(0, buf.length - ('</think>'.length - 1)));
          if (safe) { yield { type: 'thinking', text: safe }; buf = buf.slice(safe.length); }
          break;
        }
        if (idx > 0) yield { type: 'thinking', text: buf.slice(0, idx) };
        buf = buf.slice(idx + '</think>'.length);
        inThink = false;
      }
    }
  }

  // Flush any remaining buffered text
  if (buf) yield { type: inThink ? 'thinking' : 'content', text: buf };
}
