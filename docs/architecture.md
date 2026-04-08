# Architecture

## Overview

`llm-local-whisperer` is a Node.js CLI that stitches together three local services: a microphone, a Whisper speech-to-text server, and an LLM inference server. The tool itself does no ML — it is pure orchestration.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        llm-local-whisperer                          │
│                                                                     │
│   Keypress (Space)                                                  │
│        │                                                            │
│        ▼                                                            │
│   ┌─────────┐   WAV file   ┌──────────────────┐   text              │
│   │Recorder │─────────────▶│  Whisper server  │──────────┐          │
│   │ (sox)   │              │ /v1/audio/trans..│          │          │
│   └─────────┘              └──────────────────┘          ▼          │
│                                                    ┌────────────┐   │
│                                                    │ LLM server │   │
│                                                    │ /v1/chat/  │   │
│                                                    │ completions│   │
│                                                    └─────┬──────┘   │
│                                                          │ stream   │
│                                                          ▼          │
│                                                      Terminal       │
└─────────────────────────────────────────────────────────────────────┘
```

Both the Whisper server and the LLM server are expected to expose **OpenAI-compatible REST APIs**. The tool uses the official `openai` npm package pointed at configurable base URLs — no custom HTTP client needed.

---

## Module map

```
src/
├── index.ts       Entry point, CLI definition, main interaction loop
├── config.ts      Config schema, load/save, defaults
├── configure.ts   Interactive config wizard (terminal prompts)
├── recorder.ts    Audio capture via sox subprocess
├── stt.ts         Whisper transcription client
├── llm.ts         LLM streaming chat client
├── docker.ts      Docker lifecycle management for the bundled Whisper container
└── display.ts     All terminal output (chalk-based)
```

---

## Data flow

A single voice interaction follows this path:

```
1. User presses Space
        │
        ▼
2. recorder.start()
   → spawns: sox -d -r 16000 -c 1 -b 16 -e signed-integer /tmp/llm-whisper-<ts>.wav
   → sox records from the default audio device into a temp WAV file
        │
3. User presses Space again
        │
        ▼
4. recorder.stop()
   → sends SIGTERM to the sox process
   → sox finalizes the WAV header and exits cleanly
   → resolves with the path to the temp file
        │
        ▼
5. transcribe(filePath, ...)
   → opens the WAV file as a ReadStream
   → POST multipart/form-data to /v1/audio/transcriptions
   → returns transcribed text string
        │
        ▼
6. history.push({ role: 'user', content: transcription })
        │
        ▼
7. streamChat(history, ...)
   → POST /v1/chat/completions with stream: true
   → yields string chunks via async generator
   → each chunk is written directly to stdout
        │
        ▼
8. history.push({ role: 'assistant', content: fullResponse })
        │
        ▼
9. Back to idle — ready for next recording
```

---

## Interaction state machine

The main loop in `index.ts` manages three boolean flags:

| Flag | Meaning |
|------|---------|
| `isRecording` | sox is currently capturing audio |
| `isBusy` | a transcription or LLM call is in flight |

```
         ┌──────────────────────────────────────────────────────────┐
         │                        IDLE                              │
         │  isRecording=false, isBusy=false                         │
         └───┬──────────────────────────────────────────────────────┘
             │ Space
             ▼
         ┌──────────────────────────────────────────────────────────┐
         │                      RECORDING                           │
         │  isRecording=true, isBusy=false                          │
         │  sox running, elapsed timer updating every second        │
         └───┬──────────────────────────────────────────────────────┘
             │ Space
             ▼
         ┌──────────────────────────────────────────────────────────┐
         │                    PROCESSING                            │
         │  isRecording=false, isBusy=true                          │
         │  1. Stop sox → finalize WAV                              │
         │  2. POST WAV to Whisper → text                           │
         │  3. POST messages to LLM → stream to stdout             │
         └───┬──────────────────────────────────────────────────────┘
             │ done (or error)
             ▼
         IDLE (loop back)
```

Keys other than `Space` are ignored while `isBusy=true`. `Ctrl+C` bypasses the busy guard and always exits immediately.

---

## Design decisions

### Why sox?

sox is the most reliable cross-platform CLI audio tool and is universally available via package managers. The alternative would be a native Node.js binding (e.g. `node-record-lpcm16`, `mic`), which require native compilation and have more fragile platform support. Shelling out to sox is simpler and more predictable.

sox is invoked with parameters tuned for Whisper:
- 16 kHz sample rate — Whisper's native rate; avoids resampling
- Mono (1 channel) — Whisper doesn't use stereo; mono halves file size
- 16-bit signed integer PCM — uncompressed, zero decoding overhead

### Why SIGTERM to stop recording?

`SIGTERM` is sox's graceful shutdown signal. When it receives SIGTERM, sox writes the correct RIFF WAV header (including the final byte count) before exiting. Without this, the WAV file would have a zeroed header and most parsers (including Whisper) would reject or mishandle it.

### Why the openai npm package for both STT and LLM?

Both services expose OpenAI-compatible APIs. Using one package with a custom `baseURL` covers both cases cleanly — no bespoke HTTP client, automatic retry logic, and full TypeScript types.

### Why keep conversation history in memory?

The history array is the multi-turn context window. It starts with a system message and accumulates `user`/`assistant` pairs. There is no persistence — resetting the session (`r`) clears it. This is intentional: local LLMs have finite context windows and old context degrades response quality.

### ESM + NodeNext

The project uses native ES modules (`"type": "module"`) with TypeScript's `NodeNext` module resolution. This matches the module format of all dependencies (chalk, ora, @inquirer/prompts, marked-terminal) which are ESM-only in their current major versions.

### Raw terminal mode

`process.stdin.setRawMode(true)` puts the terminal in raw mode so keypress events are received immediately, one character at a time, without waiting for Enter. This enables the `Space` toggle UX. Raw mode is suspended when the config wizard runs (inquirer manages its own terminal state) and restored after.

---

## Configuration persistence

Config is loaded at startup and mutated in place by `runConfigPrompt`. It is stored as JSON at:

```
~/.config/llm-local-whisperer/config.json
```

`loadConfig` uses a `deepMerge` of defaults over stored values, so adding new config fields in a future version won't break existing config files — missing keys fall back to their defaults.

---

## Error handling strategy

Errors are scoped to the phase they occur in:

| Phase | On error |
|-------|----------|
| sox not found | Print install hint, `process.exit(1)` at startup |
| Recording fails | Print error, release `isBusy`, return to idle |
| Transcription fails | Print error + endpoint hint, release `isBusy` |
| No speech detected | Print info message, release `isBusy` |
| LLM call fails | Print error + endpoint hint, pop the pending user message from history, release `isBusy` |

Popping the failed user message from history keeps the conversation state consistent — the user can rephrase and try again without the failed turn polluting the context.
