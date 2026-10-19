# 供应商接入指南

## 配置方式

在应用顶部打开“模型设置”，选择预设或自定义供应商。模型 ID 是可编辑文本，不把供应商型号硬编码为封闭列表。请以自己账户当前可用型号为准。

| 供应商   | 默认 Base URL                                     | 备注                                              |
| -------- | ------------------------------------------------- | ------------------------------------------------- |
| DeepSeek | https://api.deepseek.com                          | 兼容 Chat Completions；非思考模式减少口语轮次等待 |
| MiniMax  | https://api.minimaxi.com/v1                       | 默认 MiniMax-M3；语音使用独立 ASR/TTS 接口        |
| OpenAI   | https://api.openai.com/v1                         | 使用兼容 Chat Completions 的模型                  |
| 通义千问 | https://dashscope.aliyuncs.com/compatible-mode/v1 | 示例为阿里云中国区地址；不同地域需自行更换        |
| 自定义   | 用户填写                                          | 须兼容请求、SSE 流和标准响应结构                  |

供应商、Key、Base URL 三个文字角色共用；主陪练、灵感教练、表达教练分别支持模型 ID。语音可独立选择 MiniMax 或浏览器；MiniMax 语音可复用其对话密钥或使用独立密钥，其他文字供应商也可搭配 MiniMax 语音。

## 请求与响应契约

```http
POST {baseUrl}/chat/completions
Authorization: Bearer {apiKey}
Content-Type: application/json
```

```json
{
  "model": "用户配置的模型 ID",
  "messages": [{ "role": "user", "content": "Hello!" }],
  "stream": true,
  "max_tokens": 650
}
```

主陪练设置 `stream: true`。响应 Content-Type 为 `text/event-stream` 时，按 SSE 事件解析 `choices[0].delta.content`；允许 Content-Type 携带 charset 参数。若接口返回标准非流式 JSON，则读取 `choices[0].message.content`。

SSE 以空行分隔事件，同一事件内多行 `data:` 用换行拼接后解析；注释和其他事件字段不进入回复。支持跨网络包的 UTF-8 字符、CRLF / LF / CR 分隔与缺少末尾换行。消费到 `data: [DONE]` 时立即完成，并取消仍开放的响应流，不依赖服务器主动关闭连接。增量回调接收累计的正文，而非单个字符片段。

