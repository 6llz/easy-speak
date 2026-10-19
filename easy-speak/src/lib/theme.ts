export const THEMES = [
  {
    id: 'violet',
    name: '暮色紫',
    description: '安静柔和，沉浸地聊一会儿',
    colorScheme: 'dark',
    pageColor: '#17151e',
    accentColor: '#c8b7f1',
    secondaryColor: '#a6d4c1',
  },
  {
    id: 'ocean',
    name: '海盐蓝',
    description: '清透的蓝，让思绪慢下来',
    colorScheme: 'dark',
    pageColor: '#111d27',
    accentColor: '#a4d6ef',
    secondaryColor: '#9bd8d1',
  },
  {
    id: 'forest',
    name: '森林绿',
    description: '像树荫下的一场自在聊天',
    colorScheme: 'dark',
    pageColor: '#17211c',
    accentColor: '#b6d5a7',
    secondaryColor: '#a9d7c6',
  },
  {
    id: 'sand',
    name: '奶油白',
    description: '温暖明亮，也适合白天练习',
    colorScheme: 'light',
    pageColor: '#f6f2eb',
    accentColor: '#795b95',
    secondaryColor: '#356b57',
  },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];
export const DEFAULT_THEME: ThemeId = 'violet';
export const THEME_STORAGE_KEY = 'morrow:theme';

/** 只接受已发布的配色 ID，损坏或旧版本的本地偏好回退到默认主题。 */
export function parseThemePreference(value: unknown): ThemeId {
  return THEMES.find((theme) => theme.id === value)?.id ?? DEFAULT_THEME;
}

/** 主题独立于供应商设置保存，存储被禁用时仍可使用默认外观。 */
export function readTheme(storage?: Pick<Storage, 'getItem'>): ThemeId {
  try {
    return parseThemePreference((storage ?? localStorage).getItem(THEME_STORAGE_KEY));
  } catch {
    // 隐私模式或浏览器策略可能阻止访问存储，不能阻止主界面加载。
    return DEFAULT_THEME;
  }
}

/** 保存外观偏好；失败由界面提示，当前页面已经应用的主题继续保留。 */
export function saveTheme(themeId: ThemeId, storage?: Pick<Storage, 'setItem'>): boolean {
  try {
    (storage ?? localStorage).setItem(THEME_STORAGE_KEY, themeId);
    return true;
  } catch {
    return false;
  }
}

/** 将主题应用于整份文档，确保弹层、原生控件与移动浏览器栏同步配色。 */
export function applyTheme(themeId: ThemeId, targetDocument: Document = document): void {
  const theme = THEMES.find((candidate) => candidate.id === themeId) ?? THEMES[0];
  targetDocument.documentElement.dataset.theme = theme.id;
  targetDocument.documentElement.style.colorScheme = theme.colorScheme;
  let themeColor = targetDocument.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!themeColor) {
    themeColor = targetDocument.createElement('meta');
    themeColor.name = 'theme-color';
    targetDocument.head.append(themeColor);
  }
  themeColor.content = theme.pageColor;
}
