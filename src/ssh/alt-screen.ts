/**
 * 跟踪远端是否处于终端的「备用屏」（全屏程序模式）。
 *
 * 全屏程序（vim / less / htop / mc / tmux …）通过 xterm 私有模式序列切屏：
 *
 *   ESC [ ? 1049 h   进入备用屏（保存光标 + 清屏）
 *   ESC [ ? 1049 l   退出备用屏（恢复主屏）
 *
 * 老程序可能用 `47` / `1047`；`1048` 只是保存/恢复光标位置，不切换缓冲区，
 * 所以故意不匹配。
 *
 * SSH 数据按块到达，序列可能被切断（这一块结尾 `ESC[?10`、下一块开头 `49h`），
 * 因此每次扫描都把上一块的最后 `TAIL_SIZE` 字节拼回来。重叠部分重复命中的
 * 是同一段序列，而 h/l 只是赋值，重复应用是幂等的。
 */
const ALT_SCREEN = /\x1b\[\?([0-9;]*)([hl])/g;
/** Modes that switch to the alternate buffer; 1048 only saves the cursor. */
const ALT_SCREEN_MODES = new Set(['47', '1047', '1049']);
/** Combined modes (`ESC[?1049;25h`) can be longer than the 8-byte form. */
const TAIL_SIZE = 32;

export interface AltScreenTracker {
  /** 喂入一块 SSH 数据并更新状态 */
  feed(chunk: Uint8Array): void;
  /** 远端当前是否在备用屏 */
  readonly active: boolean;
  /** 复位（标签关闭 / 重连时使用） */
  reset(): void;
}

export function createAltScreenTracker(): AltScreenTracker {
  let tail = '';
  let active = false;

  return {
    feed(chunk: Uint8Array): void {
      if (chunk.length === 0) return;

      // latin1 逐字节映射：不会让多字节 UTF-8 破坏转义序列
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const text = tail + bytes.toString('latin1');
      tail = text.slice(-TAIL_SIZE);

      // 必须按出现顺序处理：同一块里可能既有 h 又有 l，末态才是当前模式
      ALT_SCREEN.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = ALT_SCREEN.exec(text)) !== null) {
        // 多模式写法：只要参数里包含备用屏模式就生效（1048 忽略）
        const modes = match[1].split(';');
        if (!modes.some((mode) => ALT_SCREEN_MODES.has(mode))) continue;
        active = match[2] === 'h';
      }
    },

    get active(): boolean {
      return active;
    },

    reset(): void {
      tail = '';
      active = false;
    },
  };
}
