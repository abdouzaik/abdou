// ─────────────────────────────────────────────────────────────
//  bot detector — full passive + active scan
//  works with @whiskeysockets/baileys (any recent version)
// ─────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ─────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────

function maskPhone(pn = '') {
    if (pn.length <= 6) return `+${pn}`
    return `+${pn.slice(0, 3)}${'*'.repeat(pn.length - 6)}${pn.slice(-3)}`
}

function getPhone(p) {
    if (p?.phoneNumber) return p.phoneNumber.split('@')[0].replace(/\D/g, '')
    const raw = p?.id ?? ''
    if (raw.includes('@lid')) return null
    return raw.split('@')[0].split(':')[0].replace(/\D/g, '') || null
}

function isAdmin(p) {
    const a = p?.admin
    if (!a) return false
    return typeof a === 'boolean'
        ? a
        : ['admin', 'superadmin'].includes(String(a).toLowerCase())
}

function deviceIndex(jid = '') {
    const m = String(jid).match(/:(\d+)@/)
    return m ? parseInt(m[1]) : 0
}

// ─────────────────────────────────────────────────────────────
// state  (lives for the duration of the process)
// ─────────────────────────────────────────────────────────────

const presenceMap = new Map()   // jid  → presence profile
const groupMsgTs  = new Map()   // chatId → last-message timestamp
const sentMsgs    = new Map()   // msgId → { sentAt, textLen }
const baitMap     = new Map()   // targetJid → { sentAt, type }
const editBaitMap = new Map()   // targetJid → { sentAt, replies }
const lidMap      = new Map()   // phone → lid-jid

function getProfile(jid) {
    if (!presenceMap.has(jid)) {
        presenceMap.set(jid, {
            onlineTimes:  [],
            offlineTimes: [],
            readSpeeds:   [],
            score:        0,
            flags:        new Set()
        })
    }
    return presenceMap.get(jid)
}

// ─────────────────────────────────────────────────────────────
// presence analysis
// ─────────────────────────────────────────────────────────────

function recordPresence(jid, status, chatId) {
    const now     = Date.now()
    const profile = getProfile(jid)
    const lastMsg = groupMsgTs.get(chatId) || 0

    if (status === 'available') {
        profile.onlineTimes.push(now)
        if (profile.onlineTimes.length > 40) profile.onlineTimes.shift()

        const gap = now - lastMsg
        if (lastMsg && gap < 2000) {
            profile.flags.add(`presence triggered ${gap}ms after msg`)
            profile.score = Math.max(profile.score, 3)
        }
    }

    if (status === 'unavailable' || status === 'away') {
        profile.offlineTimes.push(now)
        if (profile.offlineTimes.length > 40) profile.offlineTimes.shift()
    }

    // online → offline cycle speed
    const onLen = profile.onlineTimes.length
    const ofLen = profile.offlineTimes.length
    if (onLen >= 3 && ofLen >= 3) {
        const pairs = Math.min(onLen, ofLen) - 1
        const cycles = []
        for (let i = 0; i < pairs; i++) {
            const d = profile.offlineTimes[i] - profile.onlineTimes[i]
            if (d > 0 && d < 30_000) cycles.push(d)
        }
        if (cycles.length >= 2) {
            const avg = cycles.reduce((a, b) => a + b, 0) / cycles.length
            if (avg < 4000) {
                profile.flags.add(`online cycle avg ${(avg / 1000).toFixed(1)}s`)
                profile.score = Math.max(profile.score, 4)
            }
        }
    }

    // coefficient of variation — mechanical timing detection
    const all = [...profile.onlineTimes, ...profile.offlineTimes].sort((a, b) => a - b)
    if (all.length >= 10) {
        const gaps = all.slice(1).map((v, i) => v - all[i])
        const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
        const std  = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length)
        const cv   = std / mean
        if (cv < 0.12 && mean < 12_000) {
            profile.flags.add(`mechanical timing CV=${cv.toFixed(3)}`)
            profile.score = Math.max(profile.score, 3)
        }
    }
}

function recordReadSpeed(jid, ms, textLen) {
    const profile  = getProfile(jid)
    const minHuman = Math.max(500, textLen * 50)
    if (ms > 0 && ms < minHuman * 0.25) {
        profile.readSpeeds.push(ms)
        if (profile.readSpeeds.length > 20) profile.readSpeeds.shift()
        const avg = profile.readSpeeds.reduce((a, b) => a + b, 0) / profile.readSpeeds.length
        profile.flags.add(`read avg ${Math.round(avg)}ms (${textLen} chars)`)
        profile.score = Math.max(profile.score, avg < 300 ? 4 : 2)
    }
}

