import React, { useState } from 'react';
import { AppSettings } from '../types';
import { Save, Shield, Search, ShoppingCart, Mail, Database, Zap, Clock, Activity, RotateCcw, RefreshCw, User, Plus, Trash2 } from 'lucide-react';
import { DEFAULT_SETTINGS } from '../constants';

export default function SettingsPanel({ 
  settings, 
  onSave, 
  onRefresh, 
  onRestore,
  onAddAccount,
  onDeleteAccount,
  accounts = []
}: { 
  settings: AppSettings; 
  onSave: (s: AppSettings) => void; 
  onRefresh: () => void; 
  onRestore: () => void;
  onAddAccount: () => void;
  onDeleteAccount: (id: string) => void;
  accounts: any[];
  key?: any 
}) {
  const [localSettings, setLocalSettings] = useState<any>(settings);
  const [activeTab, setActiveTab] = useState('binance');
  const [isSaving, setIsSaving] = useState(false);

  // Fallback sync
  React.useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(localSettings);
      setTimeout(() => setIsSaving(false), 2000);
    } catch (error) {
      setIsSaving(false);
    }
  };

  const handleRestoreDefaults = async () => {
    setIsSaving(true);
    try {
      await onRestore();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">系统配置中心</h2>
          <p className="text-slate-400 text-sm mt-1 font-medium">自定义您的交易策略与连接参数</p>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={onRefresh}
            className="flex items-center gap-2 px-6 py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black text-xs uppercase tracking-widest rounded-2xl transition-colors"
          >
            <RefreshCw size={18} />
            <span>刷新参数</span>
          </button>
          <button 
            onClick={handleRestoreDefaults}
            className="flex items-center gap-2 px-6 py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black text-xs uppercase tracking-widest rounded-2xl transition-colors"
          >
            <RotateCcw size={18} />
            <span>恢复默认值</span>
          </button>
          <button 
            onClick={handleSave}
            disabled={isSaving}
            className={`flex items-center gap-2 px-8 py-4 ${isSaving ? 'bg-slate-400' : 'bg-emerald-600 hover:bg-emerald-700'} text-white font-black text-xs uppercase tracking-widest rounded-2xl shadow-xl ${isSaving ? '' : 'shadow-emerald-600/20'} disabled:opacity-50`}
          >
            {isSaving ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Save size={20} />
            )}
            <span>{isSaving ? '正在保存...' : '保存并同步'}</span>
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-8">
        {/* Tabs */}
        <div className="flex flex-row w-full overflow-x-auto pb-2 gap-4 scrollbar-hide">
          <TabButton id="binance" icon={<Shield size={18} />} label="Binance API" active={activeTab === 'binance'} onClick={setActiveTab} />
          <TabButton id="scanner" icon={<Search size={18} />} label="扫描策略" active={activeTab === 'scanner'} onClick={setActiveTab} />
          <TabButton id="order" icon={<ShoppingCart size={18} />} label="仓单管理" active={activeTab === 'order'} onClick={setActiveTab} />
          <TabButton id="withdrawal" icon={<Database size={18} />} label="提补款" active={activeTab === 'withdrawal'} onClick={setActiveTab} />
          <TabButton id="accounts" icon={<User size={18} />} label="多账户管理" active={activeTab === 'accounts'} onClick={setActiveTab} />
        </div>

        {/* Content */}
        <div className="flex-1 bg-white border border-slate-200 rounded-[2.5rem] p-4 md:p-10 shadow-sm min-h-[600px]">
          {activeTab === 'binance' && (
            <div className="space-y-10">
              <SectionHeader title="账户标识" description="当前正在配置的账户名称" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                  <Input label="当前账户名称" value={localSettings.name || ''} onChange={v => setLocalSettings({...localSettings, name: v})} />
                </div>
              </div>

              <SectionHeader title="基础配置" description="自定义网页标题及报警通知中的名称" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                  <Input label="系统显示名称" value={localSettings.appName || ''} onChange={v => setLocalSettings({...localSettings, appName: v})} />
                </div>
              </div>
              
              <SectionHeader title="Binance API 配置" description="配置您的币安 API 密钥与连接地址" />
              <div className="grid grid-cols-1 gap-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="Binance API Key" value={localSettings.binance?.apiKey || ''} onChange={v => setLocalSettings({...localSettings, binance: {...localSettings.binance, apiKey: v}})} />
                  </div>
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="Binance Secret Key" type="password" value={localSettings.binance?.secretKey || ''} onChange={v => setLocalSettings({...localSettings, binance: {...localSettings.binance, secretKey: v}})} />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="Base URL" value={localSettings.binance?.baseUrl || ''} onChange={v => setLocalSettings({...localSettings, binance: {...localSettings.binance, baseUrl: v}})} />
                  </div>
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="WS URL" value={localSettings.binance?.wsUrl || ''} onChange={v => setLocalSettings({...localSettings, binance: {...localSettings.binance, wsUrl: v}})} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'accounts' && (
            <div className="space-y-10">
              <SectionHeader 
                title="账户列表" 
                description="管理您的多个交易账户。您可以点击右侧按钮新增账户。" 
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {accounts.map((acc: any) => (
                  <div key={acc.id} className="relative flex flex-col p-6 bg-slate-50/50 rounded-[2rem] border border-slate-100 hover:border-emerald-200 hover:bg-emerald-50/20 transition-all group overflow-hidden">
                    <div className="flex flex-col items-center text-center gap-4 mb-6">
                      <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center border border-slate-100 shadow-sm group-hover:shadow-md transition-shadow">
                        <User className="text-slate-400 group-hover:text-emerald-500 transition-colors" size={32} />
                      </div>
                      <div className="space-y-1">
                        <h4 className="font-black text-slate-900 tracking-tight text-lg line-clamp-1">{acc.name}</h4>
                        <p className="text-[10px] text-slate-400 font-mono tracking-tighter truncate w-full px-2">{acc.id}</p>
                      </div>
                    </div>
                    
                    <div className="mt-auto flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
                      <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${acc.enabled ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-500'}`}>
                        {acc.enabled ? '运行中' : '已停用'}
                      </div>
                      <button 
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onDeleteAccount(acc.id);
                        }}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                        title="删除账户"
                      >
                        <Trash2 size={20} />
                      </button>
                    </div>
                  </div>
                ))}

                <button 
                  onClick={onAddAccount}
                  className="relative flex flex-col p-6 items-center justify-center gap-4 border-2 border-dashed border-slate-200 rounded-[2rem] text-slate-400 hover:text-emerald-600 hover:border-emerald-200 hover:bg-emerald-50/30 transition-all group min-h-[220px]"
                >
                  <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center border border-slate-100 group-hover:bg-white group-hover:shadow-sm transition-all">
                    <Plus size={32} />
                  </div>
                  <span className="font-black text-xs uppercase tracking-widest">添加新账户</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'scanner' && (
            <div className="space-y-10">
              <section className="space-y-6">
                <SectionHeader title="Stage 0 - 全市场初筛" icon={<Clock size={16} className="text-blue-600" />} />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="绝对周期 (如 1h)" value={localSettings.scanner?.stage0?.interval || ''} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0: {...localSettings.scanner.stage0, interval: v}}})} />
                  </div>
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="启动时间" value={localSettings.scanner?.stage0?.startTime || ''} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0: {...localSettings.scanner.stage0, startTime: v}}})} />
                  </div>
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="K线周期" value={localSettings.scanner?.stage0?.klinePeriod || ''} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0: {...localSettings.scanner.stage0, klinePeriod: v}}})} />
                  </div>
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="K线数量下限" type="number" value={String(localSettings.scanner?.stage0?.minKlines ?? '')} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0: {...localSettings.scanner.stage0, minKlines: Number(v)}}})} />
                  </div>
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="K线数量上限" type="number" value={String(localSettings.scanner?.stage0?.maxKlines ?? '')} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0: {...localSettings.scanner.stage0, maxKlines: Number(v)}}})} />
                  </div>
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 flex items-center justify-between">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">TradFi 币对</label>
                    <Toggle enabled={localSettings.scanner?.stage0?.includeTradFi ?? false} onChange={e => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0: {...localSettings.scanner.stage0, includeTradFi: e}}})} />
                  </div>
                </div>
              </section>

              <section className="space-y-6">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <SectionHeader title="Stage 0P - 波动率过滤" icon={<Activity size={16} className="text-orange-600" />} noBorder />
                  <Toggle enabled={localSettings.scanner?.stage0P?.enabled ?? false} onChange={e => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0P: {...localSettings.scanner.stage0P, enabled: e}}})} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="0P 绝对周期" value={localSettings.scanner?.stage0P?.interval || ''} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0P: {...localSettings.scanner.stage0P, interval: v}}})} />
                  </div>
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="0P 启动时间" value={localSettings.scanner?.stage0P?.startTime || ''} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0P: {...localSettings.scanner.stage0P, startTime: v}}})} />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {Object.entries(localSettings.scanner?.stage0P?.periods || {}).map(([period, config]: [string, any]) => (
                    <div key={period} className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-4">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                        <span className="font-black text-slate-900 text-[10px] uppercase tracking-widest">{period} 监控</span>
                        <Toggle enabled={config.enabled} onChange={e => {
                          const newPeriods = { ...localSettings.scanner.stage0P.periods };
                          newPeriods[period].enabled = e;
                          setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0P: {...localSettings.scanner.stage0P, periods: newPeriods}}});
                        }} />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <Input label="K线数量" type="number" value={String(config?.count ?? '')} onChange={v => {
                          const newPeriods = { ...localSettings.scanner.stage0P.periods };
                          newPeriods[period].count = Number(v);
                          setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0P: {...localSettings.scanner.stage0P, periods: newPeriods}}});
                        }} />
                        <Input label="阈值 (%)" type="number" value={String(config?.threshold ?? '')} onChange={v => {
                          const newPeriods = { ...localSettings.scanner.stage0P.periods };
                          newPeriods[period].threshold = Number(v);
                          setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0P: {...localSettings.scanner.stage0P, periods: newPeriods}}});
                        }} />
                      </div>
                    </div>
                  ))}
                </div>
                
                <div className="p-6 bg-slate-50/50 rounded-[2rem] border border-slate-100 space-y-6">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                    <div className="flex items-center gap-3">
                      <div className="p-1.5 bg-white rounded-lg shadow-sm">
                        <Activity size={16} className="text-red-600" />
                      </div>
                      <h4 className="text-sm font-black text-slate-900 tracking-tight uppercase">异动监控</h4>
                    </div>
                    <Toggle 
                      enabled={localSettings.scanner?.stage0P?.abnormalMove?.enabled ?? false} 
                      onChange={e => setLocalSettings({
                        ...localSettings, 
                        scanner: {
                          ...localSettings.scanner, 
                          stage0P: {
                            ...localSettings.scanner.stage0P, 
                            abnormalMove: {
                              ...(localSettings.scanner.stage0P.abnormalMove || { lookbackHours: 10, windowMinutes: 60, maxPump: 25, maxDrop: 30 }),
                              enabled: e
                            }
                          }
                        }
                      })} 
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                    <Input label="考察时长 (h)" type="number" value={String(localSettings.scanner?.stage0P?.abnormalMove?.lookbackHours ?? 10)} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0P: {...localSettings.scanner.stage0P, abnormalMove: {...(localSettings.scanner.stage0P.abnormalMove || {}), lookbackHours: Number(v)}}}})} />
                    <Input label="窗口 (min)" type="number" value={String(localSettings.scanner?.stage0P?.abnormalMove?.windowMinutes ?? 60)} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0P: {...localSettings.scanner.stage0P, abnormalMove: {...(localSettings.scanner.stage0P.abnormalMove || {}), windowMinutes: Number(v)}}}})} />
                    <Input label="涨幅 (%)" type="number" value={String(localSettings.scanner?.stage0P?.abnormalMove?.maxPump ?? 25)} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0P: {...localSettings.scanner.stage0P, abnormalMove: {...(localSettings.scanner.stage0P.abnormalMove || {}), maxPump: Number(v)}}}})} />
                    <Input label="跌幅 (%)" type="number" value={String(localSettings.scanner?.stage0P?.abnormalMove?.maxDrop ?? 30)} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage0P: {...localSettings.scanner.stage0P, abnormalMove: {...(localSettings.scanner.stage0P.abnormalMove || {}), maxDrop: Number(v)}}}})} />
                  </div>
                </div>
              </section>

              <section className="space-y-6">
                <SectionHeader title="Stage 1 - 基础过滤" icon={<Filter size={16} className="text-emerald-600" />} />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="1 绝对周期" value={localSettings.scanner?.stage1?.interval || ''} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage1: {...localSettings.scanner.stage1, interval: v}}})} />
                  </div>
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="1 启动时间" value={localSettings.scanner?.stage1?.startTime || ''} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage1: {...localSettings.scanner.stage1, startTime: v}}})} />
                  </div>
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="成交额 M1 下限" type="number" value={String(localSettings.scanner?.stage1?.minVolumeM1 ?? '')} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage1: {...localSettings.scanner.stage1, minVolumeM1: Number(v)}}})} />
                  </div>
                </div>
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                  <div className="grid grid-cols-2 gap-6">
                    <Input label="K1 下限 (%)" type="number" value={String(localSettings.scanner?.stage1?.priceChangeK1?.[0] ?? '')} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage1: {...localSettings.scanner.stage1, priceChangeK1: [Number(v), localSettings.scanner.stage1.priceChangeK1[1]]}}})} />
                    <Input label="K1 上限 (%)" type="number" value={String(localSettings.scanner?.stage1?.priceChangeK1?.[1] ?? '')} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage1: {...localSettings.scanner.stage1, priceChangeK1: [localSettings.scanner.stage1.priceChangeK1[0], Number(v)]}}})} />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="白名单 (空格分隔)" value={localSettings.scanner?.stage1?.whitelist?.join(' ') || ''} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage1: {...localSettings.scanner.stage1, whitelist: v.split(' ').filter(s => s)}}})} />
                  </div>
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="黑名单 (空格分隔)" value={localSettings.scanner?.stage1?.blacklist?.join(' ') || ''} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage1: {...localSettings.scanner.stage1, blacklist: v.split(' ').filter(s => s)}}})} />
                  </div>
                </div>
              </section>

              <section className="space-y-6">
                <SectionHeader title="Stage 2 - 形态过滤" icon={<Zap size={16} className="text-purple-600" />} />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="2 绝对周期" value={localSettings.scanner?.stage2?.interval || ''} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, interval: v}}})} />
                  </div>
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="2 启动时间" value={localSettings.scanner?.stage2?.startTime || ''} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, startTime: v}}})} />
                  </div>
                  <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <Input label="冷却期 (min)" type="number" value={String(localSettings.scanner?.stage2?.cooldown ?? '')} onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, cooldown: Number(v)}}})} />
                  </div>
                </div>
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                  <Select 
                    label="优选币对选择方式" 
                    value={localSettings.scanner?.stage2?.preferredMode || 'volume'} 
                    options={[
                      { label: '交易额最高 (M最大)', value: 'volume' },
                      { label: '涨幅最高 (K最大)', value: 'k2' },
                      { label: '振幅最大 (波动量最大)', value: 'amp' }
                    ]}
                    onChange={v => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, preferredMode: v as any}}})} 
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {Object.entries(localSettings.scanner?.stage2?.conditions || {}).map(([key, config]: [string, any]) => {
                    if (key === 'kb') return null;
                    
                    if (key === 'a') {
                      return (
                        <div key={key} className="flex flex-col gap-4 p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                            <div className="flex items-center gap-3">
                              <span className="font-black text-slate-900 text-[10px] uppercase tracking-widest">{key} 过滤</span>
                              <Toggle enabled={config.enabled} onChange={e => {
                                const newConditions = { ...localSettings.scanner.stage2.conditions };
                                (newConditions as any)[key].enabled = e;
                                setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, conditions: newConditions}}});
                              }} />
                            </div>
                            <div className="flex bg-slate-200 p-0.5 rounded-lg">
                              <button 
                                onClick={() => {
                                  const newConditions = { ...localSettings.scanner.stage2.conditions };
                                  (newConditions as any)[key].mode = 'fixed';
                                  setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, conditions: newConditions}}});
                                }}
                                className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${config.mode === 'fixed' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}
                              >固定</button>
                              <button 
                                onClick={() => {
                                  const newConditions = { ...localSettings.scanner.stage2.conditions };
                                  (newConditions as any)[key].mode = 'relative';
                                  setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, conditions: newConditions}}});
                                }}
                                className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${config.mode === 'relative' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}
                              >关联K</button>
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-4">
                            {config.mode === 'fixed' ? (
                              <>
                                <Input label="下限" type="number" value={String(config?.fixedRange?.[0] ?? '')} onChange={v => {
                                  const newConditions = { ...localSettings.scanner.stage2.conditions };
                                  (newConditions as any)[key].fixedRange[0] = Number(v);
                                  setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, conditions: newConditions}}});
                                }} />
                                <Input label="上限" type="number" value={String(config?.fixedRange?.[1] ?? '')} onChange={v => {
                                  const newConditions = { ...localSettings.scanner.stage2.conditions };
                                  (newConditions as any)[key].fixedRange[1] = Number(v);
                                  setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, conditions: newConditions}}});
                                }} />
                              </>
                            ) : (
                              <>
                                <Input label="关联K下限" type="number" value={String(config?.relativeRange?.[0] ?? '')} onChange={v => {
                                  const newConditions = { ...localSettings.scanner.stage2.conditions };
                                  (newConditions as any)[key].relativeRange[0] = Number(v);
                                  setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, conditions: newConditions}}});
                                }} />
                                <Input label="关联K上限" type="number" value={String(config?.relativeRange?.[1] ?? '')} onChange={v => {
                                  const newConditions = { ...localSettings.scanner.stage2.conditions };
                                  (newConditions as any)[key].relativeRange[1] = Number(v);
                                  setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, conditions: newConditions}}});
                                }} />
                              </>
                            )}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={key} className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                          <span className="font-black text-slate-900 text-[10px] uppercase tracking-widest">{key} 过滤</span>
                          <Toggle enabled={config.enabled} onChange={e => {
                            const newConditions = { ...localSettings.scanner.stage2.conditions };
                            (newConditions as any)[key].enabled = e;
                            setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, conditions: newConditions}}});
                          }} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <Input label="下限" type="number" value={String(config?.range?.[0] ?? '')} onChange={v => {
                            const newConditions = { ...localSettings.scanner.stage2.conditions };
                            (newConditions as any)[key].range[0] = Number(v);
                            setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, conditions: newConditions}}});
                          }} />
                          <Input label="上限" type="number" value={String(config?.range?.[1] ?? '')} onChange={v => {
                            const newConditions = { ...localSettings.scanner.stage2.conditions };
                            (newConditions as any)[key].range[1] = Number(v);
                            setLocalSettings({...localSettings, scanner: {...localSettings.scanner, stage2: {...localSettings.scanner.stage2, conditions: newConditions}}});
                          }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="space-y-6">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div className="flex items-center gap-4">
                    <SectionHeader title="时间控制" icon={<Clock size={16} className="text-indigo-600" />} noBorder />
                    <div className="flex bg-slate-100 p-0.5 rounded-lg">
                      <button 
                        onClick={() => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, timeControl: {...localSettings.scanner.timeControl, mode: '+2'}}})}
                        className={`px-3 py-1.5 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${localSettings.scanner.timeControl.mode === '+2' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}
                      >+2 模式</button>
                      <button 
                        onClick={() => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, timeControl: {...localSettings.scanner.timeControl, mode: '-2'}}})}
                        className={`px-3 py-1.5 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${localSettings.scanner.timeControl.mode === '-2' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}
                      >-2 模式</button>
                    </div>
                  </div>
                  <Toggle enabled={localSettings.scanner?.timeControl?.enabled ?? true} onChange={e => setLocalSettings({...localSettings, scanner: {...localSettings.scanner, timeControl: {...localSettings.scanner.timeControl, enabled: e}}})} />
                </div>
                <div className="grid grid-cols-4 md:grid-cols-6 gap-3">
                  {localSettings.scanner?.timeControl?.hours.map((enabled, hour) => (
                    <div key={hour} className="flex flex-col items-center gap-2 p-3 bg-slate-50/50 rounded-2xl border border-slate-100">
                      <span className="text-[9px] font-black text-slate-900 uppercase tracking-widest">{hour} 时</span>
                      <Toggle enabled={enabled} onChange={e => {
                        const newHours = [...localSettings.scanner.timeControl.hours];
                        newHours[hour] = e;
                        setLocalSettings({...localSettings, scanner: {...localSettings.scanner, timeControl: {...localSettings.scanner.timeControl, hours: newHours}}});
                      }} />
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {activeTab === 'order' && (
            <div className="space-y-8">
              <SectionHeader title="仓单模块设置" description="配置交易杠杆、仓位及止盈止损逻辑" />
              
              {/* Row 1: Basic Order Params */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 flex flex-col justify-end">
                  <Input label="杠杆倍数 L" type="number" value={String(localSettings.order?.leverage ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, leverage: Number(v)}})} />
                </div>
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 flex flex-col justify-end">
                  <Input label="仓位比例 CW (%)" type="number" value={String(localSettings.order?.positionRatio ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, positionRatio: Number(v)}})} />
                </div>
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 flex flex-col justify-end">
                  <Input label="最大仓位额 KCMAX (USDT)" type="number" value={String(localSettings.order?.maxPosition ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, maxPosition: Number(v)}})} />
                </div>
              </div>

              {/* Row 2: M Link & TP/SL */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-1">
                    <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest">关联M设置</span>
                    <Toggle enabled={localSettings.order?.mLinkEnabled ?? false} onChange={e => setLocalSettings({...localSettings, order: {...localSettings.order, mLinkEnabled: e}})} />
                  </div>
                  <Input label="关联M值" type="number" value={String(localSettings.order?.mLinkValue ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, mLinkValue: Number(v)}})} />
                </div>

                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest">止盈设置</span>
                      <Toggle enabled={localSettings.order.tpEnabled ?? true} onChange={e => setLocalSettings({...localSettings, order: {...localSettings.order, tpEnabled: e}})} />
                    </div>
                    <div className="flex bg-slate-200 p-0.5 rounded-lg">
                      <button 
                        onClick={() => setLocalSettings({...localSettings, order: {...localSettings.order, tpMode: 'ratio'}})}
                        className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${localSettings.order.tpMode === 'ratio' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}
                      >比例</button>
                      <button 
                        onClick={() => setLocalSettings({...localSettings, order: {...localSettings.order, tpMode: 'fixed'}})}
                        className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${localSettings.order.tpMode === 'fixed' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}
                      >固定</button>
                    </div>
                  </div>
                  {localSettings.order.tpMode === 'ratio' ? (
                    <Input label="比例 TPB (%)" type="number" value={String(localSettings.order?.tpRatio ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, tpRatio: Number(v)}})} />
                  ) : (
                    <Input label="固定值 (%)" type="number" value={String(localSettings.order?.tpFixed ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, tpFixed: Number(v)}})} />
                  )}
                </div>

                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest">止损设置</span>
                      <Toggle enabled={localSettings.order.slEnabled ?? true} onChange={e => setLocalSettings({...localSettings, order: {...localSettings.order, slEnabled: e}})} />
                    </div>
                    <div className="flex bg-slate-200 p-0.5 rounded-lg">
                      <button 
                        onClick={() => setLocalSettings({...localSettings, order: {...localSettings.order, slMode: 'ratio'}})}
                        className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${localSettings.order.slMode === 'ratio' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-500'}`}
                      >比例</button>
                      <button 
                        onClick={() => setLocalSettings({...localSettings, order: {...localSettings.order, slMode: 'fixed'}})}
                        className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${localSettings.order.slMode === 'fixed' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-500'}`}
                      >固定</button>
                    </div>
                  </div>
                  {localSettings.order.slMode === 'ratio' ? (
                    <Input label="比例 SLB (%)" type="number" value={String(localSettings.order?.slRatio ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, slRatio: Number(v)}})} />
                  ) : (
                    <Input label="固定值 (%)" type="number" value={String(localSettings.order?.slFixed ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, slFixed: Number(v)}})} />
                  )}
                </div>
              </div>

              {/* Row 3: Time Windows & K-Best */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 flex flex-col justify-end">
                  <Input label="正向单窗口 (s)" type="number" value={String(localSettings.order?.positiveWindow ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, positiveWindow: Number(v)}})} />
                </div>
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 flex flex-col justify-end">
                  <Input label="最大持仓时间 (min)" type="number" value={String(localSettings.order?.maxHoldTime ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, maxHoldTime: Number(v)}})} />
                </div>
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100 flex flex-col justify-end">
                   <Input label="k优收绝对周期" value={localSettings.order?.kBestPeriod || ''} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, kBestPeriod: v}})} />
                </div>
              </div>

              {/* Row 4: K-Best Window */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                <Input label="k优收窗口开始 (s)" type="number" value={String(localSettings.order?.kBestWindow?.[0] ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, kBestWindow: [Number(v), localSettings.order.kBestWindow[1]]}})} />
                <Input label="k优收窗口结束 (s)" type="number" value={String(localSettings.order?.kBestWindow?.[1] ?? '')} onChange={v => setLocalSettings({...localSettings, order: {...localSettings.order, kBestWindow: [localSettings.order.kBestWindow[0], Number(v)]}})} />
              </div>
            </div>
          )}

          {activeTab === 'withdrawal' && (
            <div className="space-y-10">
              <SectionHeader title="提补款模块设置" description="配置合约账户与现货账户之间的资金划转逻辑" />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                  <Input label="提款阈值 (USDT)" type="number" value={String(localSettings.withdrawal?.withdrawalThreshold ?? '')} onChange={v => setLocalSettings({...localSettings, withdrawal: {...localSettings.withdrawal, withdrawalThreshold: Number(v)}})} />
                </div>
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                  <Input label="留存阈值 (USDT)" type="number" value={String(localSettings.withdrawal?.retentionThreshold ?? '')} onChange={v => setLocalSettings({...localSettings, withdrawal: {...localSettings.withdrawal, retentionThreshold: Number(v)}})} />
                </div>
                <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
                  <Input label="余额报警阈值 (USDT)" type="number" value={String(localSettings.withdrawal?.alarmThreshold ?? '')} onChange={v => setLocalSettings({...localSettings, withdrawal: {...localSettings.withdrawal, alarmThreshold: Number(v)}})} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ title, description, icon, noBorder }: { title: string; description?: string; icon?: React.ReactNode; noBorder?: boolean }) {
  return (
    <div className={`${noBorder ? '' : 'border-b border-slate-100 pb-6'}`}>
      <div className="flex items-center gap-3">
        <div className="p-2 bg-slate-50 rounded-lg">
          {icon}
        </div>
        <h3 className="text-xl font-black text-slate-900 tracking-tight">{title}</h3>
      </div>
      {description && <p className="text-slate-400 text-sm mt-1 font-medium">{description}</p>}
    </div>
  );
}

