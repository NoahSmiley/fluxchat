import { defineConfig, devices } from "@playwright/test";

const API_PORT = process.env.CI ? "3001" : "3002";
const VITE_PORT = process.env.CI ? "1420" : "1421";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  use: {
    baseURL: `http://127.0.0.1:${VITE_PORT}`,
    trace: "on",
    screenshot: "on",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: "cargo run -p flux-server",
      port: Number(API_PORT),
      timeout: 120 * 1000,
      reuseExistingServer: !process.env.CI,
      env: {
        BETTER_AUTH_SECRET: "e2e-test-secret",
        DATABASE_PATH: `./test-e2e-${Date.now()}.db`,
        PORT: API_PORT,
      },
    },
    {
      command: `VITE_SERVER_URL= API_PORT=${API_PORT} npx vite --port ${VITE_PORT}`,
      port: Number(VITE_PORT),
      timeout: 30 * 1000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
