const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason
} = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pino = require('pino');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

// مفتاح Google Gemini API
const API_KEY = "YOUR_GEMINI_API_KEY";
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

async function getAIResponse(prompt) {
    try {
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (error) {
        return "حدث خطأ أثناء الاتصال بالذكاء الاصطناعي.";
    }
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false
    });

    // الربط عن طريق Pairing Code
    if (!sock.authState.creds.registered) {
        const phoneNumber = await question('أدخل رقم هاتفك مع رمز الدولة (مثال: 212612345678): ');
        const code = await sock.requestPairingCode(phoneNumber.trim());
        console.log(`\n🔑 رمز الاقتران الخاص بك هو: \x1b[32m${code}\x1b[0m\n`);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ تم الاتصال بالواتساب بنجاح!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;

            const from = msg.key.remoteJid;
            const text = msg.message.conversation || 
                         msg.message.extendedTextMessage?.text || "";

            if (text === '!menu' || text === '!help') {
                const menuText = `🤖 *أوامر البوت:*
1️⃣ \`!ai [سؤالك]\` -> للذكاء الاصطناعي
2️⃣ \`!apk [اسم_الملف]\` -> لتحميل تطبيق
3️⃣ \`!ping\` -> فحص العمل`;
                await sock.sendMessage(from, { text: menuText });
            }
            else if (text === '!ping') {
                await sock.sendMessage(from, { text: '🏓 البوت شغال بنجاح!' });
            }
            else if (text.startsWith('!ai ')) {
                const prompt = text.replace('!ai ', '');
                await sock.sendMessage(from, { text: '⏳ جاري التفكير...' });
                const aiReply = await getAIResponse(prompt);
                await sock.sendMessage(from, { text: aiReply });
            }
            else if (text.startsWith('!apk ')) {
                const fileName = text.replace('!apk ', '').trim();
                const filePath = path.join(__dirname, 'files', fileName);

                if (fs.existsSync(filePath)) {
                    await sock.sendMessage(from, { text: `⏳ جاري إرسال: ${fileName}...` });
                    await sock.sendMessage(from, {
                        document: fs.readFileSync(filePath),
                        mimetype: 'application/vnd.android.package-archive',
                        fileName: fileName
                    });
                } else {
                    await sock.sendMessage(from, { text: `❌ الملف غير موجود في مجلد 'files'.` });
                }
            }
        }
    });
}

startBot();
