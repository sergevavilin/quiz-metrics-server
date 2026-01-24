const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

// 1. Подключение к MongoDB
// Замени <CONNECTION_STRING> на свою строку из Atlas
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://sergevavilin_db_user:6jDW62GJ0aDnIIBj@cluster0.q9aecqy.mongodb.net/?appName=Cluster0";

mongoose.connect(MONGO_URI)
    .then(() => console.log('Connected to MongoDB Atlas'))
    .catch(err => console.error('MongoDB connection error:', err));

// 2. Описание схемы данных
const SnapshotSchema = new mongoose.Schema({
    dayKey: { type: String, unique: true, required: true }, // Уникальный ключ дня
    data: Object,                                          // Сами метрики
    receivedAt: { type: Date, default: Date.now }
});

const Snapshot = mongoose.model('Snapshot', SnapshotSchema);

// 3. Эндпоинт ПРОВЕРКИ (exists?)
app.get('/metrics/check/:dayKey', async (req, res) => {
    try {
        const { dayKey } = req.params;
        const exists = await Snapshot.exists({ dayKey });
        
        console.log(`Check: ${dayKey} -> ${!!exists}`);
        res.json({ exists: !!exists });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 4. Эндпоинт ЗАГРУЗКИ (upload)
app.post('/metrics/upload', async (req, res) => {
    try {
        const { dayKey, data } = req.body;

        if (!dayKey || !data) {
            return res.status(400).json({ error: 'Missing fields' });
        }

        // Сохраняем в базу (upsert: если вдруг пришло дважды, обновит)
        await Snapshot.findOneAndUpdate(
            { dayKey },
            { data },
            { upsert: true, new: true }
        );

        console.log(`Saved: ${dayKey}`);
        res.status(201).json({ status: 'saved' });
    } catch (e) {
        console.error('Upload error:', e);
        res.status(500).json({ error: e.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));