import { readFile } from 'node:fs/promises';

const status = JSON.parse(await readFile('plans/PROJECT_STATUS.json', 'utf8'));
console.log(`Plan: ${status.activePlan}`);
console.log(`Updated: ${status.updatedAt}`);
console.log(`Active work: ${status.activeWork.status} (${status.activeWork.owner})`);
console.log('\nTracks:');
for (const [name, state] of Object.entries(status.tracks)) console.log(`- ${name}: ${state}`);
console.log('\nNext:');
for (const item of status.lastHandoff.next) console.log(`- ${item}`);
