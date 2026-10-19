export type LanguagePair = { supportLanguage: string; practiceLanguage: string };
export const DEFAULT_LANGUAGE_PAIR: LanguagePair = {
  supportLanguage: 'zh-CN',
  practiceLanguage: 'en-US',
};

/** 常用选项只是快捷入口；其他语言使用经过校验的 BCP-47 代码，不把任意文本拼入提示词。 */
export const LANGUAGE_OPTIONS = [
  'zh-CN',
  'zh-TW',
  'yue-HK',
  'en-US',
  'en-GB',
  'en-AU',
  'ja-JP',
  'ko-KR',
  'fr-FR',
  'de-DE',
  'es-ES',
  'es-MX',
  'pt-BR',
  'pt-PT',
  'it-IT',
  'ru-RU',
  'ar-SA',
  'hi-IN',
  'th-TH',
  'vi-VN',
  'id-ID',
  'ms-MY',
  'fil-PH',
  'tr-TR',
  'pl-PL',
  'uk-UA',
  'nl-NL',
  'sv-SE',
  'da-DK',
  'fi-FI',
  'no-NO',
  'nn-NO',
  'el-GR',
  'cs-CZ',
  'ro-RO',
  'bg-BG',
  'he-IL',
  'fa-IR',
  'sk-SK',
  'hr-HR',
  'hu-HU',
  'sl-SI',
  'ca-ES',
  'ta-IN',
  'af-ZA',
];

export function normalizeLanguage(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64 || !value.trim()) return null;
  try {
    return new Intl.Locale(value.trim()).baseName;
  } catch {
    return null;
  }
}

export function languageName(language: string, displayLocale = 'zh-CN'): string {
  const canonical = normalizeLanguage(language);
  if (!canonical) return language;
  try {
    return new Intl.DisplayNames([displayLocale], { type: 'language' }).of(canonical) || canonical;
  } catch {
    return canonical;
  }
}

export function languageBase(language: string): string {
  const canonical = normalizeLanguage(language);
  return canonical ? new Intl.Locale(canonical).language : '';
}

export function validateLanguagePair(pair: LanguagePair): string | null {
  const support = normalizeLanguage(pair.supportLanguage),
    practice = normalizeLanguage(pair.practiceLanguage);
  if (!support || !practice) return '请选择有效语言；其他语言请填写 BCP-47 代码，例如 sw-KE。';
  if (support === practice) return '请选择两种不同的语言。';
  return null;
}

export function readLanguagePair(value: Record<string, unknown>): LanguagePair {
  const supportLanguage =
    normalizeLanguage(value.supportLanguage) || DEFAULT_LANGUAGE_PAIR.supportLanguage;
  const practiceLanguage =
    normalizeLanguage(value.practiceLanguage) || DEFAULT_LANGUAGE_PAIR.practiceLanguage;
  const pair = { supportLanguage, practiceLanguage };
  return validateLanguagePair(pair) ? { ...DEFAULT_LANGUAGE_PAIR } : pair;
}

export function isDefaultLanguagePair(pair: LanguagePair): boolean {
  return (
    pair.supportLanguage === DEFAULT_LANGUAGE_PAIR.supportLanguage &&
    pair.practiceLanguage === DEFAULT_LANGUAGE_PAIR.practiceLanguage
  );
}

/** 供应商能力集中维护；未覆盖的语言仍可文字交流，不伪装成英语语音。 */
const MINIMAX_TTS_LANGUAGES: Record<string, string> = {
  zh: 'Chinese',
  yue: 'Chinese,Yue',
  en: 'English',
  ar: 'Arabic',
  ru: 'Russian',
  es: 'Spanish',
  fr: 'French',
  pt: 'Portuguese',
  de: 'German',
  tr: 'Turkish',
  nl: 'Dutch',
  uk: 'Ukrainian',
  vi: 'Vietnamese',
  id: 'Indonesian',
  ja: 'Japanese',
  it: 'Italian',
  ko: 'Korean',
  th: 'Thai',
  pl: 'Polish',
  ro: 'Romanian',
  el: 'Greek',
  cs: 'Czech',
  fi: 'Finnish',
  hi: 'Hindi',
  bg: 'Bulgarian',
  da: 'Danish',
  he: 'Hebrew',
  ms: 'Malay',
  fa: 'Persian',
  sk: 'Slovak',
  sv: 'Swedish',
  hr: 'Croatian',
  fil: 'Filipino',
  hu: 'Hungarian',
  no: 'Norwegian',
  nb: 'Norwegian',
  sl: 'Slovenian',
  ca: 'Catalan',
  nn: 'Nynorsk',
  ta: 'Tamil',
  af: 'Afrikaans',
};
export const MINIMAX_ASR_LANGUAGES = new Set([
  'zh',
  'yue',
  'en',
  'ja',
  'ko',
  'th',
  'vi',
  'id',
  'ms',
  'fil',
  'ar',
  'tr',
  'fr',
  'de',
  'es',
  'it',
  'pt',
  'pl',
  'ru',
  'uk',
]);

export function miniMaxSpeechLanguage(language: string): string | undefined {
  return MINIMAX_TTS_LANGUAGES[languageBase(language)];
}

export function miniMaxRecognitionLanguage(pair: LanguagePair): string | undefined {
  const target = languageBase(pair.practiceLanguage),
    support = languageBase(pair.supportLanguage);
  if (!MINIMAX_ASR_LANGUAGES.has(target)) return undefined;
  return target !== support && MINIMAX_ASR_LANGUAGES.has(support) ? '' : target;
}

export function languageDirection(language: string): 'ltr' | 'rtl' {
  return ['ar', 'he', 'fa', 'ur', 'ps', 'yi'].includes(languageBase(language)) ? 'rtl' : 'ltr';
}

/** 同时支持有空格的拉丁语句和无需空格的中日韩句末，供两种朗读队列共用。 */
export function takeSpeechSentence(buffer: string): { sentence: string; rest: string } | null {
  const match = buffer.match(/^([\s\S]*?(?:[。！？؟۔।॥]+[”’"']?|[.!?]+[”’"']?(?=\s|$)))\s*/u);
  return match ? { sentence: match[1], rest: buffer.slice(match[0].length) } : null;
}
