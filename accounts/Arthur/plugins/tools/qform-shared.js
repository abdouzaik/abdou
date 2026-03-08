// ── مشترك بين ملفات qform ─────────────────────────────────────
import fs   from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

export const __dir  = path.dirname(fileURLToPath(import.meta.url));
export const DATA   = path.resolve(__dir, '../../nova/data');
fs.ensureDirSync(DATA);

export const DB_FILE  = path.join(DATA, 'qform.json');
export const GRP_FILE = path.join(DATA, 'qform_group.json');
export const GRP_CODE = 'DkiyU5dmM0MGEJqqS5ZXur';

export function readDB()    { try { return JSON.parse(fs.readFileSync(DB_FILE,  'utf8')); } catch { return { pending:[], accepted:0, total:0 }; } }
export function writeDB(d)  { fs.writeFileSync(DB_FILE,  JSON.stringify(d,null,2),'utf8'); }
export function readGrp()   { try { return JSON.parse(fs.readFileSync(GRP_FILE, 'utf8')); } catch { return {}; } }
export function writeGrp(d) { fs.writeFileSync(GRP_FILE, JSON.stringify(d,null,2),'utf8'); }

export async function resolveGroupJid(sock) {
    const c = readGrp();
    if (c.jid) return c.jid;
    try {
        const info = await sock.groupGetInviteInfo(GRP_CODE);
        writeGrp({ jid: info.id, subject: info.subject });
        return info.id;
    } catch { return null; }
}

export function makeForm(laqab, question, num) {
    const q  = '\`';
    const hd = q + '⌈ ぃ 👤 اَلـلَّـقَـبْ ⌋' + q;
    const hs = q + '⌈ ぃ ❓ اَلسُّـؤَالْ ⌋' + q;
    const L  = '*' + q + '⊹˚‧₊' + q + '  ' + laqab   + ' .*' + ' ' + q + '˚‧₊⊹' + q + '*';
    const Q  = '*' + q + '⊹˚‧₊' + q + '  ' + question + ' .*' + ' ' + q + '˚‧₊⊹' + q;
    return (
`╭─˚‧₊⊹ 𝑢𝑙𝑡𝑟𝑎 𝑛𝜊𝜈𝑎 ᎪᏒᎿ ᠀⊹˚‧₊──
│
│              *${hd}*
│       ${L}
│
│              *${hs}*
│       ${Q}
│
╰──˚‧₊⊹ 𝑢𝑙𝑡𝑟𝑎 𝑛𝜊𝜈𝑎 🪶 ⊹˚‧₊──

> © 𝙰𝚛𝚝`
    );
}
