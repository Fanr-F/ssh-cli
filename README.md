# 🔌 SSH CLI — OpenTUI SSH Client

[![Bun](https://img.shields.io/badge/Bun-1.x-000?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript)](https://www.typescriptlang.org/)

A terminal-based SSH client with an interactive TUI, built with [Bun](https://bun.sh) and [OpenTUI](https://github.com/xanderjohansen/opentui).

---

<!-- markdownlint-disable MD025 -->
# 🇬🇧 English

## Overview

**SSH CLI** is a keyboard-driven SSH client that runs entirely in your terminal. Manage connections, authenticate with key or password, interact with remote shells — all without leaving the command line.

### Features

- **Connection Manager** — Add, edit, delete connections via keyboard-driven sidebar UI
- **Plain JSON Storage** — Connections saved to `~/.ssh-cli/config.json`
- **Dual Auth** — Supports both private key (`~/.ssh/id_rsa`, etc.) and password authentication
- **ANSI Terminal Emulation** — Live remote shell with 16-color ANSI support via custom screen buffer and renderer
- **Keyboard Forwarding** — Type directly into the remote shell; window resize propagates PTY size
- **Dependency Light** — Only three runtime deps: OpenTUI (UI framework), ANSI parser, and ssh2
- **Mouse Support** — Click to select connections, double-click to connect, use toolbar buttons for common actions

### Keyboard Shortcuts

| Key | Action |
|---|---|
| `↑` / `↓` | Navigate connection list |
| `Enter` | Connect to selected server |
| `a` | Add a new connection |
| `e` | Edit selected connection |
| `Delete` / `Backspace` | Delete selected connection |
| `Tab` | Switch focus between sidebar, terminal, and form |
| `Ctrl+Q` | Quit application |
| `Esc` | Cancel / close form |

### Mouse Shortcuts

| Action | Description |
|---|---|
| Single-click | Select connection in sidebar |
| Double-click | Connect to selected server |
| Click toolbar buttons | new, edit, connect, delete, quit |

### Project Status

All core layers are implemented and integrated.

| Layer | Status |
|---|---|
| Engine (SSH, ANSI, Renderer, Storage) | ✅ Complete |
| UI Components (Sidebar, Form, Terminal Panel, StatusBar) | ✅ Complete |
| Application Wiring (layout, keyboard routing, SSH lifecycle) | ✅ Complete |
| Verification & QA | ✅ 3/4 passed (F1/F2 pending minor fixes) |

### Known Limitations

- **Encrypted SSH key passphrase** — Keys with a passphrase are not yet supported
- **Bold / Italic / Underline rendering** — Text attributes are parsed but not rendered in the terminal panel
- **Terminal scrollback** — Output beyond screen height cannot be scrolled to view

### Architecture

```
src/
├── index.ts              # Entry point
├── app.ts                # Main app — layout, focus management, keyboard routing, SSH bridge
├── ssh/                  # SSH connection & authentication
│   ├── auth.ts           #   Key & password auth config builder
│   ├── connection.ts     #   Session lifecycle (connect, shell, resize, close)
│   └── types.ts          #   SSH-related types
├── storage/              # Local data persistence
│   ├── config.ts         #   Config file paths (~/.ssh-cli/)
│   └── connections.ts    #   Connection CRUD (ConnectionStore class)
├── terminal/             # Terminal emulation engine
│   ├── ansi-processor.ts #   ANSI escape sequence parser
│   ├── cell.ts           #   Cell model (char, colors, attributes)
│   ├── screen-buffer.ts  #   2D grid buffer with cursor tracking
│   └── terminal-renderer.ts # OpenTUI render bridge (dirty-diff)
├── types/                # Shared TypeScript types
│   ├── connection.ts     #   ConnectionConfig interface
│   └── terminal.ts       #   Cell, CursorPosition, ScreenBufferState
└── ui/                   # OpenTUI UI components
    ├── sidebar.ts        #   Connection list sidebar
    ├── connection-form.ts #   Add/edit connection modal form
    ├── status-bar.ts     #   Status bar (connected/disconnected/hints)
    └── terminal-panel.ts #   Terminal display panel
```

### Getting Started

```bash
# Prerequisites: Install Bun
curl -fsSL https://bun.sh/install | bash

# Clone the repository
git clone <repo-url> && cd ssh-cli

# Install dependencies
bun install

# Run
bun start
```

### Usage

#### 1. Connection List (Sidebar)
The left panel shows your saved connections. Use `↑`/`↓` to navigate.

```
┌─────────────────────┬──────────────────────────┐
│  Connections        │  Terminal                │
│                     │                          │
│  ➜ myserver        │  (connected/disconnected) │
│    web-prod         │                          │
│    db-server        │                          │
│    dev-box          │                          │
│                     │                          │
│  [a]dd [e]dit       │  Status: Disconnected    │
│  [del]ete Enter=connect                        │
└─────────────────────┴──────────────────────────┘
```

#### 3. Add a Connection
Press `a` to open the connection form. Fill in:

| Field | Description | Example |
|---|---|---|
| **Name** | A label for the connection | `My Server` |
| **Host** | Server hostname or IP | `192.168.1.100` |
| **Port** | SSH port (default 22) | `22` |
| **Username** | SSH login user | `root` |
| **Auth Type** | `key` (private key) or `password` | `key` |
| **Key Path** | (only for key auth) Path to private key | `~/.ssh/id_rsa` |
| **Password** | (only for password auth) Login password | — |

Press `Tab` to move between fields, `Enter` to save, `Esc` to cancel.

#### 4. Connect to a Server
Select a connection in the sidebar and press `Enter`. The terminal panel will show live output from the remote shell.

- Type commands directly into the terminal — they are forwarded to the remote server
- The terminal renders ANSI escape sequences (colors, cursor movement, etc.)
- Resize your terminal window — the PTY size is automatically updated

#### 5. Disconnect / Switch Sessions
- Close the remote shell (type `exit` on the remote) to disconnect
- Press `Tab` to switch focus back to the sidebar, then select another connection and press `Enter`
- The status bar shows connection state: **Connected**, **Disconnected**, or **Error**

#### 6. Edit / Delete Connections
- Select a connection and press `e` to **edit** its details
- Select a connection and press `Delete` or `Backspace` to **delete** it

#### 7. Exit
Press `Ctrl+Q` to quit the application.

### Dependencies

| Package | Purpose |
|---|---|
| [`@opentui/core`](https://github.com/xanderjohansen/opentui) | Terminal UI framework (Box, Text, renderer, input) |
| [`@ansi-tools/parser`](https://github.com/xanderjohansen/ansi-tools) | ANSI escape sequence parsing |
| [`ssh2-no-cpu-features`](https://github.com/JAForbes/ssh2-no-cpu-features) | SSH2 client (cpu-features-free fork) |

### Key Design Decisions

- **No JSX** — OpenTUI uses an imperative VNode API (`BoxRenderable`, `TextRenderable`, etc.) for component construction
- **Imperative API** — All UI components are classes, not functional components; state is mutated directly and re-rendered on demand
- **`ssh2-no-cpu-features`** — Used over `ssh2` because native `cpu-features` module fails on Bun
- **ANSI parsing** — Uses `@ansi-tools/parser` for tokenization, then maps tokens to cell grid updates
- **Dirty-row rendering** — The terminal renderer only redraws rows that changed (efficient for partial updates)
- **Dynamic import** — `ssh2-no-cpu-features` is imported via `await import()` because it ships ESM with top-level await

---

# 🇨🇳 中文

## 概述

**SSH CLI** 是一个完全运行在终端中的 SSH 客户端，使用键盘驱动。无需离开命令行即可管理连接、认证和操作远程 shell。

### 功能特性

- **连接管理** — 通过键盘驱动的侧边栏界面添加、编辑、删除 SSH 连接
- **JSON 持久化** — 连接保存到 `~/.ssh-cli/config.json`
- **双重认证** — 支持私钥（`~/.ssh/id_rsa` 等）和密码认证
- **ANSI 终端模拟** — 通过自定义屏幕缓冲区和渲染器实现实时的 16 色远程 shell 显示
- **键盘转发** — 在远程 shell 中直接输入，窗口大小变化自动调整 PTY
- **轻量依赖** — 仅三个运行时依赖：OpenTUI（UI 框架）、ANSI 解析器、ssh2
- **鼠标支持** — 点击选择连接，双击连接

### 快捷键

| 按键 | 操作 |
|---|---|
| `↑` / `↓` | 导航连接列表 |
| `Enter` | 连接到选中的服务器 |
| `a` | 添加新连接 |
| `e` | 编辑选中的连接 |
| `Delete` / `Backspace` | 删除选中的连接 |
| `Tab` | 在侧边栏、终端和表单之间切换焦点 |
| `Ctrl+Q` | 退出应用 |
| `Esc` | 取消 / 关闭表单 |

### 项目状态

所有核心层均已实现并完成集成。

| 层级 | 状态 |
|---|---|
| 引擎（SSH、ANSI、渲染器、存储） | ✅ 完成 |
| UI 组件（侧边栏、表单、终端面板、状态栏） | ✅ 完成 |
| 应用编排（布局、键盘路由、SSH 生命周期） | ✅ 完成 |
| 验证与 QA | ✅ 3/4 通过（F1/F2 待修复小问题） |

### 已知限制

- **加密 SSH 密钥密码** — 有密码的密钥暂不支持
- **粗体/斜体/下划线渲染** — 文字属性已解析但未在终端面板中渲染
- **终端历史回滚** — 超出屏幕高度的输出无法滚动查看

### 架构

```
src/
├── index.ts              # 入口文件
├── app.ts                # 主应用 — 布局、焦点管理、键盘路由、SSH 桥接
├── ssh/                  # SSH 连接与认证
│   ├── auth.ts           #   密钥与密码认证配置构建
│   ├── connection.ts     #   会话生命周期（连接、shell、调整大小、关闭）
│   └── types.ts          #   SSH 相关类型
├── storage/              # 加密本地数据持久化
│   ├── config.ts         #   配置文件路径（~/.ssh-cli/）
│   ├── connections.ts    #   连接 CRUD（ConnectionStore 类）
│   └── encryption.ts     #   AES-256-GCM 加密/解密
├── terminal/             # 终端模拟引擎
│   ├── ansi-processor.ts #   ANSI 转义序列解析器
│   ├── cell.ts           #   单元格模型（字符、颜色、属性）
│   ├── screen-buffer.ts  #   带光标跟踪的二维网格缓冲区
│   └── terminal-renderer.ts # OpenTUI 渲染桥接（脏行差异渲染）
├── types/                # 共享 TypeScript 类型
│   ├── connection.ts     #   ConnectionConfig 接口
│   └── terminal.ts       #   Cell、CursorPosition、ScreenBufferState
└── ui/                   # OpenTUI UI 组件
    ├── sidebar.ts        #   连接列表侧边栏
    ├── connection-form.ts #   添加/编辑连接模态表单
    ├── status-bar.ts     #   状态栏（已连接/已断开/快捷键提示）
    └── terminal-panel.ts #   终端显示面板
```

### 快速开始

```bash
# 前置条件：安装 Bun
curl -fsSL https://bun.sh/install | bash

# 克隆仓库
git clone <仓库地址> && cd ssh-cli

# 安装依赖
bun install

# 运行
bun start
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

#### 3. 添加连接
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

#### 4. 连接服务器
在侧边栏中选中一个连接，按 `Enter`。终端面板会显示远程 shell 的实时输出。

- 直接在终端中输入命令 — 按键会被转发到远程服务器
- 终端支持 ANSI 转义序列渲染（颜色、光标移动等）
- 调整终端窗口大小 — PTY 大小会自动同步更新

#### 5. 断开连接 / 切换会话
- 在远程 shell 中输入 `exit` 或关闭 shell 来断开连接
- 按 `Tab` 将焦点切回侧边栏，选择其他连接后按 `Enter`
- 状态栏显示连接状态：**Connected**（已连接）、**Disconnected**（已断开）或 **Error**（错误）

#### 6. 编辑 / 删除连接
- 选中连接后按 `e` **编辑**连接详情
- 选中连接后按 `Delete` 或 `Backspace` **删除**连接

#### 7. 退出
按 `Ctrl+Q` 退出应用。

### 依赖项

| 包名 | 用途 |
|---|---|
| [`@opentui/core`](https://github.com/xanderjohansen/opentui) | 终端 UI 框架（Box、Text、渲染器、输入） |
| [`@ansi-tools/parser`](https://github.com/xanderjohansen/ansi-tools) | ANSI 转义序列解析 |
| [`ssh2-no-cpu-features`](https://github.com/JAForbes/ssh2-no-cpu-features) | SSH2 客户端（移除 cpu-features 的分支） |

### 关键设计决策

- **无 JSX** — OpenTUI 使用命令式 VNode API（`BoxRenderable`、`TextRenderable` 等）构建组件
- **命令式 API** — 所有 UI 组件均为类而非函数组件，状态直接变更并按需重渲染
- **`ssh2-no-cpu-features`** — 替代 `ssh2`，因为原生 `cpu-features` 模块在 Bun 上无法运行
- **ANSI 解析** — 使用 `@ansi-tools/parser` 进行词法分析，然后将令牌映射为单元格网格更新
- **脏行渲染** — 终端渲染器只重绘发生变化的行，对局部更新高效
- **动态导入** — 通过 `await import()` 导入 `ssh2-no-cpu-features`，因其以含顶层 await 的 ESM 格式发布

---

## License

MIT