// ─────────────────────────────────────────────────────────────
// LID mismatch detection
// in LID-mode groups, official clients send receipts from @lid jids.
// Baileys sometimes uses the plain phone jid — that's a mismatch.
// ─────────────────────────────────────────────────────────────

function checkLidMismatch(senderJid) {
    const phone = senderJid.split('@')[0].split(':')[0].replace(/\D/g, '')
    const knownLid = lidMap.get(phone)
    if (!knownLid) return false
    return !senderJid.includes('@lid')
}

// ─────────────────────────────────────────────────────────────
// device query — user-agent / platform fingerprint
// ─────────────────────────────────────────────────────────────

const HEADLESS_UA = [
    /HeadlessChrome/i,
    /PhantomJS/i,
    /Electron/i,
    /node[-_ ]?fetch/i,
    /python-requests/i,
    /go-http/i,
]

const SERVER_OS = [
    /linux/i, /ubuntu/i, /debian/i, /centos/i,
    /rhel/i, /fedora/i, /alpine/i, /arch/i,
]

function analyzeUserAgent(ua = '') {
    if (!ua) return null

    for (const pat of HEADLESS_UA) {
        if (pat.test(ua)) return { score: 5, label: `headless UA: ${ua.slice(0, 50)}` }
    }
    for (const pat of SERVER_OS) {
        if (pat.test(ua)) return { score: 4, label: `server OS in UA: ${ua.slice(0, 50)}` }
    }

    const chromeMatch = ua.match(/Chrome\/(\d+)/i)
    if (chromeMatch) {
        const ver = parseInt(chromeMatch[1])
        if (ver < 90)  return { score: 3, label: `outdated Chrome ${ver} (Baileys default)` }
        if (ver < 110) return { score: 1, label: `dated Chrome ${ver}` }
    }

    return null
}

async function queryDevices(sock, jid) {
    const result = { score: 0, flags: [] }
    if (typeof sock.getUSyncDevices !== 'function') return result

    try {
        const res = await Promise.race([
            sock.getUSyncDevices([jid], false, true),
            new Promise((_, r) => setTimeout(() => r(null), 5000))
        ])
        if (!res) return result

        const entries = Array.isArray(res)
            ? res.map((v, i) => [i, v])
            : Object.entries(res)

        for (const [, list] of entries) {
            for (const d of (Array.isArray(list) ? list : [])) {
                const id = d?.deviceJid || d?.jid || ''
                const ua = d?.userAgent  || d?.keyIndex?.userAgent || ''
                const pl = String(d?.platform || d?.keyIndex?.platform || '')

                if (deviceIndex(id) >= 2) {
                    result.score = Math.max(result.score, 2)
                    result.flags.push(`extra device idx ${deviceIndex(id)}`)
                }

                const uaResult = analyzeUserAgent(ua)
                if (uaResult) {
                    result.score = Math.max(result.score, uaResult.score)
                    result.flags.push(uaResult.label)
                }

                for (const pat of SERVER_OS) {
                    if (pat.test(pl)) {
                        result.score = Math.max(result.score, 4)
                        result.flags.push(`platform: ${pl}`)
                    }
                }
            }
        }
    } catch { /* inconclusive */ }

    return result
}

// ─────────────────────────────────────────────────────────────
// message id fingerprint
// ─────────────────────────────────────────────────────────────

const ID_SIGS = [
    { prefix: 'BAE5',  score: 3 },
    { prefix: 'SIGMA', score: 3 },
    { prefix: 'WZAPI', score: 3 },
    { prefix: '3A',    score: 2 },
    { prefix: '3EB0',  score: 1 },
]

function checkMsgId(id = '') {
    if (!id) return null
    const upper = id.toUpperCase()
    for (const { prefix, score } of ID_SIGS) {
        if (upper.startsWith(prefix)) return { score, label: `msgid:${prefix}` }
    }
    if (id.length > 20 && /^[A-F0-9]+$/i.test(id))
        return { score: 1, label: `msgid:long(${id.length})` }
    return null
}

// ─────────────────────────────────────────────────────────────
// ghost mention bait
// visible text is a zero-width space — bots that watch mentions
// in metadata will react; humans won't notice anything
// ─────────────────────────────────────────────────────────────

