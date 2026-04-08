# Module Reference

Detailed documentation for every source file in `src/`.

---

## `index.ts` — Entry point & main loop

The top-level module. Handles two responsibilities:

1. **CLI definition** via `commander` — parses `--config` flag and `--version`/`--help`
2. **Main interaction loop** — raw terminal mode, keypress dispatch, pipeline orchestration

### Startup sequence

```
parseAsync(argv)
  → checkSox()           guard: exit if sox missing
  → loadConfig()
  → if --config flag:    runConfigPrompt(), exit
  → if no config file:   runConfigPrompt() (first-run wizard)
  → runMainLoop(config)
```

### `runMainLoop(config)`

Sets `process.stdin` to raw mode and attaches a `'data'` listener. The listener is an async function — it can `await` without blocking subsequent keypresses (each keypress spawns its own handler invocation). The `isBusy` flag prevents overlapping pipeline runs.

The recording timer (`setInterval` at 1 second) drives the `● REC 0:XX` display. It is started in `startRecordingTimer()` and cleared in `stopRecordingTimer()` before the pipeline begins.

**Pipeline steps inside the Space handler:**

```typescript
// 1. Stop sox and get the WAV file path
const audioFile = await recorder.stop();

// 2. Transcribe (multipart POST to Whisper)
const transcription = await transcribe(audioFile, ...);

// 3. Add user turn to history
history.push({ role: 'user', content: transcription });

// 4. Stream LLM response, write chunks to stdout
for await (const chunk of streamChat(history, ...)) {
  printChunk(chunk);
  fullResponse += chunk;
}

// 5. Add assistant turn to history
history.push({ role: 'assistant', content: fullResponse });
```

**Key binding table:**

| Raw value | Binding |
|-----------|---------|
| `' '` | Start / stop recording |
| `'c'` | Config wizard (suspends raw mode) |
| `'r'` | Reset history |
| `'q'` | Exit |
| `'\u0003'` | Ctrl+C — always exits, even mid-recording |

### `errorMessage(err)`

Utility that safely extracts a string from an unknown-typed catch block. Returns `err.message` for `Error` instances, `String(err)` otherwise.

---

## `config.ts` — Configuration management

Owns the config schema, file location, defaults, and read/write operations.

### `Config` interface

```typescript
interface Config {
  llm: {
    endpoint: string;       // base URL including /v1
    api_key: string;        // pass "ollama" or "none" for unauthenticated servers
    model: string;          // model identifier as server expects it
    temperature: number;    // 0.0–2.0
    max_tokens: number;     // max tokens per response
    system_prompt: string;  // prepended to every conversation as system role
  };
  whisper: {
    endpoint: string;       // base URL including /v1
    api_key: string;
    model: string;          // usually "whisper-1"
  };
  tools: string[];          // reserved for future tool-use support
}
```

### File location

```
~/.config/llm-local-whisperer/config.json
```

The directory is created with `{ recursive: true }` on first save, so no manual setup is needed.

### `loadConfig(): Config`

1. If the config file does not exist, returns a deep clone of `DEFAULT_CONFIG`
2. If it exists, reads and parses JSON, then merges into defaults via `deepMerge`
3. On any parse error, silently falls back to defaults

The `deepMerge` strategy means partial config files work correctly — only keys present in the stored file override their default counterparts. New fields added in future versions will have defaults without needing a migration.

### `deepMerge<T>(target, source)`

Recursive merge: for object values, recurse; for primitives and arrays, overwrite. Does not mutate either argument.

### `saveConfig(config)` / `configFileExists()`

`saveConfig` writes the full config as pretty-printed JSON (2-space indent). `configFileExists` is used by `index.ts` at startup to detect first-run.

---

## `recorder.ts` — Audio capture

Wraps a `sox` child process that records audio from the default input device to a temporary WAV file.

### `checkSox(): boolean`

Runs `which sox` synchronously. Called once at startup — if it fails the process exits immediately with an installation hint.

### `Recorder` class

**`start()`**

Generates a unique temp file path (`/tmp/llm-whisper-<timestamp>.wav`) and spawns:

```bash
sox -d -r 16000 -c 1 -b 16 -e signed-integer /tmp/llm-whisper-<ts>.wav
```

| sox flag | Value | Reason |
|----------|-------|--------|
| `-d` | default | Use the system's default audio input device |
| `-r 16000` | 16 kHz | Whisper's native sample rate — no resampling needed |
| `-c 1` | mono | Whisper ignores stereo; mono is half the data |
| `-b 16` | 16-bit | Uncompressed PCM with sufficient dynamic range |
| `-e signed-integer` | PCM | Uncompressed format, zero decoding overhead |

stderr is piped but discarded to suppress sox's progress meter.

**`stop(): Promise<string>`**

