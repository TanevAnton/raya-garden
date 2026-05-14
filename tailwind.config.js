/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0a0908",
          900: "#100e0c",
          800: "#1a1714",
          700: "#241f1a",
        },
        gold: {
          50: "#fbf6e9",
          100: "#f2e6c0",
          200: "#e6d295",
          300: "#d7b85f",
          400: "#c69b3b",
          500: "#a87f28",
          600: "#8a661c",
        },
        sage: {
          50: "#f1f4ef",
          100: "#dde4d7",
          200: "#b8c5ab",
          300: "#8fa17f",
          400: "#6c8159",
          500: "#506542",
          600: "#3d4e32",
        },
        cream: {
          50: "#faf7f0",
          100: "#f3ecdb",
          200: "#e6d8b8",
        },
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', "Georgia", "serif"],
        serif: ['"Cormorant Garamond"', "Georgia", "serif"],
        sans: ['"Inter"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
      letterSpacing: {
        widest: "0.3em",
        "ultra-wide": "0.5em",
      },
      animation: {
        "fade-up": "fadeUp 1.2s cubic-bezier(0.22, 1, 0.36, 1) both",
        "fade-in": "fadeIn 1.5s ease-out both",
        "slow-zoom": "slowZoom 20s ease-out infinite alternate",
        "shimmer": "shimmer 2s linear infinite",
        "scroll-hint": "scrollHint 2s ease-in-out infinite",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(40px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slowZoom: {
          "0%": { transform: "scale(1.05)" },
          "100%": { transform: "scale(1.15)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        scrollHint: {
          "0%, 100%": { transform: "translateY(0)", opacity: "0.4" },
          "50%": { transform: "translateY(8px)", opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};
