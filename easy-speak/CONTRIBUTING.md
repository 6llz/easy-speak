# 开发规范

本规范是「轻松说」的工程基线。提交贡献前请阅读 [非商用许可证](./LICENSE)；贡献内容采用项目相同许可证，第三方代码必须保留其来源和原有许可。仓库未提供已有公司标准，因此不声称替代公司的安全、发布、审计或评审要求。团队提供规则后，应以明确的公司要求补充本文件。

## 1. 目录与依赖方向

```text
src/
  components/        可复用界面与功能面板
  hooks/             React 会话状态及异步编排
  lib/               模型协议、语音、数据存储
  App.tsx            页面装配与导航
  main.tsx           应用入口
  styles.css         视觉系统与响应式布局
tests/               不依赖真实密钥的关键行为测试
server/              本机服务端代理与凭据边界
docs/                功能、架构、接入与验收文档
```

界面依赖 Hook 和基础模块；基础模块不得反向依赖 React 组件。模型请求、密钥存储、语音操作不得散落在展示组件中。新增独立业务功能时建立独立模块，不继续扩充入口文件。

## 2. 命名

| 对象            | 规则                                       | 示例                                    |
| --------------- | ------------------------------------------ | --------------------------------------- |
| 组件及组件文件  | PascalCase                                 | `SettingsDialog.tsx`、`PracticeScreen`  |
| Hook            | use + 动词或领域对象                       | `usePractice.ts`                        |
| 普通模块        | camelCase                                  | `storage.ts`、`voice.ts`                |
| 类型、接口      | PascalCase；不加 I 前缀                    | `Settings`、`PracticeScreenProps`       |
| 变量            | camelCase；语义明确，避免 data、obj 等泛称 | `currentMessages`                       |
| 函数            | 动词 + 业务对象                            | `requestChatCompletion`、`saveSettings` |
| 布尔状态        | is / has / can / should 开头               | `isSettingsOpen`、`isAutoSpeak`         |
| 外部事件回调    | on + 事件                                  | `onSave`、`onClose`                     |
| 内部事件处理    | handle + 事件                              | `handleSave`、`handleProviderChange`    |
| 模块级固定常量  | UPPER_SNAKE_CASE                           | `DEFAULT_SETTINGS`、`HINT_PROMPT`       |
| 可变对象引用    | 语义 + Ref，或明确领域名                   | `settingsRef`、`controller`             |
| 请求 / 响应类型 | 业务名 + Request / Response                | `ChatCompletionRequest`                 |

短变量只允许用于很短的遍历、数学计算或协议解析。跨函数、跨模块变量必须能从名称识别用途。不得用拼音命名，不得使用 `flag1`、`temp2`、`doSomething`。

第三方协议保持供应商定义的字段，例如 `max_tokens`、`choices`、`delta`；只在适配层使用这些命名，业务层使用统一的领域类型。

## 3. 类型与接口契约

- 启用 TypeScript strict，禁止显式 `any`，未知外部数据先用 `unknown` 再验证。
- 简单数据结构优先 `type`；需要声明合并或被扩展的公共契约可用 `interface`。禁止仅为命名偏好重复定义相同类型。
- 组件属性必须有明确的 `…Props` 类型。回调声明参数与返回值。
- 可空状态显式使用 `null`；可选字段用 `?`。不要通过断言绕过业务校验。
- 不允许业务层读取未经校验的辅导 JSON。接口失败必须形成可恢复错误。
- 客户端供应商通过标准 `POST {baseUrl}/chat/completions` 接入；本机 MiniMax 代理使用 `/api/v1/minimax` 下的限定路由，契约与错误码见 `docs/providers.md`。新增后端时必须同步建立接口契约、鉴权及错误模型文档；本机代理不得当作多人生产服务。
- 新增后端资源使用复数名词和版本路径，例如 `GET /api/v1/practice-sessions`、`POST /api/v1/practice-sessions`；HTTP 方法表达操作，路径不使用 `getXXX`。列表返回分页信息，失败返回明确错误码和可读提示。

