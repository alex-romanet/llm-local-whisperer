#!/usr/bin/env node

import { createRequire } from 'module';
import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { loadConfig, configFileExists, Config } from './config.js';
import { startWhisper, stopWhisper, isDockerAvailable } from './docker.js';
import { Recorder, checkSox } from './recorder.js';
import { transcribe } from './stt.js';
import { streamChatEvents, Message } from './llm.js';
import { runConfigPrompt } from './configure.js';
import {
  printBanner,
  printControls,
  clearLine,
  printUserMessage,
  printAssistantLabel,
  printResponseEnd,
  printError,
  printInfo,
  setupUI,
  teardownUI,
  redrawUI,
  StreamWriter,
  ThinkingPanel,
  IdleIndicator,
  RecordingDisplay,
} from './display.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

// ── CLI definition ─────────────────────────────────────────────────────

const program = new Command();

program
  .name('llm-local-whisperer')
  .description(
    [
      'Voice-to-chat CLI for local LLMs.',
      '',
      'Prerequisites:',
      '  • sox     — brew install sox       (audio recording)',
      '  • Whisper server at the configured endpoint (OpenAI-compatible /v1/audio/transcriptions)',
      '  • Local LLM server at the configured endpoint (OpenAI-compatible /v1/chat/completions)',
      '',
      'Controls (interactive mode):',
      '  Space  — start / stop recording',
      '  c      — open configuration',
      '  r      — reset conversation',
      '  q      — quit',
      '  Ctrl+B — toggle thinking panel (for reasoning models)',
    ].join('\n'),
  )
  .version(version)
  .option('--config', 'Open configuration setup and exit')
  .action(async (opts: { config?: boolean }) => {
    if (!checkSox()) {
      console.error(
        chalk.red.bold('\nError: ') +
          chalk.red('sox is not installed.\n') +
          chalk.dim('  Install with: brew install sox\n'),
      );
      process.exit(1);
    }

    const config = loadConfig();

    if (opts.config) {
      await runConfigPrompt(config);
      return;
    }

    if (!configFileExists()) {
      printBanner();
      printInfo("First run — let's configure your endpoints.\n");
      await runConfigPrompt(config);
    }

    // Start Whisper container before entering the main loop
    let ownedWhisperContainer = false;
    if (isDockerAvailable()) {
      printInfo('Starting Whisper STT server...');
      const whisperPort = Number(new URL(config.whisper.endpoint).port) || 9000;
      const started = await startWhisper(whisperPort);
      ownedWhisperContainer = started;
      if (started) {
        printInfo('Whisper server ready.');
      } else {
        printInfo('Whisper already running — reusing existing container.');
      }
    }

    await runMainLoop(config, ownedWhisperContainer);
  });

process.on('unhandledRejection', (err) => {
  printError(`Unhandled error: ${errorMessage(err)}`);
});

program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red(errorMessage(err)));
  process.exit(1);
});

// ── Main interaction loop ──────────────────────────────────────────────

