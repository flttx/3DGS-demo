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

  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body?.getReader();

  let loaded = 0;

  if (!reader) {
    const arrayBuffer = await response.arrayBuffer();
    const chunk = new Uint8Array(arrayBuffer);
    loaded = chunk.byteLength;
    await onChunk(chunk, true, loaded, total || loaded);
    return { loaded, total: total || loaded };
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      await onChunk(null, true, loaded, total || loaded);
      break;
    }
    loaded += value.byteLength;
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
