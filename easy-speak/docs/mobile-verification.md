# Android 安装包与手机验证记录

最近设备验证日期：2026-11-22。当日交付版本已重新构建 APK 并覆盖更新到手机，首屏布局和返回导航已完成真机检查；真实模型与语音链路仍待验证。

随后取消挂断完成提示的修改仅更新源码，尚未再次打包。下方交付包和手机安装版本仍包含原提示；源码检查见 [验证记录](./verification.md)。

11 月 19 日完成的单屏布局、移除底部重复连接入口、返回箭头与挂断返回主页，已随 11 月 22 日最新安装包更新到手机。此前旧包记录保留为历史，当前交付以本节为准。

## 最新交付与真机更新：2026-11-22

- APK：`F:\Android-Toolchain\builds\EasySpeak\releases\2026-11-22\EasySpeak-1.0-debug.apk`
- 大小：5,066,917 字节，约 4.83 MiB。
- SHA-256：`57362D8A8602D06C74218F6C19D567AE53770517912BCBF61563D49033310437`
- 包名 / 原生版本：`com.example.easyspeak` / `1.0`，versionCode `1`。原生版本号与旧包相同，本次更新通过回读安装包哈希和更新时间区分。
- 生成工程：`F:\Android-Toolchain\builds\EasySpeak\898237bf75744d2e90884a0d217a58d1`。构建使用 Node.js 24.22.3 / npm 11.19.1，其他工具链版本沿用下方记录。
- 已核验签名与旧安装包一致，ZIP 对齐、55 项源码快照、53 个构建副本输入和 16 个网页资源哈希检查通过；未发现非公开文件误打包。

| 检查                  | 本次结果                                                |
| --------------------- | ------------------------------------------------------- |
| 手机 / 系统 / WebView | OnePlus PJX110 / Android 16（API 36）/ 156.0.8078.47    |
| 覆盖更新              | `adb install -r` 返回 Success；未执行卸载或清空应用数据 |
| 启动                  | Status: ok，更新后的应用进程存活                        |
| 安装包回读            | 手机上的 base.apk SHA-256 与交付文件一致                |
| 首屏尺寸              | 视口与文档均为 360×792，无整页溢出                      |
| 安全区                | 顶部 40、底部 16 CSS 像素；底部操作完整可见             |
| 入口                  | 左上角为返回箭头，无底部重复模型连接入口                |
| 挂断                  | 返回已完成加载、可操作的主页                            |
| 再次进入对话          | 保留已结束状态，显示“继续”，挂断按钮禁用，不自动开麦    |
| 返回箭头              | 从对话回到主页，最终停留主页                            |
| 定向错误日志          | 0 条；无 Java FATAL EXCEPTION                           |

交付目录保留新旧安装包、签名与元数据报告、构建 / 测试 / 安装日志、源码清单、依赖锁文件、npm 审计和安装回读收据。真机截图与 UI 测量位于本机 `D:\Project\EnglishTalk\release\mobile-2026-11-22`，并复制到交付目录。完整检查见 [验证记录](./verification.md)。

本轮没有输入真实 API Key，也没有发送真实模型请求；录音、转写、朗读、实际输入法、系统返回键及完整硬件权限流程不计为已验收。npm 审计为 8 项中危开发依赖关联告警，0 高危、0 严重，完整报告随包保存。

## 真机安装与首次启动：2026-11-19

| 项目       | 实际结果                                                                            |
| ---------- | ----------------------------------------------------------------------------------- |
| 手机       | OnePlus，型号 PJX110                                                                |
| 系统       | Android 16，API 36                                                                  |
| WebView    | `com.google.android.webview`，156.0.8078.47                                         |
| USB 调试   | 用户在手机允许后，ADB 状态为 device                                                 |
| 安装       | 手机原先未安装此包；`adb install` 返回 Success                                      |
| 启动       | `am start -W` 返回 Status: ok，前台 Activity 为 MainActivity                        |
| 版本       | versionName 1.0，versionCode 1，与交付 APK 一致                                     |
| 首屏       | 主对话、两个辅导区与底部操作区已渲染，显示示范内容及语音暂停提示                    |
| 进程与日志 | 检查时应用进程存活，定向 AndroidRuntime / chromium / Capacitor Console 错误日志为空 |
| 媒体权限   | 查询时相机和麦克风均未授权；没有将此状态计为用户拒绝权限的测试                      |

安装前再次核对 APK SHA-256，与下方交付值一致。首次启动截图保存在本机 `D:\Project\EnglishTalk\release\mobile-2026-11-19\first-launch.png`。本轮未填写真实 Key，没有验证供应商请求、实际录音、声音播放或完整多轮会话。首屏截图不代表软键盘、安全区与全部布局均已验收。

## 历史交付文件：2026-11-18

- APK：`F:\Android-Toolchain\builds\EasySpeak\releases\2026-11-18\EasySpeak-1.0-debug.apk`
- 文件大小：5,067,505 字节，约 4.83 MiB。
- SHA-256：`0EC77054F381C922C3A95CC6FB8CDD339E9B0D476DBA380B474025DA6D023664`
- 包名：`com.example.easyspeak`；显示名：轻松说；原生版本：`1.0`，versionCode：`1`。网页源码包版本：`1.0.0`。
- 最低 Android API 24（Android 7.0），目标 API 36。
- 使用 Android Debug 证书，签名 v2 验证通过。证书 SHA-256：`555d0d252dc0659c0280e7fecb8b80d91855ef21fada41323d929024d47a4ff1`。本包供个人测试，正式发布另设发布签名。