Sends `SIGTERM` to the running sox process. sox handles this signal gracefully: it finalises the RIFF WAV header (writing the correct chunk sizes) before exiting. The promise resolves with the WAV file path once the process closes.

**`cleanup()`**

Deletes the temp WAV file. Called in a `finally` block after transcription so the file is removed whether the request succeeds or fails.

**`isRecording(): boolean`**

Returns `true` if a sox process is currently running. Used by the display layer to show the recording indicator.

---

## `stt.ts` — Speech-to-text

Single exported function that submits a WAV file to a Whisper-compatible transcription endpoint.

### `transcribe(filePath, endpoint, apiKey, model): Promise<string>`

```typescript
const client = new OpenAI({ apiKey, baseURL: endpoint });

const transcription = await client.audio.transcriptions.create({
  file: fs.createReadStream(filePath),
  model,
  response_format: 'text',   // returns plain string, not a JSON object
});
```

`response_format: 'text'` makes the server return a bare string instead of a JSON wrapper. The OpenAI SDK types the return as `Transcription` regardless, so a cast (`as unknown as string`) is needed to get the actual value.

The function trims leading/trailing whitespace before returning. An empty string after trimming signals "no speech detected" to the caller.

---

## `llm.ts` — LLM streaming chat

Single exported async generator function that streams a chat completion from an OpenAI-compatible endpoint.

### `Message` interface

```typescript
interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
```

Matches the OpenAI chat message schema directly. The history array in `index.ts` uses this type.

### `streamChat(messages, endpoint, apiKey, model, temperature, maxTokens): AsyncGenerator<string>`

```typescript
const stream = await client.chat.completions.create({
  model, messages, temperature, max_tokens: maxTokens,
  stream: true,
});

for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content;
  if (content) yield content;
}
```

Each chunk from the server contains a `delta.content` string (which may be `undefined` for the first and last chunks that carry metadata only). The generator filters those out and only yields non-empty content strings.

The caller in `index.ts` collects these into `fullResponse` while simultaneously writing them to stdout, achieving visible streaming.

---

## `configure.ts` — Configuration wizard

Drives the interactive configuration setup using `@inquirer/prompts`. Each field is a separate prompt call, displayed sequentially.

### `runConfigPrompt(config): Promise<void>`

Mutates `config` in place. Called from `index.ts` with the already-loaded config object, so defaults are pre-populated in all prompts (press Enter to keep).

**Prompt types used:**

| Prompt | Fields |
|--------|--------|
| `input` | endpoint, model, system prompt |
| `password` | api_key (masked with `*`) |
| `number` | temperature, max_tokens (with validation) |
| `confirm` | final save confirmation |

**Validation:**
- Temperature: must be a number between 0 and 2
- Max tokens: must be a positive integer

If the user declines to save (`confirm → No`), the in-memory config has already been mutated but `saveConfig` is not called. On the next startup, the old file is loaded again. This is the expected behavior — the wizard is non-destructive until confirmed.

---

## `display.ts` — Terminal output

All terminal I/O is funnelled through this module. Nothing in the rest of the codebase writes to stdout/stderr directly except for `ora` spinners (managed in `index.ts`).

### Layout constants

```typescript
const WIDTH = 70;    // content column width
const INDENT = '  '; // two-space left margin
```

### Functions

| Function | Description |
|----------|-------------|
| `printBanner()` | Draws the welcome box with title and subtitle using box-drawing chars |
| `printControls()` | Prints the `[Space] Record  [c] Config...` hint line |
| `printRecording(elapsed)` | Overwrites the current line with `● REC 0:XX` using `\r` |
| `clearLine()` | Overwrites the current line with spaces then `\r` to reset cursor |
| `printUserMessage(text)` | Prints the `You  <text>` line with blue bold label |
| `printAssistantLabel()` | Writes `Assistant  ` prefix without newline, ready for streaming |
| `printChunk(text)` | Writes a raw chunk directly to stdout — no newline, no formatting |
| `printResponseEnd()` | Writes two newlines after the streamed response |
| `printDivider()` | Prints a `──────` separator line |
| `printError(message)` | Prints `Error  <message>` in red with surrounding blank lines |
| `printInfo(message)` | Prints a dim gray info line |
| `printSuccess(message)` | Prints a green `✓ <message>` confirmation |

### Streaming output approach

The assistant response is written chunk by chunk to stdout using `process.stdout.write`. No buffering, no re-rendering after completion. This is intentional:

- Re-rendering streamed output with markdown requires knowing how many terminal rows were used, which depends on the terminal width and line wrapping — fragile to compute
- The raw LLM output is already legible
- Streaming feedback is more important than markdown rendering for a voice interface

The `ora` spinners (`Processing audio...`, `Transcribing...`, `Thinking...`) are managed in `index.ts` rather than `display.ts` because they need to be stopped conditionally before the first streaming chunk arrives.
