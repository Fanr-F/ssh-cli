import { SftpClient } from './sftp-client';
import type { TransferTask, TransferStatus } from './types';
import { createLogger } from '../logger';

const log = createLogger('sftp-transfer');

export interface TransferQueueAPI {
  addUpload(localPath: string, remotePath: string, size: number): string;
  addDownload(remotePath: string, localPath: string, size: number): string;
  cancel(taskId: string): void;
  cancelAll(): void;
  getQueue(): TransferTask[];
  getActiveCount(): number;
  onProgress(cb: (taskId: string, transferred: number, speed: number) => void): void;
  onComplete(cb: (taskId: string) => void): void;
  onError(cb: (taskId: string, error: string) => void): void;
  onQueueChange(cb: (queue: TransferTask[]) => void): void;
}

/**
 * Manages a queue of file transfers with concurrency control.
 */
export function createTransferQueue(sftpClient: SftpClient, maxConcurrent: number = 3): TransferQueueAPI {
  const queue: TransferTask[] = [];
  let activeCount = 0;
  let idCounter = 0;

  const progressCallbacks: Array<(taskId: string, transferred: number, speed: number) => void> = [];
  const completeCallbacks: Array<(taskId: string) => void> = [];
  const errorCallbacks: Array<(taskId: string, error: string) => void> = [];
  const queueChangeCallbacks: Array<(queue: TransferTask[]) => void> = [];

  function notifyQueueChange(): void {
    for (const cb of queueChangeCallbacks) cb([...queue]);
  }

  function updateTask(id: string, updates: Partial<TransferTask>): void {
    const task = queue.find(t => t.id === id);
    if (task) {
      Object.assign(task, updates);
      notifyQueueChange();
    }
  }

  async function processTask(task: TransferTask): Promise<void> {
    activeCount++;
    updateTask(task.id, { status: 'active' });

    const startTime = Date.now();
    let lastBytes = 0;
    let lastTime = startTime;

    try {
      const onProgress = (bytesTransferred: number, totalBytes: number) => {
        const now = Date.now();
        const elapsed = (now - lastTime) / 1000;
        const speed = elapsed > 0 ? (bytesTransferred - lastBytes) / elapsed : 0;
        lastBytes = bytesTransferred;
        lastTime = now;

        updateTask(task.id, {
          transferred: bytesTransferred,
          speed,
        });

        for (const cb of progressCallbacks) {
          cb(task.id, bytesTransferred, speed);
        }
      };

      if (task.direction === 'upload') {
        await sftpClient.upload(task.localPath, task.remotePath, onProgress);
      } else {
        await sftpClient.download(task.remotePath, task.localPath, onProgress);
      }

      updateTask(task.id, { status: 'completed', transferred: task.size, speed: 0 });
      for (const cb of completeCallbacks) cb(task.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transfer failed';
      updateTask(task.id, { status: 'failed', error: msg });
      for (const cb of errorCallbacks) cb(task.id, msg);
    } finally {
      activeCount--;
      processQueue();
    }
  }

  function processQueue(): void {
    while (activeCount < maxConcurrent) {
      const next = queue.find(t => t.status === 'pending');
      if (!next) break;
      processTask(next);
    }
  }

  function addTask(direction: 'upload' | 'download', localPath: string, remotePath: string, size: number): string {
    const id = `transfer-${++idCounter}`;
    const task: TransferTask = {
      id,
      direction,
      localPath,
      remotePath,
      size,
      transferred: 0,
      status: 'pending',
      speed: 0,
    };
    queue.push(task);
    notifyQueueChange();
    processQueue();
    return id;
  }

  return {
    addUpload(localPath: string, remotePath: string, size: number): string {
      return addTask('upload', localPath, remotePath, size);
    },

    addDownload(remotePath: string, localPath: string, size: number): string {
      return addTask('download', remotePath, localPath, size);
    },

    cancel(taskId: string): void {
      const task = queue.find(t => t.id === taskId);
      if (task && (task.status === 'pending' || task.status === 'active')) {
        updateTask(taskId, { status: 'cancelled' });
      }
    },

    cancelAll(): void {
      for (const task of queue) {
        if (task.status === 'pending' || task.status === 'active') {
          updateTask(task.id, { status: 'cancelled' });
        }
      }
    },

    getQueue(): TransferTask[] {
      return [...queue];
    },

    getActiveCount(): number {
      return activeCount;
    },

    onProgress(cb: (taskId: string, transferred: number, speed: number) => void): void {
      progressCallbacks.push(cb);
    },

    onComplete(cb: (taskId: string) => void): void {
      completeCallbacks.push(cb);
    },

    onError(cb: (taskId: string, error: string) => void): void {
      errorCallbacks.push(cb);
    },

    onQueueChange(cb: (queue: TransferTask[]) => void): void {
      queueChangeCallbacks.push(cb);
    },
  };
}
