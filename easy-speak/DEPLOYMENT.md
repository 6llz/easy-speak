# 手机测试与部署交接

更新时间：2026-10-18。适用源码目录：Windows `D:\Project\EnglishTalk\easy-speak`；传到 Linux 后以包含 `package.json` 的项目根目录为准。

## 1. 本次采用的方案

用户最新决定：**先不部署业务服务器，打包手机 App 后，由用户在设置中填写自己的模型 API Key，App 直接请求供应商。**

```text
手机 App ── HTTPS + 用户自己的 Key ──→ 模型供应商
         ←──── 文字 / 语音结果 ──────
```

云服务器为 Ubuntu 24、没有域名。如仍由云端 agent 操作，本阶段可以仅把云服务器作为 Android 构建机，交付 APK；不必因此安装网站服务器、数据库、VPN 或申请域名。需要模型中转时再执行第 8 节。

**当前源码是 Web App，尚没有 Capacitor、Android 原生工程或生产后端入口。本文是给执行 agent 的交接任务，不能把下述待完成的适配当成已有能力，也不能直接宣称 APK 已生成。**

## 2. 执行 agent 的工作范围

先阅读 `CONTRIBUTING.md`、`docs/packaging.md`、`docs/security-review.md`。保留现有页面、两个固定辅导区、半双工语音、语言选择、音色、自定义训练和学习记录。

实施可逆的代码、构建和验证步骤，不要仅返回建议。需要账户登录、真实凭据、签名或其他缺失信息时说明具体缺项；无需反复要求用户确认普通构建操作。不上传密钥、用户简历、录音或对话来做测试。

第一阶段交付：

1. 接入 Capacitor Android，并固定同一大版本的依赖，提交锁文件。
2. 配置麦克风 / 相机权限与拒绝恢复，确认 `getUserMedia` 和录音容器能在 Android WebView 中工作。若需要原生权限桥接，在明确的媒体适配模块实现，不把平台代码散入展示组件。
3. 沿用 MiniMax ASR / TTS，WebView 不支持 `SpeechRecognition` 时清楚提示选择 MiniMax 识别或文字输入。
4. 在个人直连模式中，不再依赖电脑的 `/api/v1/minimax`；缺少本机代理时不得把 `127.0.0.1:5173` 当成远程接口，也不得自动索取开发机的凭据。
5. 生成可安装的 Android debug APK，附 SHA-256、版本与实测清单。debug APK 只供本人测试，正式发布另做签名与发布配置。

如没有 Android SDK / JDK，先建立受控目录再安装匹配版本。Windows 的下载、缓存、SDK、Gradle 和产物都放 D 盘；Linux 构建机放项目或 `/opt/easy-speak` 下。不要上传本机 `node_modules`，在目标平台执行 `npm ci`。

## 3. 现有代码与配置

现有界面支持个人 Key 直连，无需先实现云端登录或共享服务。建议先用当前已验证过协议的 MiniMax 配置：

| 设置位置              | 项目            | 填写 / 选择                                                       |
| --------------------- | --------------- | ----------------------------------------------------------------- |
| 右上角设置 → 模型连接 | 供应商          | MiniMax；选择个人直连，不使用本机凭据                             |
| 同上                  | API Base URL    | `https://api.minimaxi.com/v1`，账户如属其他地域则用对应官方地址   |
| 同上                  | API Key         | 用户自己的有效 Key，安装后在手机输入                              |
| 同上                  | 主模型          | `MiniMax-M3`，需账户具备相应权限                                  |
| 同上                  | 两个教练模型    | 可留空沿用主模型                                                  |
| 语音与偏好            | 语音识别        | MiniMax                                                           |
| 同上                  | 朗读声音        | MiniMax                                                           |
| 同上                  | 语音 API Key    | 同一 MiniMax 账户时留空复用对话 Key；权限独立时另填自己的语音 Key |
| 同上                  | 语音接口 / 模型 | `https://api.minimaxi.com/v1` / `speech-2.8-turbo`                |
| 同上                  | 停顿多久后接话  | 先用 5 秒，体验稳定后自行调整                                     |

如果先在电脑改设置，配置不会自动同步到手机。模型、语音和转写分别受账户权限与供应商计费控制。

2026-10-18 对三个 MiniMax 路由进行了无凭据 OPTIONS 检查：`chat/completions`、`t2a_v2`、`speech_to_text` 均返回 200，并允许 `https://localhost`、Authorization 与 language 请求头。它只证明当时的跨域预检配置，不证明带 Key 的 POST、所有地区节点或所有 WebView 都可用。