async function sendGhostMention(sock, chatId, targetJid) {
    try {
        const sent = await sock.sendMessage(chatId, {
            text:        '\u200b',
            mentions:    [targetJid],
            contextInfo: { mentionedJid: [targetJid] }
        })
        baitMap.set(targetJid, { sentAt: Date.now(), type: 'ghost', msgId: sent?.key?.id })
        setTimeout(() => baitMap.delete(targetJid), 25_000)
    } catch { /* locked group — ignore */ }
}

// ─────────────────────────────────────────────────────────────
// edit bait
// send a message then edit it 300ms later.
// naive bots reply to the original before the edit arrives.
// advanced bots may double-reply.
// ─────────────────────────────────────────────────────────────

async function sendEditBait(sock, chatId, targetJid) {
    try {
        const original = await sock.sendMessage(chatId, {
            text:     'test',
            mentions: [targetJid]
        })
        if (!original?.key) return
        await sleep(300)
        await sock.sendMessage(chatId, { text: '\u200b', edit: original.key })
        editBaitMap.set(targetJid, { sentAt: Date.now(), originalMsgId: original.key.id, replies: 0 })
        setTimeout(() => editBaitMap.delete(targetJid), 20_000)
    } catch { /* ignore */ }
}

function checkBaitReply(incomingMsg) {
    const sender = incomingMsg.key?.participant || incomingMsg.key?.remoteJid
    if (!sender || incomingMsg.key?.fromMe) return null

    // ghost bait
    const ghost = baitMap.get(sender)
    if (ghost?.type === 'ghost') {
        const ms = Date.now() - ghost.sentAt
        baitMap.delete(sender)
        if (ms < 800)  return { score: 4, label: `ghost-mention reply ${ms}ms` }
        if (ms < 2500) return { score: 2, label: `ghost-mention reply ${ms}ms` }
    }

    // edit bait
    const edit = editBaitMap.get(sender)
    if (edit) {
        edit.replies++
        const ms = Date.now() - edit.sentAt
        if (edit.replies >= 2) {
            editBaitMap.delete(sender)
            return { score: 4, label: `double-reply to edited msg` }
        }
        if (ms < 1000) return { score: 3, label: `replied before edit settled ${ms}ms` }
    }

    return null
}

// ─────────────────────────────────────────────────────────────
// scan one participant
// ─────────────────────────────────────────────────────────────

async function scanParticipant(sock, p) {
    const pn    = getPhone(p)
    const raw   = p?.id ?? ''
    const admin = isAdmin(p)
    const flags = new Set()
    let   score = 0

    const hit = (label, pts = 0) => { flags.add(label); score += pts }

    // device index embedded in JID  (e.g. 123456:3@s.whatsapp.net)
    if (deviceIndex(raw) >= 2) hit(`device idx ${deviceIndex(raw)}`, 3)

    // LID participant with no linked phone number
    if (raw.includes('@lid') && !p?.phoneNumber) {
        hit('LID no-phone', 1)
        return { pn: raw.split('@')[0], score, flags: [...flags], admin }
    }

    const jid = pn ? `${pn}@s.whatsapp.net` : null
    if (!jid) return { pn: raw.split('@')[0], score, flags: [...flags], admin }

    // LID receipt mismatch
    if (checkLidMismatch(jid)) hit('LID receipt mismatch', 3)

    // accumulated radar data (presence / read-speed / baits)
    const profile = presenceMap.get(jid)
    if (profile?.score > 0) {
        score += profile.score
        for (const f of profile.flags) flags.add(f)
    }

    // device query + user-agent fingerprint
    const dev = await queryDevices(sock, jid)
    if (dev.score > 0) {
        score += dev.score
        dev.flags.forEach(f => flags.add(f))
    }

    // profile picture
    try {
        const url = await Promise.race([
            sock.profilePictureUrl(jid, 'image'),
            new Promise((_, r) => setTimeout(() => r(null), 3000))
        ])
        if (!url) hit('no profile pic', 1)
    } catch { hit('no profile pic', 1) }

    // push-name heuristics
    const name = p?.notify || p?.name || sock.chats?.[jid]?.name || ''
    if (name) {
        if (/bot|بوت|robot|auto|assistant|helper|daemon|api|sys|^v\d/i.test(name))
            hit(`suspicious name: ${name}`, 2)
        if ((name.match(/\p{Emoji}/gu) || []).length >= 3)
            hit('emoji-heavy name', 1)
    }

    // message-id fingerprint from stored history
    try {
        const chats  = sock.chats || global.conn?.chats || {}
        const stored = chats[jid]?.messages || chats[jid]?.msgs
        if (stored) {
            const list = Array.isArray(stored)   ? stored
                       : stored instanceof Map    ? [...stored.values()]
                       : Object.values(stored)
            for (const m of list.filter(m => m?.key && !m.key.fromMe).slice(-5)) {
                const r = checkMsgId(m.key.id || '')
                if (r) { hit(r.label, r.score); break }
            }
        }
    } catch { /* store not available */ }

    return { pn, score, flags: [...flags], admin }
}

