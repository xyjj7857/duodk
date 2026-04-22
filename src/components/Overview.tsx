import React, { useEffect, useState } from 'react';
import { Wallet, TrendingUp, Activity, Zap, Server, ShieldCheck, Globe } from 'lucide-react';

export default function Overview({ account }: { account: any }) {
  const totalBalance = account?.totalBalance || '0.00';
  const availableBalance = account?.availableBalance || '0.00';
  const positions = account?.positions || [];
  const allOrders = account?.openOrders || [];
  
  // 普通单只展示 LIMIT 委托单且非算法单
  const standardOrders = allOrders.filter((o: any) => o.type === 'LIMIT' && !o.isAlgo);
  // 算法单展示所有非 LIMIT 订单或标记为 isAlgo 的订单 (即 condition 订单)
  const algoOrders = allOrders.filter((o: any) => o.type !== 'LIMIT' || o.isAlgo);
  
  const conditionalTypes = ['STOP', 'STOP_MARKET', 'TAKE_PROFIT', 'TAKE_PROFIT_MARKET', 'TRAILING_STOP_MARKET', 'CONDITIONAL'];

  const formatMs = (ts: number) => {
    if (!ts) return '--';
    // Force UTC+8
    const date = new Date(ts + 8 * 3600 * 1000);
    const Y = date.getUTCFullYear();
    const M = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const D = date.getUTCDate().toString().padStart(2, '0');
    const h = date.getUTCHours().toString().padStart(2, '0');
    const m = date.getUTCMinutes().toString().padStart(2, '0');
    const s = date.getUTCSeconds().toString().padStart(2, '0');
    const ms = (ts % 1000).toString().padStart(3, '0');
    return `${Y}/${M}/${D} ${h}:${m}:${s}.${ms}`;
  };

  const renderOrderTable = (orders: any[], emptyMsg: string) => (
    <table className="w-full text-left table-fixed">
      <thead>
        <tr className="text-[11px] font-medium text-slate-400 uppercase tracking-wider border-b border-slate-50">
          <th className="pb-4 font-normal w-[180px]">合约</th>
          <th className="pb-4 font-normal w-[80px]">方向</th>
          <th className="pb-4 font-normal w-[100px]">类型</th>
          <th className="pb-4 font-normal w-[130px]">数量</th>
          <th className="pb-4 font-normal w-[150px]">价格/触发价</th>
          <th className="pb-4 font-normal w-[100px]">状态</th>
          <th className="pb-4 font-normal w-[180px]">时间</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-50">
        {orders.length > 0 ? (
          orders.map((order: any) => {
            const isConditional = order.isAlgo || conditionalTypes.some(t => order.type?.includes(t));
            return (
              <tr key={order.orderId} className="group hover:bg-slate-50/50 transition-colors">
                <td className="py-5 truncate">
                  <div className="font-black text-slate-900 text-sm truncate">{order.symbol}</div>
                  <div className="text-[10px] text-slate-400 font-medium truncate">ID: {order.orderId}</div>
                </td>
                <td className="py-5">
                  <Badge side={order.side} />
                </td>
                <td className="py-5">
                  <div className="flex items-center gap-1.5">
                    {isConditional && <Zap size={10} className="text-purple-500 fill-purple-500" />}
                    <span className={`text-xs font-bold ${isConditional ? 'text-purple-600' : 'text-slate-600'}`}>
                      {order.type}
                    </span>
                  </div>
                </td>
                <td className="py-5 font-mono text-sm font-bold text-slate-700 whitespace-nowrap">{order.origQty}</td>
                <td className="py-5 font-mono text-sm font-bold text-blue-600 whitespace-nowrap">
                  {parseFloat(order.price) === 0 ? (order.stopPrice || order.triggerPrice || order.activationPrice || '--') : order.price}
                </td>
                <td className="py-5">
                  <StatusBadge status={order.status} />
                </td>
                <td className="py-5 font-mono text-[11px] font-medium text-slate-400 whitespace-nowrap">{formatMs(order.time)}</td>
              </tr>
            );
          })
        ) : (
          <tr>
            <td colSpan={7} className="py-12 text-center text-slate-400 text-xs font-bold uppercase tracking-widest">{emptyMsg}</td>
          </tr>
        )}
      </tbody>
    </table>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20">
      {/* Section 1: Current Positions */}
      <SectionWrapper title="当前持仓 (正向单)" icon={<Activity className="text-emerald-500" size={20} />}>
        <table className="w-full text-left table-fixed">
          <thead>
            <tr className="text-[11px] font-medium text-slate-400 uppercase tracking-wider border-b border-slate-50">
              <th className="pb-4 font-normal w-[180px]">合约</th>
              <th className="pb-4 font-normal w-[80px]">方向</th>
              <th className="pb-4 font-normal w-[130px]">数量</th>
              <th className="pb-4 font-normal w-[130px]">价值(USDT)</th>
              <th className="pb-4 font-normal w-[80px]">杠杆</th>
              <th className="pb-4 font-normal w-[150px]">开仓均价</th>
              <th className="pb-4 font-normal w-[150px] text-red-500">当前价格</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {positions.length > 0 ? (
              positions.map((pos: any, idx: number) => (
                <tr key={idx} className="group hover:bg-slate-50/50 transition-colors">
                  <td className="py-5 truncate">
                    <div className="font-black text-slate-900 text-sm truncate">{pos.symbol}</div>
                    <div className="text-[10px] text-slate-400 font-medium truncate">开仓: {formatMs(pos.updateTime)}</div>
                  </td>
                  <td className="py-5">
                    <Badge side={parseFloat(pos.positionAmt) > 0 ? 'LONG' : 'SHORT'} />
                  </td>
                  <td className="py-5 font-mono text-sm font-bold text-slate-700 whitespace-nowrap">{pos.positionAmt}</td>
                  <td className="py-5 font-mono text-sm font-bold text-slate-700 whitespace-nowrap">${pos.entryValue}</td>
                  <td className="py-5 font-mono text-sm font-bold text-slate-700 whitespace-nowrap">{pos.leverage}x</td>
                  <td className="py-5 font-mono text-sm font-bold text-slate-700 whitespace-nowrap">{pos.entryPrice}</td>
                  <td className="py-5 font-mono text-sm font-bold text-red-500 animate-pulse whitespace-nowrap">
                    {pos.currentPrice ? pos.currentPrice : '--'}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-400 text-xs font-bold uppercase tracking-widest">暂无持仓数据</td>
              </tr>
            )}
          </tbody>
        </table>
      </SectionWrapper>

      {/* Section 2: Standard Open Orders */}
      <SectionWrapper title="当前委托订单 (普通单)" icon={<Zap className="text-blue-500" size={20} />}>
        {renderOrderTable(standardOrders, "暂无普通委托订单")}
      </SectionWrapper>

      {/* Section 3: Algo Orders */}
      <SectionWrapper title="算法委托订单 (Algo)" icon={<Server className="text-purple-500" size={20} />}>
        {renderOrderTable(algoOrders, "暂无算法委托订单")}
      </SectionWrapper>
    </div>
  );
}

function SectionWrapper({ title, icon, children, rightElement }: { title: string; icon: React.ReactNode; children: React.ReactNode; rightElement?: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-100 rounded-[1.5rem] p-6 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-base font-black text-slate-900 flex items-center gap-2.5">
          {icon}
          {title}
        </h3>
        {rightElement ? rightElement : (
          <button className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-emerald-100 transition-colors">
            <TrendingUp size={12} />
            导出 Excel
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        {children}
      </div>
    </div>
  );
}

function Badge({ side }: { side: 'BUY' | 'SELL' | 'LONG' | 'SHORT' }) {
  const isBuy = side === 'BUY' || side === 'LONG';
  const label = side === 'BUY' ? '买入' : side === 'SELL' ? '卖出' : side === 'LONG' ? '做多' : '做空';
  
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-black ${isBuy ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (!status) return <span className="text-slate-400 text-[10px] font-bold">--</span>;
  
  const s = status.toUpperCase();
  let colorClass = 'bg-slate-50 text-slate-500';
  let label = status;

  if (s === 'NEW' || s === 'PENDING') {
    colorClass = 'bg-blue-50 text-blue-600';
    label = s === 'NEW' ? '新订单' : '等待触发';
  } else if (s === 'FILLED') {
    colorClass = 'bg-emerald-50 text-emerald-600';
    label = '已成交';
  } else if (s === 'CANCELED' || s === 'CANCELLED') {
    colorClass = 'bg-slate-100 text-slate-400';
    label = '已撤单';
  } else if (s === 'EXPIRED') {
    colorClass = 'bg-orange-50 text-orange-600';
    label = '已过期';
  } else if (s === 'REJECTED' || s === 'FAILED') {
    colorClass = 'bg-red-50 text-red-600';
    label = '已拒绝/失败';
  }

  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-tight ${colorClass}`}>
      {label}
    </span>
  );
}