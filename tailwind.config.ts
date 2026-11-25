import type { Config } from "tailwindcss";

// The old cool utility palette is remapped to the Cozy Luxury Futurism system so
// every existing page inherits warm graphite, ivory and champagne tones without
// requiring page-by-page colour rewrites.
const champagne: Record<string, string> = {
  50: "#FBF7ED",
  100: "#F5EBD5",
  200: "#EAD9B5",
  300: "#E0C89A",
  400: "#D6B779",
  500: "#C4A46F",
  600: "#A48655",
  700: "#806744",
  800: "#59482F",
  900: "#332A1D",
  950: "#1B1710",
};

const graphite: Record<string, string> = {
  50: "#F7F4EE",
  100: "#F4F0E8",
  200: "#D8D5CE",
  300: "#BDB6AA",
  400: "#A9A29A",
  500: "#8C857C",
  600: "#6F6A63",
  700: "#4B4843",
  800: "#302E2B",
  900: "#1B1B1B",
  950: "#101010",
};

const bronze: Record<string, string> = {
  50: "#F8F4EA",
  100: "#F0E5D0",
  200: "#DFCBA7",
  300: "#D1B789",
  400: "#BFA96F",
  500: "#A89159",
  600: "#8A7448",
  700: "#6B5938",
  800: "#4B3E29",
  900: "#2E261B",
  950: "#1B1710",
};

const terracotta: Record<string, string> = {
  50: "#F9EEEA",
  100: "#F1DCD5",
  200: "#E2BDB1",
  300: "#C48A7C",
  400: "#B9786C",
  500: "#A8675B",
  600: "#8A5147",
  700: "#6B3F37",
  800: "#4A2D28",
  900: "#2E1C19",
  950: "#1B100E",
};

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        black: "#101010",
        white: "#F4F0E8",
        obsidian: "#101010",
        graphite: "#1B1B1B",
        charcoal: "#242321",
        champagne: "#D6B779",
        bronze: "#806744",
        ivory: "#F4F0E8",
        platinum: "#D8D5CE",
        slate: graphite,
        gray: graphite,
        zinc: graphite,
        neutral: graphite,
        stone: graphite,
        cyan: champagne,
        teal: champagne,
        sky: champagne,
        blue: champagne,
        indigo: champagne,
        amber: champagne,
        yellow: champagne,
        orange: champagne,
        green: bronze,
        emerald: bronze,
        lime: bronze,
        violet: bronze,
        purple: bronze,
        fuchsia: bronze,
        pink: terracotta,
        rose: terracotta,
        red: terracotta,
        ink: graphite,
        accent: {
          cyan: "#D6B779",
          blue: "#C4A46F",
          green: "#BFA96F",
          amber: "#E8CF9B",
          red: "#C48A7C",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Manrope", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Sora", "Manrope", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      borderColor: {
        DEFAULT: "rgba(214, 183, 121, 0.16)",
      },
      boxShadow: {
        luxe: "0 18px 46px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(244, 240, 232, 0.045)",
        "luxe-soft": "0 8px 24px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(244, 240, 232, 0.035)",
      },
      borderRadius: {
        luxe: "0.7rem",
      },
    },
  },
  plugins: [],
};

export default config;
