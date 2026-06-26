/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{vue,js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        'bg-primary': '#0D1117',
        'bg-secondary': '#161B22',
        'bg-tertiary': '#21262D',
        'text-primary': '#E6EDF3',
        'text-secondary': '#8B949E',
        'text-muted': '#484F58',
        'accent-blue': '#5B8DEF',
        'accent-purple': '#7C5CFC',
        'accent-light': '#A78BFA',
        'success': '#3FB950',
        'danger': '#F85149',
        'warning': '#D29922',
        'info': '#58A6FF'
      },
      fontFamily: {
        sans: ['PingFang SC', 'Microsoft YaHei', 'sans-serif']
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'float': 'float 3s ease-in-out infinite'
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 5px rgba(123, 92, 252, 0.3)' },
          '50%': { boxShadow: '0 0 20px rgba(123, 92, 252, 0.6)' }
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' }
        }
      }
    }
  },
  plugins: [require('tailwindcss-animate')]
}
