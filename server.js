const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); 

// 1. Подключение к MongoDB
const MONGO_URI = process.env.MONGO_URI; 

if (!MONGO_URI) {
    console.error("❌ КРИТИЧЕСКАЯ ОШИБКА: Переменная MONGO_URI не задана в настройках сервера!");
    process.exit(1);
}

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB Atlas'))
    .catch(err => console.error('❌ MongoDB connection error:', err));

// ==========================================
// 2. СХЕМЫ ДАННЫХ (Collections)
// ==========================================

// --- 1. Коллекция Метрик (User_Metrics) ---
const MetricSchema = new mongoose.Schema({
    userId: { type: String, required: true },  
    date: { type: String, required: true },    // "2026-03-03"
    dayKey: { type: String, required: true },  // "UUID_DATE"
    sessions: Array,                           // Массив сессий из твоего DailyReport
    isNewUser: { type: Boolean, default: false }, // Флаг регистрации
    receivedAt: { type: Date, default: Date.now }
}, { collection: 'metrics' });

MetricSchema.index({ dayKey: 1 }, { unique: true });
const Metric = mongoose.model('Metric', MetricSchema);

// --- 2. Коллекция Репортов (Reports) ---
const ReportSchema = new mongoose.Schema({
    userId: String,
    screen: String,      // 'test', 'settings' и т.д.
    collectionId: String,
    questionId: String,
    comment: String,     // Что именно не так
    status: { type: String, default: 'new' }, // для тебя: new, fixed, ignored
    receivedAt: { type: Date, default: Date.now }
}, { collection: 'Reports' });
const Report = mongoose.model('Report', ReportSchema);

// --- 3. Коллекция Стора (Store_Collect) ---
const AdminCollectSchema = new mongoose.Schema({
    id: String,
    title: String,
    description: String,
    version: String,
    filename: String,
    content: Buffer, 
    size_bytes: Number
}, { collection: 'Store_Collect' });
const AdminCollect = mongoose.model('Store_Collect', AdminCollectSchema);


// ==========================================
// 3. API МЕТРИК И РЕГИСТРАЦИИ
// ==========================================

/**
 * Регистрация "Первого контакта"
 */
app.post('/metrics/register', async (req, res) => {
    try {
        const { userId, date } = req.body;
        
        // Создаем запись-"пустышку", которая помечает юзера как активного
        await Metric.findOneAndUpdate(
            { dayKey: `reg_${userId}` }, 
            { userId, date, isNewUser: true },
            { upsert: true }
        );

        console.log(`[Auth] New user registered: ${userId}`);
        res.status(201).json({ status: 'registered' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * Загрузка дневного отчета (UUID_DATE.json)
 */
app.post('/metrics/upload', async (req, res) => {
    try {
        const { dayKey, userId, date, sessions } = req.body;

        await Metric.findOneAndUpdate(
            { dayKey },
            { userId, date, sessions, isNewUser: false },
            { upsert: true, new: true }
        );

        console.log(`[Metrics] Snapshot saved: ${dayKey}`);
        res.status(200).json({ status: 'ok' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// 4. API РЕПОРТОВ (Жалоб)
// ==========================================

app.post('/api/report', async (req, res) => {
    try {
        const reportData = req.body;
        const newReport = new Report(reportData);
        await newReport.save();

        console.log(`[Report] New issue from ${reportData.userId} on ${reportData.screen}`);
        res.status(201).json({ status: 'received' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// ==========================================
// 5. API МАГАЗИНА (БЕЗ ИЗМЕНЕНИЙ)
// ==========================================

app.get('/api/store', async (req, res) => {
    try {
        const files = await AdminCollect.find({}, '-content');
        const storeData = files.map(f => ({
            id: f.id || f.filename.split('.')[0],
            title: f.title || f.filename,
            description: f.description || '',
            file: f.filename,
            version: f.version || '1.0'
        }));
        res.json(storeData);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/download/:filename', async (req, res) => {
    try {
        const fileDoc = await AdminCollect.findOne({ filename: req.params.filename });
        if (!fileDoc) return res.status(404).send('Not found');
        res.set('Content-Type', 'application/octet-stream');
        res.send(fileDoc.content);
    } catch (e) {
        res.status(500).send(e.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 GooseServer v0.1 running on ${PORT}`));

