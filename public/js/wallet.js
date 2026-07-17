/* ========================================
   THE LORD'S STORE-HOUSE — Wallet Operations
   ======================================== */

let withdrawalTimerInterval = null;
let nextWithdrawalTime = null;

// ===== DEPOSIT =====
document.getElementById('deposit-btn')?.addEventListener('click', async () => {
  const amount = parseFloat(document.getElementById('deposit-amount').value);
  const reference = document.getElementById('deposit-ref').value;

  if (!amount || amount <= 0) {
    return showToast('Please enter a valid deposit amount.', 'error');
  }
  if (amount < 10) {
    return showToast('Minimum deposit amount is R10.00.', 'error');
  }

  try {
    await api('/api/deposit', 'POST', { amount, reference });
    showToast(
      `R ${amount.toFixed(2)} deposited! "Bring the whole tithe into the storehouse." — Malachi 3:10`,
      'success'
    );
    document.getElementById('deposit-amount').value = '';
    document.getElementById('deposit-ref').value = '';
    await refreshDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ===== WITHDRAWAL =====
document.getElementById('withdraw-btn')?.addEventListener('click', async () => {
  const amount = parseFloat(document.getElementById('withdraw-amount').value);
  const bankName = document.getElementById('withdraw-bank').value;
  const accountNumber = document.getElementById('withdraw-account').value;
  const branchCode = document.getElementById('withdraw-branch').value;
  const accountName = document.getElementById('withdraw-name').value;

  if (!amount || amount <= 0) {
    return showToast('Please enter a valid withdrawal amount.', 'error');
  }
  if (amount < 50) {
    return showToast('Minimum withdrawal is R50.00.', 'error');
  }
  if (amount > 50000) {
    return showToast('Maximum single withdrawal is R50,000.00.', 'error');
  }
  if (!bankName) return showToast('Please select your bank.', 'error');
  if (!accountNumber) return showToast('Please enter your account number.', 'error');
  if (!branchCode) return showToast('Please enter your branch code.', 'error');
  if (!accountName) return showToast('Please enter the account holder name.', 'error');

  const fee = Math.round(amount * 0.05 * 100) / 100;
  const netAmount = Math.round((amount - fee) * 100) / 100;
  const confirmed = confirm(
    `\u2720 The LORD's Store-house \u2720\n\n` +
    `Withdrawal Summary:\n` +
    `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n` +
    `Amount:       R ${amount.toFixed(2)}\n` +
    `Fee (5%):    - R ${fee.toFixed(2)}\n` +
    `You receive:  R ${netAmount.toFixed(2)}\n` +
    `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n` +
    `Bank:    ${bankName}\n` +
    `Account: ${accountNumber}\n` +
    `Branch:  ${branchCode}\n` +
    `Name:    ${accountName}\n\n` +
    `Next withdrawal available in 7 days.\n\n` +
    `Confirm this withdrawal?`
  );

  if (!confirmed) return;

  try {
    const result = await api('/api/withdraw', 'POST', {
      amount,
      bankName,
      accountNumber,
      branchCode,
      accountName
    });
    showToast(
      `Withdrawal submitted! Net: R ${(result.netAmount || netAmount).toFixed(2)}. "The earth is the LORD's, and everything in it." — Psalm 24:1`,
      'success'
    );
    document.getElementById('withdraw-amount').value = '';
    document.getElementById('withdraw-bank').value = '';
    document.getElementById('withdraw-account').value = '';
    document.getElementById('withdraw-branch').value = '';
    document.getElementById('withdraw-name').value = '';
    updateLiveFee(0);
    await refreshDashboard();
    await loadWithdrawalStatus();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ===== LIVE FEE CALCULATOR =====
const withdrawAmountInput = document.getElementById('withdraw-amount');
if (withdrawAmountInput) {
  withdrawAmountInput.addEventListener('input', () => {
    const val = parseFloat(withdrawAmountInput.value) || 0;
    updateLiveFee(val);
  });
}

function updateLiveFee(val) {
  const fee = Math.round(val * 0.05 * 100) / 100;
  const net = Math.round((val - fee) * 100) / 100;
  const feeEl = document.getElementById('wlf-fee');
  const netEl = document.getElementById('wlf-net');
  const amountEl = document.getElementById('wlf-amount');
  if (amountEl) amountEl.textContent = `R ${val.toFixed(2)}`;
  if (feeEl) feeEl.textContent = `- R ${fee.toFixed(2)}`;
  if (netEl) netEl.textContent = `R ${net.toFixed(2)}`;
}

// ===== WITHDRAWAL STATUS & COUNTDOWN =====
async function loadWithdrawalStatus() {
  try {
    const status = await api('/api/withdrawal-status');
    updateFrequencyUI(status);
    updateWithdrawalHistory(status.withdrawals);
    updateWithdrawalStats(status);
    if (status.canWithdraw) {
      enableWithdrawButton(true, null);
    } else {
      enableWithdrawButton(false, status);
      startCountdown(status.remainingMs);
    }
  } catch (err) {
    console.error('Withdrawal status error:', err);
  }
}

function updateFrequencyUI(status) {
  const icon = document.getElementById('wf-icon');
  const title = document.getElementById('wf-title');
  const subtitle = document.getElementById('wf-subtitle');
  const badge = document.getElementById('wf-badge');
  const countdown = document.getElementById('wf-countdown');
  const timer = document.getElementById('wf-timer');
  const countdownLabel = document.getElementById('wf-countdown-label');

  if (status.canWithdraw) {
    icon.innerHTML = '&#10004;';
    icon.className = 'wf-icon wf-available';
    title.textContent = 'Withdrawal Available';
    subtitle.textContent = 'You are eligible to make a withdrawal now. The Store-house is ready to bless you.';
    badge.textContent = 'Available';
    badge.className = 'wf-badge wf-badge-available';
    countdown.style.display = 'none';
  } else {
    icon.innerHTML = '&#9200;';
    icon.className = 'wf-icon wf-waiting';
    title.textContent = 'Withdrawal Cooldown Active';
    subtitle.textContent = `Last withdrawal was on ${new Date(status.lastWithdrawalAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}. You may withdraw once every 7 days.`;
    badge.textContent = 'Cooldown';
    badge.className = 'wf-badge wf-badge-waiting';
    countdown.style.display = 'block';
  }
}

function startCountdown(remainingMs) {
  if (withdrawalTimerInterval) clearInterval(withdrawalTimerInterval);
  let remaining = remainingMs;
  nextWithdrawalTime = Date.now() + remaining;

  function tick() {
    remaining = Math.max(0, nextWithdrawalTime - Date.now());
    const d = Math.floor(remaining / (24 * 60 * 60 * 1000));
    const h = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const m = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
    const s = Math.floor((remaining % (60 * 1000)) / 1000);

    const daysEl = document.getElementById('wf-days');
    const hoursEl = document.getElementById('wf-hours');
    const minsEl = document.getElementById('wf-mins');
    const secsEl = document.getElementById('wf-secs');

    if (daysEl) daysEl.textContent = String(d).padStart(2, '0');
    if (hoursEl) hoursEl.textContent = String(h).padStart(2, '0');
    if (minsEl) minsEl.textContent = String(m).padStart(2, '0');
    if (secsEl) secsEl.textContent = String(s).padStart(2, '0');

    if (remaining <= 0) {
      clearInterval(withdrawalTimerInterval);
      withdrawalTimerInterval = null;
      loadWithdrawalStatus();
    }
  }

  tick();
  withdrawalTimerInterval = setInterval(tick, 1000);
}

function enableWithdrawButton(canWithdraw, status) {
  const btn = document.getElementById('withdraw-btn');
  const note = document.getElementById('withdrawal-btn-note');
  if (!btn) return;

  if (canWithdraw) {
    btn.disabled = false;
    btn.textContent = 'Request Withdrawal';
    btn.className = 'btn btn-primary btn-lg';
    if (note) {
      note.textContent = '';
      note.className = 'withdrawal-btn-note';
    }
  } else {
    btn.disabled = true;
    btn.textContent = 'Withdrawal Unavailable';
    btn.className = 'btn btn-primary btn-lg btn-disabled';
    if (note && status) {
      note.textContent = `\u23F3 Next withdrawal available in ${status.remainingDays}d ${status.remainingHours}h ${status.remainingMinutes}m. One withdrawal per 7 days as per Store-house policy.`;
      note.className = 'withdrawal-btn-note warning';
    }
  }
}

function updateWithdrawalHistory(withdrawals) {
  const container = document.getElementById('withdrawal-history');
  if (!container) return;

  if (!withdrawals || withdrawals.length === 0) {
    container.innerHTML = '<p class="empty-state">No withdrawals yet. Your first withdrawal awaits when you are ready.</p>';
    return;
  }

  const statusColors = {
    pending: { bg: '#fff8e1', color: '#b8912e', label: 'Pending' },
    completed: { bg: '#e8f5e9', color: '#2d7a3a', label: 'Completed' },
    failed: { bg: '#fce4ec', color: '#a83232', label: 'Failed' }
  };

  container.innerHTML = withdrawals.map(w => {
    const sc = statusColors[w.status] || statusColors.pending;
    const date = new Date(w.createdAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const bankInfo = w.bankDetails ? `${w.bankDetails.bankName} \u2022 ...${w.bankDetails.accountNumber ? w.bankDetails.accountNumber.slice(-4) : '****'}` : '';
    const processed = w.processedAt ? `Processed ${new Date(w.processedAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}` : '';
    const est = w.estimatedCompletion ? `Est. ${new Date(w.estimatedCompletion).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : '';

    return `<div class="wh-item">
      <div class="wh-timeline">
        <div class="wh-dot" style="background:${sc.color}"></div>
        <div class="wh-line"></div>
      </div>
      <div class="wh-content">
        <div class="wh-header">
          <div>
            <h4>R ${w.amount.toFixed(2)} Withdrawal</h4>
            <p class="wh-date">${date}</p>
          </div>
          <span class="wh-status" style="background:${sc.bg};color:${sc.color}">${sc.label}</span>
        </div>
        <div class="wh-details">
          ${bankInfo ? `<span class="wh-detail">&#127974; ${bankInfo}</span>` : ''}
          <span class="wh-detail">&#8371; Fee: R ${(w.fee || 0).toFixed(2)} &rarr; Net: R ${(w.netAmount || w.amount).toFixed(2)}</span>
          ${w.status === 'pending' && est ? `<span class="wh-detail">&#9889; ${est}</span>` : ''}
          ${w.status === 'completed' && processed ? `<span class="wh-detail">&#10004; ${processed}</span>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

function updateWithdrawalStats(status) {
  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('ws-total', `R ${(status.totalWithdrawn || 0).toFixed(2)}`);
  setEl('ws-fees', `R ${(status.totalFees || 0).toFixed(2)}`);
  setEl('ws-completed', String(status.completedCount || 0));
  setEl('ws-pending', String(status.pendingCount || 0));
}

// ===== DEPOSIT COIN HELPER =====
const depositInput = document.getElementById('deposit-amount');
if (depositInput) {
  depositInput.addEventListener('input', () => {
    const val = parseFloat(depositInput.value) || 0;
    const coins = Math.floor(val / COIN_VALUE);
    if (coins > 0) {
      depositInput.title = `This will give you approximately ${coins} Fisherman's Coins`;
    } else {
      depositInput.title = '';
    }
  });
}

// Auto-load withdrawal status when storehouse section is shown
const storehouseObserver = new MutationObserver(() => {
  const section = document.getElementById('section-storehouse');
  if (section && section.classList.contains('active')) {
    loadWithdrawalStatus();
  }
});
const storehouseSection = document.getElementById('section-storehouse');
if (storehouseSection) {
  storehouseObserver.observe(storehouseSection, { attributes: true, attributeFilter: ['class'] });
}