## 4. 注释

对导出的业务入口、复杂状态编排、协议解析及有副作用的资源管理代码写 JSDoc：说明职责，必要时补充 `@param`、`@returns`、`@throws`。普通组件和一眼可懂的工具函数无需机械地补齐所有标签。

```ts
/**
 * 向选定供应商请求对话，支持流式增量和主动取消。
 * @param settings 已校验的供应商设置，包含当前会话密钥。
 * @param messages 按时间排序的对话上下文。
 * @returns 完整的助手回复。
 * @throws 网络失败、供应商错误或回复为空时抛出可展示错误。
 */
export async function requestChatCompletion(/* 明确类型的参数 */) {
  // 实现
}
```

行内注释解释业务约束、并发风险和兼容原因，避免翻译代码。团队文档与新增业务注释使用中文；协议名称和标准术语保留英文。逻辑修改必须同步更新注释。注释不保留被注释掉的旧代码。TODO 必须包含负责人和可追踪任务，例如 `TODO(owner, ISSUE-123): ...`，不得添加无归属 TODO。

## 5. 错误、异步与资源

- 禁止空 catch。可预期失败转化为可读提示；静默降级必须有说明并保证行为安全。
- 不把 API Key、完整请求头或敏感用户对话写入 console、日志、URL 或错误文本。
- 持久化对象必须逐字段白名单构造；不能把参数的结构类型当作运行时白名单，也不能将 `Settings` 或 `...pair` 等来源对象直接展开到记录中。跨层调用增加虚构凭据回归，确认额外字段不会进入长期存储；旧数据迁移失败需提示。
- 本机凭据只放在忽略的 `.env.local`，变量不使用 `VITE_` 前缀；客户端不得请求或返回真实服务端密钥。生产产物检查必须确认不含凭据。
- 每个外部请求都必须能取消并设超时。切换会话、更新配置和组件卸载时释放请求、语音与定时器。
- 异步回调校验会话版本；过期返回不得覆盖新会话。两个辅导面板维护独立状态。
- 禁止同时录音和朗读。新状态必须有明确进入条件、退出条件及恢复路径。
- 限制上下文长度、用户输入长度和本地记录数量；集中声明可复用限制，禁止散落重复的业务阈值。

## 6. 格式与检查

Prettier 是格式的唯一来源：2 空格缩进、单引号、分号、尾逗号、LF 换行。ESLint 检查 TypeScript、React Hook 与未使用代码。禁止手动格式与工具对抗。

```powershell
npm run format
npm run format:check
npm run lint
npm run test
npm run build
```

改动相关检查全部通过才可交付。新测试必须验证行为和真实风险，避免只重复实现。供应商真实联网、实际麦克风和扬声器测试需与模拟协议测试分开记录。

## 7. 可访问性、样式与文案

- 交互元素用原生 button、input、select；图标按钮必须有可读名称。
- 弹窗支持 Escape、焦点限制和关闭后焦点恢复；键盘可操作所有主要交互。
- 信息状态用文案表达，不能仅依靠颜色。遵循减少动态效果系统设置。
- 展示文案不包含内部实现细节；涉及密钥、计费、识别服务及示范模式时清楚说明边界。
- 新视觉规则复用已有 CSS 变量及语义类名，避免引入第二套 UI 体系。

## 8. 文档与提交

功能变化更新 `docs/features.md`；状态、数据或依赖变化更新 `docs/architecture.md`；供应商契约变化更新 `docs/providers.md`；验证结果记录于 `docs/verification.md`。

建议提交格式：`feat(scope): 描述`、`fix(scope): 描述`、`docs(scope): 描述`、`refactor(scope): 描述`。PR 说明实际问题、最终行为、验证结果及已知限制。未执行的验证不能标注通过。

## 9. D 盘存储约定

所有新增下载、依赖、测试截图、npm 缓存与构建产物均留在项目所在 D 盘。安装命令显式指定 `--cache .npm-cache`；不进行全局安装，不下载浏览器到系统默认 C 盘目录。
