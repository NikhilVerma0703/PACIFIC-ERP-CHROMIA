import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // `brand` keeps DEFAULT/dark/light exactly as they were — every existing
        // `bg-brand`, `text-brand`, `bg-brand-dark` is untouched. The numeric
        // ramp is added for the Chromia module, which was written against a
        // 50-900 scale: the shades are Pacific teal, not the module's original
        // blue, so its screens read as part of this ERP rather than as a guest.
        brand: {
          DEFAULT: "#0f4c5c",
          dark: "#0a3540",
          light: "#5f8c97",
          50: "#eef5f7",
          100: "#d7e8ec",
          200: "#b0d1d9",
          300: "#7fb3bf",
          400: "#4b8fa0",
          500: "#1f6d80",
          600: "#0f4c5c",
          700: "#0d4150",
          800: "#0a3540",
          900: "#07262e",
        },
        pacific: {
          dark: "#112732",
          mid: "#9AA8B6",
          light: "#DAE1E8",
        },
        // Chromia's reserved status palette — one colour per slab outcome, never
        // reused for decoration. `active` is the brand teal so "in progress"
        // matches the rest of the ERP; the other five keep their meanings.
        status: {
          pending: "#94a3b8",
          active: "#1f6d80",
          done: "#16a34a",
          hold: "#d97706",
          recalibration: "#9333ea",
          waste: "#dc2626",
        },
      },
      borderRadius: {
        card: "0.625rem",
      },
    },
  },
  plugins: [],
};

export default config;
