import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg:        { DEFAULT: '#0a0a0c', elev: '#0e0e11', sunk: '#08080a' },
        side:      { DEFAULT: '#16161a', alt: '#121215' },
        border:    { DEFAULT: '#1f1f24', strong: '#2a2a30', subtle: '#1a1a1f' },
        fg:        { DEFAULT: '#fafafa', muted: '#a1a1aa', dim: '#71717a', faint: '#52525b' },
      },
      fontFamily: {
        sans: ['Manrope', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
