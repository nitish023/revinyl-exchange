import { defineConfig } from 'vitest/config';

// Three groups of tests:
//   unit        shared/ and server/ logic, no database        (npm test)
//   client      browser code, run in a fake DOM (happy-dom)  (npm test)
//   integration the real API against a Postgres test database (npm run test:integration)
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['shared/**/*.test.js', 'server/src/**/*.test.js'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'client',
          include: ['client/src/**/*.test.js'],
          environment: 'happy-dom',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['server/test/**/*.int.test.js'],
          environment: 'node',
          globalSetup: ['server/test/globalSetup.js'],
          fileParallelism: false,
        },
      },
    ],
  },
});