function TabButton({ id, icon, label, active, onClick }: { id: string; icon: React.ReactNode; label: string; active: boolean; onClick: (id: string) => void }) {
  return (
    <button 
      onClick={() => onClick(id)}
      className={`flex items-center gap-3 px-6 py-4 rounded-2xl whitespace-nowrap transition-all shrink-0 ${
        active 
          ? 'bg-emerald-600 text-white font-black shadow-xl shadow-emerald-600/20' 
          : 'bg-slate-50 text-slate-400 hover:text-slate-900 hover:bg-slate-100 font-bold'
      }`}
    >
      {icon}
      <span className="text-xs uppercase tracking-widest">{label}</span>
    </button>
  );
}

function Input({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  const [displayValue, setDisplayValue] = React.useState(value);

  React.useEffect(() => {
    setDisplayValue(value);
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setDisplayValue(v);
    
    if (type === 'number') {
      // Allow empty, minus sign, or decimal point as intermediate states
      if (v === '' || v === '-' || v === '.' || v === '-.') {
        return;
      }
      const num = parseFloat(v);
      if (!isNaN(num)) {
        onChange(v);
      }
    } else {
      onChange(v);
    }
  };

  return (
    <div className="space-y-2">
      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">{label}</label>
      <input 
        type={type === 'number' ? 'text' : type} 
        value={displayValue}
        onChange={handleChange}
        className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-2.5 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500/50 font-mono text-sm text-slate-900 font-bold"
      />
    </div>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: { label: string, value: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">{label}</label>
      <div className="relative">
        <select 
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-2.5 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500/50 font-bold text-sm text-slate-900 appearance-none cursor-pointer"
        >
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </div>
    </div>
  );
}

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (e: boolean) => void }) {
  return (
    <button 
      onClick={() => onChange(!enabled)}
      className={`w-12 h-6 rounded-full relative transition-colors ${enabled ? 'bg-emerald-500' : 'bg-slate-200'}`}
    >
      <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${enabled ? 'left-7' : 'left-1'}`} />
    </button>
  );
}

function Filter(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}
