const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const server = http.createServer(app);

// SỬA LỖI 502: Cấu hình ưu tiên websocket và polling để ổn định trên Render
const io = new Server(server, { 
    cors: { origin: "*" },
    transports: ['websocket', 'polling']
});

app.use(express.json());
// SỬA LỖI CANNOT GET: Trỏ trực tiếp vào thư mục chứa file hiện tại
app.use(express.static(__dirname));

const MONGODB_URI = "mongodb+srv://baoboi97:baoboi97@cluster0.skkajlz.mongodb.net/tiktok_tts?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI).then(() => console.log("✅ MongoDB Connected"));

const BannedWord = mongoose.model('BannedWord', { word: String });
const Acronym = mongoose.model('Acronym', { key: String, value: String });
const EmojiMap = mongoose.model('EmojiMap', { icon: String, text: String });
const BotAnswer = mongoose.model('BotAnswer', { keyword: String, response: String });

// --- CÁC HÀM XỬ LÝ (Giữ nguyên logic gốc bạn cung cấp) ---
async function isBanned(name) {
    const list = await BannedWord.find();
    return list.some(b => name.toLowerCase().includes(b.word.toLowerCase()));
}
async function processText(text) {
    let t = text;
    const acrs = await Acronym.find();
    acrs.forEach(a => { t = t.split(a.key).join(a.value); });
    const emos = await EmojiMap.find();
    emos.forEach(e => { t = t.split(e.icon).join(e.text); });
    return t;
}
function getGoogleAudio(text) {
    return `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=vi&client=tw-ob`;
}

// --- ROUTING: ĐẢM BẢO HIỂN THỊ FILE ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// --- KẾT NỐI TIKTOK ---
io.on('connection', (socket) => {
    let tiktok;
    socket.on('set-username', (username) => {
        if (tiktok) tiktok.disconnect();
        tiktok = new WebcastPushConnection(username);
        tiktok.connect().then(() => socket.emit('status', `Đã kết nối: ${username}`)).catch(() => socket.emit('status', 'Lỗi kết nối'));

        tiktok.on('chat', async (data) => {
            if (!(await isBanned(data.nickname))) {
                const safeMsg = await processText(data.comment);
                const audio = getGoogleAudio(`${data.nickname} nói: ${safeMsg}`);
                socket.emit('audio-data', { type: 'chat', user: data.nickname, comment: data.comment, audio });
            }
        });

        tiktok.on('gift', async (data) => {
            if (data.repeatEnd) {
                const audio = getGoogleAudio(`Cảm ơn ${data.nickname} tặng ${data.giftName}`);
                socket.emit('audio-data', { type: 'gift', user: "QUÀ", comment: `${data.nickname} tặng ${data.giftName}`, audio });
            }
        });
    });
    socket.on('disconnect', () => { if (tiktok) tiktok.disconnect(); });
});

// API QUẢN TRỊ (Giữ nguyên để Admin.html hoạt động)
app.get('/api/words', async (req, res) => res.json((await BannedWord.find()).map(w => w.word)));
app.post('/api/words', async (req, res) => { const w = new BannedWord({word: req.body.word}); await w.save(); res.json({s:1}); });
app.delete('/api/words/:word', async (req, res) => { await BannedWord.deleteOne({word: req.params.word}); res.json({s:1}); });
app.get('/api/acronyms', async (req, res) => res.json(await Acronym.find()));
app.post('/api/acronyms', async (req, res) => { const a = new Acronym(req.body); await a.save(); res.json({s:1}); });
app.get('/api/emojis', async (req, res) => res.json(await EmojiMap.find()));
app.post('/api/emojis', async (req, res) => { const e = new EmojiMap(req.body); await e.save(); res.json({s:1}); });
app.get('/api/bot', async (req, res) => res.json(await BotAnswer.find()));
app.post('/api/bot', async (req, res) => { const b = new BotAnswer(req.body); await b.save(); res.json({s:1}); });

server.listen(process.env.PORT || 3000, () => console.log('🚀 Server mượt mà đã chạy...'));
