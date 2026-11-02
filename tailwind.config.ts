import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0F1117',
        surface: '#161B27',
        'surface-2': '#1E2435',
        border: 'rgba(255,255,255,0.08)',
        'border-strong': 'rgba(255,255,255,0.15)',
        text: '#E6EDF3',
        'text-secondary': '#8B949E',
        'text-muted': '#484F58',
        primary: '#3B82F6',
        'primary-hover': '#2563EB',
        success: '#10B981',
        warning: '#F59E0B',
        danger: '#EF4444',
        purple: '#8B5CF6',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Bricolage Grotesque', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '8px',
        sm: '6px',
        lg: '12px',
        xl: '16px',
      },
    },
  },
  plugins: [],
}

export default config
