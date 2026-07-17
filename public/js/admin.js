/* ========================================
   THE LORD'S STORE-HOUSE — Admin Panel
   ======================================== */

let allAdminUsers = [];
let allAdminWithdrawals = [];
let currentWithdrawalFilter = 'pending';

function isAdmin() {
  return currentUser && currentUser.role === 'admin';
}

function showAdminNav() {
  const navItem = document.getElementById('admin-nav-item');
  if (navItem) {
    if (isAdmin()) {
      navItem.classList.remove('hidden');
    } else {
      navItem.classList.add('hidden');
    }
  }
}

// Admin tabs
document.querySelectorAll('.admin-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const panel = document.getElementById(tab.dataset.adminTab);
    if (panel) panel.classList.add('active');
    loadAdminSection(tab.dataset.adminTab);
  });
});

// Admin filter buttons
document.querySelectorAll('.admin-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.admin-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentWithdrawalFilter = btn.dataset.filter;
    loadAdminWithdrawals();
  });
});

function loadAdminSection(section) {
  if (!isAdmin()) return;
  switch (section) {
    case 'admin-dashboard': loadAdminStats(); break;
    case 'admin-users': loadAdminUsers(); break;
    case 'admin-withdrawals': loadAdminWithdrawals(); break;
    case 'admin-transactions': loadAdminTransactions(); break;
    case 'admin-pool': loadAdminPool(); break;
  }
}

async function loadAdminStats() {
  try {
    const stats = await api('/api/admin/stats');
    document.getElementById('admin-total-users').textContent = stats.totalUsers;
    document.getElementById('admin-active-users').textContent = stats.activeUsers;
    document.getElementById('admin-total-pool').textContent = `R ${stats.totalPool.toFixed(2)}`;
    document.getElementById('admin-pool-distributable').textContent = `R ${stats.poolDistributable.toFixed(2)}`;
    document.getElementById('admin-total-deposits').textContent = `R ${stats.totalDeposits.toFixed(2)}`;
    document.getElementById('admin-total-withdrawn').textContent = `R ${stats.totalWithdrawn.toFixed(2)}`;
    document.getElementById('admin-total-offerings').textContent = `R ${stats.totalOfferings.toFixed(2)}`;
    document.getElementById('admin-pending-withdrawals').textContent = stats.pendingWithdrawals;
  } catch (err) {
    console.error('Admin stats error:', err);
  }
}

async function loadAdminUsers() {
  try {
    allAdminUsers = await api('/api/admin/users');
    renderAdminUsers(allAdminUsers);
  } catch (err) {
    console.error('Admin users error:', err);
  }
}

