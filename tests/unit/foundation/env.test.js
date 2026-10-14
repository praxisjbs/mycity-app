"use strict";
const { parseEnv, DEV_SECRETS } = require("../../../src/config/env");

const SERVER = {
  APP_ENV: "production",
  NODE_ENV: "production",
  DB_NAME: "mycity_prod",
  DB_PASSWORD: "a-real-password",
  REDIS_URL: "redis://127.0.0.1:6379/0",
  STAFF_ORIGIN: "https://hub.mycityapp.io",
  PUBLIC_ORIGIN: "https://go.mycityapp.io",
  JWT_ACCESS_SECRET: "a".repeat(40),
  JWT_REFRESH_SECRET: "b".repeat(40),
  ENCRYPTION_KEY: "ab".repeat(32),
  SMTP_HOST: "smtp.mycityapp.io",
};

describe("config/env parseEnv", () => {
  test("a server must really send mail, from a real address", () => {
    expect(parseEnv({ ...SERVER, SMTP_HOST: "" }).problems).toContain("SMTP_HOST is required on production (A4: system mail is really sent)");
    expect(parseEnv({ ...SERVER, MAIL_FROM: "MyCity" }).problems).toContain("MAIL_FROM must be an address, or Name <address>");
  });

  test("a laptop boots with nothing set, on development secrets", () => {
    const { config, problems } = parseEnv({});
    expect(problems).toEqual([]);
    expect(config.APP_ENV).toBe("development");
    expect(config.JWT_ACCESS_SECRET).toBe(DEV_SECRETS.JWT_ACCESS_SECRET);
    expect(config.PORT).toBe(8080);
  });

  test("a correct production environment passes", () => {
    expect(parseEnv(SERVER).problems).toEqual([]);
  });

  test("production refuses missing secrets instead of falling back to the development ones", () => {
    const { problems } = parseEnv({ ...SERVER, JWT_ACCESS_SECRET: "", ENCRYPTION_KEY: "" });
    expect(problems).toEqual(expect.arrayContaining([
      "JWT_ACCESS_SECRET is required",
      "ENCRYPTION_KEY must be 64 hex characters",
    ]));
  });

  test("production refuses the development values even when set explicitly", () => {
    const { problems } = parseEnv({ ...SERVER, ...DEV_SECRETS });
    expect(problems.join("\n")).toMatch(/JWT_ACCESS_SECRET is the development value/);
    expect(problems.join("\n")).toMatch(/ENCRYPTION_KEY is the development value/);
  });

  test("staging pointed at the production database or Redis db is refused", () => {
    const { problems } = parseEnv({ ...SERVER, APP_ENV: "staging" });
    expect(problems).toEqual(expect.arrayContaining([
      "DB_NAME must be mycity_stg on staging (is mycity_prod)",
      "REDIS_URL must select db 1 on staging",
    ]));
  });

  test("servers need https origins, NODE_ENV production and identical secrets refused", () => {
    const { problems } = parseEnv({
      ...SERVER,
      NODE_ENV: "development",
      STAFF_ORIGIN: "http://hub.mycityapp.io",
      JWT_REFRESH_SECRET: SERVER.JWT_ACCESS_SECRET,
    });
    expect(problems).toEqual(expect.arrayContaining([
      "NODE_ENV must be production on production",
      "STAFF_ORIGIN must be https on production",
      "JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ",
    ]));
  });

  test("a value that is a leftover comment is treated as empty and reported", () => {
    const { config, misparsed } = parseEnv({ ALERT_WEBHOOK_URL: "   # e.g. https://hooks.example" });
    expect(misparsed).toEqual(["ALERT_WEBHOOK_URL"]);
    expect(config.ALERT_WEBHOOK_URL).toBe("");
  });

  test("DATABASE_URL wins over the DB_* values", () => {
    const { config } = parseEnv({ DATABASE_URL: "postgres://u:p%40ss@db.local:6543/mycity_ci", DB_HOST: "ignored" });
    expect(config).toMatchObject({ DB_HOST: "db.local", DB_PORT: 6543, DB_NAME: "mycity_ci", DB_USER: "u", DB_PASSWORD: "p@ss" });
  });

  test("a bad number is a problem, not a NaN", () => {
    const { config, problems } = parseEnv({ PORT: "eighty" });
    expect(config).toBeNull();
    expect(problems[0]).toMatch(/^PORT:/);
  });

  test("development extra origins are dropped on servers", () => {
    const { config } = parseEnv({ ...SERVER, DEV_EXTRA_ORIGINS: "http://evil.example" });
    expect(config.DEV_EXTRA_ORIGINS).toBe("");
  });
});
