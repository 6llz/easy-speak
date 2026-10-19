# 设备权限与摄像头边界

更新时间：2026-10-20。当前项目是 Web App，尚无 Android Manifest、iOS Info.plist 或可安装的原生工程；下表是已实现的 Web 行为与后续打包所需的权限设计。

| 能力            | 当前 Web 行为                                              | 手机打包要求                                                        |
| --------------- | ---------------------------------------------------------- | ------------------------------------------------------------------- |
| 联网            | 请求用户选定的模型与语音服务                               | Android `INTERNET`；不需要运行时弹窗                                |
| 麦克风          | 在语音输入时由浏览器请求授权；拒绝后可以打字               | Android `RECORD_AUDIO` 运行时授权；iOS 配置麦克风用途说明并按需请求 |
| 摄像头          | 仅用户点击时请求，可选；关闭、挂断、后台或离开对话页后释放 | Android `CAMERA` 运行时授权；iOS 配置摄像头用途说明并按需请求       |
| 文件 / 图片选择 | 只读取用户主动选中的文件                                   | 优先系统文档 / 照片选择器，不申请全盘存储或整个相册访问             |
| 导出            | 浏览器下载文本；手机需适配系统保存 / 分享                  | 使用系统交互，不为此申请无关权限                                    |

摄像头**只有本机预览**，不截帧、不录像、不发送给模型，也不能让 AI 自动理解身边场景。视频理解暂缓实现。自定义训练中的图片理解是另一条显式操作链路：用户选择图片后，压缩图会发送给当前视觉模型，生成材料文字供用户确认。

现有功能不需要通讯录、定位、短信、通话记录、无障碍、后台录音、通知或蓝牙扫描权限。正常使用系统已连接的蓝牙耳机，不等于 App 需要扫描附近设备；若未来采用的原生 SDK 要求额外权限，应逐项确认用途。

Android 和 iOS 真机还须验证授权 / 拒绝 / 撤销后的恢复、先播后录、后台关闭媒体和原生 WebView 兼容性。网页测试不能代替原生权限验收。

参考：[Android 运行时权限](https://developer.android.com/training/permissions/requesting)、[Android 权限定义](https://developer.android.com/reference/android/Manifest.permission)、[系统文档选择器](https://developer.android.com/training/data-storage/shared/documents-files)、[系统照片选择器](https://developer.android.com/training/data-storage/shared/photo-picker)、[iOS 麦克风用途说明](https://developer.apple.com/documentation/bundleresources/information-property-list/nsmicrophoneusagedescription)、[iOS 摄像头用途说明](https://developer.apple.com/documentation/bundleresources/information-property-list/nscamerausagedescription)。
