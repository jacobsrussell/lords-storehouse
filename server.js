const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'db.json');
const COIN_VALUE = 50;
const DISTRIBUTION_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `deposit-${uuidv4()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|pdf/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype) || file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf';
    if (ext || mime) cb(null, true);
    else cb(new Error('Only images (JPG, PNG, GIF, WebP) and PDF files are allowed'));
  }
});

app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/tunnel-url', (req, res) => {
  const renderUrl = process.env.RENDER_EXTERNAL_URL || process.env.RENDER_SERVICE_URL;
  if (renderUrl) return res.json({ url: renderUrl });
  if (currentTunnelUrl) return res.json({ url: currentTunnelUrl });
  res.json({ url: `http://localhost:${PORT}` });
});

function readDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      const dir = path.dirname(DB_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const defaultDB = { users: [], transactions: [], messages: [], offerings: [], referrals: [], pool: { total: 0, distributed: 0, lastDistributionAt: null }, distributionHistory: [] };
      fs.writeFileSync(DB_PATH, JSON.stringify(defaultDB, null, 2));
      return defaultDB;
    }
    const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    if (!db.pool) db.pool = { total: 0, distributed: 0, lastDistributionAt: null };
    if (!db.pool.lastDistributionAt) db.pool.lastDistributionAt = null;
    if (!db.distributionHistory) db.distributionHistory = [];
    if (!db.messages) db.messages = [];
    return db;
  } catch {
    return { users: [], transactions: [], messages: [], offerings: [], referrals: [], pool: { total: 0, distributed: 0, lastDistributionAt: null }, distributionHistory: [] };
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

const sessions = {};

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const db = readDB();

  // Check in-memory session first (fast)
  if (sessions[token]) {
    const user = db.users.find(u => u.id === sessions[token].id);
    if (user && user.isActive !== false) {
      req.user = user;
      return next();
    }
  }

  // Fallback: check persisted authToken in DB (survives server restarts)
  const user = db.users.find(u => u.authToken === token);
  if (user && user.isActive !== false) {
    req.user = user;
    sessions[token] = { id: user.id, username: user.username };
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized' });
}

app.post('/api/register', async (req, res) => {
  const { username, email, password, fullName, phone, referralCode } = req.body;
  if (!username || !email || !password || !fullName) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  const db = readDB();
  if (db.users.find(u => u.email === email)) {
    return res.status(400).json({ error: 'Email already registered' });
  }
  if (db.users.find(u => u.username === username)) {
    return res.status(400).json({ error: 'Username already taken' });
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  const userReferralCode = uuidv4().slice(0, 8).toUpperCase();
  const user = {
    id: uuidv4(),
    username,
    email,
    password: hashedPassword,
    fullName,
    phone: phone || '',
    referralCode: userReferralCode,
    referredBy: referralCode || null,
    coins: 0,
    balance: 0,
    totalDeposited: 0,
    totalWithdrawn: 0,
    totalOfferings: 0,
    totalReferralEarnings: 0,
    referralCount: 0,
    joinedAt: new Date().toISOString(),
    lastWithdrawalAt: null,
    avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=' + username,
    role: 'believer',
    isActive: true
  };
  if (referralCode) {
    const referrer = db.users.find(u => u.referralCode === referralCode);
    if (referrer) {
      referrer.referralCount += 1;
      db.referrals.push({
        id: uuidv4(),
        referrerId: referrer.id,
        referredId: user.id,
        createdAt: new Date().toISOString(),
        rewarded: false
      });
    }
  }
  db.users.push(user);
  writeDB(db);
  const token = uuidv4();
  sessions[token] = { id: user.id, username: user.username };
  user.authToken = token;
  writeDB(db);
  res.json({ token, user: sanitizeUser(user) });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const db = readDB();
  const user = db.users.find(u => u.email === email);
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = uuidv4();
  sessions[token] = { id: user.id, username: user.username };
  user.authToken = token;
  writeDB(db);
  res.json({ token, user: sanitizeUser(user) });
});

app.post('/api/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  delete sessions[token];
  res.json({ success: true });
});

app.get('/api/me', authMiddleware, (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(sanitizeUser(user));
});

app.post('/api/deposit', authMiddleware, upload.single('proof'), (req, res) => {
  const { amount, reference } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  const depositAmount = parseFloat(amount);
  const proofFile = req.file ? `/uploads/${req.file.filename}` : null;
  const db = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.transactions.push({
    id: uuidv4(),
    userId: user.id,
    type: 'deposit',
    amount: depositAmount,
    reference: reference || '',
    proofFile: proofFile,
    status: 'pending',
    createdAt: new Date().toISOString()
  });
  writeDB(db);
  res.json({ success: true, message: 'Deposit submitted for verification. Admin will review your proof of payment.' });
});

app.post('/api/buy-coins', authMiddleware, (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  const db = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const coinAmount = parseInt(amount);
  const cost = coinAmount * COIN_VALUE;
  if (user.balance < cost) {
    return res.status(400).json({ error: 'Insufficient balance. Deposit funds first.' });
  }
  user.balance -= cost;
  user.coins += coinAmount;
  db.transactions.push({
    id: uuidv4(),
    userId: user.id,
    type: 'buy_coins',
    amount: coinAmount,
    cost: cost,
    status: 'completed',
    createdAt: new Date().toISOString()
  });
  writeDB(db);
  res.json({ success: true, balance: user.balance, coins: user.coins });
});

app.post('/api/send-offering', authMiddleware, (req, res) => {
  const { recipientUsername, coinAmount, message } = req.body;
  if (!coinAmount || coinAmount <= 0) return res.status(400).json({ error: 'Invalid coin amount' });
  const db = readDB();
  const sender = db.users.find(u => u.id === req.user.id);
  const recipient = db.users.find(u => u.username === recipientUsername);
  if (!sender) return res.status(404).json({ error: 'Sender not found' });
  if (!recipient) return res.status(404).json({ error: 'Recipient not found' });
  if (sender.id === recipient.id) return res.status(400).json({ error: 'Cannot offer to yourself' });
  if (sender.coins < coinAmount) return res.status(400).json({ error: 'Insufficient coins' });
  const offeringValue = parseInt(coinAmount) * COIN_VALUE;
  sender.coins -= parseInt(coinAmount);
  sender.totalOfferings += offeringValue;
  recipient.coins += parseInt(coinAmount);
  db.pool.total += offeringValue;
  db.offerings.push({
    id: uuidv4(),
    senderId: sender.id,
    recipientId: recipient.id,
    coinAmount: parseInt(coinAmount),
    value: offeringValue,
    message: message || '',
    createdAt: new Date().toISOString()
  });
  db.transactions.push({
    id: uuidv4(),
    userId: sender.id,
    type: 'offering_sent',
    amount: parseInt(coinAmount),
    value: offeringValue,
    recipientUsername,
    status: 'completed',
    createdAt: new Date().toISOString()
  });
  db.transactions.push({
    id: uuidv4(),
    userId: recipient.id,
    type: 'offering_received',
    amount: parseInt(coinAmount),
    value: offeringValue,
    senderUsername: sender.username,
    status: 'completed',
    createdAt: new Date().toISOString()
  });
  writeDB(db);
  res.json({ success: true, balance: sender.balance, coins: sender.coins });
});

app.post('/api/withdraw', authMiddleware, (req, res) => {
  const { amount, bankName, accountNumber, branchCode, accountName } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  const db = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const withdrawAmount = parseFloat(amount);
  if (user.balance < withdrawAmount) return res.status(400).json({ error: 'Insufficient balance' });
  if (withdrawAmount < 50) return res.status(400).json({ error: 'Minimum withdrawal is R50' });
  if (withdrawAmount > 50000) return res.status(400).json({ error: 'Maximum single withdrawal is R50,000' });
  const WITHDRAWAL_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
  if (user.lastWithdrawalAt) {
    const lastDate = new Date(user.lastWithdrawalAt);
    const now = new Date();
    const elapsed = now - lastDate;
    if (elapsed < WITHDRAWAL_INTERVAL_MS) {
      const remaining = WITHDRAWAL_INTERVAL_MS - elapsed;
      const days = Math.floor(remaining / (24 * 60 * 60 * 1000));
      const hours = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
      return res.status(400).json({
        error: `Withdrawal frequency limit reached. You may withdraw once every 7 days. Next withdrawal available in ${days} day(s) and ${hours} hour(s).`,
        nextWithdrawalAt: new Date(lastDate.getTime() + WITHDRAWAL_INTERVAL_MS).toISOString(),
        remainingMs: remaining
      });
    }
  }
  const fee = Math.round(withdrawAmount * 0.05 * 100) / 100;
  const netAmount = Math.round((withdrawAmount - fee) * 100) / 100;
  user.balance -= withdrawAmount;
  user.totalWithdrawn += withdrawAmount;
  user.lastWithdrawalAt = new Date().toISOString();
  const txId = uuidv4();
  db.transactions.push({
    id: txId,
    userId: user.id,
    type: 'withdrawal',
    amount: withdrawAmount,
    fee: fee,
    netAmount: netAmount,
    bankDetails: { bankName, accountNumber, branchCode, accountName },
    status: 'pending',
    createdAt: new Date().toISOString(),
    processedAt: null,
    estimatedCompletion: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
  });
  writeDB(db);
  const nextAllowed = new Date(Date.now() + WITHDRAWAL_INTERVAL_MS).toISOString();
  res.json({
    success: true,
    balance: user.balance,
    fee: fee,
    netAmount: netAmount,
    nextWithdrawalAt: nextAllowed,
    transactionId: txId,
    message: `Withdrawal of R ${withdrawAmount.toFixed(2)} submitted. Fee: R ${fee.toFixed(2)}. Net: R ${netAmount.toFixed(2)}. Processing within 24-48 hours.`
  });
});

app.get('/api/withdrawal-status', authMiddleware, (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const WITHDRAWAL_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
  const now = new Date();
  let canWithdraw = true;
  let nextWithdrawalAt = null;
  let remainingMs = 0;
  if (user.lastWithdrawalAt) {
    const lastDate = new Date(user.lastWithdrawalAt);
    const elapsed = now - lastDate;
    if (elapsed < WITHDRAWAL_INTERVAL_MS) {
      canWithdraw = false;
      remainingMs = WITHDRAWAL_INTERVAL_MS - elapsed;
      nextWithdrawalAt = new Date(lastDate.getTime() + WITHDRAWAL_INTERVAL_MS).toISOString();
    } else {
      nextWithdrawalAt = now.toISOString();
    }
  } else {
    nextWithdrawalAt = now.toISOString();
  }
  const remainingDays = Math.floor(remainingMs / (24 * 60 * 60 * 1000));
  const remainingHours = Math.floor((remainingMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const remainingMinutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
  const withdrawals = db.transactions
    .filter(t => t.userId === user.id && t.type === 'withdrawal')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const pending = withdrawals.filter(w => w.status === 'pending');
  const completed = withdrawals.filter(w => w.status === 'completed');
  const totalWithdrawn = withdrawals.reduce((sum, w) => sum + w.amount, 0);
  const totalFees = withdrawals.reduce((sum, w) => sum + (w.fee || 0), 0);
  res.json({
    canWithdraw,
    nextWithdrawalAt,
    remainingMs,
    remainingDays,
    remainingHours,
    remainingMinutes,
    lastWithdrawalAt: user.lastWithdrawalAt,
    maxPerWithdrawal: 50000,
    minPerWithdrawal: 50,
    feePercentage: 5,
    frequencyLabel: 'Once every 7 days (1 per week)',
    withdrawals: withdrawals.slice(0, 20),
    pendingCount: pending.length,
    completedCount: completed.length,
    totalWithdrawn,
    totalFees
  });
});

app.get('/api/transactions', authMiddleware, (req, res) => {
  const db = readDB();
  const transactions = db.transactions.filter(t => t.userId === req.user.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(transactions);
});

app.get('/api/leaderboard', authMiddleware, (req, res) => {
  const db = readDB();
  const leaders = db.users
    .map(u => ({ id: u.id, username: u.username, fullName: u.fullName, avatar: u.avatar, coins: u.coins, totalOfferings: u.totalOfferings, referralCount: u.referralCount }))
    .sort((a, b) => b.totalOfferings - a.totalOfferings)
    .slice(0, 20);
  res.json(leaders);
});

app.get('/api/referrals', authMiddleware, (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  const myReferrals = db.referrals
    .filter(r => r.referrerId === req.user.id)
    .map(r => {
      const referred = db.users.find(u => u.id === r.referredId);
      return { ...r, referredUser: referred ? { username: referred.username, fullName: referred.fullName, avatar: referred.avatar, joinedAt: referred.joinedAt } : null };
    });
  res.json({ referralCode: user.referralCode, referralCount: user.referralCount, totalReferralEarnings: user.totalReferralEarnings, referrals: myReferrals });
});

app.get('/api/stats', authMiddleware, (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  const totalPool = db.pool.total;
  const poolDistributable = totalPool * 0.45;
  res.json({
    totalUsers: db.users.length,
    totalPool,
    poolDistributable,
    userCoins: user.coins,
    userBalance: user.balance,
    userOfferings: user.totalOfferings,
    fishercoinValue: COIN_VALUE
  });
});

app.get('/api/messages', authMiddleware, (req, res) => {
  const db = readDB();
  const messages = db.messages.slice(-100);
  const enriched = messages.map(m => {
    const u = db.users.find(usr => usr.id === m.userId);
    return { ...m, username: u?.username || 'Unknown', avatar: u?.avatar || '' };
  });
  res.json(enriched);
});

// WebSocket
const clients = new Map();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  if (!token) { ws.close(1008, 'Unauthorized'); return; }

  let wsUser = null;
  if (sessions[token]) {
    const db = readDB();
    wsUser = db.users.find(u => u.id === sessions[token].id);
  }
  if (!wsUser) {
    const db = readDB();
    wsUser = db.users.find(u => u.authToken === token);
    if (wsUser) sessions[token] = { id: wsUser.id, username: wsUser.username };
  }
  if (!wsUser) { ws.close(1008, 'Unauthorized'); return; }

  clients.set(wsUser.id, ws);

  broadcast({ type: 'system', text: `${wsUser.username} has entered the Temple of Fellowship`, timestamp: new Date().toISOString() });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'chat') {
        const db = readDB();
        const chatMsg = {
          id: uuidv4(),
          userId: user.id,
          username: user.username,
          text: msg.text.substring(0, 500),
          timestamp: new Date().toISOString()
        };
        db.messages.push(chatMsg);
        if (db.messages.length > 500) db.messages = db.messages.slice(-500);
        writeDB(db);
        const u = db.users.find(usr => usr.id === user.id);
        broadcast({ ...chatMsg, avatar: u?.avatar || '' });
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    clients.delete(user.id);
    broadcast({ type: 'system', text: `${user.username} has left the Temple of Fellowship`, timestamp: new Date().toISOString() });
  });
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

function sanitizeUser(user) {
  const { password, ...safe } = user;
  return safe;
}

function adminMiddleware(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// ===== ADMIN ROUTES =====

app.get('/api/admin/stats', adminMiddleware, (req, res) => {
  const db = readDB();
  const totalUsers = db.users.length;
  const totalDeposits = db.transactions.filter(t => t.type === 'deposit').reduce((sum, t) => sum + t.amount, 0);
  const totalWithdrawn = db.transactions.filter(t => t.type === 'withdrawal' && t.status === 'completed').reduce((sum, t) => sum + t.amount, 0);
  const pendingWithdrawals = db.transactions.filter(t => t.type === 'withdrawal' && t.status === 'pending').length;
  const totalOfferings = db.transactions.filter(t => t.type === 'offering_sent').reduce((sum, t) => sum + (t.value || 0), 0);
  const totalCoinsPurchased = db.transactions.filter(t => t.type === 'buy_coins').reduce((sum, t) => sum + t.amount, 0);
  const activeUsers = db.users.filter(u => u.isActive).length;
  res.json({
    totalUsers,
    activeUsers,
    totalPool: db.pool.total,
    poolDistributable: db.pool.total * 0.45,
    poolDistributed: db.pool.distributed,
    totalDeposits,
    totalWithdrawn,
    totalOfferings,
    totalCoinsPurchased,
    pendingWithdrawals,
    totalTransactions: db.transactions.length
  });
});

app.get('/api/admin/users', adminMiddleware, (req, res) => {
  const db = readDB();
  const users = db.users.map(u => ({
    id: u.id,
    username: u.username,
    email: u.email,
    fullName: u.fullName,
    phone: u.phone,
    role: u.role,
    isActive: u.isActive,
    coins: u.coins,
    balance: u.balance,
    totalDeposited: u.totalDeposited,
    totalWithdrawn: u.totalWithdrawn,
    totalOfferings: u.totalOfferings,
    referralCount: u.referralCount,
    joinedAt: u.joinedAt,
    lastWithdrawalAt: u.lastWithdrawalAt
  })).sort((a, b) => new Date(b.joinedAt) - new Date(a.joinedAt));
  res.json(users);
});

app.put('/api/admin/users/:id', adminMiddleware, (req, res) => {
  const { role, isActive } = req.body;
  const db = readDB();
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'admin' && user.id !== req.user.id) {
    return res.status(400).json({ error: 'Cannot modify another admin' });
  }
  if (role) user.role = role;
  if (typeof isActive === 'boolean') user.isActive = isActive;
  writeDB(db);
  res.json({ success: true, user: sanitizeUser(user) });
});

app.get('/api/admin/withdrawals', adminMiddleware, (req, res) => {
  const db = readDB();
  const status = req.query.status;
  let withdrawals = db.transactions.filter(t => t.type === 'withdrawal');
  if (status) withdrawals = withdrawals.filter(t => t.status === status);
  withdrawals = withdrawals.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const enriched = withdrawals.map(w => {
    const user = db.users.find(u => u.id === w.userId);
    return { ...w, user: user ? { username: user.username, fullName: user.fullName, email: user.email } : null };
  });
  res.json(enriched);
});

app.put('/api/admin/withdrawals/:id/approve', adminMiddleware, (req, res) => {
  const db = readDB();
  const tx = db.transactions.find(t => t.id === req.params.id && t.type === 'withdrawal');
  if (!tx) return res.status(404).json({ error: 'Withdrawal not found' });
  if (tx.status !== 'pending') return res.status(400).json({ error: 'Withdrawal is not pending' });
  tx.status = 'completed';
  tx.processedAt = new Date().toISOString();
  tx.processedBy = req.user.id;
  writeDB(db);
  res.json({ success: true, transaction: tx });
});

app.put('/api/admin/withdrawals/:id/reject', adminMiddleware, (req, res) => {
  const db = readDB();
  const tx = db.transactions.find(t => t.id === req.params.id && t.type === 'withdrawal');
  if (!tx) return res.status(404).json({ error: 'Withdrawal not found' });
  if (tx.status !== 'pending') return res.status(400).json({ error: 'Withdrawal is not pending' });
  const user = db.users.find(u => u.id === tx.userId);
  if (user) {
    user.balance += tx.amount;
    user.totalWithdrawn -= tx.amount;
    user.lastWithdrawalAt = null;
  }
  tx.status = 'rejected';
  tx.processedAt = new Date().toISOString();
  tx.processedBy = req.user.id;
  tx.rejectionReason = req.body.reason || 'Rejected by administrator';
  writeDB(db);
  res.json({ success: true, transaction: tx });
});

// ===== DEPOSIT VERIFICATION =====
app.get('/api/admin/deposits', adminMiddleware, (req, res) => {
  const db = readDB();
  const status = req.query.status;
  let deposits = db.transactions.filter(t => t.type === 'deposit');
  if (status) deposits = deposits.filter(t => t.status === status);
  deposits = deposits.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const enriched = deposits.map(d => {
    const user = db.users.find(u => u.id === d.userId);
    return { ...d, user: user ? { username: user.username, fullName: user.fullName, email: user.email } : null };
  });
  res.json(enriched);
});

app.put('/api/admin/deposits/:id/approve', adminMiddleware, (req, res) => {
  const db = readDB();
  const tx = db.transactions.find(t => t.id === req.params.id && t.type === 'deposit');
  if (!tx) return res.status(404).json({ error: 'Deposit not found' });
  if (tx.status !== 'pending') return res.status(400).json({ error: 'Deposit is not pending' });
  const user = db.users.find(u => u.id === tx.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.balance += tx.amount;
  user.totalDeposited += tx.amount;
  db.pool.total += tx.amount;
  tx.status = 'completed';
  tx.processedAt = new Date().toISOString();
  tx.processedBy = req.user.id;
  writeDB(db);
  res.json({ success: true, transaction: tx });
});

app.put('/api/admin/deposits/:id/reject', adminMiddleware, (req, res) => {
  const db = readDB();
  const tx = db.transactions.find(t => t.id === req.params.id && t.type === 'deposit');
  if (!tx) return res.status(404).json({ error: 'Deposit not found' });
  if (tx.status !== 'pending') return res.status(400).json({ error: 'Deposit is not pending' });
  tx.status = 'rejected';
  tx.processedAt = new Date().toISOString();
  tx.processedBy = req.user.id;
  tx.rejectionReason = req.body.reason || 'Rejected by administrator';
  writeDB(db);
  res.json({ success: true, transaction: tx });
});

app.get('/api/admin/transactions', adminMiddleware, (req, res) => {
  const db = readDB();
  let txs = db.transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const limit = parseInt(req.query.limit) || 100;
  const enriched = txs.slice(0, limit).map(tx => {
    const user = db.users.find(u => u.id === tx.userId);
    return { ...tx, username: user?.username || 'Unknown', fullName: user?.fullName || 'Unknown' };
  });
  res.json(enriched);
});

// ===== AUTO-DISTRIBUTION =====
function performDistribution() {
  const db = readDB();
  const distributable = db.pool.total * 0.45 - db.pool.distributed;
  if (distributable <= 0) return null;
  const eligibleUsers = db.users.filter(u => u.isActive && u.role === 'believer');
  if (eligibleUsers.length === 0) return null;
  const perUser = Math.floor((distributable / eligibleUsers.length) * 100) / 100;
  const recipients = [];
  eligibleUsers.forEach(u => {
    u.balance += perUser;
    db.pool.distributed += perUser;
    recipients.push({ userId: u.id, username: u.username, amount: perUser });
    db.transactions.push({
      id: uuidv4(),
      userId: u.id,
      type: 'pool_distribution',
      amount: perUser,
      status: 'completed',
      createdAt: new Date().toISOString()
    });
  });
  const record = {
    id: uuidv4(),
    totalPool: db.pool.total,
    distributed: Math.round(perUser * eligibleUsers.length * 100) / 100,
    perUser,
    recipients: eligibleUsers.length,
    timestamp: new Date().toISOString()
  };
  if (!db.distributionHistory) db.distributionHistory = [];
  db.distributionHistory.push(record);
  db.pool.lastDistributionAt = new Date().toISOString();
  writeDB(db);
  return record;
}

function checkAutoDistribution() {
  const db = readDB();
  const now = new Date();
  const lastDist = db.pool.lastDistributionAt ? new Date(db.pool.lastDistributionAt) : null;
  if (!lastDist || (now - lastDist) >= DISTRIBUTION_INTERVAL_MS) {
    const result = performDistribution();
    if (result) {
      console.log(`[Auto-Distribution] Distributed R${result.distributed} to ${result.recipients} users (R${result.perUser} each)`);
    }
  }
}

setInterval(checkAutoDistribution, 60 * 1000);

app.get('/api/distribution-status', authMiddleware, (req, res) => {
  const db = readDB();
  const now = new Date();
  const lastDist = db.pool.lastDistributionAt ? new Date(db.pool.lastDistributionAt) : null;
  let nextDistributionAt;
  let canDistributeNow = false;
  if (!lastDist) {
    nextDistributionAt = now.toISOString();
    canDistributeNow = true;
  } else {
    const elapsed = now - lastDist;
    if (elapsed >= DISTRIBUTION_INTERVAL_MS) {
      nextDistributionAt = now.toISOString();
      canDistributeNow = true;
    } else {
      nextDistributionAt = new Date(lastDist.getTime() + DISTRIBUTION_INTERVAL_MS).toISOString();
    }
  }
  const remainingMs = canDistributeNow ? 0 : new Date(nextDistributionAt) - now;
  const days = Math.floor(remainingMs / (24 * 60 * 60 * 1000));
  const hours = Math.floor((remainingMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
  const seconds = Math.floor((remainingMs % (60 * 1000)) / 1000);
  const distributable = db.pool.total * 0.45 - db.pool.distributed;
  const history = (db.distributionHistory || []).slice(-20).reverse();
  res.json({
    totalPool: db.pool.total,
    poolDistributable: db.pool.total * 0.45,
    poolDistributed: db.pool.distributed,
    distributableNow: Math.max(0, distributable),
    lastDistributionAt: db.pool.lastDistributionAt,
    nextDistributionAt,
    canDistributeNow,
    remainingMs,
    remainingDays: days,
    remainingHours: hours,
    remainingMinutes: minutes,
    remainingSeconds: seconds,
    intervalDays: 7,
    history
  });
});

app.put('/api/admin/pool', adminMiddleware, (req, res) => {
  const db = readDB();
  const { action, amount, userIds } = req.body;
  if (action === 'distribute') {
    const distributable = db.pool.total * 0.45 - db.pool.distributed;
    if (distributable <= 0) return res.status(400).json({ error: 'No funds available for distribution' });
    const eligibleUsers = db.users.filter(u => u.isActive && u.role === 'believer');
    if (eligibleUsers.length === 0) return res.status(400).json({ error: 'No eligible users' });
    const perUser = Math.floor((distributable / eligibleUsers.length) * 100) / 100;
    eligibleUsers.forEach(u => {
      u.balance += perUser;
      db.pool.distributed += perUser;
      db.transactions.push({
        id: uuidv4(),
        userId: u.id,
        type: 'pool_distribution',
        amount: perUser,
        status: 'completed',
        createdAt: new Date().toISOString()
      });
    });
    writeDB(db);
    return res.json({ success: true, distributed: perUser, recipients: eligibleUsers.length, totalDistributed: perUser * eligibleUsers.length });
  }
  if (action === 'adjust' && typeof amount === 'number') {
    db.pool.total += amount;
    writeDB(db);
    return res.json({ success: true, newTotal: db.pool.total });
  }
  res.status(400).json({ error: 'Invalid action' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function ensureAdminAccount() {
  const db = readDB();
  const adminExists = db.users.find(u => u.role === 'admin');
  if (!adminExists) {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    const adminUser = {
      id: uuidv4(),
      username: 'admin',
      email: 'admin@storehouse.faith',
      password: hashedPassword,
      fullName: 'Store-house Administrator',
      phone: '',
      referralCode: uuidv4().slice(0, 8).toUpperCase(),
      referredBy: null,
      coins: 0,
      balance: 0,
      totalDeposited: 0,
      totalWithdrawn: 0,
      totalOfferings: 0,
      totalReferralEarnings: 0,
      referralCount: 0,
      joinedAt: new Date().toISOString(),
      lastWithdrawalAt: null,
      avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=admin',
      role: 'admin',
      isActive: true
    };
    db.users.push(adminUser);
    writeDB(db);
    console.log('Admin account created: admin@storehouse.faith / admin123');
  }
}

const { execFile, spawn } = require('child_process');
const CF_PATH = path.join('C:', 'Users', 'jacob', 'nodejs', 'node-v20.18.0-win-x64', 'node_modules', 'cloudflared', 'bin', 'cloudflared.exe');

let currentTunnelUrl = null;

function startTunnel() {
  console.log('Starting Cloudflare tunnel...');
  const cf = spawn(CF_PATH, ['tunnel', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });

  cf.stdout.on('data', (data) => {
    const line = data.toString();
    const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match) {
      currentTunnelUrl = match[0];
      console.log(`Tunnel active: ${currentTunnelUrl}`);
    }
  });

  cf.stderr.on('data', (data) => {
    const line = data.toString();
    const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match) {
      currentTunnelUrl = match[0];
      console.log(`Tunnel active: ${currentTunnelUrl}`);
    }
  });

  cf.on('exit', (code) => {
    console.log(`Tunnel exited with code ${code}. Restarting in 5s...`);
    currentTunnelUrl = null;
    setTimeout(startTunnel, 5000);
  });

  cf.on('error', (err) => {
    console.log(`Tunnel error: ${err.message}. Restarting in 5s...`);
    setTimeout(startTunnel, 5000);
  });
}

ensureAdminAccount().then(() => {
  server.listen(PORT, () => {
    console.log(`The LORD's Store-house is running on http://localhost:${PORT}`);
    console.log('"Bring the whole tithe into the storehouse, that there may be food in my house." — Malachi 3:10');
    console.log('Admin login: admin@storehouse.faith / admin123');

    const isProduction = process.env.NODE_ENV === 'production';
    if (!isProduction) {
      startTunnel();
      fs.watch(PUBLIC_DIR, { recursive: true }, (eventType, filename) => {
        if (filename) {
          console.log(`File changed: ${filename} — reloading browser`);
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'reload' }));
            }
          });
        }
      });
    }
  });
});
