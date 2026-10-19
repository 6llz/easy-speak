import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  DEFAULT_THEME,
  THEMES,
  THEME_STORAGE_KEY,
  parseThemePreference,
  readTheme,
  saveTheme,
} from '../src/lib/theme.ts';

test('主题偏好只接受已知 ID，异常本地数据安全回退', () => {
  for (const theme of THEMES) assert.equal(parseThemePreference(theme.id), theme.id);
  for (const invalid of [null, undefined, '', 'unknown', 'VIOLET', '"ocean"', {}, [], 0]) {
    assert.equal(parseThemePreference(invalid), DEFAULT_THEME);
  }
});

test('四种配色独立持久化，不读取或改写供应商与密钥设置', () => {
  const values = new Map<string, string>([
    ['morrow:settings', '{"provider":"custom"}'],
    ['morrow:key', 'session-secret'],
  ]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  assert.equal(readTheme(storage), DEFAULT_THEME);
  for (const theme of THEMES) {
    assert.equal(saveTheme(theme.id, storage), true);
    assert.equal(values.get(THEME_STORAGE_KEY), theme.id);
    assert.equal(readTheme(storage), theme.id);
  }
  assert.equal(values.get('morrow:settings'), '{"provider":"custom"}');
  assert.equal(values.get('morrow:key'), 'session-secret');
});

test('存储权限和容量错误不会阻断主题读取或切换', () => {
  assert.equal(
    readTheme({
      getItem: () => {
        throw new Error('Storage unavailable');
      },
    }),
    DEFAULT_THEME,
  );
  assert.equal(
    saveTheme('sand', {
      setItem: () => {
        throw new Error('Quota exceeded');
      },
    }),
    false,
  );
  assert.equal(readTheme({ getItem: () => '{broken json' }), DEFAULT_THEME);
});

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((offset) => {
      const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

test('主题预览与文档栏颜色和实际样式一致，浅深色文字保持可读对比度', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const palettes = new Map(
    [...css.matchAll(/:root\[data-theme='(\w+)'\]\s*\{([^}]+)\}/g)].map((match) => [
      match[1],
      new Map(
        [...match[2].matchAll(/--([\w-]+):\s*(#[\da-f]{6});/g)].map((color) => [
          color[1],
          color[2],
        ]),
      ),
    ]),
  );
  for (const theme of THEMES) {
    const colors = palettes.get(theme.id);
    assert.ok(colors, `${theme.id} 缺少全局主题样式`);
    assert.equal(colors.get('page'), theme.pageColor);
    assert.equal(colors.get('accent'), theme.accentColor);
    assert.equal(colors.get('mint'), theme.secondaryColor);
    for (const [foreground, background] of [
      ['text', 'page'],
      ['text-secondary', 'surface'],
      ['muted', 'surface'],
      ['accent', 'surface'],
      ['mint', 'surface'],
      ['accent-ink', 'accent'],
      ['danger-ink', 'danger'],
    ]) {
      const ratio = contrastRatio(colors.get(foreground)!, colors.get(background)!);
      assert.ok(
        ratio >= 4.5,
        `${theme.id}: ${foreground}/${background} 对比度 ${ratio.toFixed(2)}`,
      );
    }
  }
});
