# 打包手机 App

当前项目是 React + Vite Web App，尚未接入 Capacitor，也没有 Android / iOS 工程或安装包。本页是实施步骤，不代表已经完成打包或真机验收。

用户当前选择先在手机 App 填写个人模型 Key 直连，不先部署业务服务器。执行 agent 的任务、设置表与真机验收见 [手机测试与部署交接](../DEPLOYMENT.md)；公网 IP 中转作为后续可选路线，不要求先购买域名。

## 推荐路线

使用 Capacitor 将现有 `dist` 页面和资源放入原生工程，继续复用界面、课程、两个教练和自定义训练。在当前 Windows 开发机先做 Android 测试 APK；确认实际语音链路后再做签名发布。iOS 本地构建需要 macOS 与 Xcode，另需准备相应签名和分发配置。

## 本项目先处理的三个适配点

1. **模型连接。** 当前 MiniMax 代理是 Vite 服务端插件，`npm run build` 不会将 Node 服务打进 `dist`。手机的 `127.0.0.1` 指手机自身，不能沿用电脑地址。正式共享服务需要带鉴权、限流的 HTTPS 后端，真实服务密钥保留后端。个人测试也可以让用户自行填写自己的接口和密钥，但需处理 WebView 网络 / CORS 与凭据生命周期；不能把现有服务密钥写进安装包，也不能把回环代理简单公开。
2. **语音和权限。** 浏览器 `SpeechRecognition` 不能当作原生 WebView 的可靠前提。优先适配现有 MiniMax ASR / TTS 或原生识别桥接，配置麦克风与相机权限，验证先播后录、停说切句、电话打断、锁屏、后台恢复和蓝牙。相机保持原来的本机预览边界。
3. **数据和文件。** 测试阶段可沿用 WebView 本地存储；电脑浏览器的记录不会自动进入手机。正式版按需接原生持久化、安全凭据存储和系统文件分享。现有 `<a download>` 导出、文件选择、PDF worker 和图片读取要在手机验证。

## Android 环境

安装 Android Studio 及其要求的 Android SDK，使用匹配的 JDK。项目当前使用 Node.js 24。工具版本以当前 Capacitor 官方环境文档和所选版本要求为准。

遵守项目的 D 盘约定：Android Studio、SDK、Gradle 缓存和模拟器数据优先配置在 D 盘，例如：

| 项目                                   | 示例路径 / 配置            |
| -------------------------------------- | -------------------------- |
| Android Studio                         | `D:\Android\AndroidStudio` |
| Android SDK / `ANDROID_HOME`           | `D:\Android\Sdk`           |
| Gradle 缓存 / `GRADLE_USER_HOME`       | `D:\Android\Gradle`        |
| Android 用户目录 / `ANDROID_USER_HOME` | `D:\Android\User`          |
| 模拟器目录 / `ANDROID_AVD_HOME`        | `D:\Android\Avd`           |
| npm 缓存                               | 项目内 `.npm-cache`        |

这些变量应在首次下载 SDK / 创建模拟器或运行 Gradle 前配置。也可先用 USB 连接 Android 真机测试，暂不下载模拟器镜像。本轮没有安装上述大型工具。

## 接入步骤

以下命令在 `D:\Project\EnglishTalk\morrow` 执行。Capacitor 组件保持同一大版本；本例使用当前文档对应的 8，实际安装后提交锁文件。

```powershell
npm install @capacitor/core@8 @capacitor/android@8 --cache .npm-cache
npm install -D @capacitor/cli@8 --cache .npm-cache
npx cap init
```

初始化填写 App 名称和稳定的包名，例如名称 `轻松说`、示例包名 `com.example.easy-speak`；正式包名应在发布前确定。检查生成的配置，网页资源目录设为 `dist`：

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.example.easy-speak',
  appName: '轻松说',
  webDir: 'dist',
};

export default config;
```

完成前述模型与媒体适配后，构建并创建 Android 工程：

```powershell
npm run build
npx cap add android
npx cap sync android
npx cap open android
```

在 Android Studio 中配置 SDK / 构建 JDK，连接已启用 USB 调试的手机并运行。也可以在 Android 工程中构建测试 APK：

```powershell
cd android
.\gradlew.bat assembleDebug
```

标准产物路径为 `android\app\build\outputs\apk\debug\app-debug.apk`。测试包可安装到自己的手机，不等同于已完成商店发布。后续每次修改前端，重新执行 `npm run build` 和 `npx cap sync android` 后再构建原生包。

## 发布与验证

发布时使用独立签名配置并妥善保存签名文件；不将密码或服务密钥提交到源码。根据分发目标生成签名 APK 或 Android App Bundle，再准备图标、启动图、版本号和相关商店资料。iOS 使用对应的 Xcode 构建、签名和设备 / TestFlight 流程。

验收应包含：启动与安全区、软键盘、返回键、录音 / 摄像头授权与拒绝恢复、语音半双工循环、弱网取消、切后台、文件 / 图片导入、导出分享、保存模板及重启后的记录。当前 Web 测试通过不能替代这些真机检查。

官方依据：[接入现有 Web 项目](https://capacitorjs.com/docs/getting-started)、[环境要求](https://capacitorjs.com/docs/getting-started/environment-setup)、[Android 发布](https://capacitorjs.com/docs/android/deploying-to-google-play)。
