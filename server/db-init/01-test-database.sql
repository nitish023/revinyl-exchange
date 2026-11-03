-- Runs once when the Docker volume is first created: a separate database for tests,
-- so `npm run test:integration` never touches your development data.
CREATE DATABASE revinyl_test OWNER revinyl;
