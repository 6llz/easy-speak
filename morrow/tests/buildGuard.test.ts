import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { build } from 'vite';
import { assertSafeArtifacts, buildGuard } from '../server/buildGuard.ts';

test('构建门禁拒绝服务端凭据进入代码或资源，失败消息不泄露凭据', () => {
  for (const fileName of ['assets/app.js', 'assets/config.json', 'assets/logo.svg']) {
    assert.throws(
      () =>
        assertSafeArtifacts(
          [{ fileName, source: 'synthetic-private-key' }],
          ['synthetic-private-key'],
        ),
      (error: Error) =>
        error.message.includes(fileName) && !error.message.includes('synthetic-private-key'),
    );
  }
  assert.doesNotThrow(() =>
    assertSafeArtifacts(
      [{ fileName: 'assets/app.js', source: 'morrow-local-credential' }],
      ['', 'synthetic-private-key'],
    ),
  );
});

test('构建门禁拒绝环境文件、服务代码和依赖目录误打包，普通资源可通过', () => {
  for (const fileName of [
    '.env',
    '.env.local',
    'assets/.env.production',
    'server/proxy.js',
    'node_modules/example/index.js',
  ])
    assert.throws(() => assertSafeArtifacts([{ fileName, source: '' }], []), /非公开文件/);
  assert.doesNotThrow(() =>
    assertSafeArtifacts([{ fileName: 'assets/app.js', source: 'const ok = true;' }], []),
  );
});

test('真实 Vite 构建在 public 拷贝和打包代码泄漏虚构凭据时均失败', async () => {
  const workspace = resolve('.openai');
  await mkdir(workspace, { recursive: true });
  const root = await mkdtemp(join(workspace, 'build-guard-'));
  try {
    await mkdir(join(root, 'public'));
    await writeFile(join(root, 'index.html'), '<script type="module" src="/entry.js"></script>');
    await writeFile(join(root, 'entry.js'), 'document.body.textContent = "safe";');
    await writeFile(join(root, 'public', 'config.json'), 'synthetic-build-secret');
    const compile = () =>
      build({
        configFile: false,
        root,
        logLevel: 'silent',
        plugins: [buildGuard(['synthetic-build-secret'])],
        build: { write: false },
      });
    await assert.rejects(
      compile(),
      (error: Error) =>
        error.message.includes('config.json') && !error.message.includes('synthetic-build-secret'),
    );
    await rm(join(root, 'public', 'config.json'));
    await writeFile(
      join(root, 'entry.js'),
      'document.body.textContent = "synthetic-build-secret";',
    );
    await assert.rejects(
      compile(),
      (error: Error) =>
        error.message.includes('已阻止输出') && !error.message.includes('synthetic-build-secret'),
    );
  } finally {
    const child = relative(workspace, root);
    assert.ok(child && !isAbsolute(child) && !child.startsWith('..'));
    await rm(root, { recursive: true, force: true });
  }
});
