import { LogEntry } from '../types';

export default function Logs({ logs, onClear }: { logs: LogEntry[], onClear: () => void }) {
  // Mock logs if empty
  const displayLogs = logs.length > 0 ? logs : [
    { id: '1', timestamp: Date.now(), type: 'info', module: '扫描', message: 'Stage 0 完成，筛选出 150 个币种，耗时 1240ms' },
    { id: '2', timestamp: Date.now() - 5000, type: 'success', module: '系统', message: 'WebSocket 连接已建立' },
    { id: '3', timestamp: Date.now() - 10000, type: 'info', module: '扫描', message: '开始 Stage 0P 波动率过滤...' },
    { id: '4', timestamp: Date.now() - 15000, type: 'warning', module: '账户', message: '可用余额低于 1000 USDT' },
    { id: '5', timestamp: Date.now() - 20000, type: 'error', module: 'API', message: '获取 K 线数据失败: SOLUSDT (Timeout)' },
  ];

  const formatTime = (ts: number) => {
    const d = new Date(ts + 8 * 3600 * 1000);
    const h = d.getUTCHours().toString().padStart(2, '0');
    const m = d.getUTCMinutes().toString().padStart(2, '0');
    const s = d.getUTCSeconds().toString().padStart(2, '0');
    const ms = (ts % 1000).toString().padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-black text-slate-900 tracking-tight">系统日志</h2>
        <div className="flex gap-3">
          <button 
            onClick={onClear}
            className="px-4 py-2 bg-slate-100 text-slate-600 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-slate-200 border border-slate-200"
          >
            清除日志
          </button>
          <button className="px-4 py-2 bg-slate-100 text-slate-600 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-slate-200 border border-slate-200">导出 CSV</button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-[2rem] overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 bg-slate-50/50">
                <th className="px-8 py-5 w-48">时间</th>
                <th className="px-8 py-5 w-32">模块</th>
                <th className="px-8 py-5 w-24">级别</th>
                <th className="px-8 py-5">消息内容</th>
              </tr>
            </thead>
            <tbody className="font-mono text-sm divide-y divide-slate-50">
              {displayLogs.map(log => (
                <tr key={log.id} className="hover:bg-slate-50/50 group">
                  <td className="px-8 py-4 text-slate-400 font-medium">{formatTime(log.timestamp)}</td>
                  <td className="px-8 py-4">
                    <div className="flex flex-wrap gap-2 items-center">
                      {log.module.includes('[') && log.module.includes(']') ? (
                        <>
                          <span className="bg-slate-900 text-white text-[9px] font-black px-2 py-0.5 rounded-md shadow-sm">
                            {log.module.match(/\[(.*?)\]/)?.[1] || log.module}
                          </span>
                          <span className="text-slate-500 font-bold text-[10px] uppercase tracking-widest px-1">
                            {log.module.split(']').slice(1).join(']').trim()}
                          </span>
                        </>
                      ) : (
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest ${
                          log.module === '系统' ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' :
                          log.module === '扫描' ? 'bg-blue-50 text-blue-600 border border-blue-100' :
                          log.module === '订单' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                          'bg-slate-100 text-slate-500 border border-slate-200'
                        }`}>
                          {log.module}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-8 py-4">
                    <span className={`font-black uppercase text-[10px] tracking-widest ${
                      log.type === 'success' ? 'text-emerald-600' :
                      log.type === 'warning' ? 'text-orange-600' :
                      log.type === 'error' ? 'text-red-600' :
                      'text-blue-600'
                    }`}>
                      {log.type}
                    </span>
                  </td>
                  <td className="px-8 py-4 text-slate-700 font-medium group-hover:text-slate-900">{log.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