// ─────────────────────────────────────────────────────────────
// event listeners  (attached once per sock instance)
// ─────────────────────────────────────────────────────────────

let attached = false

function attachListeners(sock) {
    if (attached) return
    attached = true

    // presence updates
    sock.ev.on('presence.update', ({ id: chatId, presences }) => {
        for (const [jid, data] of Object.entries(presences || {})) {
            recordPresence(jid, data?.lastKnownPresence, chatId)
            // build lid mapping from presence events
            if (jid.includes('@lid')) {
                const phone = data?.phoneNumber?.replace(/\D/g, '')
                if (phone) lidMap.set(phone, jid)
            }
        }
    })

    // read receipts
    sock.ev.on('messages.update', updates => {
        for (const u of updates) {
            const msgId  = u?.key?.id
            const readTs = u?.update?.readTimestamp || u?.update?.receiptTimestamp
            const sender = u?.key?.participant || u?.key?.remoteJid
            if (!msgId || !readTs || !sender) continue

            // LID mismatch check on live receipt
            if (checkLidMismatch(sender)) {
                const pr = getProfile(sender)
                pr.flags.add('LID receipt mismatch (live)')
                pr.score = Math.max(pr.score, 3)
            }

            const record = sentMsgs.get(msgId)
            if (!record) continue
            const elapsed = (readTs * 1000) - record.sentAt
            recordReadSpeed(sender, elapsed, record.textLen)
            sentMsgs.delete(msgId)
        }
    })

    // incoming messages
    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const m of messages) {
            const chatId = m.key?.remoteJid
            const sender = m.key?.participant || m.key?.remoteJid

            // track our outgoing messages for read-speed timing
            if (m.key?.fromMe) {
                const text = m.message?.conversation
                          || m.message?.extendedTextMessage?.text || ''
                sentMsgs.set(m.key.id, { sentAt: Date.now(), textLen: text.length })
                setTimeout(() => sentMsgs.delete(m.key.id), 90_000)
            }

            // note when a group message arrived (for presence correlation)
            if (chatId?.endsWith('@g.us') && !m.key?.fromMe) {
                groupMsgTs.set(chatId, Date.now())
            }

            // live message-id fingerprint check
            if (sender && !m.key?.fromMe) {
                const idHit = checkMsgId(m.key?.id || '')
                if (idHit) {
                    const pr = getProfile(sender)
                    pr.flags.add(idHit.label)
                    pr.score = Math.max(pr.score, idHit.score)
                }
            }

            // check if this is a reply to one of our bait messages
            const baitHit = checkBaitReply(m)
            if (baitHit && sender) {
                const pr = getProfile(sender)
                pr.score = Math.max(pr.score, baitHit.score)
                pr.flags.add(baitHit.label)
            }
        }
    })
}

// subscribe to presence for all group members
async function subscribeAll(sock, participants) {
    for (const p of participants) {
        const pn  = getPhone(p)
        const jid = pn ? `${pn}@s.whatsapp.net` : null
        if (jid) await sock.presenceSubscribe(jid).catch(() => {})
        // also subscribe via LID if we have one
        if (p?.id?.includes('@lid')) {
            await sock.presenceSubscribe(p.id).catch(() => {})
        }
        await sleep(80)
    }
}

// ─────────────────────────────────────────────────────────────
// report
// ─────────────────────────────────────────────────────────────

