import type { Snapshot } from '../../platform/projectTasks';
export function TaskServiceNotice({ snapshot, base }: { snapshot: Snapshot | null; base: string }) {
  const queue = snapshot?.capabilities?.queue === true;
  const acceptance = snapshot?.capabilities?.acceptance === true;
  return <details className="tb-service-note" open={!queue || !acceptance}>
    <summary>服务能力：直接任务队列{queue ? '已启用' : '未启用（旧服务）'} · 独立验收{acceptance ? '已启用' : '未启用'}</summary>
    <p>当前连接：{base}。安装新版不会自动停止旧服务；任务发布后直接进入队列，执行 Agent 可原子领取，不存在方案审批闸门。</p>
    {(!queue || !acceptance) && <div role="status">
      <strong>需要受控升级任务服务，不能仅更新前端。</strong>
      <ol>
        <li>先让所有执行 Agent 停止写入，并记录项目身份、任务和附件。</li>
        <li>由项目所有者确认旧服务进程及共享网关的归属；经授权停止相应服务后备份完整私有数据目录（含数据库、WAL/SHM及附件），不要只复制主数据库。</li>
        <li>使用新版本重新打开同一项目；核对项目身份、任务、附件与原会话，确认直接队列能力已启用再恢复工作。</li>
        <li>升级失败时保留当前数据，按备份和版本配对评估恢复；不要删除数据库或盲目覆盖升级后新增记录。</li>
      </ol>
      <p>本界面不杀进程、不直接迁移正在使用的任务库。需要帮助时把此服务地址和能力状态交给负责升级的 Agent；不要发送连接凭据。</p>
    </div>}
  </details>;
}
