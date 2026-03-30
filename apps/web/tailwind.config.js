/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"DM Sans"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
      colors: {
        brand: {
          50: "#f5f5ff",
          100: "#ebebff",
          200: "#d4d4ff",
          300: "#b1b1f0",
          400: "#8f8fdb",
          500: "#7272c7",
          600: "#5b5bd6",
          700: "#5050c0",
          800: "#4343a8",
          900: "#363690",
          950: "#24245e",
        },
        accent: {
          50: "#fffbeb",
          100: "#fef3c7",
          200: "#fde68a",
          300: "#fcd34d",
          400: "#fbbf24",
          500: "#f59e0b",
          600: "#d97706",
          700: "#b45309",
        },
        surface: {
          0: "var(--surface-0)",
          1: "var(--surface-1)",
          2: "var(--surface-2)",
          3: "var(--surface-3)",
        },
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          tertiary: "var(--text-tertiary)",
        },
        border: {
          DEFAULT: "var(--border-color)",
          light: "var(--border-light)",
        },
      },
      borderRadius: {
        DEFAULT: "0.5rem",
      },
      boxShadow: {
        card: "0 1px 3px 0 rgb(0 0 0 / 0.04), 0 1px 2px -1px rgb(0 0 0 / 0.04)",
        elevated: "0 4px 6px -1px rgb(0 0 0 / 0.06), 0 2px 4px -2px rgb(0 0 0 / 0.04)",
        modal: "0 25px 50px -12px rgb(0 0 0 / 0.15), 0 0 0 1px rgb(0 0 0 / 0.05)",
        dropdown: "0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.04)",
        toast: "0 8px 16px -4px rgb(0 0 0 / 0.08), 0 4px 8px -4px rgb(0 0 0 / 0.04)",
      },
      keyframes: {
        "slide-in-right": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "toast-in": {
          from: { opacity: "0", transform: "translateX(100%)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "shortcut-flash": {
          "0%": { opacity: "0", transform: "translateX(-50%) translateY(8px) scale(0.95)" },
          "15%": { opacity: "1", transform: "translateX(-50%) translateY(0) scale(1)" },
          "75%": { opacity: "1", transform: "translateX(-50%) translateY(0) scale(1)" },
          "100%": { opacity: "0", transform: "translateX(-50%) translateY(-4px) scale(0.98)" },
        },
        "milestone-enter": {
          from: { opacity: "0", transform: "translateY(-6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "check-draw": {
          from: { strokeDashoffset: "20", opacity: "0" },
          to: { strokeDashoffset: "0", opacity: "1" },
        },
      },
      animation: {
        "slide-in": "slide-in-right 0.3s ease-out",
        "fade-in": "fade-in 0.2s ease-out",
        "scale-in": "scale-in 0.2s ease-out",
        "toast-in": "toast-in 0.3s ease-out",
        "shortcut-flash": "shortcut-flash 1.2s ease-out forwards",
        "milestone-enter": "milestone-enter 0.35s ease-out both",
        "check-draw": "check-draw 0.4s ease-out both",
      },
    },
  },
  plugins: [],
};