## 4. Android 构建流程

完整工具配置与命令见 [打包手册](./docs/packaging.md)。默认沿用手册的 Capacitor 8，同一套依赖保持同一大版本；实施时核对该版本官方要求的 JDK / Android SDK，不凭印象混用。

需要执行 agent 补齐的文件包括：`capacitor.config.ts`、Android 工程与权限配置、必要的原生媒体适配、可重复执行的构建脚本和验证记录。App 显示名使用「轻松说」；包名尚未由用户确定时可使用测试包名 `com.example.easy-speak`，不得直接作为正式发行身份。

```powershell
# 在项目根目录；先完成原生适配，不要只运行这些命令就宣布语音可用。
npm ci --cache .npm-cache
npm run format:check
npm run lint
npm test
npm run build

# 仅首次接入时安装、初始化；已有工程不要重复 cap init / cap add。
npm install @capacitor/core@8 @capacitor/android@8 --cache .npm-cache
npm install -D @capacitor/cli@8 --cache .npm-cache
npx cap init
npx cap add android
npx cap sync android

# JDK 与 SDK 就绪后
cd android
.\gradlew.bat assembleDebug
```

Linux 构建机使用相同 npm 检查，Gradle 命令改为 `./gradlew assembleDebug`。先设置 Android SDK 与 Gradle 缓存位置；无须为编译安装模拟器镜像。后续修改只需重新构建 Web 资源、`cap sync android` 并运行 Gradle。

标准产物：`android/app/build/outputs/apk/debug/app-debug.apk`。交付时写明文件绝对路径和 SHA-256，不把没有执行的真机测试标成通过。

## 5. 安装包的凭据与网络要求

- 不把任何真实 API Key 写入源码、`VITE_*`、Capacitor 配置、Android 资源、构建参数或 APK。用户安装后自行输入；不要把开发机的 `.env.local` 复制到构建机。
- 当前密钥仅放会话存储，不在长期偏好、记录或导出中保留；App 退出或系统回收后可能需要重新输入。若以后增加“记住 Key”，先接系统 Keystore / Keychain，不改成明文 localStorage。
- 保留 HTTPS 与证书校验。不得为了连通而允许所有明文流量、信任所有证书、关闭 WebView 安全检查，或使用公共跨域代理转发 Key。
- CORS 失败时先检查实际 WebView Origin、所选供应商和地域。确有需要时另建限定供应商与目标域名的原生网络适配；不得做网页任意调用的通用 URL 代理。
- WebView 导航限制在 App 页面；外部链接按系统浏览器处理。模型与材料文本继续用 React 文本渲染，不增加原始 HTML 执行入口。
- 保留 `server/buildGuard.ts` 的构建检查；它检查已知服务端凭据明文与非公开文件误打包，不等同于完整秘密检测或安全认证。原生构建还要单独检查 APK 内容。

## 6. 真机验收

安装前保存旧测试数据，不直接覆盖不同包名 / 签名的正式应用。

| 测试                             | 预期                                                          |
| -------------------------------- | ------------------------------------------------------------- |
| 首次启动与无 Key                 | 页面可操作；不伪装真实模型连接成功                            |
| 手机填写 Key、连接测试           | 主对话与语音接口分别可恢复地成功 / 失败；错误不回显 Key       |
| 麦克风 / 相机权限拒绝后重试      | 能恢复或切文字；不循环弹权限；相机仍只本机预览                |
| AI 播放 → 用户录音 → 停说提交    | 先播后录，句中短暂停顿不抢答；实际延迟单独记录                |
| 两个辅导区                       | 上区回答建议、下区点评当前发言；相互独立                      |
| 蓝牙 / 手机扬声器                | 开头音量、声音路由与回声正常；不能用电脑测试替代              |
| 切后台、锁屏、来电、再回前台     | 正确释放媒体，按原用户意图恢复，不自行重开相机                |
| 断网、限流、无效 Key、停止与挂断 | 请求有期限、可取消；旧结果不污染新会话                        |
| TXT / PDF / DOCX / 图片导入      | 先预览再采用，损坏 / 超限文件拒绝；图片按用户选择提交视觉模型 |
| Word 安全解压能力缺失            | 明确提示使用 TXT 或升级设备，不绕过实际展开大小检查           |
| 重启、记录、收藏与导出           | 长期记录保留；Key 不混入记录；系统文件分享实际验证            |

