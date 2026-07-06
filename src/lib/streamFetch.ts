/**
 * 流式下载工具
 * 简化自 awa-community-web/src/pages/3d-editor/lib/stream-fetch.ts
 * 去掉了共享去重 / Cache API 持久化，保留流式读取 + 进度回调
 */

export type StreamChunkHandler = (
  chunk: Uint8Array | null,
  final: boolean,
  loaded: number,
  total: number,
) => void | Promise<void>;

export interface StreamResult {
  loaded: number;
  total: number;
}

export interface StreamUrlOptions {
  signal?: AbortSignal;
}

/**
 * 流式下载 URL，逐块回调。
 * onChunk 收到 null chunk 且 final=true 时表示下载完成。
 */
export async function streamUrl(
  url: string,
  onChunk: StreamChunkHandler,
  options?: StreamUrlOptions,
): Promise<StreamResult> {
  const { signal } = options ?? {};
  const response = await fetch(url, signal ? { signal } : undefined);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }

  // 【1. 获取文件总大小】
  // 尝试从 HTTP 响应头中读取 Content-Length，用于后续计算下载进度百分比。
  // 注意：如果后端开启了 gzip/brotli 压缩或没有返回该头，这里可能拿不到真实大小（为 0）。
  const total = Number(response.headers.get('content-length')) || 0;
  
  // 【2. 获取字节流读取器 (ReadableStream Reader)】
  // 这是现代 Fetch API 支持流式下载的核心。它允许我们在底层网络包到达时，
  // 就能立刻拿到数据分片，而不需要等整个大文件全部下载到内存中。
  const reader = response.body?.getReader();

  let loaded = 0;

  // 【3. 降级方案 (Fallback)】
  // 如果当前浏览器/环境不支持 Streams API (reader 为空)，
  // 只能退化为传统的全量下载模式：卡在这里等整个 arrayBuffer 下载完，然后一次性抛出。
  if (!reader) {
    const arrayBuffer = await response.arrayBuffer();
    const chunk = new Uint8Array(arrayBuffer);
    loaded = chunk.byteLength;
    await onChunk(chunk, true, loaded, total || loaded);
    return { loaded, total: total || loaded };
  }

  // 【4. 流式消费循环 (Stream Consumption Loop)】
  while (true) {
    // reader.read() 返回一个 Promise，当下一个数据块（TCP packet）到达时 resolve。
    // done: 布尔值，表示流是否已经传输完毕。
    // value: Uint8Array，这批次到达的二进制数据块。
    const { done, value } = await reader.read();
    
    if (done) {
      // 下载完成，抛出一个 null chunk 并将 final 标为 true，通知外界闭合处理逻辑。
      await onChunk(null, true, loaded, total || loaded);
      break;
    }
    
    // 累加当前已经下载的字节数
    loaded += value.byteLength;
    
    // 【5. 实时派发】
    // 拿到一批数据就立刻丢给回调函数（比如让 WASM 解析器去处理，或者累加进度条）。
    // 这种“边下边解析”的能力极大降低了内存峰值并加快了首帧渲染时间。
    await onChunk(value, false, loaded, total || loaded);
  }

  return { loaded, total: total || loaded };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatProgress(loaded: number, total: number): string {
  if (!total) return formatBytes(loaded);
  const pct = Math.min(100, Math.round((loaded / total) * 100));
  return `${pct}% (${formatBytes(loaded)} / ${formatBytes(total)})`;
}
