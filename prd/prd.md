# SFTP 文件传输功能 PRD

## 1. 概述

为 ssh-cli 添加 SFTP 文件传输功能，支持在终端标签页快速上传/下载，以及在专用 SFTP 标签页中交互式浏览远程文件系统并进行双向传输。

### 目标
- 终端标签页：快捷键触发，输入路径快速上传/下载
- SFTP 标签页：双面板布局（类 Midnight Commander），交互式浏览本地和远程文件系统
- 传输进度实时显示

## 2. 用户故事

| # | 作为... | 我想要... | 以便... |
|---|---------|----------|---------|
| 1 | 用户 | 在终端中按 Ctrl+U 输入本地路径上传文件 | 快速上传文件到远程当前目录 |
| 2 | 用户 | 在终端中按 Ctrl+D 输入远程路径下载文件 | 快速下载远程文件到本地 |
| 3 | 用户 | 打开 SFTP 标签页浏览远程目录 | 可视化选择要传输的文件 |
| 4 | 用户 | 在 SFTP 标签页中双向传输文件 | 管理多个文件的上传下载 |
| 5 | 用户 | 查看传输进度和速度 | 了解传输状态 |
| 6 | 用户 | 在 SFTP 标签页中创建/删除/重命名远程文件 | 管理远程文件 |

## 3. 快捷键设计

### 全局快捷键（终端标签页）

| 快捷键 | 功能 | 说明 |
|--------|------|------|
| Ctrl+U | 上传文件 | 弹出输入框，输入本地文件路径，上传到远程当前目录 |
| Ctrl+D | 下载文件 | 弹出输入框，输入远程文件路径，下载到本地默认目录 |
| Ctrl+E | 打开 SFTP 标签页 | 创建新标签页并打开 SFTP 双面板界面 |

### SFTP 标签页快捷键

| 快捷键 | 功能 | 说明 |
|--------|------|------|
| Tab | 切换面板 | 在本地和远程面板间切换焦点 |
| 上/下 | 选择文件 | 在当前面板中移动光标 |
| Enter | 进入目录/执行操作 | 目录则进入，命令模式下执行命令 |
| Backspace | 返回上级目录 | 返回父目录 |
| : | 进入命令模式 | 输入命令进行文件操作 |
| Ctrl+R | 刷新 | 刷新当前面板目录列表 |
| F7 | 新建目录 | 在当前面板创建新目录 |
| F8 | 删除 | 删除选中文件（需确认） |
| F2 | 重命名 | 重命名选中文件 |
| Esc | 关闭标签页 | 关闭 SFTP 标签页回到终端 |

### SFTP 命令行

| 命令 | 说明 |
|------|------|
| upload <本地路径> <远程路径> | 上传本地文件到远程 |
| download <远程路径> <本地路径> | 下载远程文件到本地 |
| mkdir <路径> | 在远程创建目录 |
| rm <路径> | 删除远程文件 |
| rename <旧名> <新名> | 重命名远程文件 |
| cd <路径> | 切换远程目录 |

## 4. UI 设计

### 4.1 标签页类型标记

标签页通过标题前缀区分类型，让用户一眼识别当前标签页的用途：

| 类型 | 标题格式 | 示例 |
|------|---------|------|
| 终端标签页 | `SSH: user@host` | `SSH: anysoft004@192.168.10.46` |
| SFTP 标签页 | `⇄ SFTP: user@host` | `⇄ SFTP: anysoft004@192.168.10.46` |

标签栏渲染效果：
```
┌──────────────────────────────────────────────────────────────────────────┐
│ SSH: anysoft004@192.168.10.46 ×  ⇄ SFTP: anysoft004@192.168.10.46 ×   │
└──────────────────────────────────────────────────────────────────────────┘
```

实现要点：
- `tab-bar.ts` 的 tab 数据结构添加 `type: 'terminal' | 'sftp'` 字段
- `addTab(id, title, type)` 方法添加类型参数
- 终端标签页：SSH 连接成功后标题更新为 `SSH: user@host`
- SFTP 标签页：创建时标题设为 `⇄ SFTP: user@host`

### 4.2 SFTP 标签页布局

