import { ScreenBuffer } from './screen-buffer';
import { parse, type CODE } from '@ansi-tools/parser';

/**
 * AnsiProcessor feeds raw ANSI escape code text into a ScreenBuffer,
 * handling cursor positioning, SGR (colors/attributes), scrolling,
 * clears, and streaming across chunk boundaries.
 */
export class AnsiProcessor {
  private buffer: ScreenBuffer;
  private stateBuffer: string = '';

  constructor(buffer: ScreenBuffer) {
    this.buffer = buffer;
  }

  /**
   * Feed a chunk of raw ANSI text into the processor.
   * Automatically prepends any partial escape sequence held over from
   * the previous chunk, and saves any trailing partial sequence for
   * the next chunk.
   */
  process(data: string): void {
    // Handle mid-sequence splits by prepending any leftover from last chunk
    const input = this.stateBuffer + data;
    this.stateBuffer = '';

    const codes = parse(input);

    for (const code of codes) {
      if (code.type === 'TEXT') {
        this.buffer.write(code.raw);
        continue;
      }

      // code is CONTROL_CODE — has type, command, params, raw, pos
      const cmd = code.command;
      const params = code.params.map(p => {
        const n = Number(p);
        return isNaN(n) ? 1 : n;
      });

      switch (code.type) {
        case 'CSI': {
          // SGR sequences arrive as CSI with command === 'm'
          if (cmd === 'm') {
            // token.params is string[] like ['31', '1']
            const sgrParams = code.params.map(Number);
            // If empty params (bare \x1b[m), treat as reset (0)
            if (sgrParams.length === 0 || (sgrParams.length === 1 && isNaN(sgrParams[0]))) {
              this.buffer.setSGR([0]);
            } else {
              this.buffer.setSGR(sgrParams);
            }
            break;
          }

          const n = params.length > 0 ? params[0] : 1;

          switch (cmd) {
            case 'A': this.buffer.moveCursor(-n, 0); break;  // CUU
            case 'B': this.buffer.moveCursor(n, 0); break;   // CUD
            case 'C': this.buffer.moveCursor(0, n); break;   // CUF
            case 'D': this.buffer.moveCursor(0, -n); break;  // CUB

            case 'H': case 'f': {  // CUP — cursor position
              const row = params[0] ? params[0] - 1 : 0;
              const col = params[1] ? params[1] - 1 : 0;
              this.buffer.setCursor(row, col);
              break;
            }

            case 'J': {  // ED — erase in display
              // 0 or missing = cursor to end of screen, 1 = start to cursor, 2 = all
              if (n === 2 || n === 3) {
                this.buffer.clearScreen();
              } else if (n === 1) {
                this.buffer.clearToEndOfScreen();
              } else {
                this.buffer.clearToEndOfScreen();
              }
              break;
            }

            case 'K': {  // EL — erase in line
              if (n === 2) {
                this.buffer.clearLine();
              } else if (n === 1) {
                this.buffer.clearToEndOfLine();
              } else {
                this.buffer.clearToEndOfLine();
              }
              break;
            }

            case 'S': this.buffer.scrollUp(n); break;   // SU
            case 'T': this.buffer.scrollDown(n); break;  // SD
            case '@': /* ICH — insert character — not implemented */ break;
            case 'L': /* IL — insert lines — not implemented */ break;
            case 'M': /* DL — delete lines — not implemented */ break;
            case 'P': /* DCH — delete character — not implemented */ break;
            case 'X': /* ECH — erase character — not implemented */ break;

            default: break;  // Silently ignore unsupported CSI commands
          }
          break;
        }

        case 'OSC': {
          // Operating System Command (e.g. set window title) — ignore for MVP
          break;
        }

        case 'ESC': {
          // Simple escape sequences (\x1b7, \x1b8, etc.)
          if (cmd === '7') { /* DECSC — save cursor — not implemented */ }
          else if (cmd === '8') { /* DECRC — restore cursor — not implemented */ }
          break;
        }

        case 'DCS':
        case 'DEC':
        case 'PRIVATE':
        case 'STRING':
        default:
          // Silently ignore unsupported sequence types
          break;
      }
    }

    // Detect incomplete escape sequences at the end of the input
    // for proper streaming across chunk boundaries.
    // The parser produces CONTROL_CODE entries with command === '' when
    // the escape sequence is truncated (missing its final byte).
    if (codes.length > 0) {
      const last = codes[codes.length - 1];
      if (last.type !== 'TEXT' && last.type in { CSI: 1, ESC: 1, DCS: 1, OSC: 1 } && last.command === '') {
        this.stateBuffer = last.raw;
      }
    }
  }

  isDirty(): boolean {
    return this.buffer.isDirty();
  }

  clearDirty(): void {
    this.buffer.clearDirty();
  }
}
