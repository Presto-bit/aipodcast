/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      spacing: {
        "dawn-1": "var(--dawn-space-1)",
        "dawn-2": "var(--dawn-space-2)",
        "dawn-3": "var(--dawn-space-3)",
        "dawn-4": "var(--dawn-space-4)",
        "dawn-5": "var(--dawn-space-5)",
        "dawn-6": "var(--dawn-space-6)",
        "dawn-card": "var(--dawn-space-card)",
        "dawn-section": "var(--dawn-space-section)"
      },
      borderRadius: {
        /** 与 globals.css --dawn-radius-* 一致，避免 rounded-lg 与 dawn-lg 语义漂移 */
        sm: "var(--dawn-radius-sm)",
        md: "var(--dawn-radius-md)",
        lg: "var(--dawn-radius-lg)",
        xl: "var(--dawn-radius-xl)",
        "2xl": "var(--dawn-radius-2xl)",
        full: "var(--dawn-radius-full)",
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
        onStrong: "var(--dawn-on-strong)",
        /** 链接、选中态、信息强调；主行动按钮用 cta */
        brand: {
          DEFAULT: "var(--dawn-brand)",
          foreground: "var(--dawn-on-strong)"
        },
        mint: {
          DEFAULT: "var(--dawn-mint)",
          foreground: "var(--dawn-on-strong)"
        },
        /** 每屏/每表单唯一主按钮（提交、核心转化） */
        cta: {
          DEFAULT: "var(--dawn-cta)",
          foreground: "var(--dawn-on-strong)"
        },
        danger: {
          DEFAULT: "var(--dawn-danger)",
          soft: "var(--dawn-danger-soft)",
          ink: "var(--dawn-danger-ink)"
        },
        success: {
          DEFAULT: "var(--dawn-mint)",
          soft: "var(--dawn-success-soft)",
          ink: "var(--dawn-success-ink)",
          foreground: "var(--dawn-on-strong)"
        },
        warning: {
          DEFAULT: "var(--dawn-warning)",
          soft: "var(--dawn-warning-soft)",
          ink: "var(--dawn-warning-ink)"
        },
        info: {
          DEFAULT: "var(--dawn-info)",
          soft: "var(--dawn-info-soft)",
          ink: "var(--dawn-info-ink)"
        }
      },
      boxShadow: {
        soft: "var(--dawn-shadow-soft)",
        card: "var(--dawn-shadow-card)",
        modal: "var(--dawn-shadow-modal)",
        "inset-brand": "var(--dawn-shadow-inset-brand)",
        /** @deprecated 使用 shadow-soft / shadow-card */
        "card-sm": "var(--dawn-shadow-soft)"
      }
    }
  },
  plugins: []
};