最低验收记录写入 `docs/mobile-verification.md`：手机型号、Android / WebView 版本、App 版本、供应商、权限结果、一次完整多轮会话、停说到首音时间、失败项。不要记录真实 Key 或用户私人材料。

## 7. 给执行 agent 的简短任务

> 先阅读本文件与 CONTRIBUTING.md，按第 1–6 节完成个人 API Key 直连的 Android 测试包。当前不部署业务服务器，不启用 Tailscale，不将开发代理公开。补齐 Capacitor、权限及 WebView 媒体兼容，沿用既有功能与安全检查，跑完回归后交付 debug APK、校验值及真实的验证记录。手机输入 Key，安装包不内置 Key；缺少真实设备时明确标出待真机验收的项目。

## 8. 以后使用云服务器中转时

用户设想的另一条链路也成立：`App → HTTPS 公网 IP → 云服务器 → 模型供应商 → App`。**域名不是必须条件**。此阶段暂不实施，也不能把现有 `npm run dev -- --host 0.0.0.0` 当作生产服务。

### 必须新增的能力

1. 独立生产 API 入口与启动脚本；不能依赖 Vite 插件提供后台服务，也不能直接删除本机代理的回环 / 来源检查来“开放接口”。
2. App 到后台的身份认证、配额与限流。个人测试可用单独生成的设备访问令牌，后台只保留其校验摘要；它与模型 API Key 分开，不写入 APK、不放在 URL 中。没有认证或认证失败时，不能调用付费上游。
3. 模型 Key 只保存在云服务器受权限保护的运行配置中。限定模型、接口、请求体、总时限、并发和上游域名，禁止任意目标代理、任意文件读取与原始错误透传。
4. 对浏览器 / WebView 的实际 Origin 做精确 CORS 允许；CORS 不替代鉴权。Android 原生请求无 Origin 时也必须验证访问令牌。
5. App 增加明确的云端连接配置，不能把手机 `localhost` 当作云端地址；停止复用电脑本机占位凭据。

### Ubuntu 24 + 公网 IP + HTTPS

推荐固定公网 IP、Nginx 作为 TLS 入口、生产 API 只监听服务器 `127.0.0.1:3000`。公网仅开放 443、证书校验需要的 80，以及限制来源的管理端口。Nginx 不应把源码目录当静态目录；流式对话关闭代理缓冲，上游超时与应用的 35 秒预算协调。

截至本文件日期，Let's Encrypt 已支持公网 IPv4 / IPv6 证书，IP 证书有效期为 160 小时，必须自动续期。[官方 IP 证书公告](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability)

证书实施要求：Certbot 至少 5.4（使用 webroot 的 IP 支持），先在 80 端口配置专用 ACME webroot 并从公网验证，再申请证书。以下为命令模板，变量必须由执行 agent 取得真实值；不是当前代码的一键部署命令。

```bash
sudo certbot certonly --staging \
  --preferred-profile shortlived \
  --webroot --webroot-path /var/www/easy-speak-acme \
  --ip-address "$MORROW_PUBLIC_IP" \
  --cert-name morrow-ip-staging \
  --email "$MORROW_ACME_EMAIL" --agree-tos --non-interactive
```

先确认测试环境验证成功，再去掉 `--staging` 并使用独立名称 `morrow-ip` 申请受信任证书；Nginx 引用 `/etc/letsencrypt/live/easy-speak-ip/fullchain.pem` 与 `privkey.pem`。保留已验证的自动续期定时器，配置续期成功后先 `nginx -t` 再 reload，执行 `certbot renew --dry-run` 验证；监控证书到期。不要通过跳过手机证书校验来使用 staging 或自签名证书。[官方 Certbot IP 证书操作说明](https://letsencrypt.org/2026/03/11/shorter-certs-certbot)、[Certbot 参数文档](https://eff-certbot.readthedocs.io/en/stable/using.html)

公网阶段的上线条件：未授权 401 / 403、错误 Origin 拒绝、超限 413 / 429、慢请求被终止、上游断开可恢复、证书正常续期、日志脱敏、进程重启与回滚均已验收。全部通过后再开放 API；这不是对“绝不会被攻击”的承诺。

## 9. 当前交付状态

已有：React 页面、个人 Key 直连、MiniMax ASR / TTS、离线测试、生产 Web 构建与构建凭据检查。

待执行 agent 完成：Android 原生适配、APK 构建和手机验收。云生产 API、IP 证书与公网部署仅为后续路线，尚未创建或执行。
