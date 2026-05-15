/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Outfit', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        dock: '0 1px 0 rgba(9, 9, 11, 0.04)',
        lift: '0 1px 2px rgba(9, 9, 11, 0.04), 0 4px 12px -2px rgba(9, 9, 11, 0.08)',
        card: '0 0 0 1px rgba(9, 9, 11, 0.05), 0 2px 8px -2px rgba(9, 9, 11, 0.06), 0 12px 32px -8px rgba(9, 9, 11, 0.1)',
        'card-hover': '0 0 0 1px rgba(9, 9, 11, 0.06), 0 8px 24px -4px rgba(9, 9, 11, 0.12)',
        sheet: '0 0 0 1px rgba(9, 9, 11, 0.06), 0 24px 48px -12px rgba(9, 9, 11, 0.18)',
        'sheet-lg': '0 0 0 1px rgba(9, 9, 11, 0.06), 0 32px 64px -16px rgba(9, 9, 11, 0.22)',
        glow: '0 0 24px -4px rgba(99, 102, 241, 0.35)',
      },
      backgroundImage: {
        'mesh-dark':
          'radial-gradient(ellipse 120% 80% at 20% -20%, rgba(99, 102, 241, 0.25) 0%, transparent 50%), radial-gradient(ellipse 80% 60% at 100% 0%, rgba(14, 165, 233, 0.12) 0%, transparent 45%), linear-gradient(165deg, #09090b 0%, #18181b 50%, #0c0a09 100%)',
        'mesh-app':
          'radial-gradient(ellipse 100% 80% at 50% -30%, rgba(99, 102, 241, 0.06) 0%, transparent 55%), radial-gradient(ellipse 60% 40% at 100% 100%, rgba(14, 165, 233, 0.04) 0%, transparent 40%), linear-gradient(180deg, #fafafa 0%, #f4f4f5 100%)',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
};