```
+----------------------------------------------------------------------+
|  ⇄ SFTP: user@host                               ::命令  Ctrl+U:上传  Ctrl+D:下载 |
+----------------------------+-----------------------------------------+
|  Local: /home/user         |  Remote: /home/remote-user             |
+----------------------------+-----------------------------------------+
|  ../                       |  ../                                    |
|  Documents/                |  .ssh/                                  |
|  Downloads/                |  projects/                              |
|  Pictures/                 |  logs/                                  |
|  readme.txt                |  .bashrc                                |
|  config.json               |  deploy.sh                              |
|  data.csv                  |  backup.tar.gz                          |
+----------------------------+-----------------------------------------+
|  [Tab切换] [↑↓选择] [:命令] [Enter打开] [Ctrl+U上传] [Ctrl+D下载]      |
+----------------------------------------------------------------------+
```

### 4.3 SFTP 命令行模式

按 `:` 进入命令模式，底部显示命令输入行：

```
+----------------------------------------------------------------------+
|  ⇄ SFTP: user@host                               ::命令  Ctrl+U:上传  Ctrl+D:下载 |
+----------------------------+-----------------------------------------+
|  Local: /home/user         |  Remote: /home/remote-user             |
+----------------------------+-----------------------------------------+
|  ../                       |  ../                                    |
|  Documents/                |  .ssh/                                  |
|  Downloads/                |  projects/                              |
|  Pictures/                 |  logs/                                  |
|  readme.txt                |  .bashrc                                |
|  config.json               |  deploy.sh                              |
|  data.csv                  |  backup.tar.gz                          |
+----------------------------+-----------------------------------------+
|  :upload data.csv /tmp/data.csv_                                    |
+----------------------------------------------------------------------+
```

命令模式特点：
- Enter 执行命令后保持命令模式（可连续执行）
- Esc 退出命令模式
- 支持 `upload`、`download`、`mkdir`、`rm`、`rename`、`cd` 命令

### 4.4 终端快捷键输入框

```
+-------------------------------------------+
|  Upload to: anysoft004@192.168.10.46      |
|                                           |
|  Local path: /home/user/data.csv_         |
|                                           |
|  [OK]    [Cancel]                         |
+-------------------------------------------+
```

### 4.5 颜色方案

沿用 Tokyo Night 主题：
- 目录：蓝色 #6272A4
- 文件：白色 #BFBFBF
- 可执行文件：绿色 #50FA7B
- 选中项：高亮背景（手动 fg/bg 交换）
- 进度条：绿色 #50FA7B 填充，灰色 #4D4D4D 背景
- 传输速度：黄色 #F1FA8C

## 5. 功能详述

### 5.1 终端快捷键上传（Ctrl+U）

流程：
1. 用户在终端标签页按 Ctrl+U
2. 弹出路径输入弹窗（类似连接表单样式）
3. 用户输入本地文件路径（支持 ~ 展开）
4. 按 Enter 确认，弹窗关闭
5. 通过当前 SSH 连接的 SFTP 通道上传文件
6. 上传过程中在状态栏显示进度
7. 完成后状态栏显示"上传完成: filename"

约束：
- 仅在已连接状态下可用
- 上传目标为远程当前工作目录（$PWD）
- 不支持目录上传（仅文件）
- 单文件上传

### 5.2 终端快捷键下载（Ctrl+D）

流程：
1. 用户在终端标签页按 Ctrl+D
2. 弹出路径输入弹窗
3. 用户输入远程文件路径
4. 按 Enter 确认
5. 下载到本地当前工作目录（Bun 的 process.cwd()）
6. 显示进度，完成后提示

### 5.3 SFTP 标签页

#### 5.3.1 初始化
1. 按 Ctrl+E 或从工具栏按钮触发
2. 创建新标签页，**创建独立的 SSH 连接**（不复用终端的连接）
3. 通过独立 SSH 连接打开 SFTP 通道
4. 获取远程 home 目录路径
5. 获取本地 home 目录路径
6. 双面板初始化，左本地右远程

**注意**：每个 SFTP 标签页拥有独立的 SSH 连接，关闭一个标签页不会影响其他标签页。

#### 5.3.2 目录浏览
- 远程目录：通过 sftp.readdir() 获取目录内容
- 本地目录：通过 Bun.readDir() 或 node:fs 获取目录内容
- 显示文件名、大小、修改时间、权限
- 目录排序：先目录后文件，按名称字母序
- 隐藏文件（.开头）默认显示，可通过 Ctrl+H 切换

