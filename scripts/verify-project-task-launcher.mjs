import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {withProjectTasksDefaultOff} from '../src/platform/projectTasksPreference.ts';
const memory=(initial={})=>{const values=new Map(Object.entries(initial));return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)}};
assert.deepEqual(withProjectTasksDefaultOff(['ai.core'],memory()),['ai.core','tasks.core']);
assert.deepEqual(withProjectTasksDefaultOff([],memory({'aster.uiState':'{"visibleSceneIds":["overview","markdown"]}'})),['tasks.core']);
assert.deepEqual(withProjectTasksDefaultOff([],memory({'aster.uiState':'{"visibleSceneIds":["tasks"]}'})),[]);
assert.deepEqual(withProjectTasksDefaultOff(['ai.core'],memory({'aster.tasks-opt-in-v1':'1'})),['ai.core']);
assert.deepEqual(withProjectTasksDefaultOff([],memory({'aster.uiState':'{broken'})),['tasks.core']);
assert.deepEqual(withProjectTasksDefaultOff([],{getItem(){throw Error('denied')},setItem(){throw Error('denied')}}),['tasks.core']);
const store=memory();assert.deepEqual(withProjectTasksDefaultOff([],store),['tasks.core']);assert.deepEqual(withProjectTasksDefaultOff([],store),[],'explicit enable after migration survives');
const source=p=>readFileSync(p,'utf8');
assert.match(source('src/core/taskBoardPlugin.ts'),/enabledByDefault: false/);
assert.match(source('src/ui/App.tsx'),/withProjectTasksDefaultOff\(loadDisabledPluginIds\(\)\)/);
assert.match(source('src-tauri/src/lib.rs'),/project_tasks::start_project_tasks/);
assert.doesNotMatch(source('src-tauri/src/lib.rs').split('.invoke_handler')[0],/start_project_tasks\(/,'must not auto-launch during setup');
const config=JSON.parse(source('src-tauri/tauri.conf.json'));
for(const p of ['bootstrap.mjs','lib/project-onboarding.mjs','server.mjs','lib/store.mjs','lib/agent-client.mjs','cli.mjs','mcp.mjs','gateway.mjs','gateway-bootstrap.mjs','gateway-lifecycle.mjs']){assert.equal(config.bundle.resources['../apps/project-tasks/'+p],'project-tasks/'+p);assert.ok(existsSync('apps/project-tasks/'+p));}
assert.match(source('src-tauri/src/project_tasks.rs'),/resource_dir\.join\("project-tasks\/bootstrap.mjs"\)/);
// Exit-time lifecycle: bounded, identity-checked stop wired through the close event and the final exit hook only.
assert.match(source('src-tauri/src/project_tasks.rs'),/resource_dir\(\)[\s\S]*join\("project-tasks\/gateway-lifecycle.mjs"\)/);
for(const command of ['inspect_project_tasks','stop_project_tasks','set_project_tasks_exit_policy','resolve_app_exit'])assert.match(source('src-tauri/src/lib.rs'),new RegExp('project_tasks::'+command));
assert.match(source('src-tauri/src/lib.rs'),/\.on_window_event\(project_tasks::on_window_event\)/);
assert.match(source('src-tauri/src/lib.rs'),/RunEvent::Exit\)[\s\S]*project_tasks::shutdown_on_exit\(app\)/);
assert.doesNotMatch(source('src-tauri/src/lib.rs').split('.invoke_handler')[0],/stop_project_tasks\(|shutdown_on_exit\(/,'must not stop services during setup');
const capability=JSON.parse(source('src-tauri/capabilities/default.json'));
for(const permission of ['dialog:allow-ask','dialog:allow-message'])assert.ok(capability.permissions.includes(permission),'exit prompt needs '+permission);
assert.match(source('src/platform/projectTaskLauncher.ts'),/await installTaskServiceExitHandler\(\)/,'exit listener must be installed before the native launch');
assert.match(source('src/features/taskboard/TaskBoard.tsx'),/<TaskServiceControls connected=\{!!client\} \/>/);
assert.match(source('apps/project-tasks/README.md'),/关闭软件时保留后台服务/);
for (const [sourcePath, destination] of Object.entries(config.bundle.resources)) {
  if (!destination.startsWith('project-tasks/') || !sourcePath.endsWith('.mjs')) continue;
  const relative = path.posix.normalize(sourcePath.replace(/^\.\.\//, ''));
  for (const match of source(relative).matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+\.mjs)['"]/g)) {
    const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1]));
    assert.ok(config.bundle.resources['../'+dependency], 'Missing packaged dependency: '+relative+' -> '+dependency);
  }
}
console.log('Project task launcher and complete local module dependency packaging verified');
assert.match(source('src-tauri/src/project_tasks.rs'), /command\.arg\(node_path::for_node\(&bootstrap\)\)/, 'normalize installed resource path at the actual Node boundary');
assert.match(source('src/features/taskboard/TaskBoard.tsx'), /打开项目文件夹并启动看板/);
assert.match(source('src/features/taskboard/TaskBoard.tsx'), /供 Agent 连接、领取任务和更新进度/);
assert.match(source('src-tauri/src/project_tasks.rs'), /arg\("--register-project"\)/);
