# 🔌 SSH CLI — OpenTUI SSH 客户端

[![Bun](https://img.shields.io/badge/Bun-1.x-000?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript)](https://www.typescriptlang.org/)

基于 [Bun](https://bun.sh) 和 [OpenTUI](https://github.com/xanderjohansen/opentui) 构建的终端 SSH 客户端。

**[English](README.md)**

---

## 概述

**SSH CLI** 是一个完全运行在终端中的 SSH 客户端，使用键盘驱动。无需离开命令行即可管理连接、认证和操作远程 shell。

### 功能特性

- **连接管理** — 通过键盘驱动的侧边栏界面添加、编辑、删除 SSH 连接
- **JSON 持久化** — 连接保存到 `~/.ssh-cli/config.json`
- **双重认证** — 支持私钥（`~/.ssh/id_rsa` 等）和密码认证
- **原生终端模拟** — 通过 OpenTUI 的 `EmbeddedTerminalRenderable`（Ghostty VT 引擎）实现完整终端模拟
- **多标签页支持** — 在标签页中打开多个 SSH 会话，自由切换
- **键盘转发** — 在远程 shell 中直接输入，窗口大小变化自动调整 PTY
- **终端历史回滚** — 向上/向下滚动查看之前的输出
- **SFTP 文件管理器** — 双面板文件浏览器，支持命令行界面
- **独立 SFTP 连接** — 每个 SFTP 标签页创建独立的 SSH 连接
- **鼠标支持** — 点击选择连接，双击连接，可点击的工具栏按钮
- **可拖动 UI** — 调整侧边栏分隔线，拖动帮助弹窗
- **帮助系统** — 按 F1 查看所有键盘快捷键

<!-- shortcuts:begin -->

### 快捷键

#### 通用

| 按键 | 操作 |
|---|---|
| `Ctrl+Q` | 退出应用 |
| `F1` | 打开 / 关闭帮助 |
| `Alt+↑` | 切换到上一个标签页 |
| `Alt+↓` | 切换到下一个标签页 |
| `F2-F12` | 切换到第 1-11 个标签页 |
| `Ctrl+E` | 为当前连接打开 SFTP 标签页 |
| `Alt+←` | 焦点移到侧边栏 |
| `Alt+→` | 焦点移到终端 |

#### 侧边栏

| 按键 | 操作 |
|---|---|
| `↑` | 上一个连接 |
| `↓` | 下一个连接 |
| `Enter` | 连接选中的服务器 |
| `A` | 新建连接 |
| `E` | 编辑选中的连接 |
| `Delete` | 删除选中的连接（无二次确认） |
| `Ctrl+C` | 复制连接信息 |

#### 终端

| 按键 | 操作 |
|---|---|
| `Ctrl+C` | 复制选中文本；没有选区时向 shell 发送 SIGINT |
| `Ctrl+V` | 把剪贴板内容粘贴到终端 |
| `PageUp` | 向上翻页 |
| `PageDown` | 向下翻页 |

#### SFTP

| 按键 | 操作 |
|---|---|
| `Ctrl+C` | 复制选中项的路径 |
| `Ctrl+V` | 粘贴到命令行 |
| `PageUp` | 活动面板向上翻页 |
| `PageDown` | 活动面板向下翻页 |
| `Tab` | 切换面板（本地 ↔ 远程） |
| `↑` | 选择上一项 |
| `↓` | 选择下一项 |
| `Enter` | 进入目录 |
| `Backspace` | 返回上级目录 |
| `:` | 进入命令行模式 |
| `Ctrl+U` | 为选中的本地文件预填 upload 命令 |
| `Ctrl+D` | 为选中的远程文件预填 download 命令 |

#### SFTP 命令行编辑

> 仅在按 `:` 进入命令行模式后生效。

| 按键 | 操作 |
|---|---|
| `Enter` | 执行命令（保持命令行模式） |
| `Esc` | 退出命令行模式 |
| `↑` | 上一条历史命令 |
| `↓` | 下一条历史命令 |
| `Backspace` | 删除光标前一个字符 |
| `←` | 光标左移 |
| `→` | 光标右移 |
| `Home` | 光标移到行首 |
| `End` | 光标移到行尾 |
| `Tab` | 补全命令或文件路径 |

#### SFTP 命令

> 命令模式常驻：Enter 执行后仍留在命令行，Esc 退出。

| 命令 | 说明 |
|---|---|
| `upload <src> [dest]` | 上传本地文件到远端 |
| `download <src> [dest]` | 下载远端文件到本地 |
| `mkdir <name>` | 在活动面板新建目录 |
| `rm [path]` | 删除选中项或指定路径 |
| `mv <src> <dst>` | 在活动面板移动 / 重命名 |
| `cd <path>` | 切换目录并刷新两侧面板 |
| `refresh` | 刷新两侧面板 |
| `hidden [on\|off]` | 显示 / 隐藏 Windows 系统文件 |

#### 表单

| 按键 | 操作 |
|---|---|
| `Ctrl+C` | 复制当前字段 |
| `Ctrl+V` | 粘贴到当前字段 |
| `Esc` | 取消并关闭表单 |
| `Enter` | 保存连接 |
| `Tab` | 下一个字段 |
| `Shift+Tab` | 上一个字段 |
| `↓` | 下一个字段（同 Tab） |
| `↑` | 上一个字段（同 Shift+Tab） |
| `←` | 切换认证方式为 Key（在认证行） |
| `→` | 切换认证方式为 Password（在认证行） |

### 鼠标快捷键

| 操作 | 说明 |
|---|---|
| 单击（侧边栏） | 选中连接 |
| 双击（侧边栏） | 连接选中的服务器 |
| 工具栏按钮 | 新建 / 编辑 / 连接 / 删除 / 退出 / 帮助 |
| 单击（标签页） | 切换到该标签页 |
| 双击（标签页） | 关闭标签页 |
| 拖动分隔线 | 调整侧边栏宽度 |
| 拖动帮助窗 | 拖动帮助弹窗 |
| 点击表单字段 | 聚焦该字段 |
| 按住眼睛图标 | 按住显示密码 |

<!-- shortcuts:end -->

### 项目状态

所有核心层均已实现并完成集成。

| 层级 | 状态 |
|---|---|
| 引擎（SSH、VT、渲染器、存储） | ✅ 完成 |
| UI 组件（侧边栏、表单、终端面板、状态栏、标签栏、帮助弹窗） | ✅ 完成 |
| 应用编排（布局、键盘路由、SSH 生命周期、多标签页） | ✅ 完成 |
| 鼠标支持（选中、复制、拖动） | ✅ 完成 |
| 验证与 QA | ✅ 完成 |

### 已知问题

#### 暂时没有键盘快捷键关闭标签页

**行为**：目前只能通过双击标签页关闭。原先的 `Ctrl+Shift+C` 已移除：传统终端（Windows Terminal、VS Code）会把 `Ctrl+Shift+字母` 编码成 `Ctrl+字母`，Shift 信息到不了应用；而且这些终端默认把 `Ctrl+Shift+C` 绑定为"复制"，可能在终端层就被拦截。

**当前状态**：替代键（`Alt+W` / `Ctrl+W` / `Shift+F4`）尚未确定。`tab.close` 动作仍保留在 `src/app.ts`，确定后只需在 `src/keymap/bindings.ts` 增加一行绑定。

**临时方案**：双击标签页关闭。

### 架构

```
src/
├── index.ts              # 入口文件 — 创建渲染器并初始化 App
├── app.ts                # 主应用类 — 布局、焦点管理、键盘分发
├── logger.ts             # 日志系统（LogTape，写入 ssh-cli.log）
├── clipboard.ts          # 剪贴板操作（复制/粘贴）
├── keymap/               # 快捷键定义（唯一事实来源）
│   ├── bindings.ts       #   全部绑定：作用域、按键、分组、文档文案
│   ├── matcher.ts        #   按键归一化 + 模式匹配
│   ├── types.ts          #   Scope / Binding / KeyContext 类型
│   └── index.ts          #   buildDocs()，供帮助弹窗和 README 生成器使用
├── ssh/                  # SSH 连接层
│   ├── auth.ts           #   认证配置构建器（密钥/密码）
│   ├── connection.ts     #   SSH 会话生命周期（SshConnection 类）
│   └── types.ts          #   SSH 类型（SshConnectionState、错误）
├── sftp/                 # SFTP 文件管理器模块
│   ├── sftp-client.ts    #   SFTP 客户端封装（readdir、mkdir、upload、download）
│   ├── sftp-tab.ts       #   SFTP 双面板标签页（cmd 模式、键盘、ScrollBox 滚动）
│   └── types.ts          #   SFTP 类型（FileEntry、TransferTask、PanelSide）
├── storage/              # 持久化层
│   ├── config.ts         #   配置文件路径（~/.ssh-cli/）
│   └── connections.ts    #   ConnectionStore CRUD（纯 JSON）
├── terminal/             # （已移除 — VT 模拟由 @opentui/core 原生提供）
├── types/                # 共享 TypeScript 接口
│   └── connection.ts     #   ConnectionConfig 接口
└── ui/                   # OpenTUI UI 组件
    ├── sidebar.ts        #   连接列表侧边栏
    ├── connection-form.ts #   添加/编辑连接模态表单
    ├── status-bar.ts     #   状态栏（已完全禁用 - 空操作 API）
    ├── terminal-panel.ts #   终端显示面板（带 setVisible()）
    ├── tab-bar.ts        #   多标签栏（F2-F12，类型：terminal|sftp）
    ├── toolbar.ts        #   可点击的快捷键工具栏
    ├── divider.ts        #   可拖动的侧边栏分隔线
    └── help-popup.ts     #   可拖动的帮助弹窗（F1）含 SFTP 快捷键
```

### 快速开始

```bash
# 前置条件：安装 Bun
curl -fsSL https://bun.sh/install | bash

# 克隆仓库
git clone <仓库地址> && cd ssh-cli

# 安装依赖
bun install

# 运行（默认 info 级别日志写入 ssh-cli.log）
bun start

# 以 debug 级别运行
bun run start -- --log-level debug

# 以 trace 级别运行（最详细）
bun run start -- --log-level trace

# 编译为独立的 Windows 可执行文件
bun run build:win

# 重新生成 README.md / README.zh.md 中的快捷键表格
bun run docs
```

### 日志

所有日志写入项目根目录的 `ssh-cli.log` 文件，控制台无输出（TUI 安全）。

日志文件超过 2MB 时，会在下次启动时自动轮转为 `ssh-cli.log.1`（只保留一份备份）。`debug` 级别下的 SSH 输入/输出预览只在启用 debug 时才会格式化，`info` 级别下不产生额外分配。

| 参数 | 说明 |
|---|---|
| `--log-level trace` | 最详细 — 记录所有操作 |
| `--log-level debug` | 调试信息及以上 |
| `--log-level info` | 信息及以上（默认） |
| `--log-level warning` | 仅警告和错误 |
| `--log-level error` | 仅错误 |

日志格式：
```
[2026-06-17T01:56:51.603Z] [DEBUG  ] [ssh-cli.terminal] GET_STYLED_LINES: rows=49, scrollback=0
[2026-06-17T01:56:51.612Z] [INFO   ] [ssh-cli.ssh] Connecting to SSH server host=192.168.1.100
[2026-06-17T01:56:52.105Z] [ERROR  ] [ssh-cli.ssh] SSH connection error error=Connection refused
```

### 使用指南

#### 1. 连接列表（侧边栏）
左侧面板显示已保存的连接。用 `↑`/`↓` 导航。

```
┌─────────────────────┬──────────────────────────┐
│  Connections        │  Terminal                │
│                     │                          │
│  ➜ myserver        │  (已连接/已断开)          │
│    web-prod         │                          │
│    db-server        │                          │
│    dev-box          │                          │
│                     │                          │
│  [a]dd [e]dit       │  状态: 已断开            │
│  [del]ete Enter=connect                        │
└─────────────────────┴──────────────────────────┘
```

#### 2. 添加连接
按 `a` 打开连接表单，填写以下字段：

| 字段 | 说明 | 示例 |
|---|---|---|
| **Name** | 连接名称 | `我的服务器` |
| **Host** | 服务器地址或 IP | `192.168.1.100` |
| **Port** | SSH 端口（默认 22） | `22` |
| **Username** | SSH 登录用户名 | `root` |
| **Auth Type** | `key`（私钥）或 `password`（密码） | `key` |
| **Key Path** | （密钥认证时）私钥路径 | `~/.ssh/id_rsa` |
| **Password** | （密码认证时）登录密码 | — |

按 `Tab` 切换输入框，`Enter` 保存，`Esc` 取消。

#### 3. 连接服务器
在侧边栏中选中一个连接，按 `Enter`。终端面板会显示远程 shell 的实时输出。

- 直接在终端中输入命令 — 按键会被转发到远程服务器
- 终端支持 ANSI 转义序列渲染（颜色、光标移动等）
- 调整终端窗口大小 — PTY 大小会自动同步更新
- 使用 `PageUp`/`PageDown` 滚动终端输出
- `Ctrl+C` 复制终端选中文本；无选区时向 shell 发送中断（SIGINT）

#### 4. 多标签页支持
- 在独立标签页中打开多个 SSH 会话
- 用 `Alt+↑` / `Alt+↓` 切换标签页，或用 `F2-F12` 直接跳到第 1-11 个（`F11` 被宿主终端占用）
- 双击标签页关闭（暂时没有键盘快捷键）
- 每个标签页维护自己的终端状态和历史回滚

#### 5. SFTP 文件管理器
在终端标签页按 `Ctrl+E` 打开 SFTP 文件管理器：

- **双面板布局**：左侧本地文件，右侧远程文件
- **独立 SSH 连接**：每个 SFTP 标签页创建独立的 SSH 连接
- **导航**：用 `↑`/`↓` 选择文件，`Enter` 打开目录，`Backspace` 返回上级
- **切换面板**：按 `Tab` 在本地和远程面板间切换
- **命令行**：按 `:` 进入命令模式，输入 `upload`、`download`、`cd`、`mkdir`、`rm`、`mv`、`refresh`、`hidden` 等命令（`Tab` 自动补全，`↑/↓` 浏览历史，`Esc` 退出）
- **快捷键**：`Ctrl+U` 预填上传命令，`Ctrl+D` 预填下载命令 — 其余操作（新建目录、删除、重命名、刷新、系统文件）全部走命令行
- **关闭**：在命令模式下按 `Esc` 退出；关闭标签页请双击标签栏

#### 6. 断开连接 / 切换会话
- 在远程 shell 中输入 `exit` 或关闭 shell 来断开连接 — 标签页会自动关闭
- 按 `Alt+←/→` 切换侧边栏和终端之间的焦点
- 终端面板显示连接状态：**Connecting**（连接中）、**Connected**（已连接）、**Error**（错误）或 **Disconnected**（已断开）

#### 7. 编辑 / 删除连接
- 选中连接后按 `e` **编辑**连接详情
- 选中连接后按 `Delete` **删除**连接

#### 8. 帮助
按 `F1` 打开帮助弹窗。弹窗可拖动 — 点击并拖动以重新定位。

#### 9. 退出
按 `Ctrl+Q` 退出应用。

### 依赖项

| 包名 | 用途 |
|---|---|
| [`@opentui/core`](https://github.com/xanderjohansen/opentui) | 终端 UI 框架（Box、Text、渲染器、输入） |
| [`@opentui/core-win32-x64`](https://github.com/xanderjohansen/opentui) | Windows x64 平台的 OpenTUI 原生依赖 |
| [`ssh2-no-cpu-features`](https://github.com/JAForbes/ssh2-no-cpu-features) | SSH2 客户端（移除 cpu-features 的分支） |
| [`@logtape/logtape`](https://github.com/dahlia/logtape) | 结构化日志（零依赖，文件输出） |

### 关键设计决策

- **无 JSX** — OpenTUI 使用命令式 VNode API（`BoxRenderable`、`TextRenderable` 等）构建组件
- **命令式 API** — 所有 UI 组件均为类而非函数组件，状态直接变更并按需重渲染
- **`ssh2-no-cpu-features`** — 替代 `ssh2`，因为原生 `cpu-features` 模块在 Bun 上无法运行
- **原生 VT** — 终端模拟使用 OpenTUI 原生 `EmbeddedTerminalRenderable`，ANSI 解析、按键编码、选区、滚动与回滚均由它负责
- **无自研重绘** — 原生组件自己维护缓冲区，项目内不再有逐行脏差异渲染代码
- **动态导入** — 通过 `await import()` 导入 `ssh2-no-cpu-features`，因其以含顶层 await 的 ESM 格式发布
- **仅文件日志** — 所有日志写入 `ssh-cli.log`（控制台无输出，保护 TUI 完整性）

---

## License

MIT