#### 5.3.3 传输队列
- 支持多文件排队传输
- 并发限制：最多 3 个并发传输
- 传输失败时显示错误信息，不中断队列
- 支持取消传输（选中队列项按 Delete）

### 5.4 文件操作

| 操作 | 快捷键 | 说明 |
|------|--------|------|
| 新建目录 | F7 | 在当前面板创建新目录 |
| 删除 | F8 | 删除选中文件（需确认） |
| 重命名 | F2 | 重命名选中文件 |
| 刷新 | Ctrl+R | 重新读取当前面板目录 |
| 命令模式 | : | 进入命令行模式，支持更多操作 |

## 6. 技术架构

### 6.1 文件结构

```
src/
  sftp/                          # SFTP 模块
    sftp-client.ts               # SFTP 客户端封装（promisify ssh2 sftp）
    sftp-tab.ts                  # SFTP 标签页组件（双面板 + 命令行模式）
    sftp-input-dialog.ts         # 路径输入弹窗（Ctrl+U/D 触发）
    types.ts                     # SFTP 相关类型定义
  ssh/
    connection.ts                # 修改：添加 startSftp() 方法
  app.ts                         # 修改：添加 SFTP 快捷键和标签页管理
  ui/
    toolbar.ts                   # 修改：添加 SFTP 按钮
    tab-bar.ts                   # 修改：添加 type 字段，支持 SSH/SFTP 前缀图标
```

### 6.2 SshConnection 扩展

在 src/ssh/connection.ts 中添加：

```typescript
async startSftp(): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    this.client.sftp((err, sftp) => {
      if (err) reject(err);
      else resolve(sftp);
    });
  });
}

async getRemotePwd(): Promise<string> {
  const shell = await this.startShell();
  return new Promise((resolve) => {
    shell.on('data', (data: Buffer) => {
      resolve(data.toString().trim());
      shell.close();
    });
    shell.write('echo $PWD\n');
  });
}
```

### 6.3 SftpClient 封装

```typescript
class SftpClient {
  private sftp: SFTPWrapper;

  async readdir(path: string): Promise<FileEntry[]> { ... }
  async stat(path: string): Promise<Stats> { ... }
  async mkdir(path: string): Promise<void> { ... }
  async rmdir(path: string): Promise<void> { ... }
  async unlink(path: string): Promise<void> { ... }
  async rename(oldPath: string, newPath: string): Promise<void> { ... }
  async chmod(path: string, mode: number): Promise<void> { ... }
  async realpath(path: string): Promise<string> { ... }

  async upload(
    localPath: string,
    remotePath: string,
    onProgress?: (bytesUploaded: number, totalBytes: number) => void
  ): Promise<void> { ... }

  async download(
    remotePath: string,
    localPath: string,
    onProgress?: (bytesDownloaded: number, totalBytes: number) => void
  ): Promise<void> { ... }

  close(): void { ... }
}
```

### 6.4 传输队列

```typescript
interface TransferTask {
  id: string;
  direction: 'upload' | 'download';
  localPath: string;
  remotePath: string;
  size: number;
  transferred: number;
  status: 'pending' | 'active' | 'completed' | 'failed' | 'cancelled';
  speed: number;
  error?: string;
}

class TransferQueue {
  private queue: TransferTask[] = [];
  private maxConcurrent = 3;
  private activeCount = 0;

  add(task: Omit<TransferTask, 'id' | 'status' | 'transferred' | 'speed'>): string { ... }
  cancel(taskId: string): void { ... }
  onProgress: (taskId: string, transferred: number, speed: number) => void { ... }
  onComplete: (taskId: string) => void { ... }
  onError: (taskId: string, error: string) => void { ... }
}
```

### 6.5 App 集成

在 src/app.ts 中修改：

```typescript
// setupGlobalKeys() 中添加
if (key === '\x15') { // Ctrl+U
  this.openUploadDialog();
}
if (key === '\x04') { // Ctrl+D
  this.openDownloadDialog();
}
if (key === '\x05') { // Ctrl+E
  this.openSftpTab();
}

// 终端标签页标题格式
const tabTitle = `SSH: ${config.username}@${config.host}`;
this.tabBar.addTab(tabId, tabTitle, 'terminal');
// 连接成功后更新
this.tabBar.updateTabTitle(tabId, `SSH: ${config.username}@${config.host}`);

// SFTP 标签页标题格式
const sftpTitle = `⇄ SFTP: ${config.username}@${config.host}`;
this.tabBar.addTab(sftpTabId, sftpTitle, 'sftp');
```

