# 🔌 SSH CLI — OpenTUI SSH Client

[![Bun](https://img.shields.io/badge/Bun-1.x-000?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript)](https://www.typescriptlang.org/)

A terminal-based SSH client with an interactive TUI, built with [Bun](https://bun.sh) and [OpenTUI](https://github.com/xanderjohansen/opentui).

**[中文文档](README.zh.md)**

---

<!-- markdownlint-disable MD025 -->
# 🇬🇧 English

## Overview

**SSH CLI** is a keyboard-driven SSH client that runs entirely in your terminal. Manage connections, authenticate with key or password, interact with remote shells — all without leaving the command line.

### Features

- **Connection Manager** — Add, edit, delete connections via keyboard-driven sidebar UI
- **Plain JSON Storage** — Connections saved to `~/.ssh-cli/config.json`
- **Dual Auth** — Supports both private key (`~/.ssh/id_rsa`, etc.) and password authentication
- **vterm.js Terminal Emulation** — Full terminal emulation with ANSI color support via vterm.js
- **Multi-Tab Support** — Open multiple SSH sessions in tabs, switch between them
- **Keyboard Forwarding** — Type directly into the remote shell; window resize propagates PTY size
- **Terminal Scrollback** — Scroll up/down to view previous output
- **SFTP File Manager** — Dual-panel file browser with command line interface
- **Independent SFTP Connections** — Each SFTP tab creates its own SSH connection
- **Mouse Support** — Click to select connections, double-click to connect, clickable toolbar buttons
- **Draggable UI** — Resize sidebar divider, drag help popup window
- **Help System** — Press F1 to view all keyboard shortcuts

### Keyboard Shortcuts

#### General

| Key | Action |
|---|---|
| `Ctrl+Q` | Quit application |
| `Alt+←/→` | Switch focus between Sidebar ↔ Terminal |
| `F1` | Show help popup |
| `F2-F12` | Switch to tab 1-11 |
| `Ctrl+E` | Open SFTP tab for the active connection |

#### Sidebar

| Key | Action |
|---|---|
| `↑` / `↓` | Navigate connections (when sidebar focused) |
| `Alt+↑/↓` | Navigate connections (global) |
| `Enter` | Connect to selected server |
| `A` | Add new connection |
| `E` | Edit selected connection |
| `Delete` | Delete selected connection |

#### Terminal

| Key | Action |
|---|---|
| `Ctrl+C` | Copy (sidebar: connection info; terminal: selection or last line; sends SIGINT to shell if nothing to copy) |
| `Ctrl+V` | Paste (clipboard content to terminal, form, or SFTP input) |
| `Ctrl+Shift+C` | Close current tab |
| `Ctrl+Shift+Tab` | Cycle to next tab |
| `PageUp/PageDown` | Scroll terminal output |

#### SFTP File Manager

| Key | Action |
|---|---|
| `Tab` | Switch focus between local and remote panels |
| `↑` / `↓` | Navigate file list in current panel |
| `Enter` | Open directory / execute command (when in command mode) |
| `Backspace` | Go to parent directory |
| `:` | Enter command mode |
| `Ctrl+R` / `R` | Refresh both panels |
| `Ctrl+H` | Toggle showing Windows system-protected files |
| `F7` / `N` | Create new directory (remote panel) |
| `F8` / `Delete` | Delete selected file/directory |
| `F2` | Rename selected file |
| `Ctrl+U` | Pre-fill `upload` command for selected local file |
| `Ctrl+D` | Pre-fill `download` command for selected remote file |
| `Esc` | Exit command mode / cancel input |

#### SFTP Command Line

Command mode is persistent — `Enter` executes the command but stays in the prompt, `Esc` exits.

| Command | Description |
|---|---|
| `:upload <local> [remote]` | Upload a local file to remote path (defaults to file name) |
| `:download <remote> [local]` | Download a remote file to local path (defaults to file name) |
| `:mkdir <name>` | Create directory on the active panel |
| `:rm <name>` | Delete file/directory on the active panel |
| `:rename <old> <new>` | Rename on the active panel |
| `:cd <path>` | Change directory and refresh both panels |

> Tip: `Tab` autocompletes commands and file paths, `↑/↓` browse command history.

#### Form

| Key | Action |
|---|---|
| `Tab` | Next field |
| `Shift+Tab` | Previous field |
| `↑/↓` | Navigate between fields |
| `←/→` | Move cursor within field |
| `Home` | Move cursor to start |
| `End` | Move cursor to end |

### Mouse Shortcuts

| Action | Description |
|---|---|
| Single-click | Select connection in sidebar |
| Double-click | Connect to selected server |
| Click toolbar buttons | new, edit, connect, delete, quit, help |
| Double-click tab | Close tab |
| Drag divider | Resize sidebar width |
| Drag help popup | Reposition help window |

### Project Status

All core layers are implemented and integrated.

| Layer | Status |
|---|---|
| Engine (SSH, vterm.js, Renderer, Storage) | ✅ Complete |
| UI Components (Sidebar, Form, Terminal Panel, StatusBar, TabBar, HelpPopup) | ✅ Complete |
| Application Wiring (layout, keyboard routing, SSH lifecycle, multi-tab) | ✅ Complete |
| Mouse Support (selection, copy, drag) | ✅ Complete |
| Verification & QA | ✅ Complete |

### Architecture

```
src/
├── index.ts              # Entry point — creates renderer and initializes App
├── app.ts                # Main application class — layout, focus management, keyboard routing
├── logger.ts             # Logging system (LogTape, writes to ssh-cli.log)
├── clipboard.ts          # Clipboard operations (copy/paste)
├── ssh/                  # SSH connection layer
│   ├── auth.ts           #   Authentication config builder (key/password)
│   ├── connection.ts     #   SSH session lifecycle (SshConnection class)
│   └── types.ts          #   SSH types (SshConnectionState, errors)
├── sftp/                 # SFTP file manager module
│   ├── sftp-client.ts    #   SFTP client wrapper (readdir, mkdir, upload, download)
│   ├── sftp-tab.ts       #   SFTP dual-panel tab (cmd mode, keyboard, scrollY)
│   ├── sftp-input-dialog.ts # Path input dialog (used by Ctrl+U/D)
│   └── types.ts          #   SFTP types (FileEntry, TransferTask, PanelSide)
├── storage/              # Persistence layer
│   ├── config.ts         #   Config file paths (~/.ssh-cli/)
│   └── connections.ts    #   ConnectionStore CRUD (plain JSON)
├── terminal/             # Terminal emulation engine
│   ├── vterm-adapter.ts  #   vterm.js wrapper with scrollback support
│   └── terminal-renderer.ts # OpenTUI render bridge (dirty-diff rendering)
├── types/                # Shared TypeScript interfaces
│   ├── connection.ts     #   ConnectionConfig interface
│   └── terminal.ts       #   Cell, CursorPosition, ScreenBufferState
└── ui/                   # OpenTUI UI components
    ├── sidebar.ts        #   Connection list sidebar
    ├── connection-form.ts #   Add/edit connection modal form
    ├── status-bar.ts     #   Status bar (fully disabled - no-op API)
    ├── terminal-panel.ts #   Terminal display panel (with setVisible())
    ├── tab-bar.ts        #   Multi-tab bar (F2-F12, type: terminal|sftp)
    ├── toolbar.ts        #   Clickable shortcut toolbar
    ├── divider.ts        #   Draggable sidebar divider
    └── help-popup.ts     #   Draggable help popup (F1) with SFTP shortcuts
```

### Getting Started

```bash
# Prerequisites: Install Bun
curl -fsSL https://bun.sh/install | bash

# Clone the repository
git clone <repo-url> && cd ssh-cli

# Install dependencies
bun install

# Run (default: info level logging to ssh-cli.log)
bun start

# Run with debug logging
bun run start -- --log-level debug

# Run with trace logging (most verbose)
bun run start -- --log-level trace

# Compile a standalone Windows executable
bun run build:win
```

### Logging

All logs are written to `ssh-cli.log` in the project root. No console output (TUI safe).

| Flag | Description |
|---|---|
| `--log-level trace` | Most verbose — all operations logged |
| `--log-level debug` | Debug messages and above |
| `--log-level info` | Info and above (default) |
| `--log-level warning` | Warnings and errors only |
| `--log-level error` | Errors only |

Log format:
```
[2026-06-17T01:56:51.603Z] [DEBUG  ] [ssh-cli.terminal] GET_STYLED_LINES: rows=49, scrollback=0, viewportOffset=0
[2026-06-17T01:56:51.612Z] [INFO   ] [ssh-cli.ssh] Connecting to SSH server host=192.168.1.100
[2026-06-17T01:56:52.105Z] [ERROR  ] [ssh-cli.ssh] SSH connection error error=Connection refused
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

#### 2. Add a Connection
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

#### 3. Connect to a Server
Select a connection in the sidebar and press `Enter`. The terminal panel will show live output from the remote shell.

- Type commands directly into the terminal — they are forwarded to the remote server
- The terminal renders ANSI escape sequences (colors, cursor movement, etc.)
- Resize your terminal window — the PTY size is automatically updated
- Use `PageUp`/`PageDown` to scroll through terminal output
- `Ctrl+C` copies the terminal selection (or last line); when there is nothing to copy it sends an interrupt (`SIGINT`) to the shell instead

#### 4. Multi-Tab Support
- Open multiple SSH sessions in separate tabs
- Switch between tabs using `F2-F12` or `Ctrl+Shift+Tab`
- Close tabs with `Ctrl+Shift+C` or double-click on the tab
- Each tab maintains its own terminal state and scrollback

#### 5. SFTP File Manager
Press `Ctrl+E` from a terminal tab to open the SFTP file manager:

- **Dual-panel layout**: Local files on the left, remote files on the right
- **Independent SSH connections**: Each SFTP tab creates its own SSH connection
- **Navigate**: Use `↑`/`↓` to select files, `Enter` to open directories, `Backspace` to go up
- **Switch panels**: Press `Tab` to switch between local and remote panels
- **Command line**: Press `:` to enter command mode, then type commands like `upload`, `download`, `cd`, `mkdir`, `rm`, `rename` (`Tab` autocompletes, `↑/↓` browse history)
- **Shortcuts**: `Ctrl+U` to pre-fill an upload command, `Ctrl+D` to pre-fill download, `F7`/`N` to create a directory, `F8`/`Delete` to delete, `F2` to rename, `R`/`Ctrl+R` to refresh, `Ctrl+H` to toggle system files
- **Close**: Press `Esc` in command mode to exit it, or close the tab via `Ctrl+Shift+C` / double-click

#### 6. Disconnect / Switch Sessions
- Close the remote shell (type `exit` on the remote) to disconnect — the tab closes automatically
- Press `Alt+←/→` to switch focus between sidebar and terminal
- The terminal panel shows the connection state: **Connecting**, **Connected**, **Error**, or **Disconnected**

#### 7. Edit / Delete Connections
- Select a connection and press `e` to **edit** its details
- Select a connection and press `Delete` to **delete** it

#### 8. Help
Press `F1` to open the help popup. The popup is draggable — click and drag to reposition it.

#### 9. Exit
Press `Ctrl+Q` to quit the application.

### Dependencies

| Package | Purpose |
|---|---|
| [`@opentui/core`](https://github.com/xanderjohansen/opentui) | Terminal UI framework (Box, Text, renderer, input) |
| [`@opentui/core-win32-x64`](https://github.com/xanderjohansen/opentui) | Platform-specific OpenTUI binary for Windows x64 |
| [`vterm.js`](https://github.com/nickmccurdy/vterm.js) | Full terminal emulation with ANSI support |
| [`ssh2-no-cpu-features`](https://github.com/JAForbes/ssh2-no-cpu-features) | SSH2 client (cpu-features-free fork) |
| [`@logtape/logtape`](https://github.com/dahlia/logtape) | Structured logging (zero deps, file output) |

### Key Design Decisions

- **No JSX** — OpenTUI uses an imperative VNode API (`BoxRenderable`, `TextRenderable`, etc.) for component construction
- **Imperative API** — All UI components are classes, not functional components; state is mutated directly and re-rendered on demand
- **`ssh2-no-cpu-features`** — Used over `ssh2` because native `cpu-features` module fails on Bun
- **vterm.js** — Full terminal emulation instead of custom ANSI parser for better compatibility
- **Dirty-row rendering** — The terminal renderer only redraws rows that changed (efficient for partial updates)
- **Dynamic import** — `ssh2-no-cpu-features` is imported via `await import()` because it ships ESM with top-level await
- **File-only logging** — All logs write to `ssh-cli.log` (no console output to preserve TUI integrity)

---

# 🇨🇳 中文

## 概述

**SSH CLI** 是一个完全运行在终端中的 SSH 客户端，使用键盘驱动。无需离开命令行即可管理连接、认证和操作远程 shell。

### 功能特性

- **连接管理** — 通过键盘驱动的侧边栏界面添加、编辑、删除 SSH 连接
- **JSON 持久化** — 连接保存到 `~/.ssh-cli/config.json`
- **双重认证** — 支持私钥（`~/.ssh/id_rsa` 等）和密码认证
- **vterm.js 终端模拟** — 通过 vterm.js 实现完整的终端模拟和 ANSI 颜色支持
- **多标签页支持** — 在标签页中打开多个 SSH 会话，自由切换
- **键盘转发** — 在远程 shell 中直接输入，窗口大小变化自动调整 PTY
- **终端历史回滚** — 向上/向下滚动查看之前的输出
- **SFTP 文件管理器** — 双面板文件浏览器，支持命令行界面
- **独立 SFTP 连接** — 每个 SFTP 标签页创建独立的 SSH 连接
- **鼠标支持** — 点击选择连接，双击连接，可点击的工具栏按钮
- **可拖动 UI** — 调整侧边栏分隔线，拖动帮助弹窗
- **帮助系统** — 按 F1 查看所有键盘快捷键

### 快捷键

#### 通用

| 按键 | 操作 |
|---|---|
| `Ctrl+Q` | 退出应用 |
| `Alt+←/→` | 切换焦点（侧边栏 ↔ 终端） |
| `F1` | 显示帮助弹窗 |
| `F2-F12` | 切换到标签页 1-11 |
| `Ctrl+E` | 为当前活动连接打开 SFTP 标签页 |

#### 侧边栏

| 按键 | 操作 |
|---|---|
| `↑` / `↓` | 导航连接列表（侧边栏聚焦时） |
| `Alt+↑/↓` | 导航连接列表（全局） |
| `Enter` | 连接到选中的服务器 |
| `A` | 添加新连接 |
| `E` | 编辑选中的连接 |
| `Delete` | 删除选中的连接 |

#### 终端

| 按键 | 操作 |
|---|---|
| `Ctrl+C` | 复制（侧边栏：连接信息；终端：选中文本或最后一行；无内容可复制时向 shell 发送 SIGINT） |
| `Ctrl+V` | 粘贴（剪贴板内容粘贴到终端/表单/SFTP 输入） |
| `Ctrl+Shift+C` | 关闭当前标签页 |
| `Ctrl+Shift+Tab` | 循环切换到下一个标签页 |
| `PageUp/PageDown` | 滚动终端输出 |

#### SFTP 文件管理器

| 按键 | 操作 |
|---|---|
| `Tab` | 在本地和远程面板间切换焦点 |
| `↑` / `↓` | 在当前面板中导航文件列表 |
| `Enter` | 打开目录 / 执行命令（命令模式下） |
| `Backspace` | 返回上级目录 |
| `:` | 进入命令模式 |
| `Ctrl+R` / `R` | 刷新两个面板 |
| `Ctrl+H` | 切换显示 Windows 系统保护文件 |
| `F7` / `N` | 新建目录（远程面板） |
| `F8` / `Delete` | 删除选中的文件/目录 |
| `F2` | 重命名选中文件 |
| `Ctrl+U` | 为选中的本地文件预填 `upload` 命令 |
| `Ctrl+D` | 为选中的远程文件预填 `download` 命令 |
| `Esc` | 退出命令模式 / 取消输入 |

#### SFTP 命令行

命令模式为持续模式 — 按 `Enter` 执行命令后仍停留在输入行，按 `Esc` 退出。

| 命令 | 说明 |
|---|---|
| `:upload <本地路径> [远程路径]` | 上传本地文件到远程（默认使用文件名） |
| `:download <远程路径> [本地路径]` | 下载远程文件到本地（默认使用文件名） |
| `:mkdir <名称>` | 在活动面板创建目录 |
| `:rm <名称>` | 在活动面板删除文件/目录 |
| `:rename <旧名> <新名>` | 在活动面板重命名 |
| `:cd <路径>` | 切换目录并刷新两个面板 |

> 提示：`Tab` 自动补全命令与文件路径，`↑/↓` 浏览命令历史。

#### 表单

| 按键 | 操作 |
|---|---|
| `Tab` | 下一个字段 |
| `Shift+Tab` | 上一个字段 |
| `↑/↓` | 在字段间导航 |
| `←/→` | 在字段内移动光标 |
| `Home` | 光标移到开头 |
| `End` | 光标移到末尾 |

### 鼠标快捷键

| 操作 | 描述 |
|---|---|
| 单击 | 在侧边栏中选择连接 |
| 双击 | 连接到选中的服务器 |
| 点击工具栏按钮 | 新建、编辑、连接、删除、退出、帮助 |
| 双击标签页 | 关闭标签页 |
| 拖动分隔线 | 调整侧边栏宽度 |
| 拖动帮助弹窗 | 重新定位帮助窗口 |

### 项目状态

所有核心层均已实现并完成集成。

| 层级 | 状态 |
|---|---|
| 引擎（SSH、vterm.js、渲染器、存储） | ✅ 完成 |
| UI 组件（侧边栏、表单、终端面板、状态栏、标签栏、帮助弹窗） | ✅ 完成 |
| 应用编排（布局、键盘路由、SSH 生命周期、多标签页） | ✅ 完成 |
| 鼠标支持（选中、复制、拖动） | ✅ 完成 |
| 验证与 QA | ✅ 完成 |

### 架构

```
src/
├── index.ts              # 入口文件 — 创建渲染器并初始化 App
├── app.ts                # 主应用类 — 布局、焦点管理、键盘路由
├── logger.ts             # 日志系统（LogTape，写入 ssh-cli.log）
├── clipboard.ts          # 剪贴板操作（复制/粘贴）
├── ssh/                  # SSH 连接层
│   ├── auth.ts           #   认证配置构建器（密钥/密码）
│   ├── connection.ts     #   SSH 会话生命周期（SshConnection 类）
│   └── types.ts          #   SSH 类型（SshConnectionState、错误）
├── sftp/                 # SFTP 文件管理器模块
│   ├── sftp-client.ts    #   SFTP 客户端封装（readdir、mkdir、upload、download）
│   ├── sftp-tab.ts       #   SFTP 双面板标签页（cmd 模式、键盘、scrollY 滚动）
│   ├── sftp-input-dialog.ts # 路径输入弹窗（用于 Ctrl+U/D）
│   └── types.ts          #   SFTP 类型（FileEntry、TransferTask、PanelSide）
├── storage/              # 持久化层
│   ├── config.ts         #   配置文件路径（~/.ssh-cli/）
│   └── connections.ts    #   ConnectionStore CRUD（纯 JSON）
├── terminal/             # 终端模拟引擎
│   ├── vterm-adapter.ts  #   vterm.js 封装，支持历史回滚
│   └── terminal-renderer.ts # OpenTUI 渲染桥接（脏行差异渲染）
├── types/                # 共享 TypeScript 接口
│   ├── connection.ts     #   ConnectionConfig 接口
│   └── terminal.ts       #   Cell、CursorPosition、ScreenBufferState
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

# 运行
bun start

# 以 debug 级别运行
bun run start -- --log-level debug

# 以 trace 级别运行（最详细）
bun run start -- --log-level trace

# 编译为独立的 Windows 可执行文件
bun run build:win
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
- `Ctrl+C` 复制终端选中文本（或最后一行）；无内容可复制时向 shell 发送中断（SIGINT）

#### 4. 多标签页支持
- 在 separate 标签页中打开多个 SSH 会话
- 使用 `F2-F12` 或 `Ctrl+Shift+Tab` 切换标签页
- 使用 `Ctrl+Shift+C` 或双击标签页关闭
- 每个标签页维护自己的终端状态和历史回滚

#### 5. SFTP 文件管理器
在终端标签页按 `Ctrl+E` 打开 SFTP 文件管理器：

- **双面板布局**：左侧本地文件，右侧远程文件
- **独立 SSH 连接**：每个 SFTP 标签页创建独立的 SSH 连接
- **导航**：用 `↑`/`↓` 选择文件，`Enter` 打开目录，`Backspace` 返回上级
- **切换面板**：按 `Tab` 在本地和远程面板间切换
- **命令行**：按 `:` 进入命令模式，输入 `upload`、`download`、`cd`、`mkdir`、`rm`、`rename` 等命令（`Tab` 自动补全，`↑/↓` 浏览历史）
- **快捷键**：`Ctrl+U` 预填上传命令，`Ctrl+D` 预填下载命令，`F7`/`N` 创建目录，`F8`/`Delete` 删除，`F2` 重命名，`R`/`Ctrl+R` 刷新，`Ctrl+H` 切换系统文件
- **关闭**：在命令模式下按 `Esc` 退出；关闭标签页用 `Ctrl+Shift+C` 或双击

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
| [`vterm.js`](https://github.com/nickmccurdy/vterm.js) | 完整的终端模拟，支持 ANSI 颜色 |
| [`ssh2-no-cpu-features`](https://github.com/JAForbes/ssh2-no-cpu-features) | SSH2 客户端（移除 cpu-features 的分支） |
| [`@logtape/logtape`](https://github.com/dahlia/logtape) | 结构化日志（零依赖，文件输出） |

### 关键设计决策

- **无 JSX** — OpenTUI 使用命令式 VNode API（`BoxRenderable`、`TextRenderable` 等）构建组件
- **命令式 API** — 所有 UI 组件均为类而非函数组件，状态直接变更并按需重渲染
- **`ssh2-no-cpu-features`** — 替代 `ssh2`，因为原生 `cpu-features` 模块在 Bun 上无法运行
- **vterm.js** — 使用完整终端模拟替代自定义 ANSI 解析器，以获得更好的兼容性
- **脏行渲染** — 终端渲染器只重绘发生变化的行，对局部更新高效
- **动态导入** — 通过 `await import()` 导入 `ssh2-no-cpu-features`，因其以含顶层 await 的 ESM 格式发布

---

## License

MIT
