import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';

// Database storage location
const DB_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

const DB_PATH = path.join(DB_DIR, 'tracker.sqlite');
const db = new DatabaseSync(DB_PATH);

// Initialize schema
export function initDb() {
    db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;

        CREATE TABLE IF NOT EXISTS tracked_contacts (
            jid TEXT PRIMARY KEY,
            number TEXT NOT NULL,
            name TEXT,
            profile_pic TEXT,
            platform TEXT NOT NULL DEFAULT 'whatsapp',
            probe_interval INTEGER NOT NULL DEFAULT 5000,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL,
            last_seen INTEGER,
            last_state TEXT DEFAULT 'Offline'
        );

        CREATE TABLE IF NOT EXISTS rtt_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            jid TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            rtt REAL NOT NULL,
            avg REAL NOT NULL,
            median REAL NOT NULL,
            threshold REAL NOT NULL,
            state TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_rtt_jid_timestamp ON rtt_records(jid, timestamp);

        CREATE TABLE IF NOT EXISTS state_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            jid TEXT NOT NULL,
            state TEXT NOT NULL,
            start_time INTEGER NOT NULL,
            end_time INTEGER,
            duration_ms INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_state_jid_start ON state_history(jid, start_time);

        CREATE TABLE IF NOT EXISTS discovered_contacts (
            jid TEXT PRIMARY KEY,
            number TEXT NOT NULL,
            name TEXT,
            profile_pic TEXT,
            last_updated INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_discovered_name ON discovered_contacts(name);
    `);
    console.log(`[DB] Database initialized at ${DB_PATH}`);
}

export interface TrackedContactRow {
    jid: string;
    number: string;
    name: string | null;
    profile_pic: string | null;
    platform: 'whatsapp' | 'signal';
    probe_interval: number;
    is_active: number;
    created_at: number;
    last_seen: number | null;
    last_state: string | null;
}

export function saveTrackedContact(data: {
    jid: string;
    number: string;
    name?: string | null;
    profile_pic?: string | null;
    platform: 'whatsapp' | 'signal';
    probe_interval?: number;
}) {
    const now = Date.now();
    const stmt = db.prepare(`
        INSERT INTO tracked_contacts (jid, number, name, profile_pic, platform, probe_interval, is_active, created_at, last_seen, last_state)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 'Offline')
        ON CONFLICT(jid) DO UPDATE SET
            is_active = 1,
            number = excluded.number,
            name = COALESCE(excluded.name, tracked_contacts.name),
            probe_interval = COALESCE(excluded.probe_interval, tracked_contacts.probe_interval)
    `);
    stmt.run(
        data.jid,
        data.number,
        data.name || null,
        data.profile_pic || null,
        data.platform,
        data.probe_interval || 5000,
        now,
        now
    );
}

export function getTrackedContacts(): TrackedContactRow[] {
    const stmt = db.prepare(`SELECT * FROM tracked_contacts WHERE is_active = 1 ORDER BY created_at DESC`);
    return stmt.all() as unknown as TrackedContactRow[];
}

export function removeTrackedContact(jid: string) {
    const stmt = db.prepare(`UPDATE tracked_contacts SET is_active = 0 WHERE jid = ?`);
    stmt.run(jid);
}

export function updateContactName(jid: string, name: string) {
    const stmt = db.prepare(`UPDATE tracked_contacts SET name = ? WHERE jid = ?`);
    stmt.run(name, jid);
}

export function updateContactProfilePic(jid: string, profilePic: string) {
    const stmt = db.prepare(`UPDATE tracked_contacts SET profile_pic = ? WHERE jid = ?`);
    stmt.run(profilePic, jid);
}

export function updateContactInterval(jid: string, intervalMs: number) {
    const stmt = db.prepare(`UPDATE tracked_contacts SET probe_interval = ? WHERE jid = ?`);
    stmt.run(intervalMs, jid);
}

// RTT Records
export function saveRttRecord(record: {
    jid: string;
    timestamp: number;
    rtt: number;
    avg: number;
    median: number;
    threshold: number;
    state: string;
}) {
    const stmt = db.prepare(`
        INSERT INTO rtt_records (jid, timestamp, rtt, avg, median, threshold, state)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
        record.jid,
        record.timestamp,
        record.rtt,
        record.avg,
        record.median,
        record.threshold,
        record.state
    );

    // Update last_seen and last_state in tracked_contacts
    const updateStmt = db.prepare(`
        UPDATE tracked_contacts 
        SET last_seen = ?, last_state = ?
        WHERE jid = ?
    `);
    updateStmt.run(record.timestamp, record.state, record.jid);

    // Update state transition timeline
    recordStateTransition(record.jid, record.state, record.timestamp);
}

