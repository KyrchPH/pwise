import { createContext, useContext, useEffect, useMemo, useState } from 'react';

// Light/dark theme. The choice is persisted in localStorage and applied as
// data-theme on <html> (the CSS variable overrides key off that attribute).
// First visit follows the OS preference.
const ThemeContext = createContext({ theme: 'light', toggle: () => {} });

const initialTheme = () => {
  try {
    const saved = localStorage.getItem('pwise-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* storage unavailable (private mode) — fall through to OS preference */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('pwise-theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const value = useMemo(() => ({ theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
