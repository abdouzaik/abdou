// ════════════════════════════════════════════════
//  نظام.js — الملف الرئيسي
// ════════════════════════════════════════════════
import configObj from '../../nova/config.js';
if (!global.api && configObj?.api) global.api = configObj.api;
if (!global._botConfig) global._botConfig = {};
global._botConfig.owner = (configObj?.owner || '213540419314').toString().replace(/\D/g, '');

import {
    sleep, react, reactWait, reactOk, reactFail, reactInput,
    normalizeJid, getBotJid, checkElite,
    grpFile, DATA_DIR, BOT_DIR, activeSessions, MAIN_MENU,
    registerDeleteListener, registerWelcomeListener,
} from './_utils.js';

import { handleElite,   showEliteMenu }              from './s_نخبة.js';
import { handlePlugins, showPluginsMenu }             from './s_بلاجنز.js';
import { handleDl,      showDlMenu, handleDownload }  from './s_تنزيلات.js';
import { handleGeneral, showStats, showProtMenu,
         showCmdTools }                               from './s_عام.js';
import { handleAdmin,   showAdminMenu }               from './s_إدارة.js';
import { handleBot,     showBotMenu }                 from './s_بوت.js';
import './system/_protection.js';

const NovaUltra = {
    command: 'نظام', description: 'نظام البوت الشامل',
    elite: 'off', group: false, prv: false, lock: 'off',
};

