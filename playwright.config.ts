import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  use: {
    baseURL: "http://127.0.0.1:1420",
    trace: "on",
    screenshot: "on",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: "cargo run -p flux-server",
      port: 3001,
      timeout: 120 * 1000,
      reuseExistingServer: !process.env.CI,
      env: {
        BETTER_AUTH_SECRET: "e2e-test-secret",
        DATABASE_PATH: `./test-e2e-${Date.now()}.db`,
        PORT: "3001",
      },
    },
    {
      command: "npx vite --port 1420",
      port: 1420,
      timeout: 30 * 1000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
