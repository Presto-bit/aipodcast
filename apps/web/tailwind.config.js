/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      borderRadius: {
        dawn: "var(--dawn-radius-md)",
        "dawn-sm": "var(--dawn-radius-sm)",
        "dawn-lg": "var(--dawn-radius-lg)",
        "dawn-xl": "var(--dawn-radius-xl)"
      },
      colors: {
        /** 晨曦觉醒（Dawn）— 画布 / 表面 / 文本（随 html.light | html.dark 由 CSS 变量切换） */
        canvas: "var(--dawn-canvas)",
        surface: "var(--dawn-surface)",
        ink: "var(--dawn-ink)",
        muted: "var(--dawn-muted)",
        line: "var(--dawn-line)",
        fill: "var(--dawn-fill)",
        track: "var(--dawn-track)",
        brand: {
          DEFAULT: "var(--dawn-brand)",
          foreground: "#ffffff"
        },
        mint: "var(--dawn-mint)",
        cta: {
          DEFAULT: "var(--dawn-cta)",
          foreground: "#ffffff"
        },
        danger: {
          DEFAULT: "var(--dawn-danger)",
          soft: "var(--dawn-danger-soft)"
        }
      },
      boxShadow: {
        card: "0 8px 30px rgb(0 0 0 / 0.04)",
        "card-sm": "0 2px 12px rgb(0 0 0 / 0.05)"
      }
    }
  },
  plugins: []
};
