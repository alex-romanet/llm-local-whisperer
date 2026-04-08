# llm-local-whisperer

> Talk to your local LLM — no cloud, no subscriptions, just your voice and your machine.

`llm-local-whisperer` is a terminal CLI that lets you speak to any locally running large language model. Press `Space` to record, press `Space` again to send — your voice gets transcribed by a local Whisper server and the result is streamed back from your LLM of choice, right in the terminal.

```
  ╭──────────────────────────────────────────────────────────────────╮
  │  Local LLM Whisper                                               │
  │  Voice-to-chat with your local LLM                               │
  ╰──────────────────────────────────────────────────────────────────╯

  [Space] Record  [c] Config  [r] Reset chat  [q] Quit

  ● REC 0:04  Press Space to stop...

  You  What's the capital of France?

  Assistant  Paris is the capital of France. It has been the country's
             political and cultural centre for centuries...
```

---

## Quickstart

Complete steps to go from nothing to a working session.

**1. Install sox** (audio recording)

```bash
brew install sox          # macOS
sudo apt install sox      # Ubuntu/Debian
```

**2. Start an LLM server**

The easiest option is [Ollama](https://ollama.com):

```bash
# Install Ollama, then:
ollama pull llama3
ollama serve
# Running at http://localhost:11434
```

**3. Start a Whisper server**

The easiest option is Docker + whisper-asr-webservice (the same image the app auto-manages):

```bash
docker run -p 9000:9000 onerahmet/openai-whisper-asr-webservice:latest
# Running at http://localhost:9000
```

**4. Clone and build this tool**

```bash
git clone https://github.com/your-username/llm-local-whisperer
cd llm-local-whisperer
npm install
npm run build
```

**5. Run it**

```bash
node dist/index.js
```

On first launch you'll be walked through a config wizard. The defaults match the ports from steps 2 and 3 above, so you can press Enter through most of it.

**6. Talk to your LLM**

- Press `Space` to start recording
- Speak your message
- Press `Space` again to stop — it will transcribe and send automatically
- Press `q` to quit

---

## The idea

Most voice-to-LLM tools are cloud-dependent — your audio goes to a remote transcription API, then to a remote model, then back. This tool keeps everything local:

- **Audio is recorded on your machine** using `sox`
- **Transcription runs on your machine** via a local Whisper server (whisper.cpp, faster-whisper, etc.)
- **Inference runs on your machine** via any OpenAI-compatible LLM server (Ollama, LM Studio, llama.cpp, etc.)

Nothing leaves your network. The tool is just the glue between them.

---

## Prerequisites

### 1. sox — audio recording

```bash
brew install sox          # macOS
sudo apt install sox      # Ubuntu/Debian
```

### 2. A local Whisper server

The tool expects an OpenAI-compatible `/v1/audio/transcriptions` endpoint. Any of these work:

| Server | Quick start |
|--------|-------------|
| [whisper.cpp](https://github.com/ggerganov/whisper.cpp) | `./server -m models/ggml-base.en.bin -p 8080` |
| [faster-whisper-server](https://github.com/fedirz/faster-whisper-server) | `docker run -p 8080:8080 fedirz/faster-whisper-server` |
| [whisper-asr-webservice](https://github.com/ahmetoner/whisper-asr-webservice) | `docker run -p 9000:9000 onerahmet/openai-whisper-asr-webservice` |

Default expected endpoint: `http://localhost:8080/v1`

### 3. A local LLM server

The tool expects an OpenAI-compatible `/v1/chat/completions` endpoint with streaming support.

| Server | Quick start |
|--------|-------------|
| [Ollama](https://ollama.com) | `ollama serve` (default port 11434) |
| [LM Studio](https://lmstudio.ai) | Enable "Local Server" in the app |
| [llama.cpp](https://github.com/ggerganov/llama.cpp) | `./server -m model.gguf --port 8081` |
| [Jan](https://jan.ai) | Enable API server in settings |

Default expected endpoint: `http://localhost:11434/v1`

---

## Installation

```bash
git clone https://github.com/your-username/llm-local-whisperer
cd llm-local-whisperer

npm install
npm run build

# Run directly
node dist/index.js

# Or install globally
npm install -g .
llm-local-whisperer
```

---

## Usage

### First run

On first launch the tool detects there is no config file and walks you through the setup wizard:

```bash
llm-local-whisperer
```

### Reconfigure at any time

```bash
llm-local-whisperer --config
# or press [c] inside the interactive session
```

### Interactive controls

| Key | Action |
|-----|--------|
| `Space` | Start recording |
| `Space` (again) | Stop recording → transcribe → send to LLM |
| `c` | Open configuration wizard |
| `r` | Reset conversation history |
| `Ctrl+B` | Toggle thinking panel (for reasoning models) |
| `q` / `Ctrl+C` | Quit |

---

## Configuration

Config is stored at `~/.config/llm-local-whisperer/config.json` and created automatically on first run.

```json
{
  "llm": {
    "endpoint": "http://localhost:11434/v1",
    "api_key": "ollama",
    "model": "llama3",
    "temperature": 0.7,
    "max_tokens": 2048,
    "system_prompt": "You are a helpful assistant."
  },
  "whisper": {
    "endpoint": "http://localhost:9000/v1",
    "api_key": "none",
    "model": "whisper-1"
  }
}
```

| Field | Description |
|-------|-------------|
| `llm.endpoint` | Base URL of your LLM server (`/v1` included) |
| `llm.api_key` | API key — use `"ollama"` or `"none"` for servers that don't require one |
| `llm.model` | Model identifier as your server expects it (e.g. `llama3`, `mistral`, `phi3`) |
| `llm.temperature` | Sampling temperature `0.0–2.0` |
| `llm.max_tokens` | Maximum tokens per response |
| `llm.system_prompt` | System message prepended to every conversation |
| `whisper.endpoint` | Base URL of your Whisper server (`/v1` included) |
| `whisper.model` | Model name the Whisper server expects (usually `"whisper-1"`) |

> **Note:** API keys are stored in plaintext at `~/.config/llm-local-whisperer/config.json`. If you use a real API key, restrict the file's permissions: `chmod 600 ~/.config/llm-local-whisperer/config.json`.

---

## Development

```bash
npm run dev       # run with tsx (no build step)
npm run build     # compile TypeScript → dist/
npm run clean     # remove dist/
```

Source lives in `src/`. See [`docs/architecture.md`](docs/architecture.md) for a full breakdown of the code.

---

## Compatibility

Tested with:

- **LLM servers:** Ollama, LM Studio
- **Whisper servers:** whisper.cpp server mode, faster-whisper-server
- **Platforms:** macOS (primary), Linux (sox must be installed)

The tool targets any server that speaks the OpenAI REST API, so compatibility is broad.

---

## License

MIT
