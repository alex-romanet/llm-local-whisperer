import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface Config {
  llm: {
    endpoint: string;
    api_key: string;
    model: string;
    temperature: number;
    max_tokens: number;
    system_prompt: string;
  };
  whisper: {
    endpoint: string;
    api_key: string;
    model: string;
  };
}

const CONFIG_DIR = path.join(os.homedir(), '.config', 'llm-local-whisperer');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export const DEFAULT_CONFIG: Config = {
  llm: {
    endpoint: 'http://localhost:11434/v1',
    api_key: 'ollama',
    model: 'llama3',
    temperature: 0.7,
    max_tokens: 2048,
    system_prompt: 'You are a helpful assistant.',
  },
  whisper: {
    endpoint: 'http://localhost:9000/v1',
    api_key: 'none',
    model: 'whisper-1',
  },
};

function deepMerge<T>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key in source) {
    const val = source[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      (result as Record<string, unknown>)[key] = deepMerge(
        (target as Record<string, unknown>)[key] ?? {},
        val as Record<string, unknown>
      );
    } else if (val !== undefined) {
      (result as Record<string, unknown>)[key] = val;
    }
  }
  return result;
}

export function loadConfig(): Config {
  if (!fs.existsSync(CONFIG_FILE)) {
    return structuredClone(DEFAULT_CONFIG);
  }
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<Config>;
    return deepMerge(DEFAULT_CONFIG, parsed);
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function saveConfig(config: Config): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export function configFileExists(): boolean {
  return fs.existsSync(CONFIG_FILE);
}
