const MAX_ENTRIES = 512;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 32 * 1024 * 1024;
const INVALID_CONTAINER = 'Word 文件的压缩目录无效。';
const TOO_LARGE = 'Word 文件展开内容过大，请删除图片或仅保留要练习的文字。';

type ZipEntry = { start: number; end: number; size: number; method: number };

/** 校验 ZIP 目录与本地记录一致性，拒绝重叠、重名、路径跳转及不支持的压缩方式。 */
function readEntries(buffer: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let directory = -1;
  for (
    let offset = buffer.byteLength - 22;
    offset >= Math.max(0, buffer.byteLength - 65_557);
    offset--
  ) {
    if (
      view.getUint32(offset, true) === 0x06054b50 &&
      offset + 22 + view.getUint16(offset + 20, true) === buffer.byteLength
    ) {
      directory = offset;
      break;
    }
  }
  if (directory < 0) throw new Error(INVALID_CONTAINER);
  const count = view.getUint16(directory + 10, true);
  const directoryStart = view.getUint32(directory + 16, true);
  if (
    !count ||
    count > MAX_ENTRIES ||
    view.getUint16(directory + 4, true) ||
    view.getUint16(directory + 6, true) ||
    view.getUint16(directory + 8, true) !== count ||
    directoryStart + view.getUint32(directory + 12, true) !== directory
  )
    throw new Error(INVALID_CONTAINER);
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  const spans: { start: number; end: number }[] = [];
  let cursor = directoryStart;
  let expanded = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > directory || view.getUint32(cursor, true) !== 0x02014b50)
      throw new Error(INVALID_CONTAINER);
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressed = view.getUint32(cursor + 20, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const next =
      cursor +
      46 +
      nameLength +
      view.getUint16(cursor + 30, true) +
      view.getUint16(cursor + 32, true);
    const local = view.getUint32(cursor + 42, true);
    if (flags & 0x41) throw new Error('暂不支持加密 Word 文件，请先移除密码。');
    if (
      (method !== 0 && method !== 8) ||
      view.getUint16(cursor + 34, true) ||
      !nameLength ||
      next > directory ||
      local + 30 > directoryStart ||
      view.getUint32(local, true) !== 0x04034b50 ||
      view.getUint16(local + 6, true) !== flags ||
      view.getUint16(local + 8, true) !== method ||
      view.getUint16(local + 26, true) !== nameLength
    )
      throw new Error(INVALID_CONTAINER);
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    let name: string;
    try {
      name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
    } catch {
      throw new Error(INVALID_CONTAINER);
    }
    if (
      names.has(name) ||
      /[\\:]/.test(name) ||
      name.includes('\0') ||
      name.startsWith('/') ||
      name.split('/').some((segment) => segment === '.' || segment === '..')
    )
      throw new Error(INVALID_CONTAINER);
    names.add(name);
    const start = local + 30 + nameLength + view.getUint16(local + 28, true);
    const end = start + compressed;
    if (
      end > directoryStart ||
      spans.some((span) => local < span.end && end > span.start) ||
      !nameBytes.every((value, position) => value === bytes[local + 30 + position]) ||
      (!(flags & 8) &&
        (view.getUint32(local + 18, true) !== compressed ||
          view.getUint32(local + 22, true) !== size))
    )
      throw new Error(INVALID_CONTAINER);
    expanded += size;
    if (size > MAX_ENTRY_BYTES || expanded > MAX_EXPANDED_BYTES) throw new Error(TOO_LARGE);
    spans.push({ start: local, end });
    entries.push({ start, end, size, method });
    cursor = next;
  }
  if (cursor !== directory) throw new Error(INVALID_CONTAINER);
  return entries;
}

/**
 * 先按实际流式解压字节计量，再交给 Word 解析器；不能仅信任可伪造的 ZIP 大小字段。
 * 不保留展开内容；超限、损坏或取消立即释放解压流。不支持 raw deflate 的设备明确拒绝 DOCX。
 */
export async function validateDocxContainer(
  buffer: ArrayBuffer,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const entries = readEntries(buffer);
  let expanded = 0;
  for (const entry of entries) {
    signal?.throwIfAborted();
    if (entry.method === 0) {
      if (entry.end - entry.start !== entry.size) throw new Error(INVALID_CONTAINER);
      expanded += entry.size;
      continue;
    }
    let decompressor: DecompressionStream;
    try {
      decompressor = new DecompressionStream('deflate-raw');
    } catch {
      throw new Error('当前设备不支持安全读取 Word，请升级浏览器，或将材料另存为 TXT 后导入。');
    }
    const reader = new Blob([buffer.slice(entry.start, entry.end)])
      .stream()
      .pipeThrough(decompressor)
      .getReader();
    const cancel = () => {
      void reader.cancel().catch(() => undefined);
    };
    signal?.addEventListener('abort', cancel, { once: true });
    let length = 0;
    try {
      while (true) {
        signal?.throwIfAborted();
        const chunk = await reader.read();
        signal?.throwIfAborted();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        expanded += chunk.value.byteLength;
        if (length > MAX_ENTRY_BYTES || expanded > MAX_EXPANDED_BYTES) throw new Error(TOO_LARGE);
        if (length > entry.size) throw new Error(INVALID_CONTAINER);
      }
      if (length !== entry.size) throw new Error(INVALID_CONTAINER);
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof Error && [INVALID_CONTAINER, TOO_LARGE].includes(error.message))
        throw error;
      throw new Error(INVALID_CONTAINER);
    } finally {
      signal?.removeEventListener('abort', cancel);
      cancel();
      reader.releaseLock();
    }
  }
}
