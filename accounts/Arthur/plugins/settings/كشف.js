// ══════════════════════════════════════════════════════════════
//  كشف.js — رادار كشف البوتات
//  المنطق: البوت يظهر "متصل الآن" فوراً قبل إرسال الرسالة
//  الإنسان الحقيقي يكون متصلاً قبلها بوقت أطول
// ══════════════════════════════════════════════════════════════

// ── الحالة ──────────────────────────────────────────────────
const _presence     = new Map();   // jid → { connectedAt, composingAt }
const _cooldown     = new Map();   // jid → lastAlertTs
const _activeGroups = new Set();   // المجموعات النشطة
const _REGISTERED   = Symbol('kashfRegistered');

const CONNECT_BOT_WINDOW = 3_000;   // اتصال في آخر 3 ثوانٍ قبل الرسالة = بوت
const ALERT_COOLDOWN     = 120_000; // لا تكرر التنبيه لنفس الشخص قبل دقيقتين
const norm = j => j?.split('@')[0]?.split(':')[0] || '';

// ── مستمع الـ Presence ──────────────────────────────────────
function registerPresence(sock) {
    if (sock[_REGISTERED]) return;
    sock[_REGISTERED] = true;

    sock.ev.on('presence.update', ({ presences }) => {
        const now = Date.now();
        for (const [jid, data] of Object.entries(presences || {})) {
            if (!_presence.has(jid)) _presence.set(jid, {});
            const e = _presence.get(jid);
            const s = data?.lastKnownPresence;

            if (s === 'available')           e.connectedAt  = now;
            if (s === 'composing' ||
                s === 'recording')           e.composingAt  = now;
            // unavailable = مسح وقت الاتصال
            if (s === 'unavailable')         e.connectedAt  = null;
        }
    });
}

// ── منطق الكشف ──────────────────────────────────────────────
function isBot(jid) {
    const now = Date.now();
    const e   = _presence.get(jid) || {};

    // شرط 1: اتصل في آخر 3 ثوانٍ بالضبط قبل إرسال الرسالة
    const justConnected = e.connectedAt && (now - e.connectedAt) < CONNECT_BOT_WINDOW;

    // شرط 2: لم يُظهر "يكتب" أبداً
    const neverTyped = !e.composingAt;

    // شرط 3: لو كتب، كان أسرع من ثانية واحدة (مستحيل بشرياً)
    const impossiblyFast = e.composingAt && (now - e.composingAt) < 1_000;

    return justConnected && (neverTyped || impossiblyFast);
}

// ── featureHandler يعمل في الخلفية ───────────────────────────
async function kashfHandler(sock, msg) {
    try {
        if (!msg?.message || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        if (!chatId.endsWith('@g.us'))       return;
        if (!_activeGroups.has(chatId))      return;

        const jid = msg.key.participant;
        if (!jid) return;

        // تجاهل لو كان في فترة cooldown
        const now = Date.now();
        if ((_cooldown.get(jid) || 0) > now) return;

        if (!isBot(jid)) return;

        // ── تم رصد بوت ──────────────────────────────────────
        _cooldown.set(jid, now + ALERT_COOLDOWN);

        const mention = jid.endsWith('@s.whatsapp.net') ? jid : jid + '@s.whatsapp.net';

        await sock.sendMessage(chatId, {
            text: `_تم رصد بوت على هذا الرقم_ 🤖\n@${norm(jid)}`,
            mentions: [mention],
        }).catch(() => {});

    } catch {}
}
kashfHandler._src = 'kashf_system';

// ── تسجيل featureHandler ─────────────────────────────────────
function register() {
    if (!global.featureHandlers) global.featureHandlers = [];
    global.featureHandlers = global.featureHandlers.filter(h => h._src !== 'kashf_system');
    global.featureHandlers.push(kashfHandler);
}

// ══════════════════════════════════════════════════════════════
//  Plugin
// ══════════════════════════════════════════════════════════════
const KashfPlugin = {
    command:     'كشف',
    description: 'كشف البوتات في المجموعة',
    elite:       'on',
    group:       true,
    prv:         false,
    lock:        'off',
};

async function execute({ sock, msg, args }) {
    const chatId = msg.key.remoteJid;
    const sub    = (args[0] || '').trim();
    const reply  = t => sock.sendMessage(chatId, { text: t }, { quoted: msg }).catch(() => {});

    register();
    registerPresence(sock);

    // تشغيل (افتراضي)
    if (!sub || sub === 'تشغيل') {
        _activeGroups.add(chatId);
        try { await sock.presenceSubscribe(chatId); } catch {}
        return reply('`📡 الكشف مُفعَّل في هذه المجموعة`');
    }

    if (sub === 'إيقاف' || sub === 'ايقاف') {
        _activeGroups.delete(chatId);
        return reply('`📴 الكشف أُوقف`');
    }
}

export default { KashfPlugin, execute };