同目录保留 `.apk.sha256`、`signature-verification.txt`、`apk-metadata.txt`、`build.log`、`build-receipt.json`、`generated-package-lock.json` 和 `source-npm-audit.json`。生成工程位于 `F:\Android-Toolchain\builds\EasySpeak\f93e40a18c9645dab862cbcd909dc63f`，原始 APK 位于其 `android\app\build\outputs\apk\debug\app-debug.apk`；交付副本的 SHA-256 与原始文件一致。

## 工具与构建：2026-11-18

| 项目                                | 实际版本 / 结果                                                          |
| ----------------------------------- | ------------------------------------------------------------------------ |
| Node.js / npm                       | 24.20.0 / 11.19.0                                                        |
| JDK                                 | Temurin 21.0.13+9，`F:\Android-Toolchain\Jdk\21`                         |
| Android SDK                         | `F:\Android-Toolchain\Sdk`                                               |
| Command-line Tools / Platform Tools | 22.0 / 37.0.1                                                            |
| Android 平台                        | API 36 revision 2                                                        |
| Build Tools                         | 36.0.0；Gradle 另自动安装 35.0.0                                         |
| Capacitor core / android / cli      | 均固定 8.6.2                                                             |
| Gradle                              | 项目自己的 Wrapper，8.14.3；共享缓存位于 F 盘                            |
| 许可                                | SDK Manager 接受许可并成功安装包                                         |
| 构建                                | 根目录 `Build-EasySpeakAndroid.ps1` 成功；`assembleDebug` 完成 93 项任务 |

JDK 与命令行工具下载包保存在 `F:\Android-Toolchain\Downloads`，下载后核对官方 SHA-256。JDK 归档校验值为 `a4dbaa05fca4bd89d84584e58c459bd732efebb1722af80ab13c6516832004f9`；命令行工具归档校验值为 `90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a`。

本机 Java 需要使用 Windows 已信任的根证书库下载依赖。后续在新 PowerShell 会话中先执行 `. 'F:\Android-Toolchain\Use-AndroidToolchain.ps1'`，再运行根目录构建脚本，具体步骤见 [打包手册](./packaging.md)。未关闭 TLS 校验，未改动全局环境。

## 构建与安装前检查：2026-11-18

| 检查                           | 结果                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------- |
| 自动回归                       | 222 / 222 通过，无跳过                                                       |
| ESLint / Prettier / TypeScript | 通过                                                                         |
| Web 与 Android 网页资源构建    | 通过，构建门禁通过                                                           |
| APK 签名                       | `apksigner verify --verbose --print-certs` 通过，单个 Debug 签名者           |
| APK 对齐                       | `zipalign -c -P 16 4` 通过                                                   |
| APK 元数据                     | `aapt dump badging` 确认包名、版本、SDK 与媒体权限                           |
| 资源一致性                     | APK 的 16 个网页资源与独立构建输出逐项 SHA-256 一致                          |
| 非公开文件                     | 未发现环境文件、server / node_modules 目录或 jks / keystore / pem / key 文件 |
| 打包网络配置                   | `androidScheme=https`，`cleartext=false`；Manifest 禁止明文网络              |
| USB 调试设备                   | `adb devices -l` 返回空列表                                                  |

APK 声明 INTERNET、CAMERA、RECORD_AUDIO 和 MODIFY_AUDIO_SETTINGS；相机、自动对焦与麦克风硬件均为可选。权限声明和桥接代码检查不能替代设备上的授权与拒绝测试。

npm 审计报告 11 项开发依赖关联告警（5 高、6 中），主要涉及 Vite 与文件匹配工具的开发依赖链。按源码锁文件核对，报告节点均标记为开发依赖。未执行自动修复或升级；报告不等同于 APK 运行路径漏洞结论。构建另有 PDF chunk 体积、Capacitor 模板 flatDir 与 SDK XML 版本提示，未阻断构建。

## 待真机验收

手机与 Android / WebView 版本已记录于上文。实际供应商、完整多轮会话与停说到首音时间尚未记录，因为尚未在 Android 中使用真实 Key。

| 项目                                       | 当前状态                     |
| ------------------------------------------ | ---------------------------- |
| 最新安装包覆盖更新、启动                   | 2026-11-22 已完成            |
| 首屏一屏布局、安全区、页内返回箭头         | 2026-11-22 真机检查通过      |
| 挂断返回主页、再次进入后保留结束状态       | 2026-11-22 真机检查通过      |
| 实际软键盘、系统返回键                     | 待完整真机验证               |
| 设置 → 模型连接，输入个人 Key 后真实对话   | 待真机验证                   |
| MiniMax 录音转写、朗读、先播后录与停说提交 | 待真机验证                   |
| 拒绝麦克风后切换打字、再次授权恢复         | 待真机验证；自动模拟回归通过 |
| 相机授权、拒绝、关闭与后台释放             | 待真机验证                   |
| 蓝牙、扬声器、后台、锁屏、来电恢复         | 待真机验证                   |
| 断网、无效 Key、限流与模型请求取消         | 待真实模型真机验证           |
| 文件导入、导出、记录保存与重启             | 待真机验证                   |

安装后由用户在 App 中输入个人 API Key；当前 Key 保留在 App 会话中。完全退出或进程被回收后可能需重新填写。完整验收要求见 [手机测试与部署交接](../DEPLOYMENT.md)。
