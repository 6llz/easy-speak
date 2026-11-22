# 打包手机 App

项目已加入 Capacitor Android 构建配置、移动端直连模式和 Windows 打包脚本。共享工具链于 2026-11-18 安装到 F 盘；2026-11-22 已从最新源码重新生成 Android debug APK，通过签名与 SHA-256 核验并覆盖更新到手机。安装包路径、构建证据及待完成的真机测试见 [手机验证记录](./mobile-verification.md)。

用户当前选择先在手机 App 填写个人模型 Key 直连，不先部署业务服务器。执行 agent 的任务、设置表与真机验收见 [手机测试与部署交接](../DEPLOYMENT.md)；公网 IP 中转作为后续可选路线，不要求先购买域名。

## 推荐路线

使用 Capacitor 将现有 `dist` 页面和资源放入原生工程，继续复用界面、课程、两个教练和自定义训练。在当前 Windows 开发机先做 Android 测试 APK；确认实际语音链路后再做签名发布。iOS 本地构建需要 macOS 与 Xcode，另需准备相应签名和分发配置。

## 本项目先处理的三个适配点

1. **模型连接。** 当前 MiniMax 代理是 Vite 服务端插件，`npm run build` 不会将 Node 服务打进 `dist`。手机的 `127.0.0.1` 指手机自身，不能沿用电脑地址。正式共享服务需要带鉴权、限流的 HTTPS 后端，真实服务密钥保留后端。个人测试也可以让用户自行填写自己的接口和密钥，但需处理 WebView 网络 / CORS 与凭据生命周期；不能把现有服务密钥写进安装包，也不能把回环代理简单公开。
2. **语音和权限。** 浏览器 `SpeechRecognition` 不能当作原生 WebView 的可靠前提。优先适配现有 MiniMax ASR / TTS 或原生识别桥接，配置麦克风与相机权限，验证先播后录、停说切句、电话打断、锁屏、后台恢复和蓝牙。相机保持原来的本机预览边界。
3. **数据和文件。** 测试阶段可沿用 WebView 本地存储；电脑浏览器的记录不会自动进入手机。正式版按需接原生持久化、安全凭据存储和系统文件分享。现有 `<a download>` 导出、文件选择、PDF worker 和图片读取要在手机验证。

## Android 环境

Windows 工具统一放在 `F:\Android-Toolchain`，供多个 Android 项目共用。当前打包脚本使用 Capacitor 8.6.2、JDK 21、Android SDK Platform 36 和 Node.js 24。SDK Manager 可在共享 SDK 下加装其他项目所需的平台版本。

| 内容                                   | 共享目录                                |
| -------------------------------------- | --------------------------------------- |
| 下载包                                 | `F:\Android-Toolchain\Downloads`        |
| JDK 21 / `JAVA_HOME`                   | `F:\Android-Toolchain\Jdk\21`           |
| SDK / `ANDROID_HOME`                   | `F:\Android-Toolchain\Sdk`              |
| Gradle 缓存 / `GRADLE_USER_HOME`       | `F:\Android-Toolchain\gradle-cache`     |
| Android 用户目录 / `ANDROID_USER_HOME` | `F:\Android-Toolchain\android-user`     |
| npm 缓存                               | `F:\Android-Toolchain\npm-cache`        |
| EasySpeak 构建副本与 APK               | `F:\Android-Toolchain\builds\EasySpeak` |

SDK 已安装 Command-line Tools 22.0、Platform Tools 37.0.1、Platform 36 revision 2 和 Build Tools 36.0.0；Android Gradle Plugin 另自动安装了 Build Tools 35.0.0。JDK 为 Temurin 21.0.13+9。真机通过 USB 调试可用于验收。打包脚本在当前进程加载共享工具，退出时恢复原环境。

本机 Java 默认根证书库无法验证依赖下载源。F 盘的 `Use-AndroidToolchain.ps1` 仅在当前 PowerShell 进程启用共享工具与缓存，并让 Java、Node 使用 Windows 已信任的系统证书；保留 TLS 校验和已有 Java 自定义 trustStore。未修改系统或用户全局环境。其他项目也可使用此初始化脚本，再运行各自的 Gradle Wrapper。

## 接入步骤

在仓库根目录执行打包脚本。

```powershell
. 'F:\Android-Toolchain\Use-AndroidToolchain.ps1'
Set-Location -LiteralPath 'D:\Project\EnglishTalk'
.\Build-EasySpeakAndroid.ps1
```

脚本在 F 盘创建独立构建副本，复制白名单内的源码和配置，安装依赖，执行 `npm run build:android`，生成原生工程并声明相机与麦克风权限，最后运行 `assembleDebug`。测试包名为 `com.example.easyspeak`，显示名为「轻松说」。成功时输出 `app-debug.apk` 的路径和 SHA-256。需要使用已有工具目录时，脚本接受 `-ToolDirectory`、`-JdkDirectory` 和 `-SdkDirectory`。

安装后，手机可在 **设置 → 模型连接** 填写供应商、接口、API Key 和模型。Android 构建使用个人直连模式。API Key 保留在当前 App 会话，完全退出或进程被系统回收后可能需要重新填写。MiniMax 语音可在「语音与偏好」单独配置。

## 发布与验证

发布时使用独立签名配置并妥善保存签名文件；不将密码或服务密钥提交到源码。根据分发目标生成签名 APK 或 Android App Bundle，再准备图标、启动图、版本号和相关商店资料。iOS 使用对应的 Xcode 构建、签名和设备 / TestFlight 流程。

验收应包含：启动与安全区、软键盘、返回键、录音 / 摄像头授权与拒绝恢复、语音半双工循环、弱网取消、切后台、文件 / 图片导入、导出分享、保存模板及重启后的记录。当前 Web 测试通过不能替代这些真机检查。

官方依据：[接入现有 Web 项目](https://capacitorjs.com/docs/getting-started)、[环境要求](https://capacitorjs.com/docs/getting-started/environment-setup)、[Android 发布](https://capacitorjs.com/docs/android/deploying-to-google-play)。
