import type { Plugin } from 'vite';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

type BuildArtifact = { fileName: string; source: string };

/** 构建输出拒绝服务端凭据明文及环境文件；错误只报告文件名，不回显命中的值。 */
export function assertSafeArtifacts(artifacts: BuildArtifact[], secrets: readonly string[]): void {
  const privateValues = secrets.filter((secret) => secret.length > 0);
  for (const artifact of artifacts) {
    if (
      /(^|\/)\.env(?:\.|$)/i.test(artifact.fileName) ||
      /(^|\/)(?:server|node_modules)\//.test(artifact.fileName)
    )
      throw new Error(`构建包含非公开文件：${artifact.fileName}`);
    if (privateValues.some((secret) => artifact.source.includes(secret)))
      throw new Error(`构建包含服务端凭据，已阻止输出：${artifact.fileName}`);
  }
}

/** 在每次 Vite 构建中执行检查，失败时阻止产生可交付安装包资源。 */
export function buildGuard(secrets: readonly string[]): Plugin {
  let publicDirectory = '';
  return {
    name: 'morrow-build-guard',
    apply: 'build',
    configResolved(config) {
      publicDirectory = config.publicDir;
    },
    async buildStart() {
      // Vite 直接复制 public 文件，不一定把它们列入 Rollup bundle，必须单独检查。
      if (!publicDirectory) return;
      let files;
      try {
        files = await readdir(publicDirectory, { recursive: true, withFileTypes: true });
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
        throw error;
      }
      for (const file of files) {
        const filePath = join(file.parentPath, file.name);
        const fileName = relative(publicDirectory, filePath).replaceAll('\\', '/');
        if (file.isSymbolicLink()) throw new Error(`公开资源不能包含符号链接：${fileName}`);
        if (file.isFile())
          assertSafeArtifacts([{ fileName, source: await readFile(filePath, 'utf8') }], secrets);
      }
    },
    generateBundle(_options, bundle) {
      assertSafeArtifacts(
        Object.values(bundle).map((artifact) => ({
          fileName: artifact.fileName,
          source:
            artifact.type === 'chunk'
              ? artifact.code
              : typeof artifact.source === 'string'
                ? artifact.source
                : new TextDecoder().decode(artifact.source),
        })),
        secrets,
      );
    },
  };
}
