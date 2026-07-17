/* ========================================
   THE LORD'S STORE-HOUSE — Main Application
   ======================================== */

const COIN_VALUE = 50;
let currentUser = null;
let authToken = localStorage.getItem('storehouse_token');

// ===== API HELPERS =====
async function api(url, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

// ===== TOAST SYSTEM =====
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const icons = { success: '&#10004;', error: '&#10008;', info: '&#8505;' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type]}</span><span class="toast-text">${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

// ===== PRELOADER =====
window.addEventListener('load', () => {
  setTimeout(() => {
    const preloader = document.getElementById('preloader');
    preloader.classList.add('fade-out');
    setTimeout(() => {
      preloader.style.display = 'none';
      if (authToken) {
        loadApp();
      } else {
        showAuth();
      }
    }, 800);
  }, 2000);
});

function showAuth() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app-screen').classList.add('hidden');
}

function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
}

// ===== AUTH TABS =====
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab + '-form').classList.add('active');
  });
});

// ===== LOGIN =====
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  try {
    const data = await api('/api/login', 'POST', { email, password });
    authToken = data.token;
    localStorage.setItem('storehouse_token', authToken);
    currentUser = data.user;
    showApp();
    initDashboard();
    showToast('Welcome back, ' + currentUser.fullName + '! The Store-house is open.', 'success');
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

// ===== REGISTER =====
document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fullName = document.getElementById('reg-fullname').value;
  const username = document.getElementById('reg-username').value;
  const email = document.getElementById('reg-email').value;
  const phone = document.getElementById('reg-phone').value;
  const password = document.getElementById('reg-password').value;
  const referralCode = document.getElementById('reg-referral').value;
  const errorEl = document.getElementById('register-error');
  try {
    const data = await api('/api/register', 'POST', { fullName, username, email, phone, password, referralCode });
    authToken = data.token;
    localStorage.setItem('storehouse_token', authToken);
    currentUser = data.user;
    showApp();
    initDashboard();
    showToast('Welcome to The LORD\'s Store-house, ' + currentUser.fullName + '! You have joined the flock.', 'success');
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

// ===== LOGOUT =====
document.getElementById('logout-btn').addEventListener('click', async () => {
  try {
    await api('/api/logout', 'POST');
  } catch {}
  authToken = null;
  localStorage.removeItem('storehouse_token');
  currentUser = null;
  if (window.chatWs) window.chatWs.close();
  showAuth();
  showToast('You have left the Store-house. Go in peace.', 'info');
});

// ===== LOAD APP =====
async function loadApp() {
  try {
    currentUser = await api('/api/me');
    showApp();
    initDashboard();
  } catch {
    authToken = null;
    localStorage.removeItem('storehouse_token');
    showAuth();
  }
}

// ===== NAVIGATION =====
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const section = link.dataset.section;
    navigateTo(section);
  });
});

document.querySelectorAll('.quick-btn').forEach(btn => {
  btn.addEventListener('click', () => navigateTo(btn.dataset.section));
});

document.querySelectorAll('.auth-tab').forEach(() => {});

function navigateTo(section) {
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  const navLink = document.querySelector(`.nav-link[data-section="${section}"]`);
  if (navLink) navLink.classList.add('active');
  const sectionEl = document.getElementById('section-' + section);
  if (sectionEl) sectionEl.classList.add('active');
  document.getElementById('sidebar').classList.remove('open');
  if (section === 'chat' && window.connectChat) window.connectChat();
  if (section === 'leaderboard') loadLeaderboard();
  if (section === 'referrals') loadReferrals();
  if (section === 'storehouse' && window.loadWithdrawalStatus) loadWithdrawalStatus();
  if (section === 'admin' && typeof loadAdminStats === 'function') loadAdminStats();
}

