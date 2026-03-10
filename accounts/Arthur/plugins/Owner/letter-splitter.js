// ══════════════════════════════════════════════════════════════
//  فاك الحروف — يكتشف تلقائياً
//  *✒️〔نيل〕✒️*  →  ن ي ل
//  *اهلا*         →  ا ه ل ا
//  شرط: ما تتجاوز 6 حروف عربية
// ══════════════════════════════════════════════════════════════

// ── استخراج الحروف العربية فقط ────────────────────────────────
function extractArabic(text) {
    // يشيل كل شي ما هو حرف عربي (إيموجي، رموز، نجوم، أقواس...)
    return text.replace(/[^\u0600-\u06FF]/g, '');
}

// ── تحقق إن النص فيه كلمة مزخرفة أو بنجوم ────────────────────
function detectTarget(text) {
    // حالة 1: نجوم مع محتوى  *...*
    const starMatch = text.match(/\*([^*]+)\*/);
    if (starMatch) {
        const arabic = extractArabic(starMatch[1]);
        if (arabic.length >= 2 && arabic.length <= 6) {
            return arabic;
        }
    }

    // حالة 2: زخرفة وسطها كلمة — يشيل كل غير عربي
    const allArabic = extractArabic(text);
    if (allArabic.length >= 2 && allArabic.length <= 6 && text !== allArabic) {
        // يعني النص الأصلي فيه زخرفة إضافية
        return allArabic;
    }

    return null;
}

// ── featureHandler التلقائي ───────────────────────────────────
async function letterSplitter(sock, msg) {
    try {
        const chatId = msg?.key?.remoteJid;
        if (!chatId) return;
        if (msg?.key?.fromMe) return;

        const text = (
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption || ''
        ).trim();

        if (!text) return;

        // تجاهل الأوامر
        const pfx = global._botConfig?.prefix || global._botConfig?.defaultPrefix || '.';
        if (text.startsWith(pfx)) return;

        const arabic = detectTarget(text);
        if (!arabic) return;

        // فكك الحروف
        const split = arabic.split('').join(' ');

        await sock.sendMessage(chatId, {
            text: split
        }, { quoted: msg });

    } catch {}
    return true;
}
letterSplitter._src = 'letter_splitter';

if (!global.featureHandlers) global.featureHandlers = [];
global.featureHandlers = global.featureHandlers.filter(h => h._src !== 'letter_splitter');
global.featureHandlers.push(letterSplitter);

// ── export وهمي عشان يتحمل كبلوجن ───────────────────────────
export default {
    NovaUltra: {
        command: '__letter_splitter__',
        description: 'فاك الحروف تلقائي',
        elite: 'off', group: false, prv: false, lock: 'off'
    },
    execute: async () => {}
};
