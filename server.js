// Install required packages first: npm install express ws cors dotenv
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Database simulation (In Production: Connect Supabase / Firebase)
let users = {
    "MAX-G7": { password: "123", points: 30, isBlocked: false }
};

let currentBets = {
    wheel_3min: {},  // 0-9 Game
    wheel_30min: {}, // 0-99 Game
    wheel_10min: {}  // A-Z Game
};

let manualOverrides = {
    wheel_3min: null,
    wheel_30min: null,
    wheel_10min: null
};

// IST Time Helper
function getISTDate() {
    let d = new Date();
    let utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    return new Date(utc + (3600000 * 5.5));
}

// 11:00 PM Auto-Reset Check
setInterval(() => {
    let now = getISTDate();
    if (now.getHours() === 23 && now.getMinutes() === 0 && now.getSeconds() === 0) {
        currentBets = { wheel_3min: {}, wheel_30min: {}, wheel_10min: {} };
        manualOverrides = { wheel_3min: null, wheel_30min: null, wheel_10min: null };
        broadcastState({ type: 'RESET_DAY' });
    }
}, 1000);

// Lowest Bet Winner Logic
function calculateWinner(bets, defaultOutcome, maxRange, isChar = false) {
    if (Object.keys(bets).length === 0) return defaultOutcome;

    let betTotals = {};
    for (let key in bets) {
        betTotals[key] = (betTotals[key] || 0) + bets[key].points;
    }

    let minPoints = Infinity;
    let winningChoice = defaultOutcome;

    for (let choice in betTotals) {
        if (betTotals[choice] < minPoints) {
            minPoints = betTotals[choice];
            winningChoice = choice;
        }
    }
    return winningChoice;
}

// Broadcast to WebSocket clients
function broadcastState(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// REST APIs
app.post('/api/admin/create-user', (req, res) => {
    const { userId, password, initialPoints } = req.body;
    if (users[userId]) return res.status(400).json({ error: "User already exists" });
    users[userId] = { password, points: Number(initialPoints) || 0, isBlocked: false };
    res.json({ success: true, message: "User created" });
});

app.post('/api/admin/update-points', (req, res) => {
    const { userId, points, action } = req.body; // action: 'add' or 'subtract'
    if (!users[userId]) return res.status(404).json({ error: "User not found" });
    if (action === 'add') users[userId].points += Number(points);
    if (action === 'subtract') users[userId].points = Math.max(0, users[userId].points - Number(points));
    res.json({ success: true, newPoints: users[userId].points });
});

app.post('/api/admin/toggle-block', (req, res) => {
    const { userId } = req.body;
    if (!users[userId]) return res.status(404).json({ error: "User not found" });
    users[userId].isBlocked = !users[userId].isBlocked;
    res.json({ success: true, isBlocked: users[userId].isBlocked });
});

app.post('/api/admin/manual-override', (req, res) => {
    const { gameType, outcome } = req.body;
    manualOverrides[gameType] = outcome;
    res.json({ success: true, message: `Override set for ${gameType}` });
});

app.post('/api/place-bet', (req, res) => {
    const { userId, gameType, choice, points } = req.body;
    
    // Time Check (10:00 AM to 11:00 PM IST)
    let now = getISTDate();
    let hours = now.getHours();
    if (hours < 10 || hours >= 23) {
        return res.status(400).json({ error: "Betting closed! Game runs 10:00 AM - 11:00 PM IST" });
    }

    if (!users[userId] || users[userId].isBlocked) {
        return res.status(403).json({ error: "Account invalid or blocked!" });
    }

    if (points < 10 || points > 500) {
        return res.status(400).json({ error: "Bet points must be between 10 and 500!" });
    }

    if (users[userId].points < points) {
        return res.status(400).json({ error: "Insufficient balance!" });
    }

    // Deduct points instantly
    users[userId].points -= points;

    if (!currentBets[gameType][choice]) currentBets[gameType][choice] = [];
    currentBets[gameType][choice].push({ userId, points });

    broadcastState({ type: 'NEW_BET', gameType, userId, choice, points });
    res.json({ success: true, remainingPoints: users[userId].points });
});

server.listen(3000, () => console.log('37MAXIGAME Engine running on port 3000'));