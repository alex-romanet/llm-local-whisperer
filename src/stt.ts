import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';

export async function transcribe(
  filePath: string,
  endpoint: string,
  apiKey: string,
  model: string
): Promise<string> {
  const client = new OpenAI({
    apiKey: apiKey || 'none',
    baseURL: endpoint,
  });

  // Try /v1/audio/translations first — Whisper's translate task always outputs English
  try {
    const result = await client.audio.translations.create({
      file: fs.createReadStream(filePath),
      model,
      response_format: 'text',
    });
    return (result as unknown as string).trim();
  } catch (err: unknown) {
    if (!(err instanceof OpenAI.APIError && err.status === 404)) throw err;
  }

  // Fall back to /asr (onerahmet/openai-whisper-asr-webservice) with task=translate
  return transcribeViaAsr(filePath, endpoint);
}

// Calls the /asr endpoint used by onerahmet/openai-whisper-asr-webservice.
// task=translate instructs Whisper to output English regardless of input language.
async function transcribeViaAsr(filePath: string, endpoint: string): Promise<string> {
  const baseUrl = endpoint.replace(/\/v1\/?$/, '');

  const form = new FormData();
  form.append('audio_file', new Blob([fs.readFileSync(filePath)]), path.basename(filePath));

  const response = await fetch(`${baseUrl}/asr?output=text&task=translate`, {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    throw new Error(`Whisper /asr returned ${response.status}: ${await response.text()}`);
  }

  return (await response.text()).trim();
}
