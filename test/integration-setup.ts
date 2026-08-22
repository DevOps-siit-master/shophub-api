// Runs via jest `setupFiles`, before the test module and its hoisted ESM
// imports are evaluated — so the env is populated before AppModule's
// ConfigModule validates it on import. Locally a gitignored .env supplies this;
// in CI there is no .env, so this is the only source of JWT_ACCESS_SECRET.
process.env.JWT_ACCESS_SECRET ||= 'integration-secret';