## 7. 数据流

### 7.1 上传流程

```
用户按 Ctrl+U
    |
弹出路径输入弹窗
    |
用户输入本地路径，按 Enter
    |
App 获取当前 tab 的连接配置
    |
创建新的 SshConnection -> connect(config)
    |
SshConnection.startSftp() -> SFTPWrapper
    |
SftpClient.upload(localPath, remotePath, onProgress)
    |
sftp.fastPut(localPath, remotePath, { step: progressCallback })
    |
进度回调 -> 更新 UI 进度条
    |
完成 -> 状态栏提示
```

### 7.2 SFTP 标签页浏览

```
用户按 Ctrl+E
    |
创建新标签页 + 创建独立的 SSH 连接
    |
SshConnection.startSftp() -> SFTPWrapper
    |
SftpClient.readdir(remoteHomeDir) -> 文件列表
    |
渲染双面板：左=本地目录，右=远程目录
    |
用户方向键浏览，Enter 进入目录
    |
重新 readdir -> 更新面板
```

## 8. 错误处理

| 错误场景 | 处理方式 |
|---------|---------|
| SFTP 通道打开失败 | 弹窗提示错误，不创建标签页 |
| 文件不存在 | 状态栏红色提示，不中断操作 |
| 权限不足 | 弹窗提示具体权限错误 |
| 磁盘空间不足 | 传输失败，队列中标记为 failed |
| 网络中断 | 自动重连或提示用户重新连接 |
| 本地路径无效 | 输入框红色提示，不关闭弹窗 |

## 9. 依赖

- 无新依赖：ssh2-no-cpu-features 已内置完整 SFTP 支持
- 本地文件操作：使用 `node:fs` 和 `node:path` 跨平台处理

## 10. 实现优先级

| 阶段 | 功能 | 状态 |
|------|------|------|
| P0 | Tab-bar 添加 type 字段，支持 SSH/SFTP 前缀图标 | ✅ 完成 |
| P0 | SshConnection.startSftp() + SftpClient 封装 | ✅ 完成 |
| P0 | Ctrl+U 上传（路径输入弹窗 + 传输） | ✅ 完成 |
| P0 | Ctrl+D 下载 | ✅ 完成 |
| P1 | SFTP 标签页基础框架（双面板布局） | ✅ 完成 |
| P1 | 远程目录浏览（readdir + 导航） | ✅ 完成 |
| P1 | 本地目录浏览 | ✅ 完成 |
| P2 | SFTP 命令行系统 | ✅ 完成 |
| P2 | 文件操作（新建/删除/重命名） | ✅ 完成 |
| P3 | 独立 SSH 连接 | ✅ 完成 |
| P3 | ScrollY 滚动同步 | ✅ 完成 |

## 11. 验收标准

### 标签页类型标记
- [x] 终端标签页标题显示为 `SSH: user@host` 格式
- [x] SFTP 标签页标题显示为 `⇄ SFTP: user@host` 格式
- [x] 标签栏能同时显示多个终端和 SFTP 标签页，类型清晰可辨

### SFTP 功能
- [x] 终端标签页按 Ctrl+U 弹出输入框，输入本地路径后上传成功
- [x] 终端标签页按 Ctrl+D 弹出输入框，输入远程路径后下载成功
- [x] Ctrl+E 打开 SFTP 标签页，显示双面板
- [x] SFTP 标签页可以交互式浏览远程目录
- [x] SFTP 标签页可以交互式浏览本地目录
- [x] Tab 键切换本地/远程面板焦点
- [x] 文件操作（新建/删除/重命名）正常工作
- [x] 传输失败有明确错误提示
- [x] 所有快捷键不与现有功能冲突
- [x] SFTP 命令行模式（: 进入，Enter 执行但保持模式，Esc 退出）
- [x] 独立 SSH 连接（每个 SFTP 标签页独立，关闭不影响其他）
- [x] Remote cd 命令正确解析相对路径
