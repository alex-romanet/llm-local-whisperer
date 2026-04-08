import { input, password, number, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import { Config, saveConfig } from './config.js';
import { printInfo, printSuccess } from './display.js';

const INDENT = '  ';

function validateUrl(v: string): true | string {
  try { new URL(v); return true; }
  catch { return 'Enter a valid URL (e.g. http://localhost:11434/v1)'; }
}

export async function runConfigPrompt(config: Config): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan(`${INDENT}Configuration Setup`));
  console.log(chalk.dim(`${INDENT}Press Enter to keep current values\n`));

  // ── LLM ──────────────────────────────────────────────────────────────
  console.log(chalk.bold(`${INDENT}LLM Settings`));

  config.llm.endpoint = await input({
    message: 'LLM endpoint',
    default: config.llm.endpoint,
    validate: validateUrl,
  });

  config.llm.model = await input({
    message: 'LLM model',
    default: config.llm.model,
  });

  config.llm.api_key =
    (await password({
      message: 'LLM API key (blank = none)',
      mask: '*',
    })) || config.llm.api_key;

  config.llm.system_prompt = await input({
    message: 'System prompt',
    default: config.llm.system_prompt,
  });

  const temp = await number({
    message: 'Temperature (0–2)',
    default: config.llm.temperature,
    validate: (v) => {
      if (v === undefined || isNaN(v)) return 'Enter a number';
      if (v < 0 || v > 2) return 'Must be between 0 and 2';
      return true;
    },
  });
  config.llm.temperature = temp ?? config.llm.temperature;

  const maxTok = await number({
    message: 'Max tokens',
    default: config.llm.max_tokens,
    validate: (v) => {
      if (v === undefined || isNaN(v) || v < 1) return 'Enter a positive integer';
      return true;
    },
  });
  config.llm.max_tokens = maxTok ?? config.llm.max_tokens;

  console.log();

  // ── Whisper ───────────────────────────────────────────────────────────
  console.log(chalk.bold(`${INDENT}Whisper STT Settings`));

  config.whisper.endpoint = await input({
    message: 'Whisper endpoint',
    default: config.whisper.endpoint,
    validate: validateUrl,
  });

  config.whisper.model = await input({
    message: 'Whisper model',
    default: config.whisper.model,
  });

  config.whisper.api_key =
    (await password({
      message: 'Whisper API key (blank = none)',
      mask: '*',
    })) || config.whisper.api_key;

  console.log();

  const ok = await confirm({ message: 'Save configuration?', default: true });
  if (ok) {
    saveConfig(config);
    printSuccess('Configuration saved.');
  } else {
    printInfo('Configuration not saved.');
  }

  console.log();
}
