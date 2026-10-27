import type { Binding, KeyContext, KeyPattern, ManualEntry, Scope } from './types';
import { matchesKey } from './matcher';

/**
 * 全局唯一事实来源：所有快捷键都在这里声明。
 *
 * 新增/修改快捷键：
 *   1. 在下面的表里加一条（或改 `key`）；
 *   2. 若 id 是新的，在 App 的动作表（`src/app.ts`）或
 *      对应组件里实现它；
 *   3. 帮助弹窗与 README 会从这张表自动生成，无需手改文档。
 */

const ENTER: KeyPattern[] = [{ name: 'enter' }, { name: 'return' }];
/** F 键只接受“裸按”，带任何修饰键都不算标签切换。 */
const FKEY = (name: string): KeyPattern => ({ name, ctrl: false, shift: false, meta: false });

export const BINDINGS: Binding[] = [
  // ── system：最高优先级，模态打开时仍然生效 ──────────────────────
  {
    id: 'app.quit',
    scope: 'system',
    key: { name: 'q', ctrl: true },
    group: 'general',
    en: 'Quit application',
    zh: '退出应用',
  },
  {
    id: 'help.toggle',
    scope: 'system',
    key: { name: 'f1' },
    group: 'general',
    en: 'Show / hide help',
    zh: '打开 / 关闭帮助',
  },

  // ── global：任何焦点下都生效 ────────────────────────────────────
  {
    id: 'tab.prev',
    scope: 'global',
    key: { name: 'up', meta: true },
    group: 'general',
    en: 'Previous tab',
    zh: '切换到上一个标签页',
  },
  {
    id: 'tab.next',
    scope: 'global',
    key: { name: 'down', meta: true },
    group: 'general',
    en: 'Next tab',
    zh: '切换到下一个标签页',
  },
  {
    id: 'tab.goto',
    scope: 'global',
    key: [
      // 必须显式排除修饰键：否则 Shift+F4 / Ctrl+F2 也会被当成切标签
      FKEY('f2'), FKEY('f3'), FKEY('f4'), FKEY('f5'),
      FKEY('f6'), FKEY('f7'), FKEY('f8'), FKEY('f9'),
      FKEY('f10'), FKEY('f11'), FKEY('f12'),
    ],
    keys: 'F2-F12',
    group: 'general',
    en: 'Switch to tab 1-11',
    zh: '切换到第 1-11 个标签页',
  },
  {
    id: 'sftp.open',
    scope: 'global',
    key: { name: 'e', ctrl: true },
    group: 'general',
    en: 'Open SFTP tab for active connection',
    zh: '为当前连接打开 SFTP 标签页',
  },
  {
    id: 'focus.sidebar',
    scope: 'global',
    key: { name: 'left', meta: true },
    group: 'general',
    en: 'Focus sidebar',
    zh: '焦点移到侧边栏',
  },
  {
    id: 'focus.terminal',
    scope: 'global',
    key: { name: 'right', meta: true },
    group: 'general',
    en: 'Focus terminal',
    zh: '焦点移到终端',
  },
  // ── sidebar：仅在侧边栏聚焦时生效 ──────────────────────────────
  {
    id: 'sidebar.up',
    scope: 'sidebar',
    key: { name: 'up' },
    group: 'sidebar',
    en: 'Previous connection',
    zh: '上一个连接',
  },
  {
    id: 'sidebar.down',
    scope: 'sidebar',
    key: { name: 'down' },
    group: 'sidebar',
    en: 'Next connection',
    zh: '下一个连接',
  },
  {
    id: 'sidebar.connect',
    scope: 'sidebar',
    key: ENTER,
    group: 'sidebar',
    en: 'Connect to selected server',
    zh: '连接选中的服务器',
  },
  {
    id: 'sidebar.add',
    scope: 'sidebar',
    key: { name: 'a', ctrl: false, meta: false },
    group: 'sidebar',
    en: 'Add new connection',
    zh: '新建连接',
  },
  {
    id: 'sidebar.edit',
    scope: 'sidebar',
    key: { name: 'e', ctrl: false, meta: false },
    group: 'sidebar',
    en: 'Edit selected connection',
    zh: '编辑选中的连接',
  },
  {
    id: 'sidebar.delete',
    scope: 'sidebar',
    key: { name: 'delete' },
    group: 'sidebar',
    en: 'Delete selected connection (no confirmation)',
    zh: '删除选中的连接（无二次确认）',
  },

  // ── terminal：仅在终端聚焦时生效 ────────────────────────────────
  {
    id: 'terminal.pageUp',
    scope: 'terminal',
    key: { name: 'pageup' },
    group: 'terminal',
    en: 'Scroll output up (or page the remote full-screen program)',
    zh: '向上翻页（全屏程序下转发给远端）',
  },
  {
    id: 'terminal.pageDown',
    scope: 'terminal',
    key: { name: 'pagedown' },
    group: 'terminal',
    en: 'Scroll output down (or page the remote full-screen program)',
    zh: '向下翻页（全屏程序下转发给远端）',
  },

  // ── sftp：两种子状态（命令模式 / 浏览模式）──────────────────────
  {
    id: 'sftp.cmd.execute',
    scope: 'sftp',
    key: ENTER,
    group: 'sftp-prompt',
    owner: 'component',
    when: (ctx) => ctx.sftpCmdMode,
    en: 'Execute command (stays in command mode)',
    zh: '执行命令（保持命令行模式）',
  },
  {
    id: 'sftp.cmd.cancel',
    scope: 'sftp',
    key: { name: 'escape' },
    group: 'sftp-prompt',
    owner: 'component',
    when: (ctx) => ctx.sftpCmdMode,
    en: 'Leave command mode',
    zh: '退出命令行模式',
  },
  {
    id: 'sftp.cmd.historyPrev',
    scope: 'sftp',
    key: { name: 'up' },
    group: 'sftp-prompt',
    owner: 'component',
    when: (ctx) => ctx.sftpCmdMode,
    en: 'Previous command in history',
    zh: '上一条历史命令',
  },
  {
    id: 'sftp.cmd.historyNext',
    scope: 'sftp',
    key: { name: 'down' },
    group: 'sftp-prompt',
    owner: 'component',
    when: (ctx) => ctx.sftpCmdMode,
    en: 'Next command in history',
    zh: '下一条历史命令',
  },
  {
    id: 'sftp.cmd.backspace',
    scope: 'sftp',
    key: { name: 'backspace' },
    group: 'sftp-prompt',
    owner: 'component',
    when: (ctx) => ctx.sftpCmdMode,
    en: 'Delete character before cursor',
    zh: '删除光标前一个字符',
  },
  {
    id: 'sftp.cmd.left',
    scope: 'sftp',
    key: { name: 'left' },
    group: 'sftp-prompt',
    owner: 'component',
    when: (ctx) => ctx.sftpCmdMode,
    en: 'Move cursor left',
    zh: '光标左移',
  },
  {
    id: 'sftp.cmd.right',
    scope: 'sftp',
    key: { name: 'right' },
    group: 'sftp-prompt',
    owner: 'component',
    when: (ctx) => ctx.sftpCmdMode,
    en: 'Move cursor right',
    zh: '光标右移',
  },
  {
    id: 'sftp.cmd.home',
    scope: 'sftp',
    key: { name: 'home' },
    group: 'sftp-prompt',
    owner: 'component',
    when: (ctx) => ctx.sftpCmdMode,
    en: 'Move cursor to start',
    zh: '光标移到行首',
  },
  {
    id: 'sftp.cmd.end',
    scope: 'sftp',
    key: { name: 'end' },
    group: 'sftp-prompt',
    owner: 'component',
    when: (ctx) => ctx.sftpCmdMode,
    en: 'Move cursor to end',
    zh: '光标移到行尾',
  },
  {
    id: 'sftp.cmd.complete',
    scope: 'sftp',
    key: { name: 'tab' },
    group: 'sftp-prompt',
    owner: 'component',
    when: (ctx) => ctx.sftpCmdMode,
    en: 'Autocomplete command or file path',
    zh: '补全命令或文件路径',
  },
  {
    id: 'sftp.pageUp',
    scope: 'sftp',
    key: { name: 'pageup' },
    group: 'sftp',
    owner: 'component',
    when: (ctx) => !ctx.sftpCmdMode,
    en: 'Page up in the active panel',
    zh: '活动面板向上翻页',
  },
  {
    id: 'sftp.pageDown',
    scope: 'sftp',
    key: { name: 'pagedown' },
    group: 'sftp',
    owner: 'component',
    when: (ctx) => !ctx.sftpCmdMode,
    en: 'Page down in the active panel',
    zh: '活动面板向下翻页',
  },
  {
    id: 'sftp.switchPanel',
    scope: 'sftp',
    key: { name: 'tab' },
    group: 'sftp',
    owner: 'component',
    when: (ctx) => !ctx.sftpCmdMode,
    en: 'Switch panel (local ↔ remote)',
    zh: '切换面板（本地 ↔ 远程）',
  },
  {
    id: 'sftp.up',
    scope: 'sftp',
    key: { name: 'up' },
    group: 'sftp',
    owner: 'component',
    when: (ctx) => !ctx.sftpCmdMode,
    en: 'Select previous item',
    zh: '选择上一项',
  },
  {
    id: 'sftp.down',
    scope: 'sftp',
    key: { name: 'down' },
    group: 'sftp',
    owner: 'component',
    when: (ctx) => !ctx.sftpCmdMode,
    en: 'Select next item',
    zh: '选择下一项',
  },
  {
    id: 'sftp.enter',
    scope: 'sftp',
    key: ENTER,
    group: 'sftp',
    owner: 'component',
    when: (ctx) => !ctx.sftpCmdMode,
    en: 'Enter directory',
    zh: '进入目录',
  },
  {
    id: 'sftp.parent',
    scope: 'sftp',
    key: { name: 'backspace' },
    group: 'sftp',
    owner: 'component',
    when: (ctx) => !ctx.sftpCmdMode,
    en: 'Go to parent directory',
    zh: '返回上级目录',
  },
  {
    id: 'sftp.commandMode',
    scope: 'sftp',
    key: { name: ':', ctrl: false, meta: false },
    group: 'sftp',
    owner: 'component',
    when: (ctx) => !ctx.sftpCmdMode,
    en: 'Enter command mode',
    zh: '进入命令行模式',
  },
  {
    id: 'sftp.prefillUpload',
    scope: 'sftp',
    key: { name: 'u', ctrl: true },
    group: 'sftp',
    owner: 'component',
    when: (ctx) => !ctx.sftpCmdMode,
    en: 'Pre-fill upload command for selected local file',
    zh: '为选中的本地文件预填 upload 命令',
  },
  {
    id: 'sftp.prefillDownload',
    scope: 'sftp',
    key: { name: 'd', ctrl: true },
    group: 'sftp',
    owner: 'component',
    when: (ctx) => !ctx.sftpCmdMode,
    en: 'Pre-fill download command for selected remote file',
    zh: '为选中的远程文件预填 download 命令',
  },

  // ── form：仅在连接表单内生效 ────────────────────────────────────
  {
    id: 'form.cancel',
    scope: 'form',
    key: { name: 'escape' },
    group: 'form',
    owner: 'component',
    en: 'Cancel and close form',
    zh: '取消并关闭表单',
  },
  {
    id: 'form.submit',
    scope: 'form',
    key: ENTER,
    group: 'form',
    owner: 'component',
    en: 'Save connection',
    zh: '保存连接',
  },
  {
    id: 'form.nextField',
    scope: 'form',
    key: { name: 'tab', shift: false },
    group: 'form',
    owner: 'component',
    en: 'Next field',
    zh: '下一个字段',
  },
  {
    id: 'form.prevField',
    scope: 'form',
    key: { name: 'tab', shift: true },
    group: 'form',
    owner: 'component',
    en: 'Previous field',
    zh: '上一个字段',
  },
  {
    id: 'form.focusNext',
    scope: 'form',
    key: { name: 'down' },
    group: 'form',
    owner: 'component',
    en: 'Next field (same as Tab)',
    zh: '下一个字段（同 Tab）',
  },
  {
    id: 'form.focusPrev',
    scope: 'form',
    key: { name: 'up' },
    group: 'form',
    owner: 'component',
    en: 'Previous field (same as Shift+Tab)',
    zh: '上一个字段（同 Shift+Tab）',
  },
  {
    id: 'form.authKey',
    scope: 'form',
    key: { name: 'left' },
    group: 'form',
    owner: 'component',
    when: (ctx) => ctx.formField === 4,
    en: 'Switch auth type to Key (on Auth row)',
    zh: '切换认证方式为 Key（在认证行）',
  },
  {
    id: 'form.authPassword',
    scope: 'form',
    key: { name: 'right' },
    group: 'form',
    owner: 'component',
    when: (ctx) => ctx.formField === 4,
    en: 'Switch auth type to Password (on Auth row)',
    zh: '切换认证方式为 Password（在认证行）',
  },

  // ── help：模态，只响应滚动与关闭 ────────────────────────────────
  {
    id: 'help.scrollUp',
    scope: 'help',
    key: { name: 'up' },
    group: 'general',
    en: 'Scroll help up',
    zh: '帮助向上滚动',
  },
  {
    id: 'help.pageUp',
    scope: 'help',
    key: { name: 'pageup' },
    group: 'general',
    en: 'Page help up',
    zh: '帮助向上翻页',
  },
  {
    id: 'help.scrollDown',
    scope: 'help',
    key: { name: 'down' },
    group: 'general',
    en: 'Scroll help down',
    zh: '帮助向下滚动',
  },
  {
    id: 'help.pageDown',
    scope: 'help',
    key: { name: 'pagedown' },
    group: 'general',
    en: 'Page help down',
    zh: '帮助向下翻页',
  },
  {
    id: 'help.close',
    scope: 'help',
    key: { any: true },
    group: 'general',
    en: 'Close help (any other key)',
    zh: '关闭帮助（任意其他键）',
  },
];

