import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Square, Activity, Wifi, Smartphone, Monitor, MessageCircle, Calendar, Settings, TrendingUp } from 'lucide-react';
import clsx from 'clsx';
import { TimelineRoutine } from './TimelineRoutine';
import { socket } from '../App';

type Platform = 'whatsapp' | 'signal';

interface TrackerData {
    rtt: number;
    avg: number;
    median: number;
    threshold: number;
    state: string;
    timestamp: number;
}

interface DeviceInfo {
    jid: string;
    state: string;
    rtt: number;
    avg: number;
}

interface ContactCardProps {
    jid: string;
    displayNumber: string;
    contactName?: string;
    probeInterval?: number;
    data: TrackerData[];
    devices: DeviceInfo[];
    deviceCount: number;
    presence: string | null;
    profilePic: string | null;
    onRemove: () => void;
    privacyMode?: boolean;
    platform?: Platform;
}

export function ContactCard({
    jid,
    displayNumber,
    contactName,
    probeInterval = 5000,
    data,
    devices,
    deviceCount,
    presence,
    profilePic,
    onRemove,
    privacyMode = false,
    platform = 'whatsapp'
}: ContactCardProps) {
    const [activeTab, setActiveTab] = useState<'realtime' | 'routine' | 'settings'>('realtime');
    const [intervalValue, setIntervalValue] = useState<number>(probeInterval);

    const lastData = data[data.length - 1];
    const currentStatus = devices.length > 0
        ? (devices.find(d => d.state === 'OFFLINE')?.state ||
            devices.find(d => d.state.includes('Online'))?.state ||
            devices[0].state)
        : 'Standby';

    const displayName = contactName && contactName !== displayNumber ? contactName : displayNumber;
    const blurredNumber = privacyMode ? displayNumber.replace(/\d/g, '•') : displayNumber;
    const blurredName = privacyMode ? displayName.replace(/./g, '•') : displayName;

    const handleIntervalChange = (newVal: number) => {
        setIntervalValue(newVal);
        socket.emit('set-contact-interval', { jid, interval: newVal });
    };

    return (
        <div className="bg-gradient-to-br from-white to-gray-50 rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <span className={clsx(
                        "px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm",
                        platform === 'whatsapp' ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-blue-50 text-blue-700 border border-blue-200"
                    )}>
                        <MessageCircle size={13} />
                        {platform === 'whatsapp' ? 'WhatsApp' : 'Signal'}
                    </span>
                    <div>
                        <h3 className="text-lg font-bold text-gray-900 leading-tight">{blurredName}</h3>
                        {contactName && contactName !== displayNumber && (
                            <span className="text-xs text-gray-400 font-mono">+{blurredNumber}</span>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* View Switcher Tabs */}
                    <div className="flex bg-gray-100 p-1 rounded-xl text-xs font-medium">
                        <button
                            onClick={() => setActiveTab('realtime')}
                            className={clsx(
                                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all",
                                activeTab === 'realtime' ? "bg-white text-gray-900 shadow-sm font-semibold" : "text-gray-500 hover:text-gray-700"
                            )}
                        >
                            <TrendingUp size={14} /> Tempo Real
                        </button>
                        <button
                            onClick={() => setActiveTab('routine')}
                            className={clsx(
                                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all",
                                activeTab === 'routine' ? "bg-white text-gray-900 shadow-sm font-semibold" : "text-gray-500 hover:text-gray-700"
                            )}
                        >
                            <Calendar size={14} /> Rotina & Timeline
                        </button>
                        <button
                            onClick={() => setActiveTab('settings')}
                            className={clsx(
                                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all",
                                activeTab === 'settings' ? "bg-white text-gray-900 shadow-sm font-semibold" : "text-gray-500 hover:text-gray-700"
                            )}
                        >
                            <Settings size={14} /> Frequência
                        </button>
                    </div>

                    <button
                        onClick={onRemove}
                        className="px-3.5 py-2 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-xl flex items-center gap-1.5 font-semibold transition-colors text-xs"
                    >
                        <Square size={14} /> Parar
                    </button>
                </div>
            </div>

            <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Profile & Status Card */}
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex flex-col items-center text-center">
                        <div className="relative mb-4">
                            <div className="w-28 h-28 rounded-full overflow-hidden bg-gray-100 border-4 border-white shadow-md">
                                {profilePic ? (
                                    <img
                                        src={profilePic}
                                        alt="Profile"
                                        className={clsx(
                                            "w-full h-full object-cover transition-all duration-200",
                                            privacyMode && "blur-xl scale-110"
                                        )}
                                        style={privacyMode ? { filter: 'blur(16px) contrast(0.8)' } : {}}
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center font-bold text-gray-400 text-2xl bg-gray-50">
                                        {displayName.charAt(0).toUpperCase()}
                                    </div>
                                )}
                            </div>
                            <div className={clsx(
                                "absolute bottom-1 right-1 w-6 h-6 rounded-full border-2 border-white shadow-sm",
                                currentStatus === 'OFFLINE' ? "bg-red-500" :
                                    currentStatus.includes('Online') ? "bg-emerald-500" : "bg-amber-400"
                            )} />
                        </div>

                        <h4 className="text-lg font-bold text-gray-900 mb-1">{blurredName}</h4>
                        <span className="text-xs text-gray-400 font-mono mb-3">+{blurredNumber}</span>

                        <div className="flex items-center gap-2 mb-4">
                            <span className={clsx(
                                "px-3 py-1 rounded-full text-xs font-bold border",
                                currentStatus === 'OFFLINE' ? "bg-red-50 text-red-700 border-red-200" :
                                    currentStatus.includes('Online') ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                                        currentStatus === 'Standby' ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-gray-100 text-gray-700"
                            )}>
                                {currentStatus === 'Online' ? '🟢 Online (Tela Ativa)' :
                                 currentStatus === 'Standby' ? '🟡 Standby (Bloqueado)' :
                                 currentStatus === 'OFFLINE' ? '🔴 Offline' : currentStatus}
                            </span>
                        </div>

                        <div className="w-full pt-4 border-t border-gray-100 space-y-2 text-xs">
                            <div className="flex justify-between items-center text-gray-600">
                                <span className="flex items-center gap-1.5"><Wifi size={14} className="text-gray-400" /> Presença Oficial</span>
                                <span className="font-semibold">{presence || 'Indisponível'}</span>
                            </div>
                            <div className="flex justify-between items-center text-gray-600">
                                <span className="flex items-center gap-1.5"><Smartphone size={14} className="text-gray-400" /> Aparelhos Vinculados</span>
                                <span className="font-semibold">{deviceCount || 1}</span>
                            </div>
                            <div className="flex justify-between items-center text-gray-600">
                                <span className="flex items-center gap-1.5"><Activity size={14} className="text-gray-400" /> Intervalo Atual</span>
                                <span className="font-semibold text-blue-600">{intervalValue / 1000}s</span>
                            </div>
                        </div>

                        {devices.length > 0 && (
                            <div className="w-full pt-3 border-t border-gray-100 mt-3">
                                <h5 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2 text-left">Aparelhos</h5>
                                <div className="space-y-1">
                                    {devices.map((device, idx) => (
                                        <div key={device.jid} className="flex items-center justify-between text-xs py-1">
                                            <div className="flex items-center gap-1.5">
                                                <Monitor size={13} className="text-gray-400" />
                                                <span className="text-gray-600">Aparelho {idx + 1}</span>
                                            </div>
                                            <span className={clsx(
                                                "px-2 py-0.5 rounded text-[10px] font-bold border",
                                                device.state === 'OFFLINE' ? "bg-red-50 text-red-700 border-red-200" :
                                                    device.state.includes('Online') ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                                                        "bg-amber-50 text-amber-700 border-amber-200"
                                            )}>
                                                {device.state}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Main Content Area based on Tab */}
                    <div className="md:col-span-2">
                        {activeTab === 'realtime' && (
                            <div className="space-y-5">
                                {/* Metrics Grid */}
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                                        <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                                            <Activity size={14} /> Média RTT (3)
                                        </div>
                                        <div className="text-2xl font-bold text-gray-900">
                                            {lastData ? `${lastData.avg.toFixed(0)} ms` : '--'}
                                        </div>
                                    </div>
                                    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                                        <div className="text-xs text-gray-500 mb-1">Mediana Dinâmica</div>
                                        <div className="text-2xl font-bold text-gray-900">
                                            {lastData ? `${lastData.median.toFixed(0)} ms` : '--'}
                                        </div>
                                    </div>
                                    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                                        <div className="text-xs text-gray-500 mb-1">Limiar (Threshold)</div>
                                        <div className="text-2xl font-bold text-blue-600">
                                            {lastData ? `${lastData.threshold.toFixed(0)} ms` : '--'}
                                        </div>
                                    </div>
                                </div>

                                {/* Line Chart */}
                                <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200 h-[300px]">
                                    <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                                        Latência RTT em Tempo Real & Limiar
                                    </h5>
                                    <ResponsiveContainer width="100%" height="88%">
                                        <LineChart data={data}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                            <XAxis dataKey="timestamp" hide />
                                            <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11 }} />
                                            <Tooltip
                                                labelFormatter={(t: any) => (t ? new Date(t).toLocaleTimeString() : '')}
                                                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px -2px rgb(0 0 0 / 0.1)' }}
                                            />
                                            <Line type="monotone" dataKey="avg" stroke="#3b82f6" strokeWidth={2} dot={false} name="RTT Médio" isAnimationActive={false} />
                                            <Line type="step" dataKey="threshold" stroke="#ef4444" strokeDasharray="5 5" dot={false} name="Limiar" isAnimationActive={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        )}

                        {activeTab === 'routine' && (
                            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                                <TimelineRoutine jid={jid} />
                            </div>
                        )}

                        {activeTab === 'settings' && (
                            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 space-y-6">
                                <div>
                                    <h5 className="text-base font-semibold text-gray-900">Ajuste de Frequência de Monitoramento</h5>
                                    <p className="text-xs text-gray-500 mt-1">
                                        Configure o intervalo entre as sondas (probes) para este contato específico.
                                    </p>
                                </div>

                                <div className="space-y-3">
                                    {[
                                        { val: 3000, label: '3 segundos', desc: 'Rápido - ideal para testes pontuais de um único contato.' },
                                        { val: 5000, label: '5 segundos (Padrão)', desc: 'Recomendado para rastreamento preciso com baixo risco.' },
                                        { val: 10000, label: '10 segundos', desc: 'Moderado - ideal para monitorar 5 a 15 contatos simultâneos.' },
                                        { val: 30000, label: '30 segundos', desc: 'Econômico - ideal para monitorar grandes listas de contatos.' },
                                        { val: 60000, label: '1 minuto', desc: 'Ultra leve - detecta grandes blocos de sono e uso com zero sobrecarga.' },
                                    ].map(opt => (
                                        <label
                                            key={opt.val}
                                            onClick={() => handleIntervalChange(opt.val)}
                                            className={clsx(
                                                "flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all",
                                                intervalValue === opt.val
                                                    ? "bg-blue-50/70 border-blue-400 ring-1 ring-blue-400"
                                                    : "hover:bg-gray-50 border-gray-200"
                                            )}
                                        >
                                            <input
                                                type="radio"
                                                name={`interval-${jid}`}
                                                checked={intervalValue === opt.val}
                                                onChange={() => handleIntervalChange(opt.val)}
                                                className="mt-1 text-blue-600 focus:ring-blue-500"
                                            />
                                            <div>
                                                <div className="text-sm font-semibold text-gray-900">{opt.label}</div>
                                                <div className="text-xs text-gray-500 mt-0.5">{opt.desc}</div>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
