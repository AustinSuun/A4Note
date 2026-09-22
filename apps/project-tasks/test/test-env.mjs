// Child-process environment for tests that spawn the real CLI, MCP stdio server or gateway.
//
// AGENTS.md tells every agent shell on a developer machine to export TASKS_PROJECT_ROOT and
// TASKS_EXPECTED_PROJECT_ID for the production board. lib/agent-client.mjs deliberately trusts
// TASKS_EXPECTED_PROJECT_ID over the on-disk access.json, so a test that inherits the shell
// environment makes the spawned CLI compare its throwaway server against the production project
// and fail with 「看板服务身份不匹配」. Start from a copy of process.env with every TASKS_* variable
// removed, then apply only what the test sets explicitly. `undefined` deletes a key.
export function testEnv(overrides = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.toUpperCase().startsWith('TASKS_')) env[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = String(value);
  }
  return env;
}
