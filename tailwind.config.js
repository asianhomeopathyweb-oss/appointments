/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}",
  ],
  theme: {
    extend: {
      colors: {
        'accent': '#0d8a7a',
        'accent-hover': '#0b7566',
        'accent-soft': '#e6f4f1',
        'ink': '#1a1d21',
        'ink-mute': '#6b7280',
        'ink-faint': '#9ca3af',
        'hairline': '#ebeef1',
        'surface': '#ffffff',
        'surface-hover': '#f9f9fb',
        'surface-press': '#f5f5f7',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '8px',
        lg: '10px',
        xl: '12px',
        '2xl': '16px',
      },
      boxShadow: {
        sheet: '0 -8px 32px rgba(0,0,0,0.08)',
        panel: '0 8px 32px rgba(0,0,0,0.10)',
        fab: '0 6px 20px rgba(13,138,122,0.28)',
        focus: '0 0 0 3px rgba(13,138,122,0.15)',
      },
    },
  },
  plugins: [],
};
