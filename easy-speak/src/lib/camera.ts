const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 640 } },
  // 摄像头预览不另开音轨；口语录音由识别适配器独立管理。
  audio: false,
};

/**
 * 仅管理本机预览的摄像头资源，不截图、不录像、不发模型请求。
 * 版本检查覆盖权限等待阶段，停止后才到达的媒体流也会立即释放。
 */
export class CameraController {
  private version = 0;
  private stream: MediaStream | null = null;

  constructor(
    private requestStream: () => Promise<MediaStream> = () =>
      navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS),
  ) {}

  /** 请求视频流；若等待期间已关闭或有新请求取代，释放候选流并返回 null。 */
  async open(): Promise<MediaStream | null> {
    const version = ++this.version;
    const candidate = await this.requestStream();
    if (version !== this.version) {
      candidate.getTracks().forEach((track) => track.stop());
      return null;
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = candidate;
    return candidate;
  }

  /** 同时作废未完成请求并停止所有已持有轨道，可重复调用。 */
  stop(): void {
    this.version++;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}
