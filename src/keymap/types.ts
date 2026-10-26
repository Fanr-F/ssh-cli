/**
 * 快捷键系统的公共类型。
 *
 * 设计原则：
 * - 「有哪些键、在哪个上下文生效」集中在 `bindings.ts`；
 * - 「按键后干什么」留在各自的模块里，通过 binding.id 关联；
 * - 帮助弹窗 / README 从同一份数据生成，避免文档漂移。
 */

/** 应用当前的键盘焦点区域。 */
export type FocusZone = 'sidebar' | 'terminal' | 'form' | 'sftp';

/**
 * 绑定生效的层级。
 *
 * 分发顺序（前面的优先级更高）：
 *   system → help / form（模态） → global → 当前焦点
 */
export type Scope = 'system' | 'help' | 'form' | 'global' | 'sidebar' | 'terminal' | 'sftp';

/** 帮助弹窗与 README 的分组。 */
export type Group =
  | 'general'
  | 'sidebar'
  | 'terminal'
  | 'sftp'
  | 'sftp-prompt'
  | 'sftp-command'
  | 'form'
  | 'mouse';

/** 一个按键模式。未写的修饰键表示「不关心」。 */
export interface KeyPattern {
  /** 归一化后的 `KeyEvent.name`，如 `c` / `tab` / `f1` / `pageup` / `:`。 */
  name?: string;
  ctrl?: boolean;
  shift?: boolean;
  /** Alt（OpenTUI 里叫 meta / option）。 */
  meta?: boolean;
  /** 兜底：匹配任意键（用于「任意键关闭帮助」）。 */
  any?: boolean;
}

/** 归一化后的按键，屏蔽终端差异后交给匹配器。 */
export interface NormalizedKey {
  name: string;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  sequence: string;
  /** 单字符可打印输入（不含 Ctrl/Alt 组合）。 */
  printable: boolean;
}

/** 分发时传入的上下文快照，`when` 条件和动作都基于它判断。 */
export interface KeyContext {
  focus: FocusZone;
  helpOpen: boolean;
  formOpen: boolean;
  /** SFTP 是否处于 `:` 命令行模式。 */
  sftpCmdMode: boolean;
  /** 表单当前聚焦字段索引（-1 表示不在表单内）。 */
  formField: number;
  /** 当前激活标签的类型。 */
  activeTabType: 'terminal' | 'sftp' | null;
}

/**
 * 动作归属：
 * - `app`（默认）：由 App 的动作表执行；
 * - `component`：交给对应组件自己的按键处理（SFTP / 表单），
 *   组件内部同样查这张表来决定语义。
 */
export type BindingOwner = 'app' | 'component';

export interface Binding {
  /** 唯一标识，也是动作表 / 日志里的键。 */
  id: string;
  scope: Scope;
  key: KeyPattern | KeyPattern[];
  group: Group;
  /** 英文说明（帮助弹窗 + README.md）。 */
  en: string;
  /** 中文说明（README.zh.md）。 */
  zh: string;
  /** 展示文案覆盖，仅用于无法自动生成的写法（如 `F2-F12`）。 */
  keys?: string;
  owner?: BindingOwner;
  /** 额外条件，例如 SFTP 命令模式、表单的自定义字段。 */
  when?: (ctx: KeyContext) => boolean;
}

/** 只用于文档、不参与按键匹配的条目（鼠标操作、SFTP 命令）。 */
export interface ManualEntry {
  group: Group;
  keys: string;
  /** 中文文档里的键名/手势名（缺省沿用 `keys`）。 */
  keysZh?: string;
  en: string;
  zh: string;
}

export const GROUP_TITLES: Record<Group, { en: string; zh: string }> = {
  general: { en: 'General', zh: '通用' },
  sidebar: { en: 'Sidebar', zh: '侧边栏' },
  terminal: { en: 'Terminal', zh: '终端' },
  sftp: { en: 'SFTP', zh: 'SFTP' },
  'sftp-prompt': { en: 'SFTP Command Line', zh: 'SFTP 命令行编辑' },
  'sftp-command': { en: 'SFTP Commands', zh: 'SFTP 命令' },
  form: { en: 'Form', zh: '表单' },
  mouse: { en: 'Mouse', zh: '鼠标' },
};

/** 帮助弹窗 / README 中分组的显示顺序。 */
export const GROUP_ORDER: Group[] = [
  'general',
  'sidebar',
  'terminal',
  'sftp',
  'sftp-prompt',
  'sftp-command',
  'form',
  'mouse',
];

/** 分组下方的补充说明（可选）。 */
export const GROUP_NOTES: Partial<Record<Group, { en: string; zh: string }>> = {
  'sftp-prompt': {
    en: 'Only active after pressing `:` to enter command mode.',
    zh: '仅在按 `:` 进入命令行模式后生效。',
  },
  'sftp-command': {
    en: 'Command mode is persistent — Enter executes but stays in the prompt, Esc exits.',
    zh: '命令模式常驻：Enter 执行后仍留在命令行，Esc 退出。',
  },
};
