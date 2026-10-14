-- Separate database for the integration (e2e) tests, so they never touch dev data.
-- Runs only when the Postgres volume is initialised for the first time.
CREATE DATABASE mini_oms_test;
