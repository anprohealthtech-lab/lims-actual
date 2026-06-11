import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';

export type ThemeName = 'blue' | 'emerald' | 'violet' | 'rose' | 'orange';

interface ThemePreset {
  name: ThemeName;
  label: string;
  swatch: string;
  colors: Record<string, string>;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    name: 'blue',
    label: 'Blue',
    swatch: '#2563eb',
    colors: {
      '50': '239 246 255',
      '100': '219 234 254',
      '200': '191 219 254',
      '300': '147 197 253',
      '500': '59 130 246',
      '600': '37 99 235',
      '700': '29 78 216',
      '800': '30 64 175',
      '900': '30 58 138',
    },
  },
  {
    name: 'emerald',
    label: 'Emerald',
    swatch: '#059669',
    colors: {
      '50': '236 253 245',
      '100': '209 250 229',
      '200': '167 243 208',
      '300': '110 231 183',
      '500': '16 185 129',
      '600': '5 150 105',
      '700': '4 120 87',
      '800': '6 95 70',
      '900': '6 78 59',
    },
  },
  {
    name: 'violet',
    label: 'Violet',
    swatch: '#7c3aed',
    colors: {
      '50': '245 243 255',
      '100': '237 233 254',
      '200': '221 214 254',
      '300': '196 181 253',
      '500': '139 92 246',
      '600': '124 58 237',
      '700': '109 40 217',
      '800': '91 33 182',
      '900': '76 29 149',
    },
  },
  {
    name: 'rose',
    label: 'Rose',
    swatch: '#e11d48',
    colors: {
      '50': '255 241 242',
      '100': '255 228 230',
      '200': '254 205 211',
      '300': '253 164 175',
      '500': '244 63 94',
      '600': '225 29 72',
      '700': '190 18 60',
      '800': '159 18 57',
      '900': '136 19 55',
    },
  },
  {
    name: 'orange',
    label: 'Orange',
    swatch: '#ea580c',
    colors: {
      '50': '255 247 237',
      '100': '255 237 213',
      '200': '254 215 170',
      '300': '253 186 116',
      '500': '249 115 22',
      '600': '234 88 12',
      '700': '194 65 12',
      '800': '154 52 18',
      '900': '124 45 18',
    },
  },
];

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const isThemeName = (value: string | null): value is ThemeName =>
  THEME_PRESETS.some((preset) => preset.name === value);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const storageKey = user?.id ? `lims-ui-theme:${user.id}` : 'lims-ui-theme:guest';
  const [theme, setThemeState] = useState<ThemeName>('blue');

  useEffect(() => {
    const savedTheme = localStorage.getItem(storageKey);
    setThemeState(isThemeName(savedTheme) ? savedTheme : 'blue');
  }, [storageKey]);

  useEffect(() => {
    const preset = THEME_PRESETS.find((item) => item.name === theme) ?? THEME_PRESETS[0];
    Object.entries(preset.colors).forEach(([shade, value]) => {
      document.documentElement.style.setProperty(`--color-primary-${shade}`, value);
    });
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    setTheme: (nextTheme) => {
      localStorage.setItem(storageKey, nextTheme);
      setThemeState(nextTheme);
    },
  }), [storageKey, theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
};
