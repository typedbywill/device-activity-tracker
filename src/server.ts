/**
 * Device Activity Tracker - Web Server
 *
 * HTTP server with Socket.IO for real-time tracking visualization.
 * Provides REST API and WebSocket interface for the React frontend.
 * With SQLite persistence, contact book sync, and routine timeline analysis.
 *
 * For educational and research purposes only.
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { pino } from 'pino';
import { Boom } from '@hapi/boom';
import { WhatsAppTracker, ProbeMethod } from './tracker.js';
import { SignalTracker, getSignalAccounts, checkSignalNumber } from './signal-tracker.js';
import {
    initDb,
    saveTrackedContact,
    getTrackedContacts,
    removeTrackedContact,
    updateContactName,
    updateContactProfilePic,
    updateContactInterval,
    saveRttRecord,
    getRttHistory,
    getStateTimeline,
    getActivitySummary,
    saveDiscoveredContacts,
    getDiscoveredContacts
} from './db.js';

// Initialize SQLite database
initDb();

// Configuration
const SIGNAL_API_URL = process.env.SIGNAL_API_URL || 'http://localhost:8080';

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

let sock: any;
let isWhatsAppConnected = false;
let isSignalConnected = false;
let signalAccountNumber: string | null = null;
let globalProbeMethod: ProbeMethod = 'delete';
let currentWhatsAppQr: string | null = null;

type Platform = 'whatsapp' | 'signal';

interface TrackerEntry {
    tracker: WhatsAppTracker | SignalTracker;
    platform: Platform;
    number: string;
    name?: string;
    probeInterval?: number;
}

const trackers: Map<string, TrackerEntry> = new Map();

// Helper to extract contacts from Baileys events
function handleContactsSync(contacts: any[]) {
    if (!Array.isArray(contacts)) return;
    const mapped = contacts
        .filter(c => c.id && c.id.endsWith('@s.whatsapp.net'))
        .map(c => {
            const number = c.id.split('@')[0];
            const name = c.name || c.notify || c.verifiedName || null;
            return { jid: c.id, number, name };
        });
    saveDiscoveredContacts(mapped);
}

function handleChatsSync(chats: any[]) {
    if (!Array.isArray(chats)) return;
    const mapped = chats
        .filter(c => c.id && c.id.endsWith('@s.whatsapp.net'))
        .map(c => {
            const number = c.id.split('@')[0];
            const name = c.name || null;
            return { jid: c.id, number, name };
        });
    saveDiscoveredContacts(mapped);
}

// Start WhatsApp tracking helper
async function startWhatsAppTracking(
    targetJid: string,
    cleanNumber: string,
    contactName?: string,
    probeInterval = 5000
): Promise<{ success: boolean; jid?: string; name?: string; reason?: string }> {
    if (trackers.has(targetJid)) {
        return { success: false, reason: 'Already tracking this contact' };
    }
    if (!sock || !isWhatsAppConnected) {
        return { success: false, reason: 'WhatsApp is not connected' };
    }

    try {
        const results = await sock.onWhatsApp(targetJid);
        const result = results?.[0];

        if (result?.exists) {
            const tracker = new WhatsAppTracker(sock, result.jid, false, probeInterval);
            tracker.setProbeMethod(globalProbeMethod);

            let finalName = contactName || cleanNumber;
            try {
                if (!contactName) {
                    const contactInfo = await sock.onWhatsApp(result.jid);
                    if (contactInfo && contactInfo[0]?.notify) {
                        finalName = contactInfo[0].notify;
                    }
                }
            } catch (err) {
                // Ignore
            }

            trackers.set(result.jid, {
                tracker,
                platform: 'whatsapp',
                number: cleanNumber,
                name: finalName,
                probeInterval
            });

            // Save to SQLite
            saveTrackedContact({
                jid: result.jid,
                number: cleanNumber,
                name: finalName,
                platform: 'whatsapp',
                probe_interval: probeInterval
            });

            tracker.onUpdate = (updateData) => {
                const now = Date.now();
                const primaryDevice = updateData.devices?.[0];
                const state = updateData.devices?.find((d: any) => d.state?.includes('Online'))?.state || primaryDevice?.state || 'Standby';

                if (updateData.median !== undefined && primaryDevice) {
                    saveRttRecord({
                        jid: result.jid,
                        timestamp: now,
                        rtt: primaryDevice.rtt,
                        avg: primaryDevice.avg,
                        median: updateData.median,
                        threshold: updateData.threshold,
                        state: state
                    });
                }

                io.emit('tracker-update', {
                    jid: result.jid,
                    platform: 'whatsapp',
                    ...updateData
                });
            };

            tracker.startTracking();

            // Fetch profile picture asynchronously
            tracker.getProfilePicture().then(ppUrl => {
                if (ppUrl) {
                    updateContactProfilePic(result.jid, ppUrl);
                    io.emit('profile-pic', { jid: result.jid, url: ppUrl });
                }
            }).catch(() => {});

            io.emit('contact-added', {
                jid: result.jid,
                number: cleanNumber,
                name: finalName,
                platform: 'whatsapp',
                probe_interval: probeInterval
            });
            io.emit('contact-name', { jid: result.jid, name: finalName });

            return { success: true, jid: result.jid, name: finalName };
        } else {
            return { success: false, reason: 'Number not registered on WhatsApp' };
        }
    } catch (err: any) {
        console.error(`Error tracking ${targetJid}:`, err);
        return { success: false, reason: err.message || 'Verification failed' };
    }
}

// Auto-resume contacts saved in database
async function resumeSavedTrackers() {
    const savedContacts = getTrackedContacts();
    console.log(`[AUTO-RESUME] Found ${savedContacts.length} contacts to resume tracking`);
    for (const c of savedContacts) {
        if (c.platform === 'whatsapp') {
            await startWhatsAppTracking(c.jid, c.number, c.name || undefined, c.probe_interval || 5000);
        }
    }
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'debug' }),
        markOnlineOnConnect: true,
        printQRInTerminal: false,
    });

    sock.ev.on('connection.update', async (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('QR Code generated');
            currentWhatsAppQr = qr;
            io.emit('qr', qr);
        }

        if (connection === 'close') {
            isWhatsAppConnected = false;
            currentWhatsAppQr = null;
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed, reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            isWhatsAppConnected = true;
            currentWhatsAppQr = null;
            console.log('WhatsApp connection opened successfully');
            io.emit('connection-open');

            // Auto-resume saved trackers
            resumeSavedTrackers().catch(err => console.error('[AUTO-RESUME] Error:', err));
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Sync contacts and chats to SQLite
    sock.ev.on('messaging-history.set', ({ chats, contacts, messages, isLatest }: any) => {
        console.log(`[SESSION] History sync - Chats: ${chats?.length || 0}, Contacts: ${contacts?.length || 0}, Messages: ${messages?.length || 0}, Latest: ${isLatest}`);
        if (contacts) handleContactsSync(contacts);
        if (chats) handleChatsSync(chats);
    });

    sock.ev.on('contacts.upsert', (newContacts: any[]) => {
        handleContactsSync(newContacts);
    });

    sock.ev.on('contacts.update', (updatedContacts: any[]) => {
        handleContactsSync(updatedContacts);
    });

    sock.ev.on('chats.upsert', (newChats: any[]) => {
        handleChatsSync(newChats);
    });
}

connectToWhatsApp();

// Signal linking state
let signalLinkingInProgress = false;
let signalApiAvailable = false;
let currentSignalQrUrl: string | null = null;

async function checkSignalApiAvailable(): Promise<boolean> {
    try {
        const response = await fetch(`${SIGNAL_API_URL}/v1/about`, {
            signal: AbortSignal.timeout(2000)
        });
        return response.ok;
    } catch {
        return false;
    }
}

async function checkSignalConnection() {
    try {
        const available = await checkSignalApiAvailable();
        if (available !== signalApiAvailable) {
            signalApiAvailable = available;
            console.log(`[SIGNAL] API available: ${available}`);
            io.emit('signal-api-status', { available });
        }

        if (!available) {
            if (isSignalConnected) {
                isSignalConnected = false;
                signalAccountNumber = null;
                io.emit('signal-disconnected');
            }
            return;
        }

        const accounts = await getSignalAccounts(SIGNAL_API_URL);
        if (accounts.length > 0) {
            if (!isSignalConnected) {
                isSignalConnected = true;
                signalAccountNumber = accounts[0];
                signalLinkingInProgress = false;
                console.log(`[SIGNAL] Connected with account: ${signalAccountNumber}`);
                io.emit('signal-connection-open', { number: signalAccountNumber });
            }
        } else {
            if (isSignalConnected) {
                isSignalConnected = false;
                signalAccountNumber = null;
                console.log('[SIGNAL] Disconnected');
                io.emit('signal-disconnected');
            }
            if (!signalLinkingInProgress) {
                startSignalLinking();
            }
        }
    } catch (err) {
        if (isSignalConnected) {
            isSignalConnected = false;
            signalAccountNumber = null;
            io.emit('signal-disconnected');
        }
    }
}

async function startSignalLinking() {
    if (signalLinkingInProgress || isSignalConnected) return;

    signalLinkingInProgress = true;
    console.log('[SIGNAL] Starting device linking...');

    try {
        const response = await fetch(`${SIGNAL_API_URL}/v1/qrcodelink?device_name=activity-tracker`);
        if (!response.ok) {
            signalLinkingInProgress = false;
            return;
        }

        currentSignalQrUrl = `${SIGNAL_API_URL}/v1/qrcodelink?device_name=activity-tracker&t=${Date.now()}`;
        io.emit('signal-qr-image', currentSignalQrUrl);
        pollSignalLinkingStatus();
    } catch (err) {
        signalLinkingInProgress = false;
    }
}

async function pollSignalLinkingStatus() {
    const checkInterval = setInterval(async () => {
        try {
            const accounts = await getSignalAccounts(SIGNAL_API_URL);
            if (accounts.length > 0) {
                clearInterval(checkInterval);
                signalLinkingInProgress = false;
                currentSignalQrUrl = null;
                isSignalConnected = true;
                signalAccountNumber = accounts[0];
                io.emit('signal-connection-open', { number: signalAccountNumber });
            }
        } catch (err) {
            // Keep polling
        }
    }, 2000);

    setTimeout(() => {
        clearInterval(checkInterval);
        signalLinkingInProgress = false;
    }, 300000);
}

checkSignalConnection();
setInterval(checkSignalConnection, 5000);

// REST API endpoints
app.get('/api/contacts/discovered', (req, res) => {
    const q = (req.query.q as string) || '';
    const contacts = getDiscoveredContacts(q);
    res.json(contacts);
});

app.get('/api/contacts/tracked', (req, res) => {
    const contacts = getTrackedContacts();
    res.json(contacts);
});

app.get('/api/contacts/:jid/history', (req, res) => {
    const limit = parseInt(req.query.limit as string, 10) || 100;
    const history = getRttHistory(req.params.jid, limit);
    res.json(history);
});

app.get('/api/contacts/:jid/timeline', (req, res) => {
    const since = parseInt(req.query.since as string, 10) || (Date.now() - 24 * 3600 * 1000);
    const until = parseInt(req.query.until as string, 10) || Date.now();
    const timeline = getStateTimeline(req.params.jid, since, until);
    res.json(timeline);
});

app.get('/api/contacts/:jid/summary', (req, res) => {
    const startOfToday = new Date().setHours(0, 0, 0, 0);
    const summary = getActivitySummary(req.params.jid, startOfToday, Date.now());
    res.json(summary);
});

// Socket.IO event handlers
io.on('connection', (socket) => {
    console.log('Client connected');

    if (currentWhatsAppQr) {
        socket.emit('qr', currentWhatsAppQr);
    }
    if (isWhatsAppConnected) {
        socket.emit('connection-open');
    }
    if (isSignalConnected && signalAccountNumber) {
        socket.emit('signal-connection-open', { number: signalAccountNumber });
    }

    socket.emit('signal-api-status', { available: signalApiAvailable });

    if (signalLinkingInProgress && currentSignalQrUrl) {
        socket.emit('signal-qr-image', currentSignalQrUrl);
    }

    socket.emit('probe-method', globalProbeMethod);

    // Send tracked contacts list (from DB + memory)
    const sendTrackedContactsList = () => {
        const saved = getTrackedContacts();
        const list = saved.map(s => ({
            id: s.jid,
            number: s.number,
            name: s.name || s.number,
            profilePic: s.profile_pic,
            platform: s.platform,
            probeInterval: s.probe_interval,
            lastSeen: s.last_seen,
            lastState: s.last_state
        }));
        socket.emit('tracked-contacts-detailed', list);
        socket.emit('tracked-contacts', list.map(c => ({ id: c.id, platform: c.platform })));
    };

    sendTrackedContactsList();

    socket.on('get-tracked-contacts', () => {
        sendTrackedContactsList();
    });

    // Discovered contacts (from WhatsApp address book)
    socket.on('get-discovered-contacts', (query: string = '') => {
        const contacts = getDiscoveredContacts(query);
        socket.emit('discovered-contacts', contacts);
    });

    // Request history and routine summary for a contact
    socket.on('get-contact-history', (jid: string) => {
        const rttHistory = getRttHistory(jid, 100);
        const startOfToday = new Date().setHours(0, 0, 0, 0);
        const timeline = getStateTimeline(jid, startOfToday, Date.now());
        const summary = getActivitySummary(jid, startOfToday, Date.now());
        socket.emit('contact-history', {
            jid,
            rttHistory,
            timeline,
            summary
        });
    });

    // Batch add contacts
    socket.on('add-contacts-batch', async (items: Array<{ number: string; name?: string; probe_interval?: number }>) => {
        if (!Array.isArray(items)) return;
        const results = [];
        for (const item of items) {
            const cleanNumber = item.number.replace(/\D/g, '');
            if (!cleanNumber) continue;
            const targetJid = cleanNumber + '@s.whatsapp.net';
            const res = await startWhatsAppTracking(targetJid, cleanNumber, item.name, item.probe_interval || 5000);
            results.push({ number: cleanNumber, ...res });
        }
        socket.emit('batch-added-result', results);
        sendTrackedContactsList();
    });

    // Set probe interval for a specific contact
    socket.on('set-contact-interval', (data: { jid: string; interval: number }) => {
        const { jid, interval } = data;
        const entry = trackers.get(jid);
        if (entry && entry.platform === 'whatsapp') {
            (entry.tracker as WhatsAppTracker).setProbeInterval(interval);
            entry.probeInterval = interval;
            updateContactInterval(jid, interval);
            io.emit('contact-interval-updated', { jid, interval });
        }
    });

    // Single add contact (backward compatibility)
    socket.on('add-contact', async (data: string | { number: string; platform: Platform; name?: string; probe_interval?: number }) => {
        const { number, platform, name, probe_interval } = typeof data === 'string'
            ? { number: data, platform: 'whatsapp' as Platform, name: undefined, probe_interval: 5000 }
            : data;

        const cleanNumber = number.replace(/\D/g, '');

        if (platform === 'signal') {
            if (!isSignalConnected || !signalAccountNumber) {
                socket.emit('error', { message: 'Signal is not connected. Please link Signal first.' });
                return;
            }

            const signalId = `signal:${cleanNumber}`;
            if (trackers.has(signalId)) {
                socket.emit('error', { jid: signalId, message: 'Already tracking this contact on Signal' });
                return;
            }

            try {
                const targetNumber = cleanNumber.startsWith('+') ? cleanNumber : `+${cleanNumber}`;
                const checkResult = await checkSignalNumber(SIGNAL_API_URL, signalAccountNumber, targetNumber);

                if (!checkResult.registered) {
                    socket.emit('error', {
                        jid: signalId,
                        message: checkResult.error || 'Number is not registered on Signal'
                    });
                    return;
                }

                const tracker = new SignalTracker(SIGNAL_API_URL, signalAccountNumber, targetNumber);
                trackers.set(signalId, { tracker, platform: 'signal', number: cleanNumber, name });

                saveTrackedContact({
                    jid: signalId,
                    number: cleanNumber,
                    name: name || cleanNumber,
                    platform: 'signal',
                    probe_interval: probe_interval || 5000
                });

                tracker.onUpdate = (updateData) => {
                    const now = Date.now();
                    const primaryDevice = updateData.devices?.[0];
                    const state = updateData.devices?.find((d: any) => d.state?.includes('Online'))?.state || primaryDevice?.state || 'Standby';

                    if (updateData.median !== undefined && primaryDevice) {
                        saveRttRecord({
                            jid: signalId,
                            timestamp: now,
                            rtt: primaryDevice.rtt,
                            avg: primaryDevice.avg,
                            median: updateData.median,
                            threshold: updateData.threshold,
                            state: state
                        });
                    }

                    io.emit('tracker-update', {
                        jid: signalId,
                        platform: 'signal',
                        ...updateData
                    });
                };

                tracker.startTracking();

                socket.emit('contact-added', {
                    jid: signalId,
                    number: cleanNumber,
                    name: name || cleanNumber,
                    platform: 'signal'
                });
                io.emit('contact-name', { jid: signalId, name: name || cleanNumber });
            } catch (err) {
                socket.emit('error', { message: 'Failed to start Signal tracking' });
            }
        } else {
            const targetJid = cleanNumber + '@s.whatsapp.net';
            const res = await startWhatsAppTracking(targetJid, cleanNumber, name, probe_interval || 5000);
            if (!res.success) {
                socket.emit('error', { jid: targetJid, message: res.reason });
            }
        }
    });

    socket.on('remove-contact', (jid: string) => {
        console.log(`Request to stop tracking: ${jid}`);
        const entry = trackers.get(jid);
        if (entry) {
            entry.tracker.stopTracking();
            trackers.delete(jid);
        }
        removeTrackedContact(jid);
        io.emit('contact-removed', jid);
    });

    socket.on('set-probe-method', (method: ProbeMethod) => {
        if (method !== 'delete' && method !== 'reaction') {
            socket.emit('error', { message: 'Invalid probe method' });
            return;
        }

        globalProbeMethod = method;

        for (const entry of trackers.values()) {
            if (entry.platform === 'whatsapp') {
                (entry.tracker as WhatsAppTracker).setProbeMethod(method);
            }
        }

        io.emit('probe-method', method);
    });
});

const PORT = parseInt(process.env.PORT || '3001', 10);
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
