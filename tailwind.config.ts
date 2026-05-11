import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#e8dfd0",
        bgDeep: "#d4c9b6",
        ink: "#2d251c",
        inkSoft: "#5a4b3a",
        rose: "#c08c83",
        sage: "#92a48a",
        gold: "#b88752",
        paper: "#f0e7d6",
      },
      fontFamily: {
        sans: ['"Inter"', "ui-sans-serif", "system-ui"],
        serif: ['"Fraunces"', '"Cormorant Garamond"', "ui-serif", "serif"],
        book: ['"Cormorant Garamond"', '"Fraunces"', "ui-serif", "serif"],
      },
    },
  },
};
export default config;
