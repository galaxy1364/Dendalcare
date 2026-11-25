/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Vazirmatn', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        brand: {
          primary: '#087C76',
          navy: '#142E43',
          bg: '#F4F7F9',
          surface: '#FFFFFF',
          ink: '#14283B',
          secondary: '#526779',
          critical: '#AD293C',
          warning: '#92510C',
          success: '#176B52',
        },
      },
      borderRadius: {
        card: '20px',
        btn: '12px',
      },
      borderWidth: {
        3: '3px',
      },
      spacing: {
        1: '4px',
        2: '8px',
        3: '12px',
        4: '16px',
        6: '24px',
        8: '32px',
      },
    },
  },
  plugins: [],
};
