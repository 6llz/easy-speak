import type { Message } from './core';

/** 将近似练习秒数格式化为 mm:ss。 */
export function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safeSeconds / 60)
    .toString()
    .padStart(2, '0')}:${(safeSeconds % 60).toString().padStart(2, '0')}`;
}
/** 历史按消息发出时的称呼显示；旧记录没有名字时使用中性的“语伴”。 */
export function messageSpeakerName(message: Message, userName = '你'): string {
  return message.role === 'user' ? userName : message.companionName || '语伴';
}
