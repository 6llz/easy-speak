import type { CSSProperties } from 'react';
import { Check, Moon, Sun } from 'lucide-react';
import { THEMES } from '../lib/theme';
import type { ThemeId } from '../lib/theme';

type ThemePickerProps = {
  selectedTheme: ThemeId;
  onThemeChange: (themeId: ThemeId) => void;
};

export function ThemePicker({ selectedTheme, onThemeChange }: ThemePickerProps) {
  return (
    <div className="theme-preferences">
      <div className="theme-intro">
        <strong id="theme-picker-title">给聊天换一种心情</strong>
        <p id="theme-picker-description">选择后立即生效，下次打开也会记得。</p>
      </div>
      <div
        className="theme-picker"
        role="radiogroup"
        aria-labelledby="theme-picker-title"
        aria-describedby="theme-picker-description"
      >
        {THEMES.map((theme) => {
          const isSelected = selectedTheme === theme.id;
          const previewStyle = {
            '--preview-page': theme.pageColor,
            '--preview-accent': theme.accentColor,
            '--preview-secondary': theme.secondaryColor,
          } as CSSProperties;
          return (
            <label className={`theme-option ${isSelected ? 'selected' : ''}`} key={theme.id}>
              <input
                type="radio"
                name="color-theme"
                value={theme.id}
                checked={isSelected}
                onChange={() => onThemeChange(theme.id)}
              />
              <span className="theme-swatch" style={previewStyle} aria-hidden="true">
                <span className="theme-swatch-orb" />
                <span className="theme-swatch-card" />
                <span className="theme-swatch-card secondary" />
                <span className="theme-selected-mark">{isSelected && <Check size={13} />}</span>
              </span>
              <span className="theme-name">
                {theme.colorScheme === 'light' ? <Sun size={13} /> : <Moon size={13} />}
                <strong>{theme.name}</strong>
                {isSelected && <span>使用中</span>}
              </span>
              <span className="theme-description">{theme.description}</span>
            </label>
          );
        })}
      </div>
      <p className="theme-local-note">配色仅保存在本机，不影响你的模型与语音设置。</p>
    </div>
  );
}
