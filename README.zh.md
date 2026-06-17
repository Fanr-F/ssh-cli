# 🔌 SSH CLI — OpenTUI SSH 客户端

[![Bun](https://img.shields.io/badge/Bun-1.x-000?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript)](https://www.typescriptlang.org/)

基于 [Bun](https://bun.sh) 和 [OpenTUI](https://github.com/xanderjohansen/opentui) 构建的终端 SSH 客户端。

---

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
| `Ctrl+C` | 复制（侧边栏：连接信息，终端：选中文本或最后一行） |
| `Ctrl+V` | 粘贴（剪贴板内容粘贴到终端/表单） |
| `Ctrl+Shift+C` | 关闭当前标签页 |
| `Ctrl+Shift+Tab` | 循环切换到下一个标签页 |
| `PageUp/PageDown` | 滚动终端输出 |

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
├── clipboard.ts          # 剪贴板操作（复制/粘贴）
├── ssh/                  # SSH 连接层
│   ├── auth.ts           #   认证配置构建器（密钥/密码）
│   ├── connection.ts     #   SSH 会话生命周期（SshConnection 类）
│   └── types.ts          #   SSH 类型（SshConnectionState、错误）
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
    ├── status-bar.ts     #   状态栏（已连接/已断开/快捷键提示）
    ├── terminal-panel.ts #   终端显示面板
    ├── tab-bar.ts        #   多标签栏
    ├── toolbar.ts        #   可点击的快捷键工具栏
    ├── divider.ts        #   可拖动的侧边栏分隔线
    └── help-popup.ts     #   可拖动的帮助弹窗（F1）
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

#### 4. 多标签页支持
- 在 separate 标签页中打开多个 SSH 会话
- 使用 `F2-F12` 或 `Ctrl+Shift+Tab` 切换标签页
- 使用 `Ctrl+Shift+C` 或双击标签页关闭
- 每个标签页维护自己的终端状态和历史回滚

#### 5. 断开连接 / 切换会话
- 在远程 shell 中输入 `exit` 或关闭 shell 来断开连接
- 按 `Alt+←/→` 切换侧边栏和终端之间的焦点
- 状态栏显示连接状态：**Connected**（已连接）、**Disconnected**（已断开）或 **Error**（错误）

#### 6. 编辑 / 删除连接
- 选中连接后按 `e` **编辑**连接详情
- 选中连接后按 `Delete` **删除**连接

#### 7. 帮助
按 `F1` 打开帮助弹窗。弹窗可拖动 — 点击并拖动以重新定位。

#### 8. 退出
按 `Ctrl+Q` 退出应用。

### 依赖项

| 包名 | 用途 |
|---|---|
| [`@opentui/core`](https://github.com/xanderjohansen/opentui) | 终端 UI 框架（Box、Text、渲染器、输入） |
| [`vterm.js`](https://github.com/nickmccurdy/vterm.js) | 完整的终端模拟，支持 ANSI 颜色 |
| [`ssh2-no-cpu-features`](https://github.com/JAForbes/ssh2-no-cpu-features) | SSH2 客户端（移除 cpu-features 的分支） |

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
