import React, { useState, useMemo, useEffect } from 'react';
import { LineChart as ChartIcon, Download, TrendingUp, ArrowLeftRight, Trash2, Calendar, Search, RefreshCw } from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  ReferenceLine,
  Label
} from 'recharts';

interface BalanceLog {
  id: string;
  totalBalance: number;
  timestamp: number;
}

interface TransferLog {
  id: string;
  asset: string;
  amount: number;
  type: 'IN' | 'OUT';
  status: 'SUCCESS' | 'FAILED';
  timestamp: number;
  message?: string;
}

export default function BalanceHistory({ 
  balanceLogs = [], 
  transferLogs = [],
  account,
  onClearTransfers,
  accountId
}: { 
  balanceLogs?: BalanceLog[], 
  transferLogs?: TransferLog[],
  account: any,
  onClearTransfers: () => void,
  accountId: string
}) {
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Balance Search State
  const [balanceStartTime, setBalanceStartTime] = useState('');
  const [balanceEndTime, setBalanceEndTime] = useState('');
  const [searchResults, setSearchResults] = useState<BalanceLog[] | null>(null);
  const [isSearchingBalance, setIsSearchingBalance] = useState(false);

  const totalBalance = account?.totalBalance || '0.00';

  // Default view: Last 24 hours
  const displayBalanceLogs = useMemo(() => {
    if (searchResults !== null) return searchResults;
    const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
    return balanceLogs.filter(log => log.timestamp >= twentyFourHoursAgo);
  }, [balanceLogs, searchResults]);

  const handleSearchBalance = async () => {
    if (!balanceStartTime || !balanceEndTime) {
      alert('请选择开始和结束时间');
      return;
    }
    setIsSearchingBalance(true);
    try {
      const start = new Date(balanceStartTime).getTime();
      const end = new Date(balanceEndTime).getTime();
      // For date range search, we use onlySnapshot=true to get 00:18 data
      const res = await fetch(`/api/balance-logs/search?startTime=${start}&endTime=${end}&onlySnapshot=true&accountId=${accountId}`);
      const data = await res.json();
      setSearchResults(data);
    } catch (err) {
      console.error('Search balance logs error:', err);
      alert('查询失败');
    } finally {
      setIsSearchingBalance(false);
    }
  };

  const resetBalanceSearch = () => {
    setSearchResults(null);
    setBalanceStartTime('');
    setBalanceEndTime('');
  };

  const filteredTransferLogs = useMemo(() => {
    return transferLogs.filter(log => {
      const matchesSearch = log.asset.toLowerCase().includes(searchTerm.toLowerCase()) || 
                           log.message?.toLowerCase().includes(searchTerm.toLowerCase());
      const logTime = log.timestamp;
      
      let matchesTime = true;
      if (startTime) {
        const start = new Date(startTime).getTime();
        if (logTime < start) matchesTime = false;
      }
      if (endTime) {
        const end = new Date(endTime).getTime();
        if (logTime > end) matchesTime = false;
      }
      
      return matchesSearch && matchesTime;
    });
  }, [transferLogs, searchTerm, startTime, endTime]);

  const formatMs = (ts: number) => {
    if (!ts || ts === 0) return '--';
    const date = new Date(ts + 8 * 3600 * 1000);
    return date.toISOString().replace('T', ' ').substring(0, 19);
  };

  const handleExportBalance = () => {
    if (displayBalanceLogs.length === 0) return;
    
    const headers = ['时间', '总余额(USDT)'];
    const rows = displayBalanceLogs.map(log => [
      new Date(log.timestamp).toLocaleString(),
      log.totalBalance.toFixed(2)
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');
    
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `balance_history_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadTransferCSV = () => {
    if (filteredTransferLogs.length === 0) return;
    
    const headers = ['ID', '资产', '数量', '类型', '状态', '时间', '备注'];
    const rows = filteredTransferLogs.map(log => [
      log.id,
      log.asset,
      log.amount,
      log.type === 'IN' ? '现货 -> 合约' : '合约 -> 现货',
      log.status === 'SUCCESS' ? '成功' : '失败',
      formatMs(log.timestamp),
      log.message || ''
    ]);
    
    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `transfer_logs_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const chartData = displayBalanceLogs.map(log => ({
    time: searchResults 
      ? new Date(log.timestamp).toLocaleDateString([], { month: '2-digit', day: '2-digit' })
      : new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    fullTime: new Date(log.timestamp).toLocaleString(),
    balance: parseFloat(log.totalBalance.toFixed(2)),
    timestamp: log.timestamp
  }));

  const minBalance = Math.min(...chartData.map(d => d.balance), parseFloat(totalBalance)) * 0.995;
  const maxBalance = Math.max(...chartData.map(d => d.balance), parseFloat(totalBalance)) * 1.005;

  // Relevant transfers for chart markers
  const chartStartTime = displayBalanceLogs.length > 0 ? displayBalanceLogs[0].timestamp : 0;
  const chartEndTime = displayBalanceLogs.length > 0 ? displayBalanceLogs[displayBalanceLogs.length - 1].timestamp : Date.now();
  const relevantTransfers = transferLogs.filter(t => 
    t.status === 'SUCCESS' && 
    t.timestamp >= chartStartTime && 
    t.timestamp <= chartEndTime
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      {/* 1. Balance Chart Section */}
      <div className="bg-white border border-slate-100 rounded-[2.5rem] p-8 shadow-sm">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-3">
              <ChartIcon className="text-blue-500" size={28} />
              账户总余额历史
            </h2>
            <p className="text-slate-500 text-sm font-medium mt-1">
              {searchResults ? '历史快照模式 (每日 00:18)' : '实时模式 (最近 24 小时)'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {searchResults && (
              <button 
                onClick={resetBalanceSearch}
                className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-slate-200 transition-all active:scale-95"
              >
                <RefreshCw size={14} />
                重置实时
              </button>
            )}
            <button 
              onClick={handleExportBalance}
              className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-blue-100 transition-all active:scale-95"
            >
              <Download size={14} />
              导出当前数据
            </button>
          </div>
        </div>

        {/* Balance Search Filters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">历史查询开始日期</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="date" 
                value={balanceStartTime}
                onChange={(e) => setBalanceStartTime(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">历史查询结束日期</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="date" 
                value={balanceEndTime}
                onChange={(e) => setBalanceEndTime(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
              />
            </div>
          </div>
          <div className="flex items-end">
            <button 
              onClick={handleSearchBalance}
              disabled={isSearchingBalance}
              className="w-full py-2 bg-slate-900 text-white rounded-xl font-black uppercase tracking-widest hover:bg-slate-800 shadow-lg transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSearchingBalance ? <RefreshCw className="animate-spin" size={16} /> : <Search size={16} />}
              查询历史快照
            </button>
          </div>
        </div>

        <div className="h-[400px] w-full mt-4">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="time" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }}
                  minTickGap={40}
                />
                <YAxis 
                  domain={[minBalance, maxBalance]} 
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }}
                  tickFormatter={(val) => `$${val.toLocaleString()}`}
                />
                <Tooltip 
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-white border border-slate-100 p-4 rounded-2xl shadow-2xl ring-1 ring-black/5">
                          <p className="text-[10px] font-black text-slate-400 uppercase mb-1">{payload[0].payload.fullTime}</p>
                          <p className="text-lg font-black text-blue-600">${payload[0].value.toLocaleString()}</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                
                {relevantTransfers.map((transfer) => {
                  const closestPoint = chartData.reduce((prev, curr) => 
                    Math.abs(curr.timestamp - transfer.timestamp) < Math.abs(prev.timestamp - transfer.timestamp) ? curr : prev
                  );
                  
                  return (
                    <ReferenceLine 
                      key={transfer.id}
                      x={closestPoint.time} 
                      stroke={transfer.type === 'IN' ? '#10b981' : '#ef4444'} 
                      strokeDasharray="3 3"
                      strokeWidth={2}
                    >
                      <Label 
                        value={transfer.type === 'IN' ? `+${transfer.amount}` : `-${transfer.amount}`} 
                        position="top" 
                        fill={transfer.type === 'IN' ? '#10b981' : '#ef4444'}
                        fontSize={10}
                        fontWeight="bold"
                      />
                    </ReferenceLine>
                  );
                })}

                <Area 
                  type="monotone" 
                  dataKey="balance" 
                  stroke="#3b82f6" 
                  strokeWidth={4}
                  fillOpacity={1} 
                  fill="url(#colorBalance)" 
                  animationDuration={1500}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-4">
              <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center">
                <ChartIcon size={32} className="text-slate-300" />
              </div>
              <p className="text-xs font-bold uppercase tracking-widest">等待记录第一条余额数据...</p>
            </div>
          )}
        </div>

        <div className="mt-8 flex items-center gap-6 px-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-0.5 bg-emerald-500 border-t border-dashed border-emerald-500" />
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">资金转入 (Spot {"->"} Futures)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-0.5 bg-red-500 border-t border-dashed border-red-500" />
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">资金转出 (Futures {"->"} Spot)</span>
          </div>
        </div>
      </div>

      {/* 2. Transfer Logs Section */}
      <div className="bg-white border border-slate-100 rounded-[2.5rem] p-8 shadow-sm space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-600/20">
              <ArrowLeftRight className="text-white" size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">资金划转日志</h2>
              <p className="text-slate-500 text-sm font-medium">记录系统自动执行的资金划转信息</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={downloadTransferCSV}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 font-bold text-xs uppercase tracking-widest transition-all"
            >
              <Download size={14} />
              导出划转日志
            </button>
            <button 
              onClick={() => {
                if (window.confirm('确定要清空所有资金划转日志吗？此操作不可撤销。')) {
                  onClearTransfers();
                }
              }}
              className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 border border-red-100 rounded-xl hover:bg-red-100 font-bold text-xs uppercase tracking-widest transition-all"
            >
              <Trash2 size={14} />
              清空日志
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">搜索资产/备注</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="text" 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="搜索..."
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all text-sm"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">开始时间</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="datetime-local" 
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all text-sm"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">结束时间</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="datetime-local" 
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all text-sm"
              />
            </div>
          </div>
          <div className="flex items-end">
            <div className="bg-purple-50 rounded-xl px-4 py-2 border border-purple-100 w-full text-center">
              <span className="text-[10px] font-black text-purple-400 uppercase tracking-widest block">筛选结果</span>
              <span className="text-lg font-black text-purple-700">{filteredTransferLogs.length} <span className="text-xs">条记录</span></span>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse table-fixed">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-200">
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest w-[210px]">时间</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest w-[80px]">资产</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest w-[110px]">数量</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest w-[140px]">类型</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest w-[90px]">状态</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">备注</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTransferLogs.length > 0 ? (
                  filteredTransferLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="text-sm font-bold text-slate-700 font-mono whitespace-nowrap">{formatMs(log.timestamp)}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-black text-slate-900">{log.asset}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-black text-slate-900 font-mono whitespace-nowrap">{log.amount.toFixed(2)}</div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest whitespace-nowrap ${
                          log.type === 'IN' 
                            ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' 
                            : 'bg-blue-50 text-blue-600 border border-blue-100'
                        }`}>
                          {log.type === 'IN' ? '现货 -> 合约' : '合约 -> 现货'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest whitespace-nowrap ${
                          log.status === 'SUCCESS' 
                            ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' 
                            : 'bg-red-50 text-red-600 border border-red-100'
                        }`}>
                          {log.status === 'SUCCESS' ? '成功' : '失败'}
                        </span>
                      </td>
                      <td className="px-6 py-4 truncate">
                        <div className="text-xs text-slate-500 font-medium max-w-xs truncate" title={log.message}>
                          {log.message || '--'}
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <ArrowLeftRight className="text-slate-200" size={48} />
                        <p className="text-slate-400 font-bold">暂无划转记录</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
