import { defineConfig, devices } from '@playwright/test';

// Local (por defecto): levanta el servidor con datos temporales y prueba todo.
// Producción (PROD=1): solo pruebas de lectura contra https://carrusel.etziel.com.
const PROD = process.env.PROD === '1';
const PORT = 3210;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1, // un solo servidor con estado compartido
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    reducedMotion: 'reduce', // el carrusel pausa el autoplay => capturas estables
  },
  webServer: PROD
    ? undefined
    : {
        command: 'node tests/serve.mjs',
        url: `http://localhost:${PORT}/admin`,
        reuseExistingServer: false,
        timeout: 60_000,
        env: { PORT: String(PORT) },
      },
  projects: PROD
    ? [
        {
          name: 'prod',
          testMatch: /prod\.readonly\.spec\.js/,
          use: { ...devices['Desktop Chrome'], baseURL: 'https://carrusel.etziel.com', viewport: { width: 1920, height: 1080 } },
        },
      ]
    : [
        { name: 'tv-horizontal', testIgnore: /prod\.readonly/, use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } } },
        { name: 'tv-vertical', testMatch: /carousel\.spec\.js/, use: { ...devices['Desktop Chrome'], viewport: { width: 1080, height: 1920 } } },
        { name: 'movil', testMatch: /carousel\.spec\.js/, use: { ...devices['Pixel 7'] } },
      ],
});