/** 鼠标操作与 SFTP 命令：只用于生成文档，不参与键盘分发。 */
export const MANUAL_ENTRIES: ManualEntry[] = [
  // 鼠标
  { group: 'mouse', keys: 'Single-click (sidebar)', keysZh: '单击（侧边栏）', en: 'Select connection', zh: '选中连接' },
  { group: 'mouse', keys: 'Double-click (sidebar)', keysZh: '双击（侧边栏）', en: 'Connect to selected server', zh: '连接选中的服务器' },
  { group: 'mouse', keys: 'Drag to select (any text)', keysZh: '拖动选中文本', en: 'Copy the selection to the clipboard', zh: '把选中的文本复制到剪贴板' },
  { group: 'mouse', keys: 'Right-click (terminal / SFTP command line / form field)', keysZh: '右键（终端 / SFTP 命令行 / 表单字段）', en: 'Paste the clipboard', zh: '粘贴剪贴板内容' },
  { group: 'mouse', keys: 'Toolbar buttons', keysZh: '工具栏按钮', en: 'new / edit / connect / delete / quit / help', zh: '新建 / 编辑 / 连接 / 删除 / 退出 / 帮助' },
  { group: 'mouse', keys: 'Single-click (tab)', keysZh: '单击（标签页）', en: 'Switch to that tab', zh: '切换到该标签页' },
  { group: 'mouse', keys: 'Double-click (tab)', keysZh: '双击（标签页）', en: 'Close tab', zh: '关闭标签页' },
  { group: 'mouse', keys: 'Drag divider', keysZh: '拖动分隔线', en: 'Resize sidebar', zh: '调整侧边栏宽度' },
  { group: 'mouse', keys: 'Drag help window', keysZh: '拖动帮助窗', en: 'Move help popup', zh: '拖动帮助弹窗' },
  { group: 'mouse', keys: 'Click form field', keysZh: '点击表单字段', en: 'Focus that field (click places the caret)', zh: '聚焦该字段（光标落在点击处）' },
  { group: 'mouse', keys: 'Hold eye icon', keysZh: '按住眼睛图标', en: 'Reveal password', zh: '按住显示密码' },

  // SFTP 命令
  { group: 'sftp-command', keys: 'upload <src> [dest]', en: 'Upload local file to remote', zh: '上传本地文件到远端' },
  { group: 'sftp-command', keys: 'download <src> [dest]', en: 'Download remote file to local', zh: '下载远端文件到本地' },
  { group: 'sftp-command', keys: 'mkdir <name>', en: 'Create directory on active panel', zh: '在活动面板新建目录' },
  { group: 'sftp-command', keys: 'rm [path]', en: 'Delete selected item or given path', zh: '删除选中项或指定路径' },
  { group: 'sftp-command', keys: 'mv <src> <dst>', en: 'Move / rename on active panel', zh: '在活动面板移动 / 重命名' },
  { group: 'sftp-command', keys: 'cd <path>', en: 'Change directory and refresh both panels', zh: '切换目录并刷新两侧面板' },
  { group: 'sftp-command', keys: 'refresh', en: 'Refresh both panels', zh: '刷新两侧面板' },
  { group: 'sftp-command', keys: 'hidden [on|off]', en: 'Show / hide Windows system files', zh: '显示 / 隐藏 Windows 系统文件' },
];

const byScope = new Map<Scope, Binding[]>();
for (const binding of BINDINGS) {
  const list = byScope.get(binding.scope) ?? [];
  list.push(binding);
  byScope.set(binding.scope, list);
}

export function bindingsForScope(scope: Scope): Binding[] {
  return byScope.get(scope) ?? [];
}

/** 找到当前上下文中第一个命中的绑定（数组顺序即优先级）。 */
export function findBinding(
  scope: Scope,
  key: Parameters<typeof matchesKey>[0],
  ctx: KeyContext,
): Binding | undefined {
  for (const binding of bindingsForScope(scope)) {
    if (binding.when && !binding.when(ctx)) continue;
    if (matchesKey(key, binding.key)) return binding;
  }
  return undefined;
}
