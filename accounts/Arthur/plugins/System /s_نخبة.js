// ELITE
import {
    sleep, react, reactWait, reactOk, reactFail, reactInput,
    normalizeJid, getBotJid, checkElite,
    resolveTarget, pinMessage,
    readJSON, writeJSON, readJSONSync, writeJSONSync, atomicWrite,
    readProt, writeProt, readStats, writeStats,
    readBanned, isBanned, addBan, removeBan,
    getAllPluginFiles, getPluginInfo, updatePluginField, findPluginByCmd,
    quickLint, checkPluginSyntax,
    isGroupAdmin, isBotGroupAdmin, getGroupAdminInfo,
    grpFile, DATA_DIR, PLUGINS_DIR, BOT_DIR, PROT_FILE, STATS_FILE,
    BAN_FILE, PLUGINS_CFG_FILE, _eliteProPath, activeSessions,
    configObj,
} from './_utils.js';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { loadPlugins } from '../../handlers/plugins.js';
import path from 'path';
import fs from 'fs-extra';

export async function handleElite(ctx, m, text) {
    const { sock, chatId, session, update, pushState, goBack, tryAdminAction, MAIN_MENU } = ctx;
    let state = session.state;
    let tmp   = session.tmp;

        if (session.state === 'ELITE') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'عرض') {
                try {
                    const elites = sock.getElites?.() || [];
                    if (!elites.length) {
                        pushState('ELITE', showEliteMenu);
                        session.state = 'ELITE_VIEW';
                        return update(`✧━── ❝ 𝐍𝐗𝐁𝐀 ❞ ──━✧\n\n📋 القائمة فارغة.\n\n🔙 *رجوع*\n\n✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
                    }
                    const list = elites.map((id, i) => `${i+1}. @${normalizeJid(id)}`).join('\n');
                    pushState('ELITE', showEliteMenu);
                    session.state = 'ELITE_VIEW';
                    return update({
                        text: `✧━── ❝ 𝑬𝑳𝑰𝑻𝑬 ❞ ──━✧\n\n♦️ *قائمة النخبة (${elites.length}):*\n\n${list}\n\n🔙 *رجوع*\n\n✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`,
                        mentions: elites,
                    });
                } catch { return update('❌ تعذر جلب القائمة.\n\n🔙 *رجوع*'); }
            }
            if (text === 'اضافة')    { pushState('ELITE', showEliteMenu); await update('📱 ارسل الرقم:\nمثال: 966501234567\nاو منشن شخص\n\n🔙 *رجوع*'); session.state = 'ELITE_ADD'; return; }
            if (text === 'حذف')      { pushState('ELITE', showEliteMenu); await update('📱 ارسل الرقم للحذف:\nاو منشن شخص\n\n🔙 *رجوع*'); session.state = 'ELITE_DEL'; return; }
            if (text === 'مسح الكل') { pushState('ELITE', showEliteMenu); await update('⚠️ *تاكيد مسح كل النخبة؟*\nاكتب *نعم* او *رجوع*'); session.state = 'ELITE_CLEAR'; return; }
            return;
        }

        if (session.state === 'ELITE_VIEW') {
            if (text === 'رجوع') { await goBack(); return; }
            return;
        }

        if (session.state === 'ELITE_ADD') {
            if (text === 'رجوع') { await goBack(); return; }
            const ctxMentions = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const ctxReply    = m.message?.extendedTextMessage?.contextInfo?.participant;
            let ids = [];
            if (ctxMentions.length) ids = ctxMentions;
            else if (ctxReply)       ids = [ctxReply];
            else {
                const num = text.replace(/\D/g, '');
                if (num.length < 9) return update('❌ رقم غير صحيح.');
                try {
                    const check = await sock.onWhatsApp(num + '@s.whatsapp.net');
                    const resolved = check?.[0]?.jid || '';
                    ids = [resolved.endsWith('@s.whatsapp.net') ? resolved : num + '@s.whatsapp.net'];
                } catch { ids = [num + '@s.whatsapp.net']; }
            }
            try {
                const res = await sock.addElite({ sock, ids });
                let msg2 = '*إضافة النخبة*\n\n';
                if (res?.success?.length) msg2 += '☑️ ' + res.success.map(u => `@${normalizeJid(u.id)}`).join(', ') + ' تمت الإضافة\n';
                if (res?.fail?.length)    msg2 += '⚠️ ' + res.fail.map(u => `@${normalizeJid(u.id)} (${u.error==='exist_already'?'موجود مسبقاً':u.error})`).join(', ');
                await update(msg2.trim());
            } catch (e) { await update(`❌ ${e?.message}`); }
            await sleep(1500); await showEliteMenu(); session.state = 'ELITE'; return;
        }

        if (session.state === 'ELITE_DEL') {
            if (text === 'رجوع') { await goBack(); return; }
            const ctxMentions = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const ctxReply    = m.message?.extendedTextMessage?.contextInfo?.participant;
            let ids = [];
            if (ctxMentions.length) ids = ctxMentions;
            else if (ctxReply)       ids = [ctxReply];
            else {
                const num = text.replace(/\D/g, '');
                if (num.length < 9) return update('❌ رقم غير صحيح.');
                ids = [num + '@s.whatsapp.net'];
            }
            try {
                const res = await sock.rmElite({ sock, ids });
                let msg2 = '*إزالة النخبة*\n\n';
                if (res?.success?.length) msg2 += '☑️ ' + res.success.map(u => `@${normalizeJid(u.id)}`).join(', ') + ' تمت الإزالة\n';
                if (res?.fail?.length)    msg2 += '⚠️ ' + res.fail.map(u => `@${normalizeJid(u.id)} (${u.error==='not_exist'?'ليس نخبة أصلاً':u.error})`).join(', ');
                await update(msg2.trim());
            } catch (e) { await update(`❌ ${e?.message}`); }
            await sleep(1500); await showEliteMenu(); session.state = 'ELITE'; return;
        }

        if (session.state === 'ELITE_CLEAR') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'نعم') {
                try { await sock.eliteReset?.({ sock }); await update('☑️ تم مسح الكل.'); }
                catch (e) { await update(`❌ ${e?.message}`); }
                await sleep(1200); await showEliteMenu(); session.state = 'ELITE';
            }
            return;
        }

        // ══════════════════════════════════════════════════
        // PLUGINS
        // ══════════════════════════════════════════════════
}

export async function showEliteMenu() {
        await update(
`✧━── ❝ 𝐍𝐗𝐁𝐀 ❞ ──━✧

✦ *اضافة*
\`➕ إضافة رقم للنخبة\`

✦ *حذف*
\`🗑️ حذف رقم\`

✦ *عرض*
\`📋 عرض القائمة\`

✦ *مسح الكل*
\`🧹 مسح الكل\`

🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

