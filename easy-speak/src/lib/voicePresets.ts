import type { Settings } from './core';
import { languageBase } from './languages';
import { validateSpeechSettings } from './speechSettings';
import { APP_NAME } from './brand';

export type VoicePreset = {
  id: string;
  name: string;
  companionName: string;
  description: string;
  traits: string[];
  bestFor: string;
  language: string;
};
export type VoiceChoice =
  { provider: 'minimax'; voiceId: string } | { provider: 'browser'; voiceURI: string };

/** 系统音色来源及验证日期见 docs/voices.md；名称是界面别名，不改变供应商 ID。 */
export const VOICE_PRESETS: VoicePreset[] = [
  {
    id: 'English_expressive_narrator',
    name: '米洛 Milo',
    companionName: 'Milo',
    description: '英文 · 自然讲述',
    traits: ['富有表现力', '叙述自然'],
    bestFor: '日常聊天、分享经历',
    language: 'en',
  },
  {
    id: 'English_Gentle-voiced_man',
    name: '诺亚 Noah',
    companionName: 'Noah',
    description: '英文 · 柔和男声',
    traits: ['温润亲和', '轻松从容'],
    bestFor: '轻松闲聊、慢慢开口',
    language: 'en',
  },
  {
    id: 'English_Graceful_Lady',
    name: '克拉拉 Clara',
    companionName: 'Clara',
    description: '英文 · 优雅女声',
    traits: ['优雅从容', '成熟风格'],
    bestFor: '观点交流、职场表达',
    language: 'en',
  },
  {
    id: 'English_Trustworthy_Man',
    name: '伊森 Ethan',
    companionName: 'Ethan',
    description: '英文 · 沉稳男声',
    traits: ['沉着稳重', '可靠风格'],
    bestFor: '工作沟通、认真讨论',
    language: 'en',
  },
  {
    id: 'Serene_Woman',
    name: '露娜 Luna',
    companionName: 'Luna',
    description: '英文 · 舒缓女声',
    traits: ['舒缓平和', '放松氛围'],
    bestFor: '日常陪伴、聊聊心情',
    language: 'en',
  },
  {
    id: 'English_Aussie_Bloke',
    name: '奥利 Oliver',
    companionName: 'Oliver',
    description: '英文 · 澳洲男声',
    traits: ['澳洲风格', '随性交谈'],
    bestFor: '旅行聊天、口音体验',
    language: 'en',
  },
  {
    id: 'Chinese (Mandarin)_Warm_Bestie',
    name: '知夏',
    companionName: '知夏',
    description: '普通话 · 温暖女声',
    traits: ['亲切温暖', '朋友般自然'],
    bestFor: '生活分享、轻松交流',
    language: 'zh',
  },
  {
    id: 'Chinese (Mandarin)_Gentleman',
    name: '言舟',
    companionName: '言舟',
    description: '普通话 · 温润男声',
    traits: ['温润平和', '从容表达'],
    bestFor: '日常沟通、讲述故事',
    language: 'zh',
  },
  {
    id: 'Japanese_KindLady',
    name: '春奈 Haruna',
    companionName: 'Haruna',
    description: '日文 · 亲切女声',
    traits: ['温柔亲切', '轻松氛围'],
    bestFor: '日常寒暄、生活会话',
    language: 'ja',
  },
  {
    id: 'Japanese_GentleButler',
    name: '悠人 Yuto',
    companionName: 'Yuto',
    description: '日文 · 温和男声',
    traits: ['温和从容', '礼貌风格'],
    bestFor: '情景会话、礼貌表达',
    language: 'ja',
  },
  {
    id: 'French_CasualMan',
    name: '卢卡 Lucas',
    companionName: 'Lucas',
    description: '法文 · 随性男声',
    traits: ['随性自然', '朋友式聊天'],
    bestFor: '旅行交流、日常聊天',
    language: 'fr',
  },
  {
    id: 'French_FemaleAnchor',
    name: '卡米 Camille',
    companionName: 'Camille',
    description: '法文 · 清晰女声',
    traits: ['清晰讲述', '主播风格'],
    bestFor: '听读练习、完整表达',
    language: 'fr',
  },
];

export function voicePresetsFor(language: string): VoicePreset[] {
  const base = languageBase(language);
  return [
    ...VOICE_PRESETS.filter((voice) => voice.language === base),
    ...VOICE_PRESETS.filter((voice) => voice.language !== base),
  ];
}

export function selectedVoiceName(settings: Settings): string {
  if (settings.speechProvider === 'browser') return settings.voice ? '设备音色' : '设备默认';
  return VOICE_PRESETS.find((voice) => voice.id === settings.speechVoice)?.name || '自定义音色';
}

/** 预设音色使用对应语伴称呼；设备和自定义音色没有人物映射，使用项目名称。 */
export function companionName(settings: Pick<Settings, 'speechProvider' | 'speechVoice'>): string {
  return settings.speechProvider === 'minimax'
    ? VOICE_PRESETS.find((voice) => voice.id === settings.speechVoice)?.companionName || APP_NAME
    : APP_NAME;
}

export function personalizeGreeting(text: string, settings: Settings): string {
  return text.replaceAll('{companion}', companionName(settings));
}

/** 仅修改朗读音色，不改对话供应商、密钥、语速、自动朗读意图和交流语言。 */
export function applyVoiceChoice(settings: Settings, choice: VoiceChoice): Settings {
  if (choice.provider === 'browser')
    return { ...settings, speechProvider: 'browser', voice: choice.voiceURI };
  const voiceId = choice.voiceId.trim();
  if (!voiceId || voiceId.length > 160)
    throw new Error('请选择有效音色，或在语音设置中填写自定义音色。');
  const next = { ...settings, speechProvider: 'minimax' as const, speechVoice: voiceId };
  const validation = validateSpeechSettings(next);
  if (validation) throw new Error(validation);
  return next;
}

/** 试听使用当前练习语言；没有预设短句的语言读其本地名称，不偷偷换成英语。 */
export function voicePreviewText(language: string): string | null {
  const samples: Record<string, string> = {
    en: 'Hi! I’m here to listen. Let’s take it one sentence at a time.',
    zh: '你好，很高兴陪你练习。我们慢慢聊，一句一句来。',
    ja: 'こんにちは。一緒に、ゆっくり会話の練習をしましょう。',
    fr: 'Bonjour ! Prenons le temps de discuter et de pratiquer ensemble.',
    es: '¡Hola! Vamos a conversar y practicar con calma.',
    de: 'Hallo! Lass uns in Ruhe miteinander sprechen und üben.',
    ko: '안녕하세요. 천천히 함께 대화를 연습해요.',
    it: 'Ciao! Facciamo un po’ di conversazione con calma.',
    pt: 'Olá! Vamos conversar e praticar com calma.',
    ar: 'مرحباً! لنتحدث ونتدرب معاً بهدوء.',
  };
  return samples[languageBase(language)] || null;
}
