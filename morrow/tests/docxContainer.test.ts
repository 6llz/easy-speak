import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import { validateDocxContainer } from '../src/lib/docxContainer.ts';

async function archive(text = 'hello', compression: 'STORE' | 'DEFLATE' = 'DEFLATE') {
  const zip = new JSZip();
  zip.file('word/document.xml', text);
  const bytes = await zip.generateAsync({ type: 'arraybuffer', compression });
  const view = new DataView(bytes);
  const end = bytes.byteLength - 22;
  const directory = view.getUint32(end + 16, true);
  return { bytes, view, directory, end };
}

test('DOCX STORE 与 DEFLATE 均按实际输出通过，预取消不开始解压', async () => {
  for (const compression of ['STORE', 'DEFLATE'] as const) {
    const { bytes } = await archive('正常内容', compression);
    await validateDocxContainer(bytes);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(validateDocxContainer(bytes, controller.signal), { name: 'AbortError' });
  }
});

test('伪造中央及本地展开大小不能绕过实际解压计量', async () => {
  const { bytes, view, directory } = await archive('x'.repeat(1_000_000));
  // JSZip 会为 word/ 创建目录，找到实际压缩文件。
  let entry = directory;
  while (view.getUint16(entry + 10, true) !== 8)
    entry +=
      46 +
      view.getUint16(entry + 28, true) +
      view.getUint16(entry + 30, true) +
      view.getUint16(entry + 32, true);
  const local = view.getUint32(entry + 42, true);
  view.setUint32(entry + 24, 1, true);
  view.setUint32(local + 22, 1, true);
  await assert.rejects(validateDocxContainer(bytes), /压缩目录无效/);
});

test('目录边界、记录错配、路径跳转、压缩方法与真实 STORE 长度异常均拒绝', async () => {
  for (const mutate of [
    ({ view, end }: Awaited<ReturnType<typeof archive>>) => view.setUint32(end + 12, 1, true),
    ({ view, directory }: Awaited<ReturnType<typeof archive>>) =>
      view.setUint32(directory + 42, 0xffffffff, true),
    ({ view, directory }: Awaited<ReturnType<typeof archive>>) =>
      view.setUint16(directory + 10, 99, true),
    ({ bytes, view, directory }: Awaited<ReturnType<typeof archive>>) => {
      const local = view.getUint32(directory + 42, true);
      new Uint8Array(bytes).set(new TextEncoder().encode('../a/'), directory + 46);
      new Uint8Array(bytes).set(new TextEncoder().encode('../a/'), local + 30);
    },
  ]) {
    const value = await archive();
    mutate(value);
    await assert.rejects(validateDocxContainer(value.bytes), /Word/);
  }
  const { bytes, view, directory } = await archive('hello', 'STORE');
  let entry = directory;
  while (!view.getUint32(entry + 24, true))
    entry +=
      46 +
      view.getUint16(entry + 28, true) +
      view.getUint16(entry + 30, true) +
      view.getUint16(entry + 32, true);
  view.setUint32(entry + 24, 1, true);
  view.setUint32(view.getUint32(entry + 42, true) + 22, 1, true);
  await assert.rejects(validateDocxContainer(bytes), /Word/);
});

test('解压能力缺失时明确拒绝 Word，不回退到无资源边界的解压', async (context) => {
  const { bytes } = await archive();
  context.mock.method(globalThis, 'DecompressionStream', function () {
    throw new Error('unsupported');
  });
  await assert.rejects(validateDocxContainer(bytes), /不支持安全读取 Word/);
});
