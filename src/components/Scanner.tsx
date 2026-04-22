import React, { useState, useEffect } from 'react';
import { Search, Filter, Play, Pause, ChevronRight, Zap, RefreshCw, Info } from 'lucide-react';

export default function Scanner({ accountId, onToggleStrategy, isRunning }: { accountId: string, onToggleStrategy: () => void, isRunning: boolean }) {
  const [loadingStage, setLoadingStage] = useState<number | null>(null);
  const [isTogglingEngine, setIsTogglingEngine] = useState(false);
  const [allResults, setAllResults] = useState<any>({
    0: { data: [], scannedCount: 0, startTime: 0, duration: 0 },
    1: { data: [], scannedCount: 0, startTime: 0, duration: 0 },
    2: { data: [], scannedCount: 0, startTime: 0, duration: 0 },
    3: { data: [], scannedCount: 0, startTime: 0, duration: 0 },
  });
  const [isLoadingResults, setIsLoadingResults] = useState(false);

  const fetchAllResults = async () => {
    if (!accountId) return;
    setIsLoadingResults(true);
    try {
      const resultsRes = await fetch(`/api/all-scan-results?accountId=${accountId}`);
      const resultsData = await resultsRes.json();
      setAllResults(resultsData);
    } catch (error) {
      console.error('Fetch scan data error:', error);
    } finally {
      setIsLoadingResults(false);
    }
  };

  useEffect(() => {
    fetchAllResults();
    const interval = setInterval(fetchAllResults, 5000);
    return () => clearInterval(interval);
  }, [accountId]);

  const toggleEngine = async () => {
    setIsTogglingEngine(true);
    try {
      await onToggleStrategy();
    } finally {
      setIsTogglingEngine(false);
    }
  };

  const handleForceScan = async (stage: number) => {
    setLoadingStage(stage);
    try {
      await fetch(`/api/force-scan?accountId=${accountId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage })
      });
      setTimeout(() => {
        setLoadingStage(null);
        fetchAllResults();
      }, 1000);
    } catch (error) {
      console.error('Force scan error:', error);
      setLoadingStage(null);
    }
  };

  const stages = [
    { id: 0, title: "全市场初筛", description: "过滤非USDT及非永续合约" },
    { id: 1, title: "波动率过滤", description: "筛选符合波动率阈值的币种" },
    { id: 2, title: "基础过滤", description: "成交额及涨跌幅初步筛选" },
    { id: 3, title: "形态过滤", description: "实时形态锁定及策略验证" },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">扫描引擎</h2>
          <p className="text-slate-400 text-sm mt-1 font-medium">实时监控市场波动，捕捉潜在交易机会</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={toggleEngine}
            disabled={isTogglingEngine}
            className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold shadow-lg transition-all active:scale-95 ${
              isRunning 
                ? 'bg-red-500 text-white hover:bg-red-600 shadow-red-500/20' 
                : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-600/20'
            } ${isTogglingEngine ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {isTogglingEngine ? (
              <RefreshCw size={20} className="animate-spin" />
            ) : (
              isRunning ? <Pause size={20} /> : <Play size={20} />
            )}
            <span>{isRunning ? '停止策略' : '启动策略'}</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-start">
        {stages.map((s) => (
          <div key={s.id} className="space-y-6">
            <ScannerStageCard 
              stage={s.id} 
              title={s.title} 
              status={isRunning ? 'active' : 'waiting'} 
              count={allResults[s.id]?.data?.length || 0} 
              scannedCount={allResults[s.id]?.scannedCount || 0}
              startTime={allResults[s.id]?.startTime || 0}
              duration={allResults[s.id]?.duration || 0}
              isSelected={false} // No longer needed for selection
              onClick={() => {}} // No longer needed for selection
              onForceScan={() => handleForceScan(s.id)}
              isLoading={loadingStage === s.id}
            />
            
            <div className="bg-white border border-slate-200 rounded-[2.5rem] overflow-hidden shadow-sm flex flex-col h-[600px]">
              <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0">
                <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                  <Filter size={16} className="text-emerald-600" />
                  筛选结果
                </h3>
                <div className="px-3 py-1 bg-slate-50 rounded-full text-[10px] font-bold text-slate-500 border border-slate-100">
                  {allResults[s.id]?.data?.length || 0} 符合
                </div>
              </div>
              
              <div className="overflow-y-auto flex-1 custom-scrollbar">
                <table className="w-full text-left border-collapse table-fixed">
                  <thead className="sticky top-0 bg-white z-10 shadow-sm">
                    <tr className="text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-50">
                      <th className="px-4 py-3 w-[80px]">币种</th>
                      <th className="px-4 py-3 w-[100px]">{s.id === 3 ? 'k2/A/M' : '状态'}</th>
                      <th className="px-4 py-3">原因</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {allResults[s.id]?.data?.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-4 py-8 text-center text-slate-400 text-xs font-medium">
                          暂无数据
                        </td>
                      </tr>
                    ) : (
                      allResults[s.id].data.map((c: any, i: number) => (
                        <CandidateRow 
                          key={c.symbol + i} 
                          candidate={c} 
                          stageId={s.id}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ScannerStageCardProps {
  stage: number;
  title: string;
  status: 'active' | 'waiting' | 'completed';
  count: number;
  scannedCount: number;
  startTime: number;
  duration: number;
  isSelected: boolean;
  onClick: () => void;
  onForceScan: () => void | Promise<void>;
  isLoading: boolean;
}

const ScannerStageCard: React.FC<ScannerStageCardProps> = ({ 
  stage, 
  title, 
  status, 
  count, 
  scannedCount,
  startTime,
  duration,
  isSelected,
  onClick,
  onForceScan,
  isLoading 
}) => {
  const formatTime = (ts: number) => {
    if (!ts) return '--:--:--';
    const date = new Date(ts);
    const timeStr = date.toLocaleTimeString('zh-CN', { 
      hour12: false, 
      timeZone: 'Asia/Shanghai' 
    });
    return timeStr + '.' + date.getMilliseconds().toString().padStart(3, '0');
  };

  return (
    <div 
      className={`p-6 rounded-[2.5rem] border relative group bg-white border-slate-200 hover:border-emerald-200 hover:bg-slate-50/50 shadow-sm`}
    >
      <div className="flex items-center justify-between mb-4">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black bg-slate-100 text-slate-400`}>
          {stage}
        </div>
        <button 
          onClick={(e) => {
            e.stopPropagation();
            onForceScan();
          }}
          disabled={isLoading}
          className={`p-2 rounded-xl ${
            isLoading ? 'text-emerald-600' : 'text-slate-300 hover:text-emerald-600 hover:bg-emerald-50'
          }`}
          title="强制扫描"
        >
          <RefreshCw size={16} />
        </button>
      </div>
      
      <div className="space-y-3">
        <div>
          <h4 className="font-black text-slate-900 text-sm">{title}</h4>
          <div className="flex items-baseline gap-2">
            <div className="text-2xl font-black text-slate-900 tracking-tighter">{count}</div>
            <div className="text-[9px] font-black text-slate-300 uppercase tracking-widest">币种</div>
            {scannedCount > 0 && (
              <div className="text-[9px] font-bold text-slate-400 ml-auto">
                扫描了 {scannedCount} 个
              </div>
            )}
          </div>
        </div>

        <div className="pt-3 border-t border-slate-50 space-y-1">
          <div className="flex justify-between text-[9px] font-bold text-slate-400">
            <span>开始时间</span>
            <span className="text-slate-600">{formatTime(startTime)}</span>
          </div>
          <div className="flex justify-between text-[9px] font-bold text-slate-400">
            <span>总用时</span>
            <span className="text-emerald-600">{duration}ms</span>
          </div>
        </div>

        <div className={`text-[9px] font-black uppercase tracking-widest ${
          status === 'active' ? 'text-emerald-500' : 'text-slate-300'
        }`}>
          {status === 'active' ? '● 运行中' : '○ 等待中'}
        </div>
      </div>
    </div>
  );
};

interface CandidateRowProps {
  candidate: any;
  stageId: number;
}

const CandidateRow: React.FC<CandidateRowProps> = ({ candidate, stageId }) => {
  const { symbol, status, k2, a, m, k5, reason, isPass, isPreferred } = candidate;
  
  return (
    <tr className={`hover:bg-slate-50/50 group transition-colors ${isPreferred ? 'bg-emerald-50/30' : ''}`}>
      <td className="px-4 py-4">
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5">
            <span className="font-black text-slate-900 text-xs">{symbol}</span>
            {isPreferred && (
              <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[8px] font-black rounded-md border border-amber-200 uppercase tracking-tighter">
                优选
              </span>
            )}
          </div>
          {stageId === 3 && (
            <span className="text-[8px] text-slate-400 font-bold">K5:{k5}</span>
          )}
        </div>
      </td>
      <td className="px-4 py-4">
        {stageId < 3 ? (
          <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 text-[8px] font-black uppercase tracking-widest border border-emerald-100">
            {status?.split(' ')[0] || '--'}
          </span>
        ) : (
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-slate-900">
              {k2}/{a}/{m}
            </span>
            <span className="text-[8px] text-slate-400 font-medium">K2/A/M(百万)</span>
          </div>
        )}
      </td>
      <td className="px-4 py-4">
        <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest border ${
          !isPass && stageId === 3
            ? 'bg-red-50 text-red-600 border-red-100'
            : isPreferred 
              ? 'bg-amber-50 text-amber-600 border-amber-100'
              : 'bg-emerald-50 text-emerald-600 border-emerald-100'
        }`}>
          {reason || (stageId === 1 ? '波动率达标' : stageId === 2 ? '上线时间达标' : '符合初筛')}
        </span>
      </td>
    </tr>
  );
};
