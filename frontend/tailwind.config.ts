import type { Config } from 'tailwindcss'

export default {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        paper: '#E4E1D9',
        ink: '#1D1E18',
        'warm-highlight': '#FFE8D1',
        'trust-blue': '#4F638C',
        'ember-red': '#C73E1D',
        'player-blue': '#3B82F6',
        'night-bg': '#0e0e0c',
        'night-surface': '#1D1E18',
        'night-border': '#333333',
        'studio-dark': '#141414',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Inter', 'sans-serif'],
        serif: ['var(--font-serif)', 'Newsreader', 'serif'],
        mono: ['var(--font-mono)', 'IBM Plex Mono', 'monospace'],
      },
      boxShadow: {
        elevation: '0 10px 40px -10px rgba(0,0,0,0.1)',
        float: '0 20px 50px -10px rgba(0,0,0,0.3)',
      },
      transitionProperty: {
        height: 'height, max-height, padding, opacity',
      },
    },
  },
  plugins: [],
} satisfies Config