async function runMainLoop(config: Config, stopWhisperOnExit = false): Promise<void> {
  const recorder = new Recorder();
  const recording = new RecordingDisplay();
  const history: Message[] = [{ role: 'system', content: config.llm.system_prompt }];

  // Clear screen and draw the fixed banner + controls, then set scroll region
  setupUI();

  // Debounce resize: only redraw after the user stops dragging for 80 ms
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  process.stdout.on('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { resizeTimer = null; redrawUI(); }, 80);
  });

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  let isRecording = false;
  let isBusy = false;
  let showThinking = false;
  let currentPanel: ThinkingPanel | null = null;
  const indicator = new IdleIndicator();
  indicator.start();

  // Keep the event loop alive between interactions.
  const keepAlive = setInterval(() => {}, 500);

  process.stdin.on('data', async (key: string) => {
   try {
    // Always allow Ctrl+C
    if (key === '\u0003') {
      clearInterval(keepAlive);
      indicator.stop();
      recording.stop();
      if (isRecording) {
        recorder.stop().catch(() => {});
        recorder.cleanup();
      }
      teardownUI();
      if (stopWhisperOnExit) stopWhisper();
      printInfo('Goodbye!');
      process.exit(0);
    }

    // ── Ctrl+B: toggle thinking panel ───────────────────────────────
    if (key === '\x02') {
      showThinking = !showThinking;
      if (currentPanel) {
        currentPanel.toggle(showThinking);
      } else {
        // No active panel right now — show the new preference as feedback
        indicator.stop();
        const msg = showThinking
          ? 'Thinking panel: ON — next response will show reasoning'
          : 'Thinking panel: OFF';
        process.stdout.write(`\r\x1b[2K  \x1b[2m${msg}\x1b[0m\n`);
        setTimeout(() => { if (!isBusy && !isRecording) indicator.start(); }, 1500);
      }
      return;
    }

    if (isBusy) return;

    // ── Space: start or stop recording ──────────────────────────────
    if (key === ' ') {
      if (!isRecording) {
        isRecording = true;
        indicator.stop();
        recorder.start();
        recording.start();
        return;
      }

      // Stop recording → transcribe → LLM
      isRecording = false;
      isBusy = true;
      recording.stop();

      // ── Stop recorder ────────────────────────────────────────────
      let audioFile: string;
      const stopSpinner = ora({ text: 'Processing audio...', color: 'yellow' }).start();
      try {
        audioFile = await recorder.stop();
      } catch (err: unknown) {
        stopSpinner.stop();
        printError(`Recording failed: ${errorMessage(err)}`);
        isBusy = false;
        indicator.start();
        return;
      } finally {
        stopSpinner.stop();
      }

      // ── Transcribe ───────────────────────────────────────────────
      let transcription: string;
      const sttSpinner = ora({ text: 'Transcribing...', color: 'cyan' }).start();
      try {
        transcription = await transcribe(
          audioFile,
          config.whisper.endpoint,
          config.whisper.api_key,
          config.whisper.model,
        );
      } catch (err: unknown) {
        sttSpinner.stop();
        recorder.cleanup();
        printError(`Transcription failed: ${errorMessage(err)}`);
        printInfo('Is the Whisper server running at ' + config.whisper.endpoint + '?');
        isBusy = false;
        indicator.start();
        return;
      } finally {
        sttSpinner.stop();
        recorder.cleanup();
      }

      if (!transcription.trim()) {
        printInfo('No speech detected — try again.');
        isBusy = false;
        indicator.start();
        return;
      }

      printUserMessage(transcription);
      history.push({ role: 'user', content: transcription });

      // ── Stream LLM response ──────────────────────────────────────
      const llmSpinner = ora({ text: 'Thinking...', color: 'green' }).start();
      let fullResponse = '';
      let spinnerStopped = false;
      let firstContent = true;
      let thinkingDone = false;
      let writer: StreamWriter | null = null;
      currentPanel = null;

      try {
        const stream = streamChatEvents(
          history,
          config.llm.endpoint,
          config.llm.api_key,
          config.llm.model,
          config.llm.temperature,
          config.llm.max_tokens,
        );

        for await (const event of stream) {
          if (!spinnerStopped) {
            llmSpinner.stop();
            spinnerStopped = true;
          }

          if (event.type === 'thinking') {
            if (!currentPanel) currentPanel = new ThinkingPanel(showThinking);
            currentPanel.addChunk(event.text);
            continue;
          }

          // ── content ──────────────────────────────────────────────
          if (currentPanel && !thinkingDone) {
            currentPanel.complete();
            thinkingDone = true;
            currentPanel = null;
          }

          if (firstContent) {
            const startCol = printAssistantLabel();
            writer = new StreamWriter(startCol);
            firstContent = false;
            // Strip leading newlines — some models open with \n before their response
            const trimmed = event.text.replace(/^\n+/, '');
            if (trimmed) { writer.write(trimmed); fullResponse += trimmed; }
          } else {
            writer!.write(event.text);
            fullResponse += event.text;
          }
        }

        // Stream ended while still in a thinking block (no content followed)
        if (currentPanel && !thinkingDone) {
          currentPanel.complete();
          currentPanel = null;
        }

        writer?.flush();

      } catch (err: unknown) {
        llmSpinner.stop();
        clearLine();
        printError(`LLM error: ${errorMessage(err)}`);
        printInfo('Is the LLM server running at ' + config.llm.endpoint + '?');
        history.pop();
        isBusy = false;
        currentPanel?.dispose();
        currentPanel = null;
        indicator.start();
        process.stdin.setRawMode(true);
        process.stdin.resume();
        return;
      } finally {
        llmSpinner.stop();
        currentPanel?.dispose();
        currentPanel = null;
      }

      if (fullResponse) {
        printResponseEnd();
        history.push({ role: 'assistant', content: fullResponse });
      }

      isBusy = false;
      indicator.nextTip();
      indicator.start();
      // Re-assert raw mode — streaming output can corrupt terminal state
      process.stdin.setRawMode(true);
      process.stdin.resume();
      return;
    }

    // ── c: open config ───────────────────────────────────────────────
    if (key === 'c' && !isRecording) {
      isBusy = true;
      indicator.stop();
      teardownUI();
      process.stdin.setRawMode(false);
      console.log();

      await runConfigPrompt(config);
      history[0] = { role: 'system', content: config.llm.system_prompt };

      process.stdin.setRawMode(true);
      setupUI();
      isBusy = false;
      indicator.start();
      return;
    }

    // ── r: reset conversation ────────────────────────────────────────
    if (key === 'r' && !isRecording) {
      history.length = 0;
      history.push({ role: 'system', content: config.llm.system_prompt });
      printInfo('Conversation reset.');
      console.log();
      return;
    }

    // ── q: quit ──────────────────────────────────────────────────────
    if (key === 'q' && !isRecording) {
      clearInterval(keepAlive);
      indicator.stop();
      teardownUI();
      if (stopWhisperOnExit) stopWhisper();
      printInfo('Goodbye!');
      process.exit(0);
    }
   } catch (err: unknown) {
     isBusy = false;
     currentPanel = null;
     recording.stop();
     printError(`Unexpected error: ${errorMessage(err)}`);
     printControls();
   }
  });

  await new Promise<never>(() => {});
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