async function execute({ sock, msg }) {
    const chatId = msg.key.remoteJid;
    const sender = msg.key.participant || chatId;

    // ── owner من config.js ──
    if (!global._botConfig) global._botConfig = {};
    global._botConfig.owner = (configObj?.owner || '213540419314').toString().replace(/\D/g, '');

    registerDeleteListener(sock);
    registerWelcomeListener(sock);

    if (activeSessions.has(chatId)) {
        const old       = activeSessions.get(chatId);
        const ownerNum  = normalizeJid(global._botConfig?.owner || '');
        const oldSender = normalizeJid(old.sender || '');
        const curSender = normalizeJid(sender);
        const oldIsOwner = ownerNum && oldSender === ownerNum;
        const curIsOwner = msg.key.fromMe || (ownerNum && curSender === ownerNum);

        // أي جلسة نشطة + المستخدم الحالي ليس أونر → ارفض
        if (!curIsOwner) {
            const who = oldIsOwner ? 'الأونر' : 'شخص آخر';
            const dur = old.isOwnerSess ? '5 دقائق' : 'دقيقتين';
            await sock.sendMessage(chatId, {
                text: `⏳ *الجلسة محجوزة*
${who} يستخدم النظام الآن.
تنتهي تلقائياً بعد ${dur}.`,
            }, { quoted: msg }).catch(() => {});
            return;
        }

        // غير ذلك → امسح القديمة وافتح جديدة
        if (old.listener) sock.ev.off('messages.upsert', old.listener);
        if (old.timeout)  clearTimeout(old.timeout);
        if (typeof old.cleanupFn === 'function') try { old.cleanupFn(); } catch (_e) {}
        activeSessions.delete(chatId);
    }

    const sentMsg = await sock.sendMessage(chatId, { text: MAIN_MENU }, { quoted: msg });
    let botMsgKey = sentMsg.key;
    let state     = 'MAIN';
    let tmp       = {};
    let msgCount  = 0;          // عداد الرسائل الواردة
    let lastMenuText = MAIN_MENU; // آخر نص قائمة عُرض

    // لما msgCount يصل 10، يُعاد إرسال القائمة الحالية برسالة جديدة
    const RESEND_EVERY = 10;

    // ── تاريخ التنقل للرجوع درجة واحدة بدقة ──
    // كل entry: { state, showFn, label }
    const history = [];
    const SHOW_FN_MAP = {};  // يُملأ لاحقاً بعد تعريف الدوال

    // push: احفظ الوضع الحالي قبل الانتقال
    const pushState = (fromState, fromShowFn) => {
        const last = history[history.length - 1];
        if (last?.state === fromState) return;
        history.push({ state: fromState, showFn: fromShowFn });
        if (history.length > 20) history.shift();
    };

    // goBack: ارجع للحالة السابقة مع تشغيل دالة العرض
    const goBack = async () => {
        const prev = history.pop();
        if (!prev) {
            await update(MAIN_MENU);
            state = 'MAIN';
            return;
        }
        state = prev.state;
        if (typeof prev.showFn === 'function') await prev.showFn();
        else await update(MAIN_MENU);
    };

    const update = async (textOrObj) => {
        const payload = typeof textOrObj === 'string' ? { text: textOrObj } : textOrObj;
        // خزّن آخر نص للإعادة التلقائية
        if (payload.text) lastMenuText = payload.text;
        try { await sock.sendMessage(chatId, { ...payload, edit: botMsgKey }); }
        catch { const s = await sock.sendMessage(chatId, payload); botMsgKey = s.key; }
    };

    // إعادة إرسال القائمة — يمسح القديمة أولاً ثم يرسل جديدة
    const resendMenu = async () => {
        try {
            // احذف الرسالة القديمة
            try { await sock.sendMessage(chatId, { delete: botMsgKey }); } catch (e) { if (e?.message) console.error('[catch]', e.message); }
            await sleep(300);
            const s = await sock.sendMessage(chatId, { text: lastMenuText });
            botMsgKey = s.key;
            msgCount = 0; // إعادة العد
        } catch (e) { if (e?.message) console.error('[catch]', e.message); }
    };

    async function getAdminPerms() {
        if (!chatId.endsWith('@g.us')) return { isGroup: false, isAdmin: false, isBotAdmin: false, meta: null };
        try {
            const meta      = await sock.groupMetadata(chatId);
            const senderNum = normalizeJid(sender);
            const botNum    = normalizeJid(getBotJid(sock));
            const adminNums = new Set(
                meta.participants
                    .filter(p => p.admin)
                    .flatMap(p => [normalizeJid(p.id), normalizeJid(p.lid || '')])
                    .filter(Boolean)
            );
            return {
                meta,
                isGroup:    true,
                isAdmin:    msg.key.fromMe || adminNums.has(senderNum),
                isBotAdmin: adminNums.has(botNum),
            };
        } catch { return { isGroup: true, isAdmin: false, isBotAdmin: false, meta: null }; }
    }

    const tryAdminAction = async (fn, emoji = '☑️') => {
        try { await fn(); react(sock, m, emoji); return true; }
        catch (e) {
            const { isGroup, isAdmin, isBotAdmin } = await getAdminPerms();
            if (!isGroup)    { await update('❌ هذا الامر للمجموعات فقط.');    return false; }
            if (!isBotAdmin) { await update('❌ البوت ليس مشرفا، رقه اولا.'); return false; }
            if (!isAdmin)    { await update('❌ انت لست مشرفا.');              return false; }
            await update(`❌ فشل: ${e?.message || e}`); return false;
        }
    };

    // isOwner helper — البوت نفسه أو رقم الأونر من config
    const isOwner = () => {
        if (m?.key?.fromMe || msg.key.fromMe) return true;
        const ownerNum = global._botConfig?.owner || '';
        return ownerNum && normalizeJid(sender) === normalizeJid(ownerNum);
    };

    const cleanup = () => {
        // نزيل كل المستمعين المحتملين
        sock.ev.off('messages.upsert', listener);
        // wrappedListener مخزّن في activeSessions — نزيله أيضاً
        const sess = activeSessions.get(chatId);
        if (sess?.listener && sess.listener !== listener) {
            sock.ev.off('messages.upsert', sess.listener);
        }
        clearTimeout(timeout);
        // مسح reactClearTimer لو موجود في الجلسة
        if (sess?.reactClearTimer) clearTimeout(sess.reactClearTimer);
        activeSessions.delete(chatId);
    };

    // ══════════════════════════════════════════════════
    //  listener
    // ══════════════════════════════════════════════════
    const listener = async ({ messages }) => {
        const m = messages[0];
        if (!m?.message || m.key.remoteJid !== chatId) return;
        const newSender = m.key.participant || m.key.remoteJid;
        if (newSender !== sender) return;

        const text = (m.message.conversation || m.message.extendedTextMessage?.text || '').trim();
        if (!text) return;

        // ── Rate limiting ──
        if (isRateLimited(newSender)) return;

        // ☑️ أوامر البريفكس المباشر /امر تتجاوز الجلسة — يعالجها slashCommandHandler
        if (text.startsWith('/')) return;

        // تحديث lastActivity فقط — لا نُمدِّد الـ timeout (ثابت)
        const sess = activeSessions.get(chatId);
        if (sess) sess.lastActivity = Date.now();

        reactInput(sock, m, text);

        // ── إعادة إرسال القائمة كل RESEND_EVERY رسالة ──
        msgCount++;
        if (msgCount >= RESEND_EVERY) {
            msgCount = 0;
            await resendMenu();
        }

        // 🏠 زر الرئيسية — يعمل من أي مكان في أي فرع
        if (text === 'الرئيسية') {
            await update(MAIN_MENU);
            state = 'MAIN';
            tmp = {};
            return;
        }

        // ══════════════════════════════════════════════════
        // MAIN
        if (state === 'MAIN') {
            if (text === 'تنزيلات')                       { pushState('MAIN', () => update(MAIN_MENU)); await showDlMenu(ctx);      state = 'DL_MENU'; return; }
            if (text === 'إحصاءات' || text === 'احصاءات') { pushState('MAIN', () => update(MAIN_MENU)); await showStats(ctx);       state = 'STATS';   return; }
            const eliteOnlyCmd = ['نخبة','بلاجنز','حماية','بوت','إدارة'].includes(text);
            if (eliteOnlyCmd) {
                if (!(await checkElite(sock, m))) {
                    await update('🚫 *للنخبة فقط*\n\n✦ *تنزيلات* و *إحصاءات* للجميع\n\n🏠 *الرئيسية*');
                    return;
                }
                if (text === 'نخبة')   { pushState('MAIN', () => update(MAIN_MENU)); await showEliteMenu(ctx);   state = 'ELITE';   return; }
                if (text === 'بلاجنز') { pushState('MAIN', () => update(MAIN_MENU)); await showPluginsMenu(ctx); state = 'PLUGINS'; return; }
                if (text === 'حماية')  { pushState('MAIN', () => update(MAIN_MENU)); await showProtMenu(ctx);    state = 'PROT';    return; }
                if (text === 'بوت')    { pushState('MAIN', () => update(MAIN_MENU)); await showBotMenu(ctx);     state = 'BOT';     return; }
                if (text === 'إدارة')  { pushState('MAIN', () => update(MAIN_MENU)); await showAdminMenu(ctx);   state = 'ADMIN';   return; }
            }
            return;
        }
        if (state.startsWith('ELITE'))                                                             { await handleElite(ctx, m, text);   return; }
        if (state.startsWith('PLUGIN')||state.startsWith('RENAME')||state.startsWith('CODE_'))    { await handlePlugins(ctx, m, text);  return; }
        if (state.startsWith('DL_')||state.startsWith('PIN_')||state.startsWith('TT_'))           { await handleDl(ctx, m, text);       return; }
        if (state==='STATS'||state==='PROT'||state.startsWith('CMDTOOLS'))                        { await handleGeneral(ctx, m, text);  return; }
        if (state.startsWith('ADMIN'))                                                             { await handleAdmin(ctx, m, text);    return; }
        if (state.startsWith('BOT'))                                                               { await handleBot(ctx, m, text);      return; }

    }; // نهاية listener

    const session = { state, tmp };
    const ctx = {
        sock, chatId, sender, msg,
        session,
        get state()  { return session.state; },
        set state(v) { session.state = v; state = v; },
        get tmp()    { return session.tmp; },
        set tmp(v)   { session.tmp = v; tmp = v; },
        update:    async (t) => update(t),
        pushState, goBack, tryAdminAction,
        react:     (m2, e) => react(sock, m2, e),
        reactOk:   m2 => reactOk(sock, m2),
        reactWait: m2 => reactWait(sock, m2),
        reactFail: m2 => reactFail(sock, m2),
        MAIN_MENU, grpFile, DATA_DIR, BOT_DIR,
        handleDownload: (url, ao, mm) => handleDownload(ctx, url, ao, mm),
    };

    // تسجيل الجلسة
    sock.ev.on('messages.upsert', listener);

    // أونر → 5 دقائق | غيره → 2 دقيقة (ثابت، لا يُمدَّد بالتفاعل)
    const ownerNumS   = normalizeJid(global._botConfig?.owner || '');
    const senderNumS  = normalizeJid(sender);
    const isOwnerSess = msg.key.fromMe || (ownerNumS && senderNumS === ownerNumS);
    const SESSION_MS  = isOwnerSess ? 300_000 : 120_000;
    const REACT_CLEAR_BEFORE = 10_000;

    // مسح الرياكت 10 ثوانٍ قبل انتهاء الجلسة
    let reactClearTimer = setTimeout(async () => {
        try {
            // مسح رياكت آخر رسالة عبر إرسال رياكت فارغ
            await sock.sendMessage(chatId, {
                react: { text: '', key: botMsgKey },
            });
        } catch (e) { if (e?.message) console.error('[catch]', e.message); }
    }, SESSION_MS - REACT_CLEAR_BEFORE);

    let timeout = setTimeout(() => {
        clearTimeout(reactClearTimer);
        cleanup();
    }, SESSION_MS);

    // عند كل تفاعل: أعد ضبط كلا الـ timer
    // ── guard: منع double-wrapping ──────────────────
    if (listener.__nova_wrapped) {
        sock.ev.on('messages.upsert', listener);
        activeSessions.set(chatId, {
            listener,
            timeout,
            cleanupFn: cleanup,
            lastActivity: Date.now(),
            sender,
        });
        return;
    }
    const _origListener = listener;
    const wrappedListener = async (args) => {
        wrappedListener.__nova_wrapped = true;
        // لا نُمدِّد الـ timer — الجلسة ثابتة مهما حصل تفاعل
        await _origListener(args);
    };

    sock.ev.off('messages.upsert', listener);
    sock.ev.on('messages.upsert', wrappedListener);

    activeSessions.set(chatId, {
        listener:        wrappedListener,
        timeout,
        reactClearTimer,
        cleanupFn:       cleanup,
        lastActivity:    Date.now(),
        sender,
        isOwnerSess,
    });
}

export default { NovaUltra, execute };