// ===== MOBILE MENU =====
document.getElementById('menu-toggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

document.getElementById('mobile-chat-btn')?.addEventListener('click', () => navigateTo('chat'));

// ===== DASHBOARD =====
async function initDashboard() {
  if (!currentUser) return;
  updateSidebar();
  await refreshDashboard();
  loadRecentTransactions();
  loadDistributionStatus();
  if (window.loadWithdrawalStatus) loadWithdrawalStatus();
}

function updateSidebar() {
  document.getElementById('sidebar-avatar').src = currentUser.avatar;
  document.getElementById('sidebar-username').textContent = currentUser.fullName;
  document.getElementById('sidebar-role').textContent = currentUser.role === 'believer' ? 'Believer' : currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1);
  if (typeof showAdminNav === 'function') showAdminNav();
}

async function refreshDashboard() {
  try {
    const stats = await api('/api/stats');
    currentUser = await api('/api/me');
    document.getElementById('greeting').textContent = `Shalom, ${currentUser.fullName.split(' ')[0]}`;
    document.getElementById('stat-coins').textContent = currentUser.coins;
    document.getElementById('stat-balance').textContent = `R ${currentUser.balance.toFixed(2)}`;
    document.getElementById('stat-offerings').textContent = `R ${currentUser.totalOfferings.toFixed(2)}`;
    document.getElementById('stat-referrals').textContent = currentUser.referralCount;
    document.getElementById('pool-total').textContent = `R ${stats.totalPool.toFixed(2)}`;
    document.getElementById('pool-distributable').textContent = `R ${stats.poolDistributable.toFixed(2)}`;
    const fillPct = Math.min((stats.totalPool / 100000) * 100, 100);
    document.getElementById('pool-fill').style.width = fillPct + '%';
    document.getElementById('wallet-balance').textContent = `R ${currentUser.balance.toFixed(2)}`;
    document.getElementById('wallet-deposited').textContent = `R ${currentUser.totalDeposited.toFixed(2)}`;
    document.getElementById('wallet-withdrawn').textContent = `R ${currentUser.totalWithdrawn.toFixed(2)}`;
    document.getElementById('coins-balance').textContent = currentUser.coins;
    document.getElementById('coins-total-value').textContent = `R ${(currentUser.coins * COIN_VALUE).toFixed(2)}`;
    document.getElementById('sh-balance').textContent = `R ${currentUser.balance.toFixed(2)}`;
  } catch (err) {
    console.error('Dashboard refresh error:', err);
  }
}

