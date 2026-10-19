import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import {
  MAX_TRAINING_FILE_BYTES,
  MAX_TRAINING_TEXT_LENGTH,
  TRAINING_FILE_ACCEPT,
  readTrainingFile,
} from '../src/lib/trainingImport.ts';
import { DEFAULT_SETTINGS } from '../src/lib/core.ts';

async function docx(text: string): Promise<File> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</w:t></w:r></w:p></w:body></w:document>`,
  );
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return new File([bytes], 'resume.docx');
}

/** 最小合法 PDF，包含可提取的 Helvetica 文字；不依赖联网下载测试文档。 */
function pdf(text: string | null, pageCount = 1): File {
  const stream = text === null ? '' : `BT /F1 16 Tf 40 100 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pageCount} /Kids [${Array.from({ length: pageCount }, (_, index) => `${index + 5} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    ...Array.from(
      { length: pageCount },
      () =>
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>',
    ),
  ];
  let source = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) source += `${String(offset).padStart(10, '0')} 00000 n \n`;
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new File([source], 'article.pdf');
}

test('纯文本、Markdown、CSV 在本机提取，保留原文而不解释 HTML 或公式', async () => {
  assert.equal(TRAINING_FILE_ACCEPT, '.txt,.md,.csv,.pdf,.docx,.png,.jpg,.jpeg,.webp');
  for (const name of ['article.TXT', 'words.csv', 'notes.md']) {
    assert.deepEqual(
      await readTrainingFile(new File(['\uFEFF # 主题\r\n<img> =SUM(A1)\r词汇 '], name)),
      {
        text: '# 主题\n<img> =SUM(A1)\n词汇',
        sourceName: name,
      },
    );
  }
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('简历内容', 'utf16le')]);
  assert.equal((await readTrainingFile(new File([utf16], 'resume.txt'))).text, '简历内容');
});

test('不支持格式、空文件、损坏编码与二进制明确拒绝', async () => {
  await assert.rejects(readTrainingFile(new File(['a'], 'old.doc')), /支持.*DOCX/);
  await assert.rejects(readTrainingFile(new File([], 'empty.txt')), /空/);
  await assert.rejects(readTrainingFile(new File([' \r\n '], 'blank.md')), /没有.*文字/);
  await assert.rejects(
    readTrainingFile(new File([new Uint8Array([0xff, 0x00])], 'broken.txt')),
    /编码/,
  );
  await assert.rejects(readTrainingFile(new File(['abc\u0000data'], 'binary.txt')), /无法读取/);
});

test('文件大小和提取文字上限完整拒绝，不静默截断', async () => {
  const large = new File([new Uint8Array(MAX_TRAINING_FILE_BYTES + 1)], 'large.txt');
  await assert.rejects(readTrainingFile(large), /8 MB/);
  await assert.rejects(
    readTrainingFile(new File(['词'.repeat(MAX_TRAINING_TEXT_LENGTH + 1)], 'long.txt')),
    /24,000/,
  );
  assert.equal(
    (await readTrainingFile(new File(['a'.repeat(MAX_TRAINING_TEXT_LENGTH)], 'limit.txt'))).text
      .length,
    MAX_TRAINING_TEXT_LENGTH,
  );
});

test('已取消及读取期间取消都不返回迟到的材料', async () => {
  const early = new AbortController();
  early.abort();
  await assert.rejects(readTrainingFile(new File(['test'], 'file.txt'), early.signal), {
    name: 'AbortError',
  });
  let finish!: (value: ArrayBuffer) => void;
  const lateFile = new File(['old'], 'file.txt');
  Object.defineProperty(lateFile, 'arrayBuffer', {
    value: () => new Promise<ArrayBuffer>((resolve) => (finish = resolve)),
  });
  const late = new AbortController();
  const reading = readTrainingFile(lateFile, late.signal);
  late.abort();
  finish(new TextEncoder().encode('old content').buffer);
  await assert.rejects(reading, { name: 'AbortError' });
});

test('真实 DOCX 仅提取纯文本，空、损坏和文字超限均报错', async () => {
  assert.equal(
    (await readTrainingFile(await docx('Resume <script> 研发经验'))).text,
    'Resume <script> 研发经验',
  );
  await assert.rejects(readTrainingFile(await docx('')), /没有.*文字/);
  await assert.rejects(readTrainingFile(new File(['not a zip'], 'bad.docx')), /Word.*无效/);
  await assert.rejects(
    readTrainingFile(await docx('x'.repeat(MAX_TRAINING_TEXT_LENGTH + 1))),
    /24,000/,
  );
});

test('Word 展开体积超限在解析前拒绝，避免压缩文件无限展开', async () => {
  const zip = new JSZip();
  zip.file('word/document.xml', 'x'.repeat(17 * 1024 * 1024));
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  await assert.rejects(readTrainingFile(new File([bytes], 'large.docx')), /展开内容过大/);
});

test('图片必须明确使用可看图模型，读取后只返回描述并释放本机图像资源', async (context) => {
  await assert.rejects(readTrainingFile(new File(['fake'], 'photo.png')), /需要连接模型/);
  await assert.rejects(
    readTrainingFile(new File(['fake'], 'photo.png'), undefined, {
      ...DEFAULT_SETTINGS,
      apiKey: 'test',
      provider: 'deepseek',
    }),
    /不支持图片/,
  );
  let closed = 0;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ fillRect() {}, drawImage() {}, fillStyle: '' }),
    toBlob: (callback: (blob: Blob) => void) => callback(new Blob(['jpeg-data'])),
  };
  const descriptors = new Map(
    ['document', 'createImageBitmap'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => canvas },
  });
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: async () => ({ width: 2000, height: 1000, close: () => closed++ }),
  });
  context.after(() =>
    descriptors.forEach((descriptor, key) =>
      descriptor
        ? Object.defineProperty(globalThis, key, descriptor)
        : Reflect.deleteProperty(globalThis, key),
    ),
  );
  let calls = 0;
  context.mock.method(globalThis, 'fetch', async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.match(body.messages[0].content, /Chinese/);
    assert.equal(
      body.messages.at(-1).content[1].image_url.url,
      'data:image/jpeg;base64,anBlZy1kYXRh',
    );
    return Response.json({
      choices: [{ message: { content: '图片里是一杯咖啡，菜单上写着 $3。' } }],
    });
  });
  const settings = {
    ...DEFAULT_SETTINGS,
    provider: 'minimax' as const,
    model: 'MiniMax-M3',
    apiKey: 'test',
  };
  const result = await readTrainingFile(new File(['fake'], 'photo.png'), undefined, settings);
  assert.equal(result.text, '图片里是一杯咖啡，菜单上写着 $3。');
  assert.equal(result.sourceName, 'photo.png');
  assert.equal(closed, 1);
  assert.equal(canvas.width, 0);
  assert.equal(canvas.height, 0);
  assert.equal(calls, 1);
  assert.equal('dataUrl' in result, false);
});

test('真实文本 PDF 提取文字，扫描件、损坏与页数超限明确拒绝', async () => {
  assert.equal(
    (await readTrainingFile(pdf('My article about travel'))).text,
    'My article about travel',
  );
  await assert.rejects(readTrainingFile(pdf(null)), /扫描件.*粘贴/);
  await assert.rejects(readTrainingFile(new File(['broken pdf'], 'bad.pdf')), /PDF.*损坏/);
  await assert.rejects(readTrainingFile(pdf('page', 61)), /60 页/);
});
