# 🔌 SSH CLI — OpenTUI SSH Client

[![Bun](https://img.shields.io/badge/Bun-1.x-000?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript)](https://www.typescriptlang.org/)

A terminal-based SSH client with an interactive TUI, built with [Bun](https://bun.sh) and [OpenTUI](https://github.com/xanderjohansen/opentui).

---

<!-- markdownlint-disable MD025 -->
# 🇬🇧 English

## Overview

**SSH CLI** is a full-featured SSH client that runs entirely in your terminal. It offers a modern tabbed interface for managing SSH connections, viewing terminal output, and browsing logs — all without leaving the command line.

### Features

- **Connection Manager** — Add, edit, delete, and organize SSH connections with encrypted local storage
- **Terminal Emulator** — Full ANSI escape sequence support via a custom-built parser and screen buffer
- **Dual Auth** — Supports both private key (`key`) and password (`password`) authentication
- **Tabbed UI** — Three tabs: Connections (sidebar + form), Terminal (live SSH session), Logs
- **Encrypted Storage** — Connection credentials encrypted with AES-256-GCM using a master password
- **Dependency Light** — Only three runtime deps: OpenTUI (UI framework), an ANSI parser, and ssh2

### Project Status

> 🚧 **Active development.** The core engine and UI components are complete. Integration into the final application layout is in progress.

| Layer | Status |
|---|---|
| Engine (SSH, ANSI, Renderer, Storage) | ✅ Complete |
| UI Components (Sidebar, Form, Terminal, StatusBar) | ✅ Complete |
| Application Wiring (layout, event flow, SSH lifecycle) | 🚧 In Progress |
| Polish & Testing | ⏳ Planned |

### Architecture

```
src/
├── index.ts              # Entry point
├── ssh/                  # SSH connection & authentication
│   ├── auth.ts           #   Key & password auth
│   ├── connection.ts     #   Session lifecycle (connect, exec, resize, close)
│   └── types.ts          #   SSH-related types
├── storage/              # Encrypted local data persistence
│   ├── config.ts         #   Config file paths (~/.ssh-cli/)
│   ├── connections.ts    #   Connection CRUD (ConnectionStore class)
│   └── encryption.ts     #   AES-256-GCM encrypt/decrypt
├── terminal/             # Terminal emulation engine
│   ├── ansi-processor.ts #   ANSI escape sequence parser
│   ├── cell.ts           #   Cell model (char, colors, attributes)
│   ├── screen-buffer.ts  #   2D grid buffer with scrollback
│   └── terminal-renderer.ts # OpenTUI render bridge
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

> ⚠️ The app is not yet fully wired. Running `bun start` currently shows a minimal OpenTUI placeholder.

### Dependencies

| Package | Purpose |
|---|---|
| [`@opentui/core`](https://github.com/xanderjohansen/opentui) | Terminal UI framework (Box, Text, renderer, input) |
| [`@ansi-tools/parser`](https://github.com/xanderjohansen/ansi-tools) | ANSI escape sequence parsing |
| [`ssh2-no-cpu-features`](https://github.com/JAForbes/ssh2-no-cpu-features) | SSH2 client (cpu-features-free fork) |

### Key Design Decisions

- **No JSX** — OpenTUI uses a virtual-node factory (`h()` / `jsx()`) with `{ tag, props, children }` objects
- **VNode API** — UI components attach methods via `Object.assign(vnode, api)` for imperative control
- **`await import('ssh2')`** — Required because `ssh2` ships ESM with top-level await; `require()` will not work
- **Encryption at rest** — Connections file is AES-256-GCM encrypted; the master password is entered at startup
- **ANSI parsing** — Uses `@ansi-tools/parser` for tokenization, then maps tokens to cell grid updates
- **Dirty-row rendering** — The terminal renderer only redraws rows that changed (efficient for partial updates)

---

# 🇨🇳 中文

## 概述

**SSH CLI** 是一个完全运行在终端中的 SSH 客户端，提供现代化的标签式界面来管理 SSH 连接、查看终端输出和浏览日志，全程无需离开命令行。

### 功能特性

- **连接管理** — 通过加密本地存储添加、编辑、删除和管理 SSH 连接
- **终端模拟** — 通过自建的 ANSI 解析器和屏幕缓冲区支持完整的 ANSI 转义序列
- **双重认证** — 支持私钥（`key`）和密码（`password`）两种认证方式
- **标签式界面** — 三个标签页：连接（侧边栏 + 表单）、终端（实时 SSH 会话）、日志
- **加密存储** — 使用 AES-256-GCM 主密码加密存储连接凭据
- **轻量依赖** — 仅三个运行时依赖：OpenTUI（UI 框架）、ANSI 解析器、ssh2

### 项目状态

> 🚧 **积极开发中。** 核心引擎和 UI 组件已完成，正在进行最终应用布局的集成。

| 层级 | 状态 |
|---|---|
| 引擎（SSH、ANSI、渲染器、存储） | ✅ 完成 |
| UI 组件（侧边栏、表单、终端面板、状态栏） | ✅ 完成 |
| 应用编排（布局、事件流、SSH 生命周期） | 🚧 进行中 |
| 完善与测试 | ⏳ 计划中 |

### 架构

```
src/
├── index.ts              # 入口文件
├── ssh/                  # SSH 连接与认证
│   ├── auth.ts           #   密钥与密码认证
│   ├── connection.ts     #   会话生命周期（连接、执行命令、调整大小、关闭）
│   └── types.ts          #   SSH 相关类型
├── storage/              # 加密本地数据持久化
│   ├── config.ts         #   配置文件路径（~/.ssh-cli/）
│   ├── connections.ts    #   连接 CRUD（ConnectionStore 类）
│   └── encryption.ts     #   AES-256-GCM 加密/解密
├── terminal/             # 终端模拟引擎
│   ├── ansi-processor.ts #   ANSI 转义序列解析器
│   ├── cell.ts           #   单元格模型（字符、颜色、属性）
│   ├── screen-buffer.ts  #   带回滚的二维网格缓冲区
│   └── terminal-renderer.ts # OpenTUI 渲染桥接
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

> ⚠️ 应用尚未完全完成编排。当前运行 `bun start` 会显示一个最小的 OpenTUI 占位界面。

### 依赖项

| 包名 | 用途 |
|---|---|
| [`@opentui/core`](https://github.com/xanderjohansen/opentui) | 终端 UI 框架（Box、Text、渲染器、输入） |
| [`@ansi-tools/parser`](https://github.com/xanderjohansen/ansi-tools) | ANSI 转义序列解析 |
| [`ssh2-no-cpu-features`](https://github.com/JAForbes/ssh2-no-cpu-features) | SSH2 客户端（移除 cpu-features 的分支） |

### 关键设计决策

- **无 JSX** — OpenTUI 使用虚拟节点工厂函数（`h()` / `jsx()`），返回 `{ tag, props, children }` 对象
- **VNode API** — UI 组件通过 `Object.assign(vnode, api)` 附加方法以实现命令式控制
- **`await import('ssh2')`** — 必须使用动态导入，因为 `ssh2` 以 ESM 格式发布且包含顶层 await，`require()` 无法工作
- **静态加密** — 连接文件使用 AES-256-GCM 加密，启动时输入主密码解密
- **ANSI 解析** — 使用 `@ansi-tools/parser` 进行词法分析，然后将令牌映射为单元格网格更新
- **脏行渲染** — 终端渲染器只重绘发生变化的行，对局部更新高效

---

## License

MIT
