# 轻松说 · EasySpeak 应用源码

成人 AI 口语陪练：像聊天一样练习所选语言，上区给下一句灵感，下区只点评刚才的话。支持多供应商、语音输入与朗读、自定义材料训练、课程、收藏及复习。

**项目完整介绍与使用说明见 [根目录 README](../README.md)。源码公开，仅按 [PolyForm Noncommercial 1.0.0](./LICENSE) 授权非商用使用、修改和分发。**

## 本地开发

在本目录执行，需要 Node.js 22.13+（建议 24）：

```sh
npm ci --cache .npm-cache
npm run dev
```

打开终端显示的本地地址。在设置中选择供应商并填入自己的 Base URL、API Key 和模型 ID；也可复制 `.env.example` 为 `.env.local`，配置本机 MiniMax 代理后重启。不要提交真实 Key，不要使用 `VITE_` 前缀保存凭据。代理只用于本机开发。

```sh
npm run format:check
npm run lint
npm test
npm run build
npm run preview
```

Windows 后台启动入口为上级目录的 `Start-EasySpeak.ps1`。依赖、缓存、日志与构建产物保存在本项目目录；不需要全局安装。

## 阅读入口

- [开发规范：命名、注释、接口与安全](./CONTRIBUTING.md)
- [功能说明与验收](./docs/features.md)
- [架构与数据流](./docs/architecture.md)
- [供应商接入与隐私边界](./docs/providers.md)
- [自由输入与文件、图片自定义训练](./docs/custom-training.md)
- [手机权限](./docs/permissions.md) / [打包指南](./docs/packaging.md)
- [测试与部署交接](./DEPLOYMENT.md)
- [源码分享与许可](./docs/source-release.md)
- [安全审查](./docs/security-review.md) / [验证记录](./docs/verification.md)

当前是移动优先 Web App，没有现成 APK 或公网共享后端。摄像头仅本机预览，AI 不接收镜头内容；图片理解只在自定义训练中主动选择图片时调用。