function renderAdminUsers(users) {
  const container = document.getElementById('admin-users-list');
  if (users.length === 0) {
    container.innerHTML = '<p class="empty-state">No users found.</p>';
    return;
  }
  container.innerHTML = `<table class="admin-table">
    <thead>
      <tr>
        <th>User</th>
        <th>Email</th>
        <th>Role</th>
        <th>Status</th>
        <th>Balance</th>
        <th>Coins</th>
        <th>Deposited</th>
        <th>Referrals</th>
        <th>Joined</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      ${users.map(u => {
        const date = new Date(u.joinedAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
        return `<tr>
          <td><div class="user-cell"><img src="${u.avatar}" alt="${u.username}"><div><strong>${u.fullName}</strong><br><small>@${u.username}</small></div></div></td>
          <td>${u.email}</td>
          <td><span class="admin-badge ${u.role === 'admin' ? 'badge-admin' : 'badge-believer'}">${u.role}</span></td>
          <td><span class="admin-badge ${u.isActive ? 'badge-active' : 'badge-inactive'}">${u.isActive ? 'Active' : 'Inactive'}</span></td>
          <td>R ${u.balance.toFixed(2)}</td>
          <td>${u.coins}</td>
          <td>R ${u.totalDeposited.toFixed(2)}</td>
          <td>${u.referralCount}</td>
          <td>${date}</td>
          <td>
            ${u.role !== 'admin' ? `
              <button class="admin-action-btn ${u.isActive ? 'btn-deactivate' : 'btn-activate'}" onclick="toggleUserActive('${u.id}', ${!u.isActive})">
                ${u.isActive ? 'Deactivate' : 'Activate'}
              </button>
            ` : '<small>Admin</small>'}
          </td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

async function toggleUserActive(userId, isActive) {
  try {
    await api(`/api/admin/users/${userId}`, 'PUT', { isActive });
    showToast(`User ${isActive ? 'activated' : 'deactivated'} successfully.`, 'success');
    loadAdminUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// User search
document.getElementById('admin-user-search')?.addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  const filtered = allAdminUsers.filter(u =>
    u.fullName.toLowerCase().includes(q) ||
    u.username.toLowerCase().includes(q) ||
    u.email.toLowerCase().includes(q)
  );
  renderAdminUsers(filtered);
});

async function loadAdminWithdrawals() {
  try {
    const statusParam = currentWithdrawalFilter ? `?status=${currentWithdrawalFilter}` : '';
    allAdminWithdrawals = await api(`/api/admin/withdrawals${statusParam}`);
    renderAdminWithdrawals(allAdminWithdrawals);
  } catch (err) {
    console.error('Admin withdrawals error:', err);
  }
}

function renderAdminWithdrawals(withdrawals) {
  const container = document.getElementById('admin-withdrawals-list');
  if (withdrawals.length === 0) {
    container.innerHTML = '<p class="empty-state">No withdrawals found.</p>';
    return;
  }
  container.innerHTML = `<table class="admin-table">
    <thead>
      <tr>
        <th>User</th>
        <th>Amount</th>
        <th>Fee</th>
        <th>Net</th>
        <th>Bank</th>
        <th>Account</th>
        <th>Status</th>
        <th>Date</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      ${withdrawals.map(w => {
        const date = new Date(w.createdAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const bank = w.bankDetails || {};
        return `<tr>
          <td><div class="user-cell"><div><strong>${w.user?.fullName || 'Unknown'}</strong><br><small>@${w.user?.username || 'N/A'}</small></div></div></td>
          <td><strong>R ${w.amount.toFixed(2)}</strong></td>
          <td>R ${(w.fee || 0).toFixed(2)}</td>
          <td>R ${(w.netAmount || 0).toFixed(2)}</td>
          <td>${bank.bankName || '-'}</td>
          <td>${bank.accountNumber || '-'}</td>
          <td><span class="admin-badge badge-${w.status}">${w.status}</span></td>
          <td>${date}</td>
          <td>
            ${w.status === 'pending' ? `
              <button class="admin-action-btn btn-approve" onclick="approveWithdrawal('${w.id}')">Approve</button>
              <button class="admin-action-btn btn-reject" onclick="rejectWithdrawal('${w.id}')">Reject</button>
            ` : w.status === 'completed' ? `<small>Processed</small>` : `<small>Rejected</small>`}
          </td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

async function approveWithdrawal(id) {
  try {
    await api(`/api/admin/withdrawals/${id}/approve`, 'PUT');
    showToast('Withdrawal approved and completed.', 'success');
    loadAdminWithdrawals();
    loadAdminStats();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function rejectWithdrawal(id) {
  const reason = prompt('Reason for rejection (optional):');
  try {
    await api(`/api/admin/withdrawals/${id}/reject`, 'PUT', { reason: reason || 'Rejected by administrator' });
    showToast('Withdrawal rejected. Funds returned to user.', 'info');
    loadAdminWithdrawals();
    loadAdminStats();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadAdminTransactions() {
  try {
    const txs = await api('/api/admin/transactions?limit=200');
    const container = document.getElementById('admin-transactions-list');
    if (txs.length === 0) {
      container.innerHTML = '<p class="empty-state">No transactions yet.</p>';
      return;
    }
    const typeLabels = {
      deposit: { label: 'Deposit', cls: 'badge-active' },
      withdrawal: { label: 'Withdrawal', cls: 'badge-pending' },
      buy_coins: { label: 'Buy Coins', cls: 'badge-completed' },
      offering_sent: { label: 'Offering Sent', cls: 'badge-admin' },
      offering_received: { label: 'Offering Received', cls: 'badge-active' },
      pool_distribution: { label: 'Pool Distribution', cls: 'badge-completed' }
    };
    container.innerHTML = `<table class="admin-table">
      <thead>
        <tr>
          <th>User</th>
          <th>Type</th>
          <th>Amount</th>
          <th>Status</th>
          <th>Date</th>
        </tr>
      </thead>
      <tbody>
        ${txs.map(tx => {
          const info = typeLabels[tx.type] || { label: tx.type, cls: 'badge-believer' };
          const date = new Date(tx.createdAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
          const amount = tx.type === 'buy_coins' ? `${tx.amount} coins` : `R ${(tx.value || tx.amount || 0).toFixed(2)}`;
          return `<tr>
            <td><strong>${tx.fullName}</strong> <small>@${tx.username}</small></td>
            <td><span class="admin-badge ${info.cls}">${info.label}</span></td>
            <td>${amount}</td>
            <td><span class="admin-badge badge-${tx.status}">${tx.status}</span></td>
            <td>${date}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  } catch (err) {
    console.error('Admin transactions error:', err);
  }
}

async function loadAdminPool() {
  try {
    const stats = await api('/api/admin/stats');
    document.getElementById('admin-pool-total').textContent = `R ${stats.totalPool.toFixed(2)}`;
    document.getElementById('admin-pool-dist').textContent = `R ${stats.poolDistributable.toFixed(2)}`;
    document.getElementById('admin-pool-distributed').textContent = `R ${stats.poolDistributed.toFixed(2)}`;
    const available = stats.poolDistributable - stats.poolDistributed;
    document.getElementById('admin-pool-available').textContent = `R ${Math.max(0, available).toFixed(2)}`;
    document.getElementById('pool-dist-result').classList.add('hidden');

    try {
      const distStatus = await api('/api/distribution-status');
      const nextDistEl = document.getElementById('admin-pool-next-dist');
      const lastDistEl = document.getElementById('admin-pool-last-dist');
      if (distStatus.canDistributeNow) {
        nextDistEl.textContent = 'Ready now!';
        nextDistEl.style.color = 'var(--success)';
      } else {
        nextDistEl.textContent = `In ${distStatus.remainingDays}d ${distStatus.remainingHours}h ${distStatus.remainingMinutes}m`;
        nextDistEl.style.color = '';
      }
      if (distStatus.lastDistributionAt) {
        lastDistEl.textContent = new Date(distStatus.lastDistributionAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      } else {
        lastDistEl.textContent = 'Never';
      }

      const histContainer = document.getElementById('admin-dist-history');
      if (distStatus.history.length === 0) {
        histContainer.innerHTML = '<p class="empty-state">No distributions yet. The first distribution will happen automatically after 7 days, or you can force one now.</p>';
      } else {
        histContainer.innerHTML = `<table class="admin-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Pool Total</th>
              <th>Distributed</th>
              <th>Per User</th>
              <th>Recipients</th>
            </tr>
          </thead>
          <tbody>
            ${distStatus.history.map(h => {
              const date = new Date(h.timestamp).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
              return `<tr>
                <td>${date}</td>
                <td>R ${h.totalPool.toFixed(2)}</td>
                <td><strong>R ${h.distributed.toFixed(2)}</strong></td>
                <td>R ${h.perUser.toFixed(2)}</td>
                <td>${h.recipients}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>`;
      }
    } catch (e) {
      console.error('Distribution status error:', e);
    }
  } catch (err) {
    console.error('Admin pool error:', err);
  }
}

document.getElementById('admin-distribute-btn')?.addEventListener('click', async () => {
  if (!confirm('Distribute the available pool equally among all active users?')) return;
  try {
    const result = await api('/api/admin/pool', 'PUT', { action: 'distribute' });
    const resultEl = document.getElementById('pool-dist-result');
    resultEl.textContent = `Successfully distributed R ${result.totalDistributed.toFixed(2)} to ${result.recipients} users (R ${result.distributed.toFixed(2)} each).`;
    resultEl.classList.remove('hidden');
    loadAdminPool();
    showToast('Pool distributed successfully!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// Hook into navigation
const origNavigateTo = window.navigateTo || navigateTo;
function navigateToWithAdmin(section) {
  origNavigateTo(section);
  if (section === 'admin' && isAdmin()) {
    loadAdminStats();
  }
}
