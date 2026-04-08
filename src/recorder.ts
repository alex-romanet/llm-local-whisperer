import { spawn, ChildProcess, execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export function checkSox(): boolean {
  try {
    execSync('which sox', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export class Recorder {
  private process: ChildProcess | null = null;
  private tempFile: string = '';

  start(): void {
    if (this.process) return;

    this.tempFile = path.join(os.tmpdir(), `llm-whisper-${Date.now()}.wav`);

    // sox -d: default input device, 16kHz mono 16-bit signed PCM — optimal for Whisper
    this.process = spawn(
      'sox',
      ['-d', '-r', '16000', '-c', '1', '-b', '16', '-e', 'signed-integer', this.tempFile],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );

    // Suppress sox progress output
    this.process.stderr?.on('data', () => {});
  }

  stop(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.process) {
        reject(new Error('Not currently recording'));
        return;
      }

      const proc = this.process;
      this.process = null;

      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        proc.kill('SIGKILL');
        reject(new Error('sox timed out — audio capture did not finish within 10 s'));
      }, 10_000);

      proc.on('close', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(this.tempFile);
      });

      proc.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(err);
      });

      // SIGTERM causes sox to gracefully finalize the WAV header before exiting
      proc.kill('SIGTERM');
    });
  }

  cleanup(): void {
    try {
      if (this.tempFile && fs.existsSync(this.tempFile)) {
        fs.unlinkSync(this.tempFile);
      }
    } catch {
      // ignore cleanup errors
    }
  }

  isRecording(): boolean {
    return this.process !== null;
  }
}
