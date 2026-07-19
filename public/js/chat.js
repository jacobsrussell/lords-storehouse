/* ========================================
   THE LORD'S STORE-HOUSE — Temple Chat (WebSocket)
   ======================================== */

let chatWs = null;
let chatConnected = false;
window.chatWs = null;
window.connectChat = connectChat;

function connectChat() {
  if (chatWs && (chatWs.readyState === WebSocket.OPEN || chatWs.readyState === WebSocket.CONNECTING)) {
    return;
  }
  if (!authToken) return;

  const wsHost = window.location.protocol === 'capacitor:' ? 'lords-storehouse.onrender.com' : window.location.host;
  const protocol = (window.location.protocol === 'https:' || window.location.protocol === 'capacitor:') ? 'wss:' : 'ws:';
  const url = `${protocol}//${wsHost}?token=${authToken}`;

  chatWs = new WebSocket(url);
  window.chatWs = chatWs;

  chatWs.onopen = () => {
    chatConnected = true;
    updateChatStatus(true);
    loadChatHistory();
  };

  chatWs.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'reload') {
        window.location.reload();
        return;
      }
      appendChatMessage(msg);
    } catch (e) {}
  };

  chatWs.onclose = () => {
    chatConnected = false;
    updateChatStatus(false);
    setTimeout(() => {
      if (authToken) connectChat();
    }, 5000);
  };

  chatWs.onerror = () => {
    chatConnected = false;
    updateChatStatus(false);
  };
}

function updateChatStatus(connected) {
  const dot = document.getElementById('chat-status-dot');
  const text = document.getElementById('chat-status-text');
  if (!dot || !text) return;
  if (connected) {
    dot.classList.add('connected');
    text.textContent = 'Connected to the Temple';
  } else {
    dot.classList.remove('connected');
    text.textContent = 'Reconnecting...';
  }
}

async function loadChatHistory() {
  try {
    const res = await fetch(getBaseUrl() + '/api/messages', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const messages = await res.json();
    const container = document.getElementById('chat-messages');
    const welcome = container.querySelector('.chat-welcome');
    container.innerHTML = '';
    if (welcome) container.appendChild(welcome.cloneNode(true));
    messages.forEach(msg => appendChatMessage(msg, false));
    scrollChatToBottom();
  } catch (e) {}
}

function appendChatMessage(msg, scroll = true) {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  if (msg.type === 'system') {
    const div = document.createElement('div');
    div.className = 'chat-system-msg';
    div.textContent = msg.text;
    container.appendChild(div);
  } else {
    const isOwn = currentUser && msg.userId === currentUser.id;
    const time = new Date(msg.timestamp).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });

    const div = document.createElement('div');
    div.className = `chat-msg ${isOwn ? 'own' : ''}`;
    div.innerHTML = `
      <img src="${msg.avatar || 'https://api.dicebear.com/7.x/bottts/svg?seed=default'}" alt="${msg.username}">
      <div class="chat-msg-body">
        <div class="chat-msg-meta">
          <span class="name">${msg.username}</span>
          <span class="time">${time}</span>
        </div>
        <div class="chat-msg-text">${escapeHtml(msg.text)}</div>
      </div>
    `;
    container.appendChild(div);
  }

  if (scroll) scrollChatToBottom();
}

function scrollChatToBottom() {
  const container = document.getElementById('chat-messages');
  setTimeout(() => { container.scrollTop = container.scrollHeight; }, 50);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ===== SEND MESSAGE =====
document.getElementById('chat-send-btn')?.addEventListener('click', sendChatMessage);

document.getElementById('chat-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
});

function sendChatMessage() {
  const input = document.getElementById('chat-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text || !chatWs || chatWs.readyState !== WebSocket.OPEN) return;
  chatWs.send(JSON.stringify({ type: 'chat', text }));
  input.value = '';
  input.focus();
}