async function loadRecentTransactions() {
  try {
    const txs = await api('/api/transactions');
    const container = document.getElementById('recent-transactions');
    if (txs.length === 0) {
      container.innerHTML = '<p class="empty-state">No transactions yet. Begin your journey by depositing funds into the Store-house.</p>';
      return;
    }
    container.innerHTML = txs.slice(0, 10).map(tx => {
      const typeLabels = {
        deposit: { label: 'Deposit', icon: '&#9670;', cls: 'deposit' },
        withdrawal: { label: 'Withdrawal', icon: '&#9669;', cls: 'withdrawal' },
        buy_coins: { label: 'Purchased Coins', icon: '&#9672;', cls: 'buy_coins' },
        offering_sent: { label: 'Offering Sent', icon: '&#10084;', cls: 'offering_sent' },
        offering_received: { label: 'Offering Received', icon: '&#10084;', cls: 'offering_received' }
      };
      const info = typeLabels[tx.type] || { label: tx.type, icon: '&#8226;', cls: 'deposit' };
      const isPositive = ['deposit', 'offering_received'].includes(tx.type);
      const amount = tx.type === 'buy_coins'
        ? `${tx.amount} coins`
        : `${isPositive ? '+' : '-'}R ${(tx.value || tx.amount).toFixed(2)}`;
      const amountCls = tx.type === 'buy_coins' ? 'coin' : (isPositive ? 'positive' : 'negative');
      const date = new Date(tx.createdAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      return `<div class="tx-item">
        <div class="tx-icon ${info.cls}">${info.icon}</div>
        <div class="tx-info"><h4>${info.label}</h4><p>${date}${tx.recipientUsername ? ' to ' + tx.recipientUsername : ''}${tx.senderUsername ? ' from ' + tx.senderUsername : ''}</p></div>
        <div class="tx-amount ${amountCls}">${amount}</div>
      </div>`;
    }).join('');
  } catch (err) {
    console.error('Transactions error:', err);
  }
}

// ===== COIN PACKAGES =====
document.querySelectorAll('.coin-pkg').forEach(pkg => {
  pkg.addEventListener('click', () => {
    document.querySelectorAll('.coin-pkg').forEach(p => p.classList.remove('selected'));
    pkg.classList.add('selected');
    document.getElementById('custom-coin-amount').value = pkg.dataset.coins;
    updateCoinCost();
  });
});

document.getElementById('custom-coin-amount').addEventListener('input', updateCoinCost);

function updateCoinCost() {
  const coins = parseInt(document.getElementById('custom-coin-amount').value) || 0;
  document.getElementById('custom-coin-cost').value = `R ${(coins * COIN_VALUE).toFixed(2)}`;
}

// ===== BUY COINS =====
document.getElementById('buy-coins-btn').addEventListener('click', async () => {
  const coins = parseInt(document.getElementById('custom-coin-amount').value);
  if (!coins || coins <= 0) return showToast('Please select or enter a coin amount.', 'error');
  try {
    await api('/api/buy-coins', 'POST', { amount: coins });
    showToast(`${coins} Fisherman's Coins purchased! "Follow me, and I will make you fishers of men."`, 'success');
    await refreshDashboard();
    document.querySelectorAll('.coin-pkg').forEach(p => p.classList.remove('selected'));
    document.getElementById('custom-coin-amount').value = '';
    document.getElementById('custom-coin-cost').value = 'R 0.00';
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ===== OFFERING =====
document.getElementById('offering-coins').addEventListener('input', () => {
  const coins = parseInt(document.getElementById('offering-coins').value) || 0;
  document.getElementById('offering-value').textContent = (coins * COIN_VALUE).toFixed(2);
});

document.getElementById('send-offering-btn').addEventListener('click', async () => {
  const recipient = document.getElementById('offering-recipient').value.trim();
  const coins = parseInt(document.getElementById('offering-coins').value);
  const message = document.getElementById('offering-message').value;
  if (!recipient) return showToast('Please enter the recipient\'s username.', 'error');
  if (!coins || coins <= 0) return showToast('Please enter a valid coin amount.', 'error');
  try {
    await api('/api/send-offering', 'POST', { recipientUsername: recipient, coinAmount: coins, message });
    showToast(`Offering of ${coins} coins sent to ${recipient}! "Each of you should give what you have decided in your heart to give."`, 'success');
    document.getElementById('offering-recipient').value = '';
    document.getElementById('offering-coins').value = '';
    document.getElementById('offering-message').value = '';
    document.getElementById('offering-value').textContent = '0.00';
    await refreshDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ===== FAQ ACCORDION =====
document.querySelectorAll('.faq-question').forEach(q => {
  q.addEventListener('click', () => {
    const item = q.parentElement;
    const wasOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
    if (!wasOpen) item.classList.add('open');
  });
});

// ===== REFERRALS =====
async function loadReferrals() {
  try {
    const data = await api('/api/referrals');
    document.getElementById('ref-code-display').textContent = data.referralCode;
    document.getElementById('ref-count').textContent = data.referralCount;
    document.getElementById('ref-earnings').textContent = `R ${data.totalReferralEarnings.toFixed(2)}`;
    const list = document.getElementById('referral-list');
    if (data.referrals.length === 0) {
      list.innerHTML = '<p class="empty-state">No referrals yet. Share your code with fellow believers!</p>';
      return;
    }
    list.innerHTML = data.referrals.map(r => {
      const u = r.referredUser;
      if (!u) return '';
      const date = new Date(u.joinedAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
      return `<div class="ref-item">
        <img src="${u.avatar}" alt="${u.username}">
        <div class="ref-item-info"><h4>${u.fullName}</h4><p>@${u.username} &middot; Joined ${date}</p></div>
      </div>`;
    }).join('');
  } catch (err) {
    console.error('Referrals error:', err);
  }
}

document.getElementById('copy-ref-btn').addEventListener('click', () => {
  const code = document.getElementById('ref-code-display').textContent;
  navigator.clipboard.writeText(code).then(() => {
    showToast('Referral code copied! Share it with fellow believers.', 'success');
  }).catch(() => {
    showToast('Code: ' + code, 'info');
  });
});

// ===== LEADERBOARD =====
async function loadLeaderboard() {
  try {
    const leaders = await api('/api/leaderboard');
    const list = document.getElementById('leaderboard-list');
    if (leaders.length === 0) {
      list.innerHTML = '<p class="empty-state">No entries yet. Be the first to contribute!</p>';
      return;
    }
    list.innerHTML = leaders.map((l, i) => `<div class="lb-item">
      <div class="lb-rank">${i + 1}</div>
      <img src="${l.avatar}" alt="${l.username}">
      <div class="lb-info"><h4>${l.fullName}</h4><p>@${l.username} &middot; ${l.referralCount} referrals</p></div>
      <div class="lb-stats"><h4>${l.coins} coins</h4><p>R ${l.totalOfferings.toFixed(2)} given</p></div>
    </div>`).join('');
  } catch (err) {
    console.error('Leaderboard error:', err);
  }
}

// ===== WALLET & WITHDRAWAL (wallet.js handles events) =====
// Refresh dashboard periodically
setInterval(refreshDashboard, 30000);

// ===== POOL DISTRIBUTION COUNTDOWN =====
let poolCountdownInterval = null;
let poolNextDistTime = null;

async function loadDistributionStatus() {
  try {
    const status = await api('/api/distribution-status');
    const distBox = document.getElementById('pool-countdown-box');
    if (!distBox) return;
    if (status.canDistributeNow) {
      distBox.querySelector('.pool-countdown-timer').style.display = 'none';
      distBox.querySelector('.pool-countdown-label').textContent = 'Distribution Ready!';
      distBox.querySelector('.pool-countdown-label').style.color = 'var(--success)';
      const myShare = currentUser ? (status.distributableNow / Math.max(1, 1)) : 0;
      const eligibleCount = await getEligibleCount();
      const perUser = eligibleCount > 0 ? status.distributableNow / eligibleCount : 0;
      document.getElementById('pool-my-share').textContent = `R ${perUser.toFixed(2)}`;
    } else {
      distBox.querySelector('.pool-countdown-timer').style.display = 'flex';
      distBox.querySelector('.pool-countdown-label').textContent = 'Next Auto-Distribution In';
      distBox.querySelector('.pool-countdown-label').style.color = 'var(--gold-dark)';
      poolNextDistTime = Date.now() + status.remainingMs;
      const eligibleCount = await getEligibleCount();
      const perUser = eligibleCount > 0 ? status.distributableNow / eligibleCount : 0;
      document.getElementById('pool-my-share').textContent = `R ${perUser.toFixed(2)}`;
      startPoolCountdown();
    }
  } catch (err) {
    console.error('Distribution status error:', err);
  }
}

async function getEligibleCount() {
  try {
    const users = await api('/api/admin/users');
    return users.filter(u => u.isActive && u.role === 'believer').length;
  } catch {
    const stats = await api('/api/stats');
    return stats.totalUsers || 1;
  }
}

function startPoolCountdown() {
  if (poolCountdownInterval) clearInterval(poolCountdownInterval);
  function tick() {
    if (!poolNextDistTime) return;
    const remaining = Math.max(0, poolNextDistTime - Date.now());
    const d = Math.floor(remaining / (24 * 60 * 60 * 1000));
    const h = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const m = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
    const s = Math.floor((remaining % (60 * 1000)) / 1000);
    const daysEl = document.getElementById('pct-days');
    const hoursEl = document.getElementById('pct-hours');
    const minsEl = document.getElementById('pct-mins');
    const secsEl = document.getElementById('pct-secs');
    if (daysEl) daysEl.textContent = String(d).padStart(2, '0');
    if (hoursEl) hoursEl.textContent = String(h).padStart(2, '0');
    if (minsEl) minsEl.textContent = String(m).padStart(2, '0');
    if (secsEl) secsEl.textContent = String(s).padStart(2, '0');
    if (remaining <= 0) {
      clearInterval(poolCountdownInterval);
      loadDistributionStatus();
    }
  }
  tick();
  poolCountdownInterval = setInterval(tick, 1000);
}

// ===== SOCIAL SHARE =====
let _dynamicShareUrl = null;

async function fetchShareUrl() {
  try {
    const res = await fetch('/api/tunnel-url');
    const data = await res.json();
    _dynamicShareUrl = data.url;
  } catch (e) {
    _dynamicShareUrl = window.location.origin;
  }
}

function getShareUrl() {
  if (_dynamicShareUrl) return _dynamicShareUrl;
  return window.location.origin;
}

function getShareMessage(type) {
  const url = getShareUrl();
  const referralCode = currentUser ? currentUser.referralCode : '';
  const messages = {
    invite: `\u2720 *The LORD's Store-house* \u2720\n\nCome and join The LORD's Store-house! A faith-based platform where believers deposit funds, buy Fisherman's Coins, send offerings to fellow believers, and earn rewards.\n\n\uD83D\uDD35 *1 Fisherman's Coin = R50*\n\uD83D\uDCB0 Deposit via EFT\n\uD83D\uDCAC Temple Chat fellowship\n\uD83D\uDD04 Weekly pool distributions\n\nJoin using my referral code: *${referralCode}*\n\n${url}\n\n_"Store up for yourselves treasures in heaven."_ \u2014 Matthew 6:20`,
    simple: `Check out The LORD's Store-house! \u2720\n\nA faith-based platform where believers can:\n\uD83D\uDCB0 Deposit & withdraw funds\n\uD83E\uDE99 Buy Fisherman's Coins (R50 each)\n\uD83D\uDC9C Send offerings to fellow believers\n\uD83D\uDD04 Earn weekly rewards\n\nJoin here: ${url}\nUse my referral code: *${referralCode}*`,
    code: `My referral code for The LORD's Store-house is: *${referralCode}*\n\nDownload and join here: ${url}`
  };
  return messages[type] || messages.invite;
}

function buildWhatsAppUrl(message) {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

function buildFacebookUrl() {
  return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(getShareUrl())}`;
}

function buildTikTokUrl() {
  const msg = `The LORD's Store-house \u2720 — A faith-based platform where believers deposit funds, buy Fisherman's Coins, and earn rewards! Join here: ${getShareUrl()}`;
  return `https://www.tiktok.com/?lang=en`;
}

function updateSocialLinks() {
  const fullMsg = getShareMessage('invite');
  const simpleMsg = getShareMessage('simple');

  const waFloat = document.getElementById('share-whatsapp-float');
  if (waFloat) waFloat.href = buildWhatsAppUrl(fullMsg);

  const fbFloat = document.getElementById('share-facebook-float');
  if (fbFloat) fbFloat.href = buildFacebookUrl();

  const ttFloat = document.getElementById('share-tiktok-float');
  if (ttFloat) ttFloat.href = buildTikTokUrl();

  const refBtn = document.getElementById('whatsapp-share-btn');
  if (refBtn) refBtn.href = buildWhatsAppUrl(fullMsg);

  const msgBtn = document.getElementById('whatsapp-share-msg-btn');
  if (msgBtn) msgBtn.href = buildWhatsAppUrl(simpleMsg);

  const sidebarLink = document.getElementById('whatsapp-share-sidebar-link');
  if (sidebarLink) sidebarLink.href = buildWhatsAppUrl(fullMsg);
}

const origRefreshDashboard = refreshDashboard;
async function refreshDashboardWithWA() {
  await origRefreshDashboard();
  updateSocialLinks();
}

// Hook into login/register/init
const origInitDashboard = initDashboard;
async function initDashboardWithWA() {
  await origInitDashboard();
  updateSocialLinks();
}

// Re-assign on load
window.addEventListener('load', async () => {
  await fetchShareUrl();
  setTimeout(updateSocialLinks, 3000);
});
