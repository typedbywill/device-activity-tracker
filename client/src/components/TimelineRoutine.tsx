import React, { useEffect, useState } from 'react';
import { Sun, Moon, Clock, Activity, RefreshCw } from 'lucide-react';
import { socket } from '../App';

interface StateTransition {
    id: number;
    state: string;
    start_time: number;
    end_time: number;
    duration_ms: number;
}

interface ActivitySummary {
    totalOnlineMs: number;
    totalStandbyMs: number;
    totalOfflineMs: number;
    onlineSessionsCount: number;
    firstOnlineTime: number | null;
    lastOnlineTime: number | null;
    transitionsCount: number;
}

interface TimelineRoutineProps {
    jid: string;
}

export function TimelineRoutine({ jid }: TimelineRoutineProps) {
    const [timeline, setTimeline] = useState<StateTransition[]>([]);
    const [summary, setSummary] = useState<ActivitySummary | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const loadData = () => {
        setIsLoading(true);
        socket.emit('get-contact-history', jid);
    };

    useEffect(() => {
        loadData();

        function onHistory(data: any) {
            if (data.jid === jid) {
                setTimeline(data.timeline || []);
                setSummary(data.summary || null);
                setIsLoading(false);
            }
        }

        socket.on('contact-history', onHistory);
        return () => {
            socket.off('contact-history', onHistory);
        };
    }, [jid]);

    const formatDuration = (ms: number) => {
        if (!ms || ms < 1000) return '0s';
        const totalSecs = Math.floor(ms / 1000);
        const hours = Math.floor(totalSecs / 3600);
        const mins = Math.floor((totalSecs % 3600) / 60);
        const secs = totalSecs % 60;

        if (hours > 0) return `${hours}h ${mins}m`;
        if (mins > 0) return `${mins}m ${secs}s`;
        return `${secs}s`;
    };

    const formatTime = (ts: number | null) => {
        if (!ts) return '--:--';
        return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };

    const getStateBgColor = (state: string) => {
        if (state.includes('Online')) return 'bg-emerald-500';
        if (state.includes('Standby')) return 'bg-amber-400';
        return 'bg-red-500';
    };

    const getStateTextColor = (state: string) => {
        if (state.includes('Online')) return 'text-emerald-700 bg-emerald-50 border-emerald-200';
        if (state.includes('Standby')) return 'text-amber-700 bg-amber-50 border-amber-200';
        return 'text-red-700 bg-red-50 border-red-200';
    };

    // Calculate percentage width for timeline bar (relative to 24h or current span)
    const now = Date.now();
    const startOfToday = new Date().setHours(0, 0, 0, 0);
    const totalDayMs = Math.max(now - startOfToday, 3600000);

    return (
        <div className="flex flex-col gap-5">
            {/* Header / Refresh */}
            <div className="flex items-center justify-between">
                <div>
                    <h5 className="text-sm font-semibold text-gray-800">Rotina & Linha do Tempo (Hoje)</h5>
                    <p className="text-xs text-gray-400">Padrões de uso, desbloqueios e horários de atividade</p>
                </div>
                <button
                    onClick={loadData}
                    className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500 transition-colors"
                    title="Recarregar histórico"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {/* Routine Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-100 flex flex-col">
                    <span className="text-[11px] font-medium text-blue-600 flex items-center gap-1.5">
                        <Sun className="w-3.5 h-3.5 text-blue-500" />
                        1ª Atividade (Hoje)
                    </span>
                    <span className="text-base font-bold text-blue-950 mt-1">
                        {formatTime(summary?.firstOnlineTime || null)}
                    </span>
                    <span className="text-[10px] text-blue-500/80 mt-0.5">Despertar estimado</span>
                </div>

                <div className="p-3 bg-indigo-50/60 rounded-xl border border-indigo-100 flex flex-col">
                    <span className="text-[11px] font-medium text-indigo-600 flex items-center gap-1.5">
                        <Moon className="w-3.5 h-3.5 text-indigo-500" />
                        Última Atividade
                    </span>
                    <span className="text-base font-bold text-indigo-950 mt-1">
                        {formatTime(summary?.lastOnlineTime || null)}
                    </span>
                    <span className="text-[10px] text-indigo-500/80 mt-0.5">Último uso registrado</span>
                </div>

                <div className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-100 flex flex-col">
                    <span className="text-[11px] font-medium text-emerald-600 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-emerald-500" />
                        Tempo de Tela Ativa
                    </span>
                    <span className="text-base font-bold text-emerald-950 mt-1">
                        {formatDuration(summary?.totalOnlineMs || 0)}
                    </span>
                    <span className="text-[10px] text-emerald-500/80 mt-0.5">Em uso / Desbloqueado</span>
                </div>

                <div className="p-3 bg-purple-50/60 rounded-xl border border-purple-100 flex flex-col">
                    <span className="text-[11px] font-medium text-purple-600 flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5 text-purple-500" />
                        Sessões de Uso
                    </span>
                    <span className="text-base font-bold text-purple-950 mt-1">
                        {summary?.onlineSessionsCount || 0} vezes
                    </span>
                    <span className="text-[10px] text-purple-500/80 mt-0.5">Desbloqueios no dia</span>
                </div>
            </div>

            {/* Visual Timeline Bar */}
            <div className="bg-gray-50/80 p-4 rounded-xl border border-gray-200">
                <div className="flex items-center justify-between text-xs text-gray-500 font-medium mb-2">
                    <span>00:00</span>
                    <span>Linha do Tempo das Atividades (Hoje)</span>
                    <span>Agora</span>
                </div>

                {/* Progress-style Bar */}
                <div className="w-full h-7 bg-gray-200 rounded-lg overflow-hidden flex relative shadow-inner">
                    {timeline.length === 0 ? (
                        <div className="w-full h-full flex items-center justify-center text-[11px] text-gray-400">
                            Aguardando primeiras transições de estado...
                        </div>
                    ) : (
                        timeline.map((seg, idx) => {
                            const segStart = Math.max(seg.start_time, startOfToday);
                            const segEnd = Math.min(seg.end_time || now, now);
                            const duration = Math.max(segEnd - segStart, 0);
                            const pct = Math.max((duration / totalDayMs) * 100, 0.5);

                            return (
                                <div
                                    key={idx}
                                    style={{ width: `${pct}%` }}
                                    className={`h-full ${getStateBgColor(seg.state)} transition-all hover:opacity-80`}
                                    title={`${seg.state}: ${formatTime(seg.start_time)} até ${formatTime(seg.end_time || now)} (${formatDuration(seg.duration_ms || duration)})`}
                                />
                            );
                        })
                    )}
                </div>

                {/* Legend */}
                <div className="flex items-center justify-center gap-6 mt-3 text-xs text-gray-600 font-medium">
                    <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-full bg-emerald-500" />
                        <span>🟢 Online (Tela Ativa)</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-full bg-amber-400" />
                        <span>🟡 Standby (Bloqueado)</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-full bg-red-500" />
                        <span>🔴 Offline</span>
                    </div>
                </div>
            </div>

            {/* Recent Transition Logs */}
            <div className="border border-gray-100 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-700">
                    Histórico de Sessões Recentes
                </div>
                <div className="max-h-[220px] overflow-y-auto divide-y divide-gray-100 text-xs">
                    {timeline.length === 0 ? (
                        <div className="p-4 text-center text-gray-400">Nenhum evento registrado ainda.</div>
                    ) : (
                        [...timeline].reverse().slice(0, 15).map((item, idx) => (
                            <div key={idx} className="px-4 py-2 flex items-center justify-between hover:bg-gray-50/50">
                                <div className="flex items-center gap-2">
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${getStateTextColor(item.state)}`}>
                                        {item.state}
                                    </span>
                                    <span className="text-gray-600 font-medium">
                                        {formatTime(item.start_time)} - {item.end_time ? formatTime(item.end_time) : 'Em andamento'}
                                    </span>
                                </div>
                                <span className="text-gray-400 font-mono">
                                    {formatDuration(item.duration_ms || (now - item.start_time))}
                                </span>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
