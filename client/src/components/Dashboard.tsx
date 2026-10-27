import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, Plus, Trash2, Zap, MessageCircle, Settings, Users, BookOpen } from 'lucide-react';
import { socket, Platform, ConnectionState } from '../App';
import { ContactCard } from './ContactCard';
import { Login } from './Login';
import { ImportModal } from './ImportModal';

type ProbeMethod = 'delete' | 'reaction';

interface DashboardProps {
    connectionState: ConnectionState;
}

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

interface ContactInfo {
    jid: string;
    displayNumber: string;
    contactName: string;
    data: TrackerData[];
    devices: DeviceInfo[];
    deviceCount: number;
    presence: string | null;
    profilePic: string | null;
    platform: Platform;
    probeInterval?: number;
}

export function Dashboard({ connectionState }: DashboardProps) {
    const [inputNumber, setInputNumber] = useState('');
    const [selectedPlatform, setSelectedPlatform] = useState<Platform>(
        connectionState.whatsapp ? 'whatsapp' : 'signal'
    );
    const [contacts, setContacts] = useState<Map<string, ContactInfo>>(new Map());
    const [error, setError] = useState<string | null>(null);
    const [privacyMode, setPrivacyMode] = useState(false);
    const [probeMethod, setProbeMethod] = useState<ProbeMethod>('delete');
    const [showConnections, setShowConnections] = useState(false);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);

    useEffect(() => {
        function onTrackerUpdate(update: any) {
            const { jid, ...data } = update;
            if (!jid) return;

            setContacts(prev => {
                const next = new Map(prev);
                const contact = next.get(jid);

                if (contact) {
                    const updatedContact = { ...contact };

                    if (data.presence !== undefined) {
                        updatedContact.presence = data.presence;
                    }
                    if (data.deviceCount !== undefined) {
                        updatedContact.deviceCount = data.deviceCount;
                    }
                    if (data.devices !== undefined) {
                        updatedContact.devices = data.devices;
                    }

                    if (data.median !== undefined && data.devices && data.devices.length > 0) {
                        const newDataPoint: TrackerData = {
                            rtt: data.devices[0].rtt,
                            avg: data.devices[0].avg,
                            median: data.median,
                            threshold: data.threshold,
                            state: data.devices.find((d: DeviceInfo) => d.state.includes('Online'))?.state || data.devices[0].state,
                            timestamp: Date.now(),
                        };
                        updatedContact.data = [...updatedContact.data.slice(-59), newDataPoint];
                    }

                    next.set(jid, updatedContact);
                }

                return next;
            });
        }

        function onProfilePic(data: { jid: string, url: string | null }) {
            setContacts(prev => {
                const next = new Map(prev);
                const contact = next.get(data.jid);
                if (contact) {
                    next.set(data.jid, { ...contact, profilePic: data.url });
                }
                return next;
            });
        }

        function onContactName(data: { jid: string, name: string }) {
            setContacts(prev => {
                const next = new Map(prev);
                const contact = next.get(data.jid);
                if (contact) {
                    next.set(data.jid, { ...contact, contactName: data.name });
                }
                return next;
            });
        }

        function onContactAdded(data: { jid: string, number: string, name?: string, platform?: Platform, probe_interval?: number }) {
            setContacts(prev => {
                const next = new Map(prev);
                next.set(data.jid, {
                    jid: data.jid,
                    displayNumber: data.number,
                    contactName: data.name || data.number,
                    data: [],
                    devices: [],
                    deviceCount: 1,
                    presence: null,
                    profilePic: null,
                    platform: data.platform || 'whatsapp',
                    probeInterval: data.probe_interval || 5000
                });
                return next;
            });
            setInputNumber('');
            // Query history from DB
            socket.emit('get-contact-history', data.jid);
        }

        function onContactRemoved(jid: string) {
            setContacts(prev => {
                const next = new Map(prev);
                next.delete(jid);
                return next;
            });
        }

        function onError(data: { jid?: string, message: string }) {
            setError(data.message);
            setTimeout(() => setError(null), 3000);
        }

        function onProbeMethod(method: ProbeMethod) {
            setProbeMethod(method);
        }

        function onTrackedContactsDetailed(list: any[]) {
            if (!Array.isArray(list)) return;
            setContacts(prev => {
                const next = new Map(prev);
                list.forEach(c => {
                    if (!next.has(c.id)) {
                        next.set(c.id, {
                            jid: c.id,
                            displayNumber: c.number,
                            contactName: c.name || c.number,
                            data: [],
                            devices: c.lastState ? [{ jid: c.id, state: c.lastState, rtt: 0, avg: 0 }] : [],
                            deviceCount: 1,
                            presence: null,
                            profilePic: c.profilePic || null,
                            platform: c.platform,
                            probeInterval: c.probeInterval || 5000
                        });
                        // Request history
                        socket.emit('get-contact-history', c.id);
                    }
                });
                return next;
            });
        }

        function onContactHistory(histData: any) {
            const { jid, rttHistory } = histData;
            if (!jid || !rttHistory) return;
            setContacts(prev => {
                const next = new Map(prev);
                const contact = next.get(jid);
                if (contact && rttHistory.length > 0) {
                    next.set(jid, {
                        ...contact,
                        data: rttHistory
                    });
                }
                return next;
            });
        }

        function onContactIntervalUpdated(data: { jid: string; interval: number }) {
            setContacts(prev => {
                const next = new Map(prev);
                const contact = next.get(data.jid);
                if (contact) {
                    next.set(data.jid, {
                        ...contact,
                        probeInterval: data.interval
                    });
                }
                return next;
            });
        }

        socket.on('tracker-update', onTrackerUpdate);
        socket.on('profile-pic', onProfilePic);
        socket.on('contact-name', onContactName);
        socket.on('contact-added', onContactAdded);
        socket.on('contact-removed', onContactRemoved);
        socket.on('error', onError);
        socket.on('probe-method', onProbeMethod);
        socket.on('tracked-contacts-detailed', onTrackedContactsDetailed);
        socket.on('contact-history', onContactHistory);
        socket.on('contact-interval-updated', onContactIntervalUpdated);

        // Fetch contacts
        socket.emit('get-tracked-contacts');

        return () => {
            socket.off('tracker-update', onTrackerUpdate);
            socket.off('profile-pic', onProfilePic);
            socket.off('contact-name', onContactName);
            socket.off('contact-added', onContactAdded);
            socket.off('contact-removed', onContactRemoved);
            socket.off('error', onError);
            socket.off('probe-method', onProbeMethod);
            socket.off('tracked-contacts-detailed', onTrackedContactsDetailed);
            socket.off('contact-history', onContactHistory);
            socket.off('contact-interval-updated', onContactIntervalUpdated);
        };
    }, []);

    const handleAdd = () => {
        if (!inputNumber) return;
        socket.emit('add-contact', { number: inputNumber, platform: selectedPlatform });
    };

    const handleRemove = (jid: string) => {
        socket.emit('remove-contact', jid);
    };

    const handleProbeMethodChange = (method: ProbeMethod) => {
        socket.emit('set-probe-method', method);
    };

    return (
        <div className="space-y-6">
            {/* Top Toolbar */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                <div className="flex flex-wrap justify-between items-center gap-4 mb-5">
                    <div className="flex items-center gap-3">
                        <h2 className="text-xl font-bold text-gray-900">Monitor de Atividade</h2>
                        <button
                            onClick={() => setShowConnections(!showConnections)}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-all flex items-center gap-1.5 ${
                                showConnections
                                    ? 'bg-gray-800 text-white'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                        >
                            <Settings size={14} />
                            {showConnections ? 'Ocultar Conexões' : 'Gerenciar Conexões'}
                        </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        {/* Import Contacts Button */}
                        <button
                            onClick={() => setIsImportModalOpen(true)}
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-sm hover:shadow"
                        >
                            <Users size={15} />
                            Importar Contatos da Agenda
                        </button>

                        {/* Probe Method Toggle */}
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 font-medium">Método de Sonda:</span>
                            <div className="flex rounded-xl overflow-hidden border border-gray-200 bg-gray-50 p-0.5">
                                <button
                                    onClick={() => handleProbeMethodChange('delete')}
                                    className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1 ${
                                        probeMethod === 'delete'
                                            ? 'bg-purple-600 text-white shadow-sm'
                                            : 'text-gray-600 hover:text-gray-900'
                                    }`}
                                    title="Sonda Silenciosa de Exclusão (Totalmente invisível para o alvo)"
                                >
                                    <Trash2 size={13} />
                                    Delete
                                </button>
                                <button
                                    onClick={() => handleProbeMethodChange('reaction')}
                                    className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1 ${
                                        probeMethod === 'reaction'
                                            ? 'bg-amber-500 text-white shadow-sm'
                                            : 'text-gray-600 hover:text-gray-900'
                                    }`}
                                    title="Sonda por Reação"
                                >
                                    <Zap size={13} />
                                    Reação
                                </button>
                            </div>
                        </div>

                        {/* Privacy Mode Toggle */}
                        <button
                            onClick={() => setPrivacyMode(!privacyMode)}
                            className={`px-3.5 py-1.5 rounded-xl flex items-center gap-1.5 text-xs font-semibold transition-all ${
                                privacyMode
                                    ? 'bg-emerald-600 text-white shadow-sm'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                        >
                            {privacyMode ? (
                                <>
                                    <EyeOff size={15} />
                                    <span>Privacidade ON</span>
                                </>
                            ) : (
                                <>
                                    <Eye size={15} />
                                    <span>Privacidade OFF</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* Quick Add Form */}
                <div className="flex flex-wrap gap-3">
                    <div className="flex rounded-xl overflow-hidden border border-gray-200 bg-gray-50 p-0.5">
                        <button
                            onClick={() => setSelectedPlatform('whatsapp')}
                            disabled={!connectionState.whatsapp}
                            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                                selectedPlatform === 'whatsapp'
                                    ? 'bg-emerald-600 text-white shadow-sm'
                                    : connectionState.whatsapp
                                        ? 'text-gray-600 hover:text-gray-900'
                                        : 'text-gray-400 cursor-not-allowed'
                            }`}
                        >
                            <MessageCircle size={14} />
                            WhatsApp
                        </button>
                        <button
                            onClick={() => setSelectedPlatform('signal')}
                            disabled={!connectionState.signal}
                            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                                selectedPlatform === 'signal'
                                    ? 'bg-blue-600 text-white shadow-sm'
                                    : connectionState.signal
                                        ? 'text-gray-600 hover:text-gray-900'
                                        : 'text-gray-400 cursor-not-allowed'
                            }`}
                        >
                            <MessageCircle size={14} />
                            Signal
                        </button>
                    </div>

                    <input
                        type="text"
                        placeholder="Adicionar número único com DDI e DDD (ex: 5511999998888)"
                        className="flex-1 min-w-[240px] px-4 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                        value={inputNumber}
                        onChange={(e) => setInputNumber(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleAdd()}
                    />
                    <button
                        onClick={handleAdd}
                        className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors shadow-sm"
                    >
                        <Plus size={16} /> Adicionar
                    </button>
                </div>

                {error && <p className="mt-3 text-red-500 text-xs font-semibold">{error}</p>}
            </div>

            {/* Connections Panel */}
            {showConnections && (
                <Login connectionState={connectionState} />
            )}

            {/* Import Modal */}
            <ImportModal
                isOpen={isImportModalOpen}
                onClose={() => setIsImportModalOpen(false)}
            />

            {/* Contact Cards */}
            {contacts.size === 0 ? (
                <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center shadow-sm">
                    <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto text-blue-600 mb-4">
                        <Users size={32} />
                    </div>
                    <p className="text-gray-800 text-lg font-bold">Nenhum contato monitorado</p>
                    <p className="text-gray-400 text-sm mt-1 mb-5">
                        Clique em "Importar Contatos da Agenda" para selecionar vários de uma vez ou digite um número acima.
                    </p>
                    <button
                        onClick={() => setIsImportModalOpen(true)}
                        className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold inline-flex items-center gap-2 shadow-sm"
                    >
                        <Users size={16} /> Abrir Agenda do WhatsApp
                    </button>
                </div>
            ) : (
                <div className="space-y-6">
                    {Array.from(contacts.values()).map(contact => (
                        <ContactCard
                            key={contact.jid}
                            jid={contact.jid}
                            displayNumber={contact.displayNumber}
                            contactName={contact.contactName}
                            probeInterval={contact.probeInterval}
                            data={contact.data}
                            devices={contact.devices}
                            deviceCount={contact.deviceCount}
                            presence={contact.presence}
                            profilePic={contact.profilePic}
                            onRemove={() => handleRemove(contact.jid)}
                            privacyMode={privacyMode}
                            platform={contact.platform}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
