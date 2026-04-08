import chalk from 'chalk';
import { spawn } from 'child_process';

const INDENT = '  ';
const BANNER_ROWS = 6;  // rows 1-6: blank + box (4 lines) + blank
const BOTTOM_ROWS = 2;  // last 2 rows: divider + controls

// Block characters for the waveform animation, shortest to tallest
const WAVE_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
const WAVE_WIDTH = 18;

/** Content width, capped so it always fits within the terminal. */
function getWidth(): number {
  const cols = process.stdout.columns || 80;
  return Math.max(40, Math.min(cols - INDENT.length * 2, 100));
}

// ── Strip ANSI / control codes ─────────────────────────────────────────
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b[^[]/g;
const CTRL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g; // keep \t \n \r

function sanitize(text: string): string {
  return text.replace(ANSI_RE, '').replace(CTRL_RE, '');
}

// ── Text-wrap helpers ──────────────────────────────────────────────────

/** Wrap text into lines, each at most maxWidth chars (plain text). */
function wrapToLines(text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const sep = current ? ' ' : '';
    if (current.length + sep.length + word.length > maxWidth) {
      if (current) lines.push(current);
      current = word;
    } else {
      current += sep + word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

// ── Fixed UI layout ────────────────────────────────────────────────────
//
// Layout (rows are 1-indexed):
//   Rows 1-6         → fixed banner (top bar)
//   Rows 7 .. N-2    → scrollable content  (scroll region)
//   Rows N-1 .. N    → fixed controls (bottom bar)

function drawTopBar(): void {
  const w = getWidth();
  const inner = w - 2;
  process.stdout.write('\x1b[s');  // save cursor

  process.stdout.write('\x1b[1;1H\x1b[2K');  // row 1 — blank
  process.stdout.write('\x1b[2;1H\x1b[2K');  // row 2 — top border
  process.stdout.write(chalk.bold.cyan(`${INDENT}╭${'─'.repeat(inner)}╮`));
  process.stdout.write('\x1b[3;1H\x1b[2K');  // row 3 — title
  process.stdout.write(
    chalk.bold.cyan(`${INDENT}│`) +
    chalk.bold.white(` Local LLM Whisper`.padEnd(inner)) +
    chalk.bold.cyan('│'),
  );
  process.stdout.write('\x1b[4;1H\x1b[2K');  // row 4 — subtitle
  process.stdout.write(
    chalk.bold.cyan(`${INDENT}│`) +
    chalk.dim(` Voice-to-chat with your local LLM`.padEnd(inner)) +
    chalk.bold.cyan('│'),
  );
  process.stdout.write('\x1b[5;1H\x1b[2K');  // row 5 — bottom border
  process.stdout.write(chalk.bold.cyan(`${INDENT}╰${'─'.repeat(inner)}╯`));
  process.stdout.write('\x1b[6;1H\x1b[2K');  // row 6 — blank

  process.stdout.write('\x1b[u');  // restore cursor
}

function drawBottomBar(rows: number): void {
  const w = getWidth();
  process.stdout.write('\x1b[s');
  process.stdout.write(`\x1b[${rows - 1};1H\x1b[2K`);
  process.stdout.write(chalk.dim(`${INDENT}${'─'.repeat(w - 2)}`));
  process.stdout.write(`\x1b[${rows};1H\x1b[2K`);
  process.stdout.write(
    chalk.dim(
      `${INDENT}[${chalk.white('Space')}] Record  ` +
      `[${chalk.white('c')}] Config  ` +
      `[${chalk.white('r')}] Reset chat  ` +
      `[${chalk.white('q')}] Quit`,
    ),
  );
  process.stdout.write('\x1b[u');
}

export function setupUI(): void {
  const rows = process.stdout.rows || 24;
  // Enter alternate screen buffer (like vim/htop) — prevents scrollback bleed
  process.stdout.write('\x1b[?1049h');
  // Clear screen and home cursor before drawing fixed regions
  process.stdout.write('\x1b[2J\x1b[H');

  const hasBanner = rows >= BANNER_ROWS + BOTTOM_ROWS + 3; // need at least 3 content rows
  if (hasBanner) {
    drawTopBar();
    drawBottomBar(rows);
    const contentTop = BANNER_ROWS + 1;
    const contentBottom = rows - BOTTOM_ROWS;
    process.stdout.write(`\x1b[${contentTop};${contentBottom}r`);
    process.stdout.write(`\x1b[${contentBottom};1H`);
  } else {
    // Terminal too short for banner — just fix the bottom controls
    drawBottomBar(rows);
    process.stdout.write(`\x1b[1;${rows - BOTTOM_ROWS}r`);
    process.stdout.write(`\x1b[${rows - BOTTOM_ROWS};1H`);
  }
}

export function teardownUI(): void {
  // Reset scroll region, clear screen, then leave alternate screen buffer
  process.stdout.write('\x1b[r\x1b[2J\x1b[H\x1b[?1049l');
}

/**
 * Full redraw after a resize: clears the screen and redraws all fixed regions.
 * Content history is lost but the layout is always correct after a resize.
 */
export function redrawUI(): void {
  const rows = process.stdout.rows || 24;
  // Clear the entire screen first so nothing is left in a broken position
  process.stdout.write('\x1b[2J\x1b[H');

  const hasBanner = rows >= BANNER_ROWS + BOTTOM_ROWS + 3;
  if (hasBanner) {
    drawTopBar();
    drawBottomBar(rows);
    const contentTop = BANNER_ROWS + 1;
    const contentBottom = rows - BOTTOM_ROWS;
    process.stdout.write(`\x1b[${contentTop};${contentBottom}r`);
    process.stdout.write(`\x1b[${contentBottom};1H`);
  } else {
    drawBottomBar(rows);
    process.stdout.write(`\x1b[1;${rows - BOTTOM_ROWS}r`);
    process.stdout.write(`\x1b[${rows - BOTTOM_ROWS};1H`);
  }
}

// Kept for use outside the main loop (e.g. first-run config prompt)
export function printBanner(): void {
  const w = getWidth();
  const inner = w - 2;
  console.log();
  console.log(chalk.bold.cyan(`${INDENT}╭${'─'.repeat(inner)}╮`));
  console.log(
    chalk.bold.cyan(`${INDENT}│`) +
      chalk.bold.white(` Local LLM Whisper`.padEnd(inner)) +
      chalk.bold.cyan('│'),
  );
  console.log(
    chalk.bold.cyan(`${INDENT}│`) +
      chalk.dim(` Voice-to-chat with your local LLM`.padEnd(inner)) +
      chalk.bold.cyan('│'),
  );
  console.log(chalk.bold.cyan(`${INDENT}╰${'─'.repeat(inner)}╯`));
  console.log();
}

export function printControls(): void {
  console.log(
    chalk.dim(
      `${INDENT}[${chalk.white('Space')}] Record  ` +
        `[${chalk.white('c')}] Config  ` +
        `[${chalk.white('r')}] Reset chat  ` +
        `[${chalk.white('q')}] Quit`,
    ),
  );
  console.log();
}

export function clearLine(): void {
  process.stdout.write(`\r${' '.repeat(process.stdout.columns || 80)}\r`);
}

export function printUserMessage(text: string): void {
  clearLine();
  console.log();
  const w = getWidth();

  // Right-aligned label: "(^_^)  You"
  const labelPlain = '(^_^)  You';
  const labelStyled = chalk.dim('(^_^)') + '  ' + chalk.bold.blue('You');
  process.stdout.write(' '.repeat(Math.max(0, w - labelPlain.length)));
  console.log(labelStyled);

  // Right-align each wrapped line of the message
  for (const line of wrapToLines(text, w)) {
    const pad = Math.max(0, w - line.length);
    console.log(' '.repeat(pad) + chalk.white(line));
  }
  console.log();
}

/**
 * Prints the "[o_o]  Assistant" label on its own line and returns the column
 * where response text will start, for use by StreamWriter.
 */
export function printAssistantLabel(): number {
  process.stdout.write(
    `\n${INDENT}${chalk.dim('[o_o]')}  ${chalk.bold.green('Assistant')}\n${INDENT}`,
  );
  return INDENT.length; // 2 — content starts at the indent level
}

export function printChunk(text: string): void {
  process.stdout.write(sanitize(text));
}

export function printResponseEnd(): void {
  console.log('\n');
  // Soft ping to signal the LLM finished — macOS only, fire-and-forget
  if (process.platform === 'darwin') {
    const proc = spawn('afplay', ['/System/Library/Sounds/Tink.aiff', '-v', '0.4'], {
      stdio: 'ignore',
      detached: true,
    });
    proc.unref();
  }
}

export function printError(message: string): void {
  clearLine();
  console.log();
  console.log(`${INDENT}${chalk.bold.red('Error')}  ${chalk.red(message)}`);
  console.log();
}

export function printInfo(message: string): void {
  console.log(chalk.dim(`${INDENT}${message}`));
}

export function printSuccess(message: string): void {
  console.log(`${INDENT}${chalk.green('✓')} ${chalk.dim(message)}`);
}

// ── Streaming word-wrapper ─────────────────────────────────────────────
//
// Accumulates characters into words and flushes them to stdout, wrapping at
// getWidth() so long LLM responses never overflow the terminal edge.
// Continuation lines are indented to align with the first character of the
// response (i.e. after the "Assistant  " label).

export class StreamWriter {
  private col: number;
  private readonly wrapIndent: string;
  private wordBuf = '';
  private atLineStart = false;

  constructor(startCol: number) {
    this.col = startCol;
    this.wrapIndent = ' '.repeat(startCol);
  }

  write(text: string): void {
    const clean = sanitize(text);
    for (const ch of clean) {
      if (ch === '\n') {
        this._flushWord();
        process.stdout.write('\n' + this.wrapIndent);
        this.col = this.wrapIndent.length;
        this.atLineStart = true;
      } else if (ch === ' ') {
        this._flushWord();
        if (!this.atLineStart) {
          process.stdout.write(' ');
          this.col++;
        }
      } else {
        this.wordBuf += ch;
        this.atLineStart = false;
      }
    }
  }

  flush(): void {
    this._flushWord();
  }

  private _flushWord(): void {
    if (!this.wordBuf) return;
    const maxCol = getWidth();
    if (this.col + this.wordBuf.length > maxCol) {
      process.stdout.write('\n' + this.wrapIndent);
      this.col = this.wrapIndent.length;
      this.atLineStart = false;
    }
    process.stdout.write(this.wordBuf);
    this.col += this.wordBuf.length;
    this.wordBuf = '';
  }
}

// ── Thinking panel ────────────────────────────────────────────────────
//
// Displays model reasoning (<think> blocks / reasoning_content).
// Collapsed (default): animated ASCII brain, finished with a compact summary.
// Expanded (Ctrl+B):   full thinking text with a box header/footer.

// Four-frame ASCII brain animation — cycles at 220 ms
const BRAIN_FRAMES = ['(@_@)', '(*_*)', '(o_o)', '(0_0)'];

export class ThinkingPanel {
  private buffer = '';
  private expanded: boolean;
  private started = false;
  private completed = false;
  private brainTimer: ReturnType<typeof setInterval> | null = null;
  private frameIdx = 0;

  constructor(expanded: boolean) {
    this.expanded = expanded;
  }

  addChunk(text: string): void {
    const clean = sanitize(text);
    if (!clean) return;

    if (!this.started) {
      this.started = true;
      if (this.expanded) {
        this._printHeader();
      } else {
        // Kick off brain animation
        this._renderBrain();
        this.brainTimer = setInterval(() => {
          this.frameIdx = (this.frameIdx + 1) % BRAIN_FRAMES.length;
          this._renderBrain();
        }, 220);
      }
    }

    this.buffer += clean;

    if (this.expanded) {
      process.stdout.write(chalk.dim(clean));
    }
    // In collapsed mode the timer drives all rendering — nothing to do here
  }

  expand(): void {
    if (this.expanded) return;
    this.expanded = true;
    this._stopBrain();
    if (!this.started) return;

    if (this.completed) {
      // After completion: replay below current cursor
      process.stdout.write('\n');
      this._printHeader();
      process.stdout.write(chalk.dim(this.buffer));
      const w = getWidth();
      process.stdout.write(`\n${INDENT}${chalk.dim('└' + '─'.repeat(Math.max(0, w - 4)))}\n`);
    } else {
      // Mid-stream: erase indicator and replay buffered reasoning so far
      process.stdout.write('\r\x1b[2K');
      this._printHeader();
      process.stdout.write(chalk.dim(this.buffer));
    }
  }

  collapse(): void {
    if (!this.expanded) return;
    this.expanded = false;
    // If still streaming, restart the brain animation
    if (this.started && !this.completed) {
      this._renderBrain();
      this.brainTimer = setInterval(() => {
        this.frameIdx = (this.frameIdx + 1) % BRAIN_FRAMES.length;
        this._renderBrain();
      }, 220);
    }
  }

  toggle(show: boolean): void {
    if (show) this.expand(); else this.collapse();
  }

  complete(): void {
    if (!this.started) return;
    this._stopBrain();
    this.completed = true;
    if (this.expanded) {
      const w = getWidth();
      process.stdout.write(`\n${INDENT}${chalk.dim('└' + '─'.repeat(Math.max(0, w - 4)))}\n`);
    } else {
      process.stdout.write(
        `\r\x1b[2K${INDENT}${chalk.dim('◆ Thought')}` +
          chalk.dim('  [Ctrl+B to expand]\n'),
      );
    }
  }

  /** Stop timers — call before discarding the panel on errors/cleanup. */
  dispose(): void { this._stopBrain(); }

  get hasContent(): boolean { return this.buffer.length > 0; }

  private _renderBrain(): void {
    const brain = chalk.yellow(BRAIN_FRAMES[this.frameIdx]);
    process.stdout.write(`\r${INDENT}${brain}  ${chalk.dim('thinking...')}`);
  }

  private _printHeader(): void {
    const w = getWidth();
    process.stdout.write(
      `${INDENT}${chalk.dim('┌─ Thinking ' + '─'.repeat(Math.max(0, w - 14)))}\n`,
    );
  }

  private _stopBrain(): void {
    if (this.brainTimer) { clearInterval(this.brainTimer); this.brainTimer = null; }
  }
}

// ── Idle mic indicator ────────────────────────────────────────────────
//
// Shown when the app is waiting for input. A mic icon blinks at 700 ms
// and a rotating italic tip is displayed. Tips advance after each chat.

const TIPS = [
  'Press Space to start recording',
  'Ask me anything — I\'m all ears',
  'Have a nice day! ✨',
  'You have a lovely voice',
  'Just speak naturally — I\'ll handle the rest',
  'Tip: [r] resets the conversation',
  'Tip: [c] opens configuration',
  'Pro tip: longer recordings give better context',
  'Press [c] to check your LLM server is running',
  'Make sure your Whisper server is up and reachable',
  'Ctrl+B reveals the model\'s thinking (if supported)',
  'Ready when you are',
  'Your voice is your keyboard here',
  'What\'s on your mind?',
  'Got a question? I got answers',
  'Try asking something complex — I love details',
  'Need clarity? Say: \"explain like I\'m five\"',
  'Remember: press Space to START and STOP',
  'Don\'t worry about pacing, just speak naturally',
  'I can read your tone and inflection',
  'Keep me chatting — I never sleep',
  'Need a break? Press [q] anytime',
  'Your privacy is local — nothing leaves your machine',
  'Experiment with the system prompt in config',
  'Why do programmers prefer dark mode? — Because light attracts bugs 🐛',
  'There are only two hard things in Computer Science: cache invalidation, naming things, and off-by-one errors',
  'A SQL query walks into a bar, walks up to two tables and asks: \"Can I join you?\"',
  'I would tell you a UDP joke but you might not get it',
  'My stack overflow problem is too recursive',
  '404: Brain not found — try speaking more clearly',
  'Hello World! My first LLM conversation',
  'Let\'s debug this chat together...',
  'npm install some wisdom 📦',
  'if (hasVoice) { speak(); }',
];

export class IdleIndicator {
  private timer: ReturnType<typeof setInterval> | null = null;
  private blinkOn = true;
  private tipIndex = 0;

  start(): void {
    if (this.timer) return;
    this.blinkOn = true;
    this._render();
    this.timer = setInterval(() => {
      this.blinkOn = !this.blinkOn;
      this._render();
    }, 700);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    clearLine();
  }

  nextTip(): void {
    this.tipIndex = (this.tipIndex + 1) % TIPS.length;
  }

  private _render(): void {
    // ASCII mic: (•) blinks to ( ) — same width so \r overwrites cleanly
    const mic = this.blinkOn ? chalk.red('(•)') : chalk.dim('( )');
    const tip = chalk.italic(chalk.dim(TIPS[this.tipIndex]));
    process.stdout.write(`\r${INDENT}${mic}  ${tip}`);
  }
}

// ── Recording display ──────────────────────────────────────────────────
//
// Animates a scrolling waveform while audio is being captured.

export class RecordingDisplay {
  private waveTimer: ReturnType<typeof setInterval> | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private wave: number[] = [];
  private seconds = 0;

  start(): void {
    this.seconds = 0;
    this.wave = Array.from({ length: WAVE_WIDTH }, () => this.randomBar());
    this.render();

    this.waveTimer = setInterval(() => {
      this.wave.shift();
      this.wave.push(this.randomBar());
      this.render();
    }, 120);

    this.clockTimer = setInterval(() => { this.seconds++; }, 1000);
  }

  stop(): void {
    if (this.waveTimer) { clearInterval(this.waveTimer); this.waveTimer = null; }
    if (this.clockTimer) { clearInterval(this.clockTimer); this.clockTimer = null; }
    clearLine();
  }

  private randomBar(): number {
    const r = Math.random();
    if (r < 0.08) return 7;
    if (r < 0.15) return 0;
    return Math.floor(1 + Math.random() * 6);
  }

  private render(): void {
    const secs = String(this.seconds).padStart(2, '0');
    const wave = this.wave.map(v => chalk.red(WAVE_CHARS[v])).join('');
    process.stdout.write(
      `\r${INDENT}${chalk.red.bold('● REC')} ${chalk.red(`0:${secs}`)}  ${wave}  ${chalk.dim('Space to stop')}`,
    );
  }
}