export function getRttHistory(jid: string, limit = 60) {
    const stmt = db.prepare(`
        SELECT timestamp, rtt, avg, median, threshold, state
        FROM rtt_records
        WHERE jid = ?
        ORDER BY timestamp DESC
        LIMIT ?
    `);
    const rows = stmt.all(jid, limit);
    return (rows as any[]).reverse();
}

// State transitions (for Gantt / Activity Timeline)
function recordStateTransition(jid: string, newState: string, timestamp: number) {
    // Find current open transition
    const openStmt = db.prepare(`
        SELECT id, state, start_time 
        FROM state_history 
        WHERE jid = ? AND end_time IS NULL 
        ORDER BY start_time DESC 
        LIMIT 1
    `);
    const current = openStmt.get(jid) as { id: number; state: string; start_time: number } | undefined;

    if (!current) {
        // Create first transition
        const insertStmt = db.prepare(`
            INSERT INTO state_history (jid, state, start_time)
            VALUES (?, ?, ?)
        `);
        insertStmt.run(jid, newState, timestamp);
        return;
    }

    if (current.state !== newState) {
        // Close current transition
        const duration = Math.max(0, timestamp - current.start_time);
        const closeStmt = db.prepare(`
            UPDATE state_history 
            SET end_time = ?, duration_ms = ?
            WHERE id = ?
        `);
        closeStmt.run(timestamp, duration, current.id);

        // Open new transition
        const insertStmt = db.prepare(`
            INSERT INTO state_history (jid, state, start_time)
            VALUES (?, ?, ?)
        `);
        insertStmt.run(jid, newState, timestamp);
    }
}

export function getStateTimeline(jid: string, startTime: number, endTime: number = Date.now()) {
    const stmt = db.prepare(`
        SELECT id, state, start_time, COALESCE(end_time, ?) as end_time, 
               COALESCE(duration_ms, ? - start_time) as duration_ms
        FROM state_history
        WHERE jid = ? AND (end_time IS NULL OR end_time >= ?) AND start_time <= ?
        ORDER BY start_time ASC
    `);
    return stmt.all(endTime, endTime, jid, startTime, endTime);
}

// Activity summary (routine stats)
export function getActivitySummary(jid: string, startOfDay: number, endOfDay: number = Date.now()) {
    const transitions = getStateTimeline(jid, startOfDay, endOfDay) as Array<{
        state: string;
        start_time: number;
        end_time: number;
        duration_ms: number;
    }>;

    let totalOnlineMs = 0;
    let totalStandbyMs = 0;
    let totalOfflineMs = 0;
    let firstOnlineTime: number | null = null;
    let lastOnlineTime: number | null = null;
    let onlineSessionsCount = 0;

    for (const t of transitions) {
        const duration = Math.max(0, t.duration_ms || 0);
        if (t.state.includes('Online')) {
            totalOnlineMs += duration;
            onlineSessionsCount++;
            if (!firstOnlineTime || t.start_time < firstOnlineTime) {
                firstOnlineTime = t.start_time;
            }
            if (!lastOnlineTime || t.end_time > lastOnlineTime) {
                lastOnlineTime = t.end_time;
            }
        } else if (t.state.includes('Standby')) {
            totalStandbyMs += duration;
        } else {
            totalOfflineMs += duration;
        }
    }

    return {
        totalOnlineMs,
        totalStandbyMs,
        totalOfflineMs,
        onlineSessionsCount,
        firstOnlineTime,
        lastOnlineTime,
        transitionsCount: transitions.length
    };
}

// Discovered contacts (from WhatsApp address book and chat sync)
export function saveDiscoveredContacts(contacts: Array<{ jid: string; number: string; name?: string | null; profile_pic?: string | null }>) {
    if (!contacts.length) return;
    const now = Date.now();
    const insert = db.prepare(`
        INSERT INTO discovered_contacts (jid, number, name, profile_pic, last_updated)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(jid) DO UPDATE SET
            name = COALESCE(excluded.name, discovered_contacts.name),
            profile_pic = COALESCE(excluded.profile_pic, discovered_contacts.profile_pic),
            last_updated = excluded.last_updated
    `);

    for (const c of contacts) {
        if (!c.jid || c.jid.includes('@g.us')) continue; // Ignore groups
        insert.run(c.jid, c.number, c.name || null, c.profile_pic || null, now);
    }
}

export function getDiscoveredContacts(query = '', limit = 100) {
    if (!query) {
        const stmt = db.prepare(`
            SELECT * FROM discovered_contacts 
            ORDER BY COALESCE(name, number) ASC 
            LIMIT ?
        `);
        return stmt.all(limit);
    }

    const wildcard = `%${query}%`;
    const stmt = db.prepare(`
        SELECT * FROM discovered_contacts 
        WHERE name LIKE ? OR number LIKE ? 
        ORDER BY COALESCE(name, number) ASC 
        LIMIT ?
    `);
    return stmt.all(wildcard, wildcard, limit);
}
