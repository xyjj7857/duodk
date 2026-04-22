/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Search, 
  FileText, 
  Settings, 
  Activity,
  Globe,
  Zap,
  Server,
  RefreshCw,
  Wallet,
  Mail,
  TrendingUp,
  ShieldCheck,
  History,
  ArrowLeftRight,
  Play,
  Square,
  Lock
} from 'lucide-react';
import { DEFAULT_SETTINGS, APP_NAME } from './constants';
import { AppSettings, LogEntry, TradeLog } from './types';

// Components
import Overview from './components/Overview';
import Scanner from './components/Scanner';
import Logs from './components/Logs';
import TradeLogs from './components/TradeLogs';
import BalanceHistory from './components/BalanceHistory';
import SettingsPanel from './components/SettingsPanel';

export default function App() {
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);
  const [settings, setSettings] = useState<AppSettings>(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [settingsVersion, setSettingsVersion] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [tradeLogs, setTradeLogs] = useState<TradeLog[]>([]);
  const [transferLogs, setTransferLogs] = useState<any[]>([]);
  const [balanceLogs, setBalanceLogs] = useState<any[]>([]);
  const [account, setAccount] = useState<any>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [gatekeeperKey, setGatekeeperKey] = useState("");
  const [modulePassword, setModulePassword] = useState("");
  const [isModuleUnlocked, setIsModuleUnlocked] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showPasswordVerifyModal, setShowPasswordVerifyModal] = useState(false);
  const [verifyPassword, setVerifyPassword] = useState("");
  const [verifyError, setVerifyError] = useState(false);
  const [transferAmount, setTransferAmount] = useState("");
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferStatus, setTransferStatus] = useState<{ type: 'error' | 'success', msg: string } | null>(null);
  const [status, setStatus] = useState({
    wsConnected: false,
    apiConnected: false,
    lastUpdate: Date.now(),
    isRunning: false,
    serverIp: '获取中...'
  });

  const fetchSettings = async (accountId?: string) => {
    try {
      const id = accountId || selectedAccountId;
      const res = await fetch(`/api/settings?accountId=${id}`);
      const data = await res.json();
      setSettings(data);
      setSettingsVersion(v => v + 1);
    } catch (err) {
      console.error('Fetch settings error:', err);
    }
  };

  const fetchAccounts = async () => {
    try {
      // Add cache-busting to ensure we get the latest account list from server
      const res = await fetch(`/api/accounts?t=${Date.now()}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setAccounts(data);
        if (data.length > 0 && !selectedAccountId) {
          setSelectedAccountId(data[0].id);
        }
      }
    } catch (err) {
      console.error('Fetch accounts error:', err);
    }
  };

  // Fetch initial accounts
  useEffect(() => {
    fetchAccounts();
  }, []);

  // Fetch settings when account changes
  useEffect(() => {
    if (selectedAccountId) {
      fetchSettings(selectedAccountId);
    }
  }, [selectedAccountId]);

  // WebSocket and Initial Data Fetch
  useEffect(() => {
    if (!selectedAccountId) return;
    
    const selectedAccountName = accounts.find(a => a.id === selectedAccountId)?.name || selectedAccountId;
    document.title = (settings.appName || APP_NAME) + (selectedAccountName ? ` - ${selectedAccountName}` : '');
    let ws: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout;

    const fetchInitialData = async () => {
      try {
        const query = `?accountId=${selectedAccountId}`;
        const [statusRes, logsRes, tradeLogsRes, transferLogsRes, balanceLogsRes, ipRes, accountRes] = await Promise.all([
          fetch(`/api/status${query}`),
          fetch(`/api/logs${query}`),
          fetch(`/api/trade-logs${query}`),
          fetch(`/api/transfer-logs${query}`),
          fetch(`/api/balance-logs${query}`),
          fetch('/api/ip'),
          fetch(`/api/account${query}`)
        ]);
        
        if (statusRes.status === 403) {
          const data = await statusRes.json();
          if (data.gatekeeper) {
            setIsLocked(true);
            return;
          }
        }

        const statusData = await statusRes.json();
        const logsData = await logsRes.json();
        const tradeLogsData = await tradeLogsRes.json();
        const transferLogsData = await transferLogsRes.json();
        const balanceLogsData = await balanceLogsRes.json();
        const ipData = await ipRes.json();
        const accountData = await accountRes.json();

        setStatus(prev => ({
          ...prev,
          wsConnected: statusData.wsConnected,
          apiConnected: statusData.apiConnected,
          lastUpdate: Date.now(),
          isRunning: statusData.isRunning,
          serverIp: ipData.ip
        }));
        setLogs(logsData);
        setTradeLogs(tradeLogsData);
        setTransferLogs(transferLogsData);
        setBalanceLogs(balanceLogsData);
        setAccount(accountData);
      } catch (error) {
        console.error('Initial fetch error:', error);
      }
    };

    const connectWebSocket = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}?accountId=${selectedAccountId}`;
      
      ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        try {
          const { accountId, type, data } = JSON.parse(event.data);
          
          // Only process updates for the selected account
          if (accountId && accountId !== selectedAccountId) return;
          
          switch (type) {
            case 'status':
              setStatus(prev => ({ ...prev, ...data, lastUpdate: Date.now() }));
              break;
            case 'log':
              setLogs(prev => [data, ...prev].slice(0, 1000));
              break;
            case 'logs':
              setLogs(data);
              break;
            case 'tradeLogs':
              setTradeLogs(data);
              break;
            case 'transferLogs':
              setTransferLogs(data);
              break;
            case 'balanceLogs':
              setBalanceLogs(data);
              break;
            case 'account':
              setAccount(data);
              break;
          }
        } catch (err) {
          console.error('WS message error:', err);
        }
      };

      ws.onclose = () => {
        console.log('WS disconnected, retrying...');
        reconnectTimeout = setTimeout(connectWebSocket, 3000);
      };

      ws.onerror = (err) => {
        console.error('WS error:', err);
        ws?.close();
      };
    };

    fetchInitialData();
    connectWebSocket();

    return () => {
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
      clearTimeout(reconnectTimeout);
    };
  }, [selectedAccountId, settings.appName]);

  const handleSaveSettings = async (newSettings: AppSettings) => {
    try {
      const res = await fetch(`/api/settings?accountId=${selectedAccountId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings)
      });
      
      if (res.status === 403) {
        const data = await res.json();
        if (data.gatekeeper) setIsLocked(true);
        return;
      }

      const data = await res.json();
      if (data.success) {
        setSettings(newSettings);
        setSettingsVersion(v => v + 1);
        await fetchAccounts();
      } else {
        console.error('Save settings failed');
      }
    } catch (err) {
      console.error('Save settings error:', err);
    }
  };

  const handleRestoreDefaults = async () => {
    if (window.confirm('确定要恢复当前账户的默认参数吗？')) {
      try {
        const res = await fetch(`/api/settings/restore?accountId=${selectedAccountId}`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          setSettings(data.settings);
          setSettingsVersion(v => v + 1);
          alert('系统已成功恢复默认参数并完成同步。');
        } else {
          alert('恢复失败: ' + data.message);
        }
      } catch (err: any) {
        console.error('Restore error:', err);
        alert('恢复失败: ' + err.message);
      }
    }
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/gatekeeper/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: gatekeeperKey })
      });
      const data = await res.json();
      if (data.success) {
        setIsLocked(false);
        window.location.reload(); // Reload to refresh all data
      } else {
        alert("门卫密钥错误！");
      }
    } catch (err) {
      console.error("Unlock error:", err);
    }
  };

  const handleClearLogs = async () => {
    try {
      await fetch(`/api/logs/clear?accountId=${selectedAccountId}`, { method: 'POST' });
      setLogs([]);
    } catch (err) {
      console.error('Clear logs error:', err);
    }
  };

  const handleClearTradeLogs = async () => {
    try {
      await fetch(`/api/trade-logs/clear?accountId=${selectedAccountId}`, { method: 'POST' });
      setTradeLogs([]);
    } catch (err) {
      console.error('Clear trade logs error:', err);
    }
  };

  const handleClearTransferLogs = async () => {
    try {
      await fetch(`/api/transfer-logs/clear?accountId=${selectedAccountId}`, { method: 'POST' });
      setTransferLogs([]);
    } catch (err) {
      console.error('Clear transfer logs error:', err);
    }
  };

  const handleToggleStrategy = async () => {
    const endpoint = status.isRunning 
      ? `/api/engine/stop?accountId=${selectedAccountId}` 
      : `/api/engine/start?accountId=${selectedAccountId}`;
    try {
      const res = await fetch(endpoint, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setStatus(prev => ({ ...prev, isRunning: !status.isRunning }));
      }
    } catch (err) {
      console.error('Toggle strategy error:', err);
    }
  };

  const handleAddAccount = async () => {
    try {
      const res = await fetch('/api/accounts/add', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        await fetchAccounts();
        alert('新账户已添加并初始化');
      }
    } catch (err) {
      console.error('Add account error:', err);
    }
  };

  const handleDeleteAccount = async (id: string) => {
    if (!window.confirm('确定要删除该账户吗？此操作不可逆。')) return;
    try {
      const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        // Clear local storage if the deleted account was the selected one
        if (selectedAccountId === id || localStorage.getItem('selectedAccountId') === id) {
          localStorage.removeItem('selectedAccountId');
          setSelectedAccountId("");
        }
        
        await fetchAccounts();
        alert('账户已成功删除');
        
        // Reload to ensure all backend and frontend services align
        window.location.reload();
      } else {
        alert('删除失败: ' + data.message);
      }
    } catch (err) {
      console.error('Delete account error:', err);
      alert('删除过程中发生错误');
    }
  };

  const handleModuleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (modulePassword === "Sunbin7857#") {
      setIsModuleUnlocked(true);
    } else {
      alert("模块访问密码错误！");
    }
  };

  const handleVerifyPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (verifyPassword === "Sunbin7857#") {
      setShowPasswordVerifyModal(false);
      setShowTransferModal(true);
      setVerifyPassword("");
      setVerifyError(false);
    } else {
      setVerifyError(true);
      setTimeout(() => setVerifyError(false), 3000);
    }
  };

  const handleTransferToFutures = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(transferAmount);
    if (isNaN(amount) || amount <= 0) {
      setTransferStatus({ type: 'error', msg: "请输入有效的划转金额" });
      return;
    }

    setIsTransferring(true);
    setTransferStatus(null);
    try {
      const res = await fetch('/api/transfer/to-futures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount })
      });
      const data = await res.json();
      if (data.success) {
        setTransferStatus({ type: 'success', msg: `成功划转 ${amount} USDT 到合约账户` });
        setTimeout(() => {
          setShowTransferModal(false);
          setTransferAmount("");
          setTransferStatus(null);
        }, 2000);
      } else {
        setTransferStatus({ type: 'error', msg: "划转失败: " + data.message });
      }
    } catch (err: any) {
      console.error("Transfer error:", err);
      setTransferStatus({ type: 'error', msg: "划转请求失败: " + err.message });
    } finally {
      setIsTransferring(false);
    }
  };

  if (isLocked) {
    return (
      <div className="h-screen w-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="w-full max-md bg-white rounded-3xl p-8 shadow-2xl animate-in zoom-in duration-300">
          <div className="flex flex-col items-center text-center mb-8">
            <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mb-4">
              <ShieldCheck className="text-emerald-600" size={32} />
            </div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">门卫守护中</h2>
            <p className="text-slate-500 text-sm mt-2">请输入门卫密钥以访问{settings.appName || APP_NAME} system</p>
          </div>
          <form onSubmit={handleUnlock} className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">门卫密钥</label>
              <input 
                type="password" 
                value={gatekeeperKey}
                onChange={(e) => setGatekeeperKey(e.target.value)}
                placeholder="请输入密钥..."
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-mono"
                required
              />
            </div>
            <button 
              type="submit"
              className="w-full py-4 bg-emerald-600 text-white rounded-xl font-black uppercase tracking-widest hover:bg-emerald-700 shadow-lg shadow-emerald-600/20 transition-all active:scale-[0.98]"
            >
              解锁系统
            </button>
          </form>
          <div className="mt-8 pt-6 border-t border-slate-100 text-center">
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
              SUPER NODE SECURITY GATEKEEPER v1.0
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Router>
      <div className="flex h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden">
        {/* Sidebar */}
        <aside className={`${isSidebarExpanded ? 'w-64' : 'w-20'} border-r border-slate-200 flex flex-col bg-white transition-all duration-300 relative group`}>
          <button 
            onClick={() => setIsSidebarExpanded(!isSidebarExpanded)}
            className="absolute -right-3 top-20 w-6 h-6 bg-white border border-slate-200 rounded-full flex items-center justify-center shadow-sm z-20 hover:bg-slate-50 transition-colors"
          >
            <LayoutDashboard size={12} className={`transition-transform duration-300 ${isSidebarExpanded ? 'rotate-180' : ''}`} />
          </button>

          <div className={`p-6 flex items-center ${isSidebarExpanded ? 'gap-3' : 'justify-center'}`}>
            <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-600/20 shrink-0">
              <Zap className="text-white fill-white" size={24} />
            </div>
            {isSidebarExpanded && <h1 className="text-xl font-bold tracking-tight text-slate-900 truncate">{settings.appName || APP_NAME}</h1>}
          </div>

          {/* Account Switcher */}
          <div className="px-4 mb-4">
            <div className={`flex flex-col gap-1 ${isSidebarExpanded ? '' : 'items-center'}`}>
              {isSidebarExpanded && <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-1">选择账户</label>}
              <div className="relative group/select">
                <select 
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                  className={`${isSidebarExpanded ? 'w-full px-3 py-2' : 'w-10 h-10 px-0'} appearance-none bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all cursor-pointer text-center`}
                >
                  {accounts.map(acc => (
                    <option key={acc.id} value={acc.id}>
                      {isSidebarExpanded ? acc.name : acc.name.substring(0, 1)}
                    </option>
                  ))}
                </select>
                {isSidebarExpanded && <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                  <RefreshCw size={12} />
                </div>}
              </div>
            </div>
          </div>

          <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto overflow-x-hidden">
            <NavLink to="/" icon={<LayoutDashboard size={20} />} label="总览" expanded={isSidebarExpanded} />
            <NavLink to="/scanner" icon={<Search size={20} />} label="扫描" expanded={isSidebarExpanded} />
            <NavLink to="/logs" icon={<FileText size={20} />} label="日志" expanded={isSidebarExpanded} />
            <NavLink to="/trade-logs" icon={<History size={20} />} label="交易日志" expanded={isSidebarExpanded} />
            <NavLink to="/balance" icon={<TrendingUp size={20} />} label="账户总余额" expanded={isSidebarExpanded} />
            <NavLink to="/settings" icon={<Settings size={20} />} label="设置" expanded={isSidebarExpanded} />
          </nav>

          {/* Sidebar Stats (Area 2) */}
          <div className={`px-4 py-4 border-t border-slate-100 ${isSidebarExpanded ? 'grid grid-cols-2 gap-2' : 'flex flex-col items-center space-y-4'}`}>
            <SidebarStat 
              title={isSidebarExpanded ? "总余额" : ""} 
              value={parseFloat(account?.totalBalance || '0.00').toLocaleString()} 
              unit="USDT" 
              icon={<Wallet className="text-emerald-600" size={14} />} 
              expanded={isSidebarExpanded}
            />
            <SidebarStat 
              title={isSidebarExpanded ? "可用额" : ""} 
              value={parseFloat(account?.availableBalance || '0.00').toLocaleString()} 
              unit="USDT" 
              icon={<TrendingUp className="text-blue-600" size={14} />} 
              expanded={isSidebarExpanded}
            />
            <SidebarStat 
              title={isSidebarExpanded ? "现货" : ""} 
              value={parseFloat(account?.spotBalance || '0.00').toLocaleString()} 
              unit="USDT" 
              icon={<Wallet className="text-purple-600" size={14} />} 
              onClick={() => setShowPasswordVerifyModal(true)}
              expanded={isSidebarExpanded}
            />
            <SidebarStat 
              title={isSidebarExpanded ? "状态" : ""} 
              value={status.isRunning ? "运行中" : "停止"} 
              unit="" 
              icon={<ShieldCheck className={status.isRunning ? "text-emerald-600" : "text-red-600"} size={14} />} 
              expanded={isSidebarExpanded}
            />
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto relative">
          <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-slate-200 px-8 py-4 flex items-center justify-between">
            <div className="flex items-center gap-6">
              <StatusBadge icon={<Globe size={14} />} label="WS" active={status.wsConnected} />
              <StatusBadge icon={<ShieldCheck size={14} />} label="API" active={status.apiConnected} />
              <button 
                onClick={async () => {
                  try {
                    await fetch(`/api/check-status?accountId=${selectedAccountId}`, { method: 'POST' });
                  } catch (err) {
                    console.error('Check status failed:', err);
                  }
                }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 text-[10px] font-black uppercase tracking-widest border border-slate-200"
              >
                <RefreshCw size={12} />
                <span>检测状态</span>
              </button>
              <button 
                onClick={async () => {
                  try {
                    await fetch(`/api/account/refresh?accountId=${selectedAccountId}`, { method: 'POST' });
                  } catch (err) {
                    console.error('Refresh account failed:', err);
                  }
                }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 text-[10px] font-black uppercase tracking-widest border border-emerald-100"
              >
                <Wallet size={12} />
                <span>强制获取余额</span>
              </button>
              <button 
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/test-email?accountId=${selectedAccountId}`, { method: 'POST' });
                    const data = await res.json();
                    if (data.success) {
                      alert(data.message);
                    } else {
                      alert('测试邮件发送失败: ' + data.error);
                    }
                  } catch (err: any) {
                    alert('请求失败: ' + err.message);
                  }
                }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 text-[10px] font-black uppercase tracking-widest border border-blue-100"
              >
                <Mail size={12} />
                <span>测试邮件</span>
              </button>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Activity size={14} />
                <span>更新: {Math.floor((Date.now() - status.lastUpdate) / 1000)}s</span>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">服务器 IP</div>
                <div className="text-sm font-mono font-bold text-slate-700">{status.serverIp}</div>
              </div>
              <div className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${status.isRunning ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-red-100 text-red-700 border border-red-200'}`}>
                {status.isRunning ? '策略运行中' : '策略已停止'}
              </div>
            </div>
          </header>

          <div className="p-8">
            <Routes>
              <Route path="/" element={<Overview account={account} />} />
              <Route path="/scanner" element={
                <ProtectedRoute 
                  isModuleUnlocked={isModuleUnlocked} 
                  modulePassword={modulePassword} 
                  setModulePassword={setModulePassword} 
                  onUnlock={handleModuleUnlock}
                >
                  <Scanner accountId={selectedAccountId} onToggleStrategy={handleToggleStrategy} isRunning={status.isRunning} />
                </ProtectedRoute>
              } />
              <Route path="/logs" element={
                <ProtectedRoute 
                  isModuleUnlocked={isModuleUnlocked} 
                  modulePassword={modulePassword} 
                  setModulePassword={setModulePassword} 
                  onUnlock={handleModuleUnlock}
                >
                  <Logs logs={logs} onClear={handleClearLogs} />
                </ProtectedRoute>
              } />
              <Route path="/trade-logs" element={
                <ProtectedRoute 
                  isModuleUnlocked={isModuleUnlocked} 
                  modulePassword={modulePassword} 
                  setModulePassword={setModulePassword} 
                  onUnlock={handleModuleUnlock}
                >
                  <TradeLogs tradeLogs={tradeLogs} onClear={handleClearTradeLogs} accountId={selectedAccountId} />
                </ProtectedRoute>
              } />
              <Route path="/balance" element={
                <ProtectedRoute 
                  isModuleUnlocked={isModuleUnlocked} 
                  modulePassword={modulePassword} 
                  setModulePassword={setModulePassword} 
                  onUnlock={handleModuleUnlock}
                >
                  <BalanceHistory 
                    account={account} 
                    balanceLogs={balanceLogs} 
                    transferLogs={transferLogs} 
                    onClearTransfers={handleClearTransferLogs}
                    accountId={selectedAccountId}
                  />
                </ProtectedRoute>
              } />
              <Route path="/settings" element={
                <ProtectedRoute 
                  isModuleUnlocked={isModuleUnlocked} 
                  modulePassword={modulePassword} 
                  setModulePassword={setModulePassword} 
                  onUnlock={handleModuleUnlock}
                >
                  <SettingsPanel 
                    key={settingsVersion} 
                    settings={settings} 
                    onSave={handleSaveSettings} 
                    onRefresh={fetchSettings} 
                    onRestore={handleRestoreDefaults}
                    onAddAccount={handleAddAccount}
                    onDeleteAccount={handleDeleteAccount}
                    accounts={accounts}
                  />
                </ProtectedRoute>
              } />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </div>
        </main>
      </div>

      {/* Password Verify Modal */}
      {showPasswordVerifyModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-sm bg-white rounded-[2.5rem] p-8 shadow-2xl animate-in zoom-in duration-300">
            <div className="flex flex-col items-center text-center mb-8">
              <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mb-4">
                <Lock className="text-blue-600" size={32} />
              </div>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">安全验证</h2>
              <p className="text-slate-500 text-sm mt-2 font-medium">请输入访问密码以继续划转</p>
            </div>
            <form onSubmit={handleVerifyPassword} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">访问密码</label>
                <input 
                  type="password" 
                  value={verifyPassword}
                  onChange={(e) => setVerifyPassword(e.target.value)}
                  placeholder="请输入访问密码..."
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono"
                  required
                  autoFocus
                />
                {verifyError && (
                  <p className="text-[10px] text-red-500 font-bold mt-1 ml-1 animate-pulse">密码错误，请重试</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button 
                  type="button"
                  onClick={() => setShowPasswordVerifyModal(false)}
                  className="py-4 bg-slate-100 text-slate-600 rounded-xl font-black uppercase tracking-widest hover:bg-slate-200 transition-all active:scale-[0.98]"
                >
                  取消
                </button>
                <button 
                  type="submit"
                  className="py-4 bg-slate-900 text-white rounded-xl font-black uppercase tracking-widest hover:bg-slate-800 shadow-lg transition-all active:scale-[0.98]"
                >
                  验证
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transfer Modal */}
      {showTransferModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-sm bg-white rounded-[2.5rem] p-8 shadow-2xl animate-in zoom-in duration-300">
            <div className="flex flex-col items-center text-center mb-8">
              <div className="w-16 h-16 bg-purple-50 rounded-2xl flex items-center justify-center mb-4">
                <ArrowLeftRight className="text-purple-600" size={32} />
              </div>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">资金划转</h2>
              <p className="text-slate-500 text-sm mt-2 font-medium">现货账户 {"->"} 合约账户</p>
            </div>
            <form onSubmit={handleTransferToFutures} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">划转金额 (USDT)</label>
                <input 
                  type="number" 
                  step="0.00000001"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all font-mono"
                  required
                  autoFocus
                />
                <div className="flex justify-between px-1 mt-1">
                  <span className="text-[10px] text-slate-400 font-bold">现货余额: {parseFloat(account?.spotBalance || '0').toFixed(2)} USDT</span>
                  <button 
                    type="button" 
                    onClick={() => setTransferAmount(account?.spotBalance || "0")}
                    className="text-[10px] text-purple-600 font-black uppercase tracking-widest hover:text-purple-700"
                  >
                    全部
                  </button>
                </div>
              </div>

              {transferStatus && (
                <div className={`p-3 rounded-xl text-xs font-bold text-center ${
                  transferStatus.type === 'success' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-red-50 text-red-600 border border-red-100'
                }`}>
                  {transferStatus.msg}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <button 
                  type="button"
                  onClick={() => setShowTransferModal(false)}
                  className="py-4 bg-slate-100 text-slate-600 rounded-xl font-black uppercase tracking-widest hover:bg-slate-200 transition-all active:scale-[0.98]"
                >
                  取消
                </button>
                <button 
                  type="submit"
                  disabled={isTransferring}
                  className="py-4 bg-purple-600 text-white rounded-xl font-black uppercase tracking-widest hover:bg-purple-700 shadow-lg shadow-purple-600/20 transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  {isTransferring ? "处理中..." : "确认划转"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Router>
  );
}

interface ProtectedRouteProps {
  children: React.ReactNode;
  isModuleUnlocked: boolean;
  modulePassword: string;
  setModulePassword: (val: string) => void;
  onUnlock: (e: React.FormEvent) => void;
}

const ProtectedRoute = ({ 
  children, 
  isModuleUnlocked, 
  modulePassword, 
  setModulePassword, 
  onUnlock 
}: ProtectedRouteProps) => {
  if (!isModuleUnlocked) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] animate-in fade-in duration-500">
        <div className="w-full max-w-sm bg-white rounded-[2.5rem] p-8 border border-slate-200 shadow-xl">
          <div className="flex flex-col items-center text-center mb-8">
            <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mb-4">
              <Lock className="text-blue-600" size={32} />
            </div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">模块已锁定</h2>
            <p className="text-slate-500 text-sm mt-2 font-medium">进入该模块需要验证访问密码</p>
          </div>
          <form onSubmit={onUnlock} className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">访问密码</label>
              <input 
                type="password" 
                value={modulePassword}
                onChange={(e) => setModulePassword(e.target.value)}
                placeholder="请输入访问密码..."
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono"
                required
              />
            </div>
            <button 
              type="submit"
              className="w-full py-4 bg-slate-900 text-white rounded-xl font-black uppercase tracking-widest hover:bg-slate-800 shadow-lg transition-all active:scale-[0.98]"
            >
              验证并进入
            </button>
          </form>
        </div>
      </div>
    );
  }
  return <>{children}</>;
};

function NavLink({ to, icon, label, expanded = true }: { to: string; icon: React.ReactNode; label: string; expanded?: boolean }) {
  const location = useLocation();
  const isActive = location.pathname === to;

  return (
    <Link 
      to={to} 
      className={`flex items-center ${expanded ? 'gap-3 px-4' : 'justify-center'} py-3 rounded-xl transition-all ${
        isActive 
          ? 'bg-emerald-600 text-white font-semibold shadow-lg shadow-emerald-600/20' 
          : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
      }`}
      title={expanded ? "" : label}
    >
      <span className="shrink-0">{icon}</span>
      {expanded && <span className="text-sm tracking-tight">{label}</span>}
    </Link>
  );
}

function StatusBadge({ icon, label, active }: { icon: React.ReactNode; label: string; active: boolean }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${
      active 
        ? 'bg-emerald-50 border-emerald-200 text-emerald-600' 
        : 'bg-red-50 border-red-200 text-red-600'
    }`}>
      <span>{icon}</span>
      <span className="text-[10px] font-black uppercase tracking-widest">{label}</span>
      <div className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-red-500'}`} />
    </div>
  );
}

