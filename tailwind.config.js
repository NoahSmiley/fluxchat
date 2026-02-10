/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--sc-border))",
        input: "hsl(var(--sc-input))",
        ring: "hsl(var(--sc-ring))",
        background: "hsl(var(--sc-background))",
        foreground: "hsl(var(--sc-foreground))",
        primary: {
          DEFAULT: "hsl(var(--sc-primary))",
          foreground: "hsl(var(--sc-primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--sc-secondary))",
          foreground: "hsl(var(--sc-secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--sc-destructive))",
          foreground: "hsl(var(--sc-destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--sc-muted))",
          foreground: "hsl(var(--sc-muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--sc-accent))",
          foreground: "hsl(var(--sc-accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--sc-popover))",
          foreground: "hsl(var(--sc-popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--sc-card))",
          foreground: "hsl(var(--sc-card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  corePlugins: {
    preflight: false,
  },
  plugins: [],
};
