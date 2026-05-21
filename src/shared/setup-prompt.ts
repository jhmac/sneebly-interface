export function buildSetupPrompt(projectName: string): string {
  return `This project's preview isn't running. Set it up to run locally on the user's Mac.

Steps:
1. Read SETUP.md, README.md, package.json, .env.example, drizzle.config.ts, docker-compose.yml, and any other setup-related files that exist. Skip ones that don't exist; don't error.
   Also check the parent directory (\`../\`) for context files: \`../SETUP.md\`, \`../README.md\`, \`../PHASE1-REPORT.md\`, \`../GOALS.md\`. These exist when this folder is a sub-directory of a wrapper (like Sneebly-V3's projects/<name>/artifacts/ pattern). If they don't exist there, ignore them — don't error.
2. Identify what's needed: language runtime, dependencies, databases (Postgres/MySQL/SQLite/MongoDB/Redis), environment variables, migrations, seed data.
3. Install missing system dependencies via Homebrew when needed (postgres, redis, etc.). Use \`brew install\` and \`brew services start\` as appropriate. If Homebrew is missing, install it first.
4. Run \`npm install\` (or the equivalent for the detected package manager: pnpm, yarn, bun).
5. Create a .env file from .env.example if one doesn't exist. Fill in values you can determine locally (DATABASE_URL pointing at local Postgres, NODE_ENV, etc.). For values you CANNOT determine — API keys, OAuth credentials, third-party service tokens — STOP and write a message asking the user to paste them in chat. Use placeholder values only as a last resort and call them out.
6. Run any database migrations (e.g. \`npm run db:push\`, \`drizzle-kit push\`, prisma migrate, etc.).
7. Verify the dev command starts cleanly: run it briefly (timeout ~10 seconds) and check for the localhost URL output. Don't leave it running long-term — Sneebly will restart the dev server itself once you're done.
8. End your reply with exactly this marker on its own line so Sneebly knows you're done: SETUP_COMPLETE

If anything blocks you that requires the user's input (API keys, account credentials, choices between options), pause and write a message asking — DO NOT end with SETUP_COMPLETE until everything is actually ready.

Project: ${projectName}`
}
