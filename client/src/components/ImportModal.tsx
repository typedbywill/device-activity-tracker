import React, { useState, useEffect } from 'react';
import { X, Search, Users, ClipboardList, CheckSquare, Square, RefreshCw, AlertCircle } from 'lucide-react';
import { socket } from '../App';

interface DiscoveredContact {
    jid: string;
    number: string;
    name: string | null;
    profile_pic: string | null;
}

interface ImportModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function ImportModal({ isOpen, onClose }: ImportModalProps) {
    const [tab, setTab] = useState<'agenda' | 'batch'>('agenda');
    const [searchQuery, setSearchQuery] = useState('');
    const [contacts, setContacts] = useState<DiscoveredContact[]>([]);
    const [selectedJids, setSelectedJids] = useState<Set<string>>(new Set());
    const [probeInterval, setProbeInterval] = useState<number>(5000);
    const [rawNumbers, setRawNumbers] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) return;

        setIsLoading(true);
        socket.emit('get-discovered-contacts', searchQuery);

        function onDiscovered(list: DiscoveredContact[]) {
            setContacts(list || []);
            setIsLoading(false);
        }

        socket.on('discovered-contacts', onDiscovered);

        return () => {
            socket.off('discovered-contacts', onDiscovered);
        };
    }, [isOpen, searchQuery]);

    if (!isOpen) return null;

    const toggleSelect = (jid: string) => {
        setSelectedJids(prev => {
            const next = new Set(prev);
            if (next.has(jid)) {
                next.delete(jid);
            } else {
                next.add(jid);
            }
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedJids.size === contacts.length && contacts.length > 0) {
            setSelectedJids(new Set());
        } else {
            setSelectedJids(new Set(contacts.map(c => c.jid)));
        }
    };

    const handleImportAgenda = () => {
        if (selectedJids.size === 0) return;
        setIsSubmitting(true);
        setStatusMessage(null);

        const selectedContacts = contacts.filter(c => selectedJids.has(c.jid));
        const payload = selectedContacts.map(c => ({
            number: c.number,
            name: c.name || c.number,
            probe_interval: probeInterval
        }));

        socket.emit('add-contacts-batch', payload);

        setTimeout(() => {
            setIsSubmitting(false);
            onClose();
        }, 1000);
    };

    const handleImportBatchText = () => {
        const lines = rawNumbers.split(/[\n,;]+/);
        const cleanList = lines
            .map(l => l.replace(/\D/g, ''))
            .filter(n => n.length >= 8);

        if (cleanList.length === 0) {
            setStatusMessage('Nenhum número válido encontrado no texto.');
            return;
        }

        setIsSubmitting(true);
        setStatusMessage(null);

        const payload = cleanList.map(num => ({
            number: num,
            name: num,
            probe_interval: probeInterval
        }));

        socket.emit('add-contacts-batch', payload);

        setTimeout(() => {
            setIsSubmitting(false);
            onClose();
        }, 1000);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden border border-gray-100">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/50">
                    <div className="flex items-center gap-2">
                        <Users className="w-5 h-5 text-blue-600" />
                        <h3 className="font-semibold text-gray-800 text-lg">Importar Contatos</h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-gray-200 px-6 bg-white">
                    <button
                        onClick={() => setTab('agenda')}
                        className={`flex items-center gap-2 py-3 px-4 font-medium text-sm border-b-2 transition-colors ${
                            tab === 'agenda'
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        <Users className="w-4 h-4" />
                        Agenda do WhatsApp
                    </button>
                    <button
                        onClick={() => setTab('batch')}
                        className={`flex items-center gap-2 py-3 px-4 font-medium text-sm border-b-2 transition-colors ${
                            tab === 'batch'
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        <ClipboardList className="w-4 h-4" />
                        Colar em Lote (Texto)
                    </button>
                </div>

                {/* Global Interval Selector */}
                <div className="px-6 py-3 bg-blue-50/50 border-b border-blue-100 flex items-center justify-between text-xs text-blue-900">
                    <span className="font-medium flex items-center gap-1.5">
                        <AlertCircle className="w-4 h-4 text-blue-600" />
                        Intervalo de Sondagem (por contato):
                    </span>
                    <select
                        value={probeInterval}
                        onChange={(e) => setProbeInterval(Number(e.target.value))}
                        className="bg-white border border-blue-200 rounded-lg px-2.5 py-1 font-semibold text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value={3000}>3 segundos (Agressivo / Poucos contatos)</option>
                        <option value={5000}>5 segundos (Recomendado)</option>
                        <option value={10000}>10 segundos (Moderado)</option>
                        <option value={30000}>30 segundos (Econômico / Muitos contatos)</option>
                        <option value={60000}>1 minuto (Mínimo impacto)</option>
                    </select>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {tab === 'agenda' ? (
                        <div className="flex flex-col h-full gap-4">
                            {/* Search and Select All */}
                            <div className="flex items-center gap-3">
                                <div className="relative flex-1">
                                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input
                                        type="text"
                                        placeholder="Buscar por nome ou número..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <button
                                    onClick={toggleSelectAll}
                                    className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 px-3 py-2 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
                                >
                                    {selectedJids.size > 0 && selectedJids.size === contacts.length ? (
                                        <CheckSquare className="w-4 h-4 text-blue-600" />
                                    ) : (
                                        <Square className="w-4 h-4 text-gray-400" />
                                    )}
                                    {selectedJids.size === contacts.length && contacts.length > 0 ? 'Desmarcar' : 'Marcar Todos'}
                                </button>
                                <button
                                    onClick={() => socket.emit('get-discovered-contacts', searchQuery)}
                                    className="p-2 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600 transition-colors"
                                    title="Atualizar"
                                >
                                    <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                                </button>
                            </div>

                            {/* Contact List */}
                            <div className="flex-1 overflow-y-auto border border-gray-100 rounded-xl divide-y divide-gray-100 max-h-[350px]">
                                {isLoading ? (
                                    <div className="p-8 text-center text-gray-400 text-sm">Carregando contatos sincronizados...</div>
                                ) : contacts.length === 0 ? (
                                    <div className="p-8 text-center text-gray-400 text-sm">
                                        Nenhum contato encontrado no cache do WhatsApp.
                                        <p className="text-xs text-gray-400 mt-1">Converse com alguém ou aguarde a sincronização inicial.</p>
                                    </div>
                                ) : (
                                    contacts.map(c => {
                                        const isSelected = selectedJids.has(c.jid);
                                        return (
                                            <div
                                                key={c.jid}
                                                onClick={() => toggleSelect(c.jid)}
                                                className={`flex items-center justify-between p-3 cursor-pointer transition-colors ${
                                                    isSelected ? 'bg-blue-50/60' : 'hover:bg-gray-50'
                                                }`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center font-bold text-blue-600 text-sm overflow-hidden">
                                                        {c.profile_pic ? (
                                                            <img src={c.profile_pic} alt="" className="w-full h-full object-cover" />
                                                        ) : (
                                                            (c.name || c.number).charAt(0).toUpperCase()
                                                        )}
                                                    </div>
                                                    <div>
                                                        <div className="font-medium text-gray-800 text-sm">
                                                            {c.name || c.number}
                                                        </div>
                                                        <div className="text-xs text-gray-400">
                                                            +{c.number}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div>
                                                    {isSelected ? (
                                                        <CheckSquare className="w-5 h-5 text-blue-600" />
                                                    ) : (
                                                        <Square className="w-5 h-5 text-gray-300" />
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-3">
                            <label className="text-sm font-medium text-gray-700">
                                Cole os números com código do país (ex: 5511999998888):
                            </label>
                            <textarea
                                rows={8}
                                placeholder={`5511999998888\n5521988887777\n5531977776666`}
                                value={rawNumbers}
                                onChange={(e) => setRawNumbers(e.target.value)}
                                className="w-full p-3 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <p className="text-xs text-gray-400">
                                Você pode colar números separados por nova linha, vírgula ou ponto-e-vírgula.
                            </p>
                        </div>
                    )}

                    {statusMessage && (
                        <div className="mt-3 p-2.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-xl text-xs flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                            {statusMessage}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50/50">
                    <span className="text-xs text-gray-500 font-medium">
                        {tab === 'agenda' ? `${selectedJids.size} contatos selecionados` : ''}
                    </span>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={tab === 'agenda' ? handleImportAgenda : handleImportBatchText}
                            disabled={isSubmitting || (tab === 'agenda' ? selectedJids.size === 0 : !rawNumbers.trim())}
                            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-2 shadow-sm"
                        >
                            {isSubmitting ? (
                                <>
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                    Adicionando...
                                </>
                            ) : (
                                `Iniciar Rastreamento ${tab === 'agenda' && selectedJids.size > 0 ? `(${selectedJids.size})` : ''}`
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
