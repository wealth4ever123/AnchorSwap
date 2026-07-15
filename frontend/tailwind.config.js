/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      colors: {
        anchor: {
          50: "#f0f4ff",
          100: "#e0e9ff",
          400: "#6c8cff",
          500: "#4d72ff",
          600: "#3355e8",
          900: "#0f1a3d",
        },
        glass: {
          white: "rgba(255,255,255,0.08)",
          border: "rgba(255,255,255,0.12)",
        },
      },
      backdropBlur: {
        xs: "2px",
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
        "anchor-gradient":
          "linear-gradient(135deg, #0d1b4b 0%, #1a0a3d 40%, #0d2d5f 100%)",
      },
      boxShadow: {
        glass: "0 8px 32px rgba(0,0,0,0.37)",
        "glass-hover": "0 12px 40px rgba(77,114,255,0.25)",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4,0,0.6,1) infinite",
        shimmer: "shimmer 2s linear infinite",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
    },
  },
  plugins: [],
};
