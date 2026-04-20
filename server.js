const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const server = http.createServer(app);

// SỬA LỖI KẾT NỐI: Cho phép tự động chuyển đổi giữa WebSocket và Polling để tránh bị Render chặn
const io = new Server(server, { 
    cors: { origin: "*" },
    transports: ['polling', 'websocket'], // Ưu tiên polling trước để thiết lập kết nối ổn định trên Render
    allowEIO3: true
});

app.use(express.json());
app.use(express.static(__dirname));

const MONGODB_URI = "mongodb+srv://baoboi97:baoboi97@cluster0.skkajlz.mongodb.net/tiktok_tts?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI).then(() => console.log("✅ MongoDB Connected"));

const BannedWord = mongoose.model('BannedWord', { word: String });
const Acronym = mongoose.model('Acronym', { key: String, value: String });
const EmojiMap = mongoose.model('EmojiMap', { icon: String, text: String });
const BotAnswer = mongoose.model('BotAnswer', { keyword: String, response: String });

// --- CÁC HÀM XỬ LÝ DỮ LIỆU ---
async function isBanned(text) {
    if (!text) return false;
    const banned = await BannedWord.find();
    return banned.some(b => text.toLowerCase().includes(b.word));
}

async function processText(text) {
    if (!text) return null;
    let processed = text;
    const emojis = await EmojiMap.find();
    for (const e of emojis) { processed = processed.split(e.icon).join(" " + e.text + " "); }
    const acronyms = await Acronym.find();
    acronyms.forEach(a => {
        const regex = new RegExp(`(?<!\\p{L})${a.key}(?!\\p{L})`, 'giu');
        processed = processed.replace(regex, a.value);
    });
    return processed;
}

function getGoogleAudio(text) {
    return `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
}

// --- ROUTING ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// --- XỬ LÝ TIKTOK ---
io.on('connection', (socket) => {
    let tiktok;
    socket.on('set-username', (username) => {
        if (tiktok) tiktok.disconnect();
        tiktok = new WebcastPushConnection(username);
        tiktok.connect().then(() => socket.emit('status', `✅ Live: ${username}`)).catch(() => socket.emit('status', '❌ Lỗi kết nối'));

        tiktok.on('chat', async (data) => {
            if (await isBanned(data.nickname)) return;
            const final = await processText(data.comment);
            if (final) {
                const audio = getGoogleAudio(`${data.nickname} nói: ${final}`);
                socket.emit('audio-data', { user: data.nickname, comment: data.comment, audio });
            }
        });

        tiktok.on('gift', async (data) => {
            if (data.repeatEnd) {
                const audio = getGoogleAudio(`Cảm ơn ${data.nickname} tặng ${data.giftName}`);
                socket.emit('audio-data', { user: "QUÀ", comment: `${data.nickname} tặng ${data.giftName}`, audio });
            }
        });
    });
    socket.on('disconnect', () => { if (tiktok) tiktok.disconnect(); });
});

server.listen(process.env.PORT || 3000, () => console.log('🚀 Hệ thống đã sẵn sàng'));
