/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Primary — midnight navy. Drives buttons, links, active states.
        brand: {
          50: '#eef2f8',
          100: '#d6e0ee',
          200: '#afc2dc',
          300: '#809bbe',
          400: '#4f6e9a',
          500: '#2f4f7e',
          600: '#1f3a66',
          700: '#16294a',
          800: '#101e37',
          900: '#0b1426',
        },
        // Accent — champagne gold. Hairlines, marks, highlights.
        gold: {
          50: '#fbf7ee',
          100: '#f3e8ce',
          200: '#e7d2a4',
          300: '#d8bb79',
          400: '#c2a368',
          500: '#a8884b',
          600: '#8c6f3b',
          700: '#6f582f',
          800: '#524122',
          900: '#362b16',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['Fraunces', 'Georgia', 'Cambria', 'serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16, 30, 55, 0.04), 0 2px 6px rgba(16, 30, 55, 0.04)',
      },
    },
  },
  plugins: [],
};