function SidebarStat({ title, value, unit, icon, onClick, expanded = true }: { title: string; value: string; unit: string; icon: React.ReactNode; onClick?: () => void, expanded?: boolean }) {
  return (
    <div 
      className={`bg-slate-50/50 border border-slate-100 rounded-xl p-2 md:p-3 ${onClick ? 'cursor-pointer hover:bg-slate-100 transition-colors group' : ''} ${expanded ? 'w-full' : 'w-12 h-12 flex items-center justify-center p-0'}`}
      onClick={onClick}
      title={expanded ? "" : `${title}: ${value} ${unit}`}
    >
      {expanded ? (
        <>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{title}</span>
            <div className={`w-5 h-5 bg-white rounded-md flex items-center justify-center border border-slate-100 shadow-sm ${onClick ? 'group-hover:border-purple-200 group-hover:bg-purple-50' : ''}`}>
              {icon}
            </div>
          </div>
          <div className="flex items-baseline gap-0.5 mt-auto">
            <span className="text-[12px] font-black text-slate-900 tracking-tighter font-mono truncate">{value}</span>
            {unit && <span className="text-[7px] text-slate-400 font-black uppercase tracking-tight">{unit}</span>}
          </div>
        </>
      ) : (
        <div className="shrink-0">{icon}</div>
      )}
    </div>
  );
}