function buildReport(participants, results, botPhone) {
    const all = [...results]

    // merge passive radar detections not already in scan results
    for (const [jid, profile] of presenceMap.entries()) {
        if (profile.score < 2) continue
        const pn = jid.split('@')[0].replace(/\D/g, '')
        if (pn === botPhone) continue
        if (all.some(r => r.pn === pn)) continue
        all.push({
            pn,
            score:   profile.score,
            flags:   [...profile.flags],
            admin:   false,
            passive: true
        })
    }

    all.sort((a, b) => b.score - a.score)

    const confirmed = all.filter(r => r.score >= 4)
    const probable  = all.filter(r => r.score >= 2 && r.score < 4)
    const low       = all.filter(r => r.score === 1)

    const now = new Date().toLocaleString('ar-SA', {
        timeZone: 'Asia/Riyadh',
        hour:     '2-digit',
        minute:   '2-digit',
        day:      'numeric',
        month:    'long'
    })

    const line = '─'.repeat(28)
    let text = `🤖 *Bot Detector*\n${line}\n`
    text += `${now}  •  bot: ${maskPhone(botPhone)}\n`
    text += `members: ${participants.length}  |  found: ${all.length}\n`
    text += `${line}\n\n`

    const section = (list, label) => {
        if (!list.length) return ''
        let s = `*${label} (${list.length})*\n╭${line}\n`
        for (const r of list) {
            const crown = r.admin   ? ' 👑' : ''
            const radar = r.passive ? ' 📡' : ''
            s += `┊ ${maskPhone(r.pn)}${crown}${radar}  [${r.score}pts]\n`
            const shown = r.flags.slice(0, 4)
            s += `┊  ${shown.join('  ·  ')}\n`
            if (r.flags.length > 4) s += `┊  +${r.flags.length - 4} more signals\n`
        }
        return s + `╰${line}\n\n`
    }

    text += section(confirmed, '🔴 confirmed')
    text += section(probable,  '🟠 probable')
    text += section(low,       '🟡 low signal')

    if (!all.length) {
        text += `✅ nothing detected yet\n`
        text += `radar is running — recheck in a few minutes\n`
    } else {
        text += `📡 radar keeps collecting — results improve over time\n`
    }

    text += `\n> © 𝘼𝙍𝙏𝙃𝙐𝙍 𝘽𝙊𝙏`
    return { text, all, probable, low }
}

// ─────────────────────────────────────────────────────────────
// export
// ─────────────────────────────────────────────────────────────

export default {
    NovaUltra: {
        command:     ['كشف1', 'كشف2', 'بوتات3'],
        description: 'bot detector',
        elite:       'off',
        group:       true,
        prv:         false,
        lock:        'off'
    },

    execute: async ({ sock, msg }) => {
        const chatId   = msg.key.remoteJid
        const botPhone = sock.user?.id?.split(':')[0] ?? ''

        attachListeners(sock)

        await sock.sendMessage(chatId, { react: { text: '🔍', key: msg.key } })

        // fetch group metadata
        let meta = null
        try {
            meta = await Promise.race([
                sock.groupMetadata(chatId),
                new Promise((_, r) => setTimeout(() => r(null), 10_000))
            ])
        } catch { /* fall through */ }

        if (!meta) {
            await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } })
            return sock.sendMessage(chatId,
                { text: '❌ failed to fetch group metadata' },
                { quoted: msg }
            )
        }

        const participants = meta.participants ?? []

        // build lid mapping from metadata
        for (const p of participants) {
            const pn = getPhone(p)
            if (pn && p?.id?.includes('@lid')) lidMap.set(pn, p.id)
        }

        const members = participants.filter(p => {
            const pn  = getPhone(p)
            const raw = p?.id ?? ''
            return pn !== botPhone && raw.split('@')[0].split(':')[0] !== botPhone
        })

        await sock.sendMessage(chatId,
            { text: `scanning ${members.length} members...` },
            { quoted: msg }
        )

        // subscribe to all presences so radar starts collecting immediately
        await subscribeAll(sock, members)

        // scan in batches of 5 to avoid rate-limiting
        const results = []
        for (let i = 0; i < members.length; i += 5) {
            const batch = await Promise.allSettled(
                members.slice(i, i + 5).map(p => scanParticipant(sock, p))
            )
            for (const r of batch) {
                if (r.status === 'fulfilled' && r.value.score > 0)
                    results.push(r.value)
            }
            if (i + 5 < members.length) await sleep(400)
        }

        const { text, probable, low } = buildReport(participants, results, botPhone)

        await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } })
        await sock.sendMessage(chatId, { text }, { quoted: msg })

        // send baits to weak signals for passive confirmation
        // limit to 3 targets and alternate between ghost-mention and edit-bait
        const targets = [...probable, ...low]
            .filter(r => r.pn && r.score <= 2 && !r.passive)
            .slice(0, 3)

        for (let i = 0; i < targets.length; i++) {
            await sleep(1500)
            const tJid = `${targets[i].pn}@s.whatsapp.net`
            if (i % 2 === 0) {
                await sendGhostMention(sock, chatId, tJid)
            } else {
                await sendEditBait(sock, chatId, tJid)
            }
        }
    }
}
