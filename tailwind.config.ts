import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#0f4c5c",
          dark: "#0a3540",
          light: "#5f8c97",
        },
        pacific: {
          dark: "#112732",
          mid: "#9AA8B6",
          light: "#DAE1E8",
        },
      },
    },
  },
  plugins: [],
};

export default config;