两个教练请求非流式 JSON 内容，并在客户端验证结构。DeepSeek 请求附带 `thinking: { "type": "disabled" }`，依据[官方 Chat Completions 文档](https://api-docs.deepseek.com/api/create-chat-completion/)。MiniMax 主回复使用 `max_completion_tokens: 650`、`reasoning_split: true`；实际请求模型为 `MiniMax-M3` 时也发送 `thinking: { "type": "disabled" }`。推理字段不进入显示和朗读；其他 MiniMax 模型的思考行为以[官方接口](https://platform.minimax.io/docs/api-reference/text-chat-openai)为准，不发送不受支持的禁用参数。

主回复预算仍为 650；教练改用独立预算：提示 1200、点评 / 重练 1800，格式修复分别最多 2000 / 2800。只有输出格式、字段或明确截断失败允许一次修复，共用三十五秒总期限，其他网络 / HTTP / 取消错误直接传递；不强加未知供应商的 JSON 模式参数。返回原文不进入错误提示或日志。详见 [点评恢复](./conversation-timing.md)。

### 超时、大小与响应校验

每次请求默认 35 秒超时，从发起请求覆盖到读取响应正文结束；已返回响应头但正文迟迟不结束也会取消。用户结束会话、切换场景或取消未完成主回复时也可中止请求。流消费结束、失败或被取消时释放读取器和未结束的响应流。

- 合并后的回复内容最多 64 × 1024 字符。
- 单个 SSE 事件的 data 缓冲、未结束的行缓冲，以及非流式 JSON 封包最多 256 × 1024 字符；SSE 该限制不代表整个会话所有事件的总和。
- 上限按 JavaScript 字符串长度计算，不按 UTF-8 网络字节数计算；语音识别或文字的单次用户提交另限 3000 字符，超限保留原文待用户精简。
- JSON 必须具备可解析的 `choices` 数组；存在的 `message` / `delta` 必须是对象，`content` 仅接受字符串、空值或省略。控制帧可以不含正文，最终回复必须有非空文字。
- 供应商响应含 `error` 字段时视为失败；无效 JSON、非法 UTF-8、错误字段结构或大小超限均以明确错误结束，不继续拼接损坏的数据。

HTTP 失败按状态码返回应用自己的提示；不读取或展示供应商错误正文。响应中的供应商 `error` 也使用通用失败提示，避免原始错误意外包含密钥或内部信息。网络连接失败、正文读取失败、超时和无效格式各有对应提示。

### 灵感教练内容

```json
{
  "angle": "聊聊今天让你放松的一件事",
  "words": [{ "en": "wind down", "zh": "放松下来" }],
  "example": "I like going for a short walk after work."
}
```

实际提示要求三个词组。客户端最多显示四个，避免模型异常输出造成面板过长。

### 表达教练内容

```json
{
  "positive": "你把今天的感受说清楚了。",
  "original": "I am agree",
  "improved": "I agree",
  "explanation": "agree 已经是动词，不需要 am。",
  "tag": "语法"
}
```

没有需要纠正的片段时，`original` 和 `improved` 返回空字符串；不得为了展示纠错而编造问题。

## 网络、安全与隐私

- 直接模式由浏览器请求选定供应商，必须支持相应 Origin 的 CORS，包括 Authorization 和 Content-Type 请求头；本机 MiniMax 模式由下面的限定代理转发。
- 默认要求 HTTPS；仅 localhost、127.0.0.1、IPv6 localhost 可使用 HTTP。URL 不接受内嵌账号、密码、查询参数或锚点。
- 不通过公共 CORS 代理转发密钥。部署静态站点本身不会绕过供应商 CORS。
- 页面填写的密钥只进入当前会话存储与供应商 Authorization 请求头，不放入 localStorage、查询字符串、导出文件和日志。本机模式的真实密钥只在忽略的 `.env.local` 与服务端进程中；客户端取得占位值，生产构建不包含真实密钥。
- 真实调用会将相应会话文字提交到供应商。浏览器语音识别也可能使用远端服务，参见 [SpeechRecognition 文档](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)。
- 设备朗读由 [SpeechSynthesis](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis) 提供；MiniMax 朗读使用其合成接口返回的 MP3，不承诺设备声音跨平台一致。
- 三个角色可能产生独立计费；本项目不提供供应商额度、费用或模型可用性的保证。

## 故障处理

| 现象             | 处理                                                           |
| ---------------- | -------------------------------------------------------------- |
| 401              | 核对 API Key 与供应商                                          |
| 403              | 检查模型访问权限与地域限制                                     |
| 404              | 检查 Base URL 是否重复了 /v1 或 /chat/completions，确认模型 ID |
| 429              | 检查账户额度、速率限制与并发限制                               |
| 网络失败         | 核对网络、HTTPS、CORS 和域名                                   |
| 超时             | 更换低延迟模型，重试主回复或对应辅导面板                       |
| 模型回复过长     | 缩短本轮要求或调整供应商输出，再重试；应用不会保留超限正文     |
| 无效响应格式     | 检查 Chat Completions / SSE 结构与 UTF-8 编码                  |
| 辅导格式异常     | 检查模型结构化输出能力；独立重试，不重发用户消息               |
| 麦克风无识别结果 | 允许权限，检查设备与浏览器识别服务网络；可切换文字             |

连接测试仅验证主模型的非流式请求。独立辅导模型和流式能力仍需一次实际对话验证，不得把单次测试成功当作所有能力已验收。

## MiniMax ASR / TTS

对话和语音分开请求。默认中国区 Base URL 为 `https://api.minimaxi.com/v1`；其他地域应填写账户相应接口，不在失败后自动把密钥发往另一地域。

- [同步语音合成](https://platform.minimax.io/docs/api-reference/speech-t2a-http)：`POST {speechBaseUrl}/t2a_v2`，JSON 包含 `model`、`text`、`stream: false`、`output_format: "hex"`、`language_boost（按练习语言映射，默认 English）`，以及 `voice_setting` 的音色、语速、音量和音调。当前输出为 32kHz、单声道、128kbps MP3。验证 `base_resp` 成功、`data.status === 2`、`data.audio` 为非空偶数长度的 hex，再生成内存 Blob；不访问供应商返回的下载地址。
- [语音转写](https://platform.minimax.io/docs/api-reference/speech-to-text)：`POST {speechBaseUrl}/speech_to_text`，multipart 字段为 `model: asr-1.0`、`file`、`response_format: json`、`stream: false`，`language（两种语言均受支持时省略以自动识别，否则传练习语言代码）` 请求头。浏览器录音先解码为 PCM16 WAV；成功响应的 `text` 必须为字符串，空白结果交给识别层暂停，不生成空消息。
- 语音请求超时 35 秒并覆盖正文读取；JSON 响应最多 20 MiB，合成音频最多 8 MiB，提交录音最多 20 MiB；合成文本少于 10000 字符，应用通常按句发送。取消释放流；错误只显示应用提示，不回显供应商正文。
- `MiniMaxVoiceQueue` 逐句请求并顺序播放，最多一个合成请求与当前播放，预取下一句；同一回复复用播放器，切换音源不在句间销毁元素，完成或取消统一释放。片段版本隔离旧回调与播放拒绝。启动播放 2.5 秒无进展则恢复；播放中的片段设时长看门狗。失败不会悄悄换成设备声音。
- `MiniMaxRecognition` 使用浏览器麦克风和音量停说检测。录音结束即释放轨道，内存解码后提交转写；不保存或上传整段练习音频，也不上传视频。转写不是原生端到端语音对话，也没有逐字实时转写 UI。

## 本机服务接口

### 语言参数

当前组合进入三个文字角色各自的系统提示；主语言与解释语言分别指定。辅导协议中的 `en` / `zh` 是兼容字段名，其内容跟随选择的两种语言。语音选择及未覆盖语言的处理见 [语言说明](./languages.md)。

MiniMax TTS 的 `language_boost` 按练习语言映射；ASR 在两种基础语言均受支持时省略 `language` 以自动识别，否则指定练习语言。不支持的目标语音能力明确提示，不使用固定英语参数掩盖。代理对非空 ASR 代码做允许列表检查，无效值返回 `400 INVALID_LANGUAGE`。

Vite 开发及预览服务读取 `.env.local` 中的 `MINIMAX_API_KEY`，仅在本机运行；不设置 `VITE_` 前缀。客户端首次启动最多等待 1.5 秒读取状态；已明确保存其他供应商选择时，不覆盖用户选择。

| 方法 | 路径                               | 行为                                              |
| ---- | ---------------------------------- | ------------------------------------------------- |
| GET  | `/api/v1/minimax/status`           | 仅返回 `{ "configured": true/false }`，不返回凭据 |
| POST | `/api/v1/minimax/chat/completions` | 固定转发文字请求并保留 SSE                        |
| POST | `/api/v1/minimax/t2a_v2`           | 固定转发语音合成                                  |
| POST | `/api/v1/minimax/speech_to_text`   | 固定转发 multipart 录音转写                       |

请求仅接受回环来源、回环 Host 和同源 Origin，拒绝跨站请求。POST 还要求 `X-Morrow-Client: 1`，服务端使用自己保存的密钥，不信任浏览器提供的 Authorization。目的域固定为 `api.minimaxi.com`，拒绝任意路由、查询参数、重定向和错误的 Content-Type；聊天请求体最多 4 MiB（允许显式图片材料读取），朗读仍最多 128 KiB，录音请求体最多 20 MiB，响应流最多 20 MiB。Content-Length 超限提前拒绝；最多六个活动付费请求，超出返回 429 / LOCAL_BUSY。断开连接或总计 35 秒超时会释放未完成上传、读取器及上游；慢速上传超时时连接可能被关闭，不保证还能发送 JSON 错误。

自定义训练的图片读取沿用 `/chat/completions`：最后一条用户消息使用 `text` 与 `image_url` 内容块，图片只允许本机生成的 JPEG / PNG / WebP base64 数据，不接受任意图片 URL。使用主模型、非流式，输出上限 1800；MiniMax 使用对应 `max_completion_tokens` 字段。先返回可检查的文字材料，再用于普通对话，原图不会每轮重复发送。图片理解需要支持多模态的实际模型，当前 MiniMax-M3 路径经最小实测；格式依据 [MiniMax 官方文档](https://platform.minimax.cn/docs/api-reference/text-openai-api)。

服务失败返回 `{ "error": { "code": "..." } }`，包括 `LOCAL_ONLY` / `CLIENT_REQUIRED`（403）、`INVALID_ROUTE`（400）、`NOT_FOUND`（404）、`INVALID_CONTENT_TYPE`（415）、`REQUEST_TOO_LARGE`（413）、`MINIMAX_NOT_CONFIGURED`（503）、`MINIMAX_UNAVAILABLE`（502/504）及 `MINIMAX_REJECTED`（保留上游 HTTP 状态）。原始错误正文不透传；所有响应禁止缓存。

该代理没有用户身份、多人配额或账单功能，不能直接作为公网生产后端。静态构建不包含服务端代码或 `.env.local`；生产或手机远程访问需单独部署带鉴权的 HTTPS 服务。
