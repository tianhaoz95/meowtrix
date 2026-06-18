// ── Chat pet ─────────────────────────────────────────────────────────────────
// A cute cat that wanders around the app. Click it to chat; replies come from
// Chrome's on-device LLM (Gemini Nano via the Prompt API — the global
// `LanguageModel`). Everything here is purely cosmetic + local: no network, no
// PTY input. Toggled from Settings (`petEnabled`); the toggle is disabled there
// when the on-device model isn't available (see settings.js / petModelAvailability).

(function () {
  const FACE = '🐱';
  const SYSTEM_PROMPT =
    "You are Mochi, a tiny, cheerful cat companion living inside a developer's " +
    "terminal workspace called Meowtrix. Keep replies short, warm, and playful " +
    "(1-3 sentences). You can be a little silly and use the occasional 'meow' or " +
    "cat pun, but stay genuinely helpful when asked a real question.";

  let enabled = false;
  let booted = false;
  let pet, chat, log, input, sendBtn;
  let wanderTimer = null;
  let session = null;        // lazily created LanguageModel session
  let creating = null;       // in-flight session creation promise
  let busy = false;          // a prompt is currently being answered

  // ── On-device model availability ───────────────────────────────────────────
  // Returns one of: 'unavailable' | 'downloadable' | 'downloading' | 'available'.
  // 'unavailable' also covers browsers without the Prompt API at all.
  async function modelAvailability() {
    if (!('LanguageModel' in self)) return 'unavailable';
    try {
      return await LanguageModel.availability();
    } catch {
      return 'unavailable';
    }
  }
  window.petModelAvailability = modelAvailability;

  // ── DOM ────────────────────────────────────────────────────────────────────
  function build() {
    if (booted) return;
    booted = true;

    pet = document.createElement('div');
    pet.id = 'pet';
    pet.setAttribute('role', 'button');
    pet.setAttribute('aria-label', 'Chat with Mochi the pet');
    pet.innerHTML = `<span class="pet-face">${FACE}</span>`;
    pet.addEventListener('click', toggleChat);

    chat = document.createElement('div');
    chat.id = 'pet-chat';
    chat.hidden = true;
    chat.innerHTML = `
      <div id="pet-chat-head">
        <span class="pet-face-sm">${FACE}</span>
        <span id="pet-chat-name">Mochi</span>
        <button id="pet-chat-close" aria-label="Close chat">✕</button>
      </div>
      <div id="pet-chat-log"></div>
      <form id="pet-chat-form" autocomplete="off">
        <input id="pet-chat-input" type="text" placeholder="Say something to Mochi…" maxlength="500">
        <button id="pet-chat-send" type="submit" aria-label="Send">➤</button>
      </form>`;

    document.body.append(pet, chat);

    log = chat.querySelector('#pet-chat-log');
    input = chat.querySelector('#pet-chat-input');
    sendBtn = chat.querySelector('#pet-chat-send');
    chat.querySelector('#pet-chat-close').addEventListener('click', closeChat);
    chat.querySelector('#pet-chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      send();
    });

    // Place the pet somewhere sensible to start.
    const x = Math.max(20, window.innerWidth * 0.5);
    const y = Math.max(80, window.innerHeight - 140);
    pet.style.transform = `translate(${x}px, ${y}px)`;
  }

  // ── Wandering ──────────────────────────────────────────────────────────────
  function petSize() { return pet.offsetWidth || 56; }

  function step() {
    if (!enabled || chat.hidden === false) return; // sit still while chatting
    const size = petSize();
    const maxX = Math.max(0, window.innerWidth - size - 12);
    const maxY = Math.max(60, window.innerHeight - size - 12);
    const minY = 56; // keep clear of the toolbar
    const targetX = Math.random() * maxX;
    const targetY = minY + Math.random() * (maxY - minY);

    // Face the direction of travel.
    const cur = currentPos();
    const flip = targetX < cur.x ? -1 : 1;
    pet.style.setProperty('--pet-flip', flip);
    pet.classList.add('pet-walking');
    pet.style.transform = `translate(${targetX}px, ${targetY}px)`;
  }

  function currentPos() {
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(pet.style.transform || '');
    return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: 0, y: 0 };
  }

  function startWandering() {
    stopWandering();
    wanderTimer = setInterval(step, 3200);
    setTimeout(step, 400);
  }
  function stopWandering() {
    if (wanderTimer) { clearInterval(wanderTimer); wanderTimer = null; }
    if (pet) pet.classList.remove('pet-walking');
  }

  // ── Chat ───────────────────────────────────────────────────────────────────
  function toggleChat() {
    if (chat.hidden) openChat(); else closeChat();
  }

  function openChat() {
    if (chat.hidden === false) return;
    chat.hidden = false;
    stopWandering();
    pet.classList.add('pet-active');
    // Anchor the chat panel near the pet.
    positionChat();
    if (!log.childElementCount) {
      addMsg('pet', 'Meow! I’m Mochi 🐱 Ask me anything.');
    }
    setTimeout(() => input.focus(), 50);
  }

  function closeChat() {
    chat.hidden = true;
    pet.classList.remove('pet-active');
    if (enabled) startWandering();
  }

  function positionChat() {
    const size = petSize();
    const cur = currentPos();
    const w = 280, h = 360;
    let left = cur.x + size + 10;
    if (left + w > window.innerWidth - 10) left = cur.x - w - 10;
    if (left < 10) left = 10;
    let top = cur.y - h + size;
    if (top < 56) top = 56;
    if (top + h > window.innerHeight - 10) top = window.innerHeight - h - 10;
    chat.style.left = left + 'px';
    chat.style.top = top + 'px';
  }

  function addMsg(who, text) {
    const el = document.createElement('div');
    el.className = 'pet-msg pet-msg-' + who;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  async function getSession() {
    if (session) return session;
    if (creating) return creating;
    creating = LanguageModel.create({
      initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
      // Declare languages so the model attests output quality/safety (the API
      // warns otherwise). Supported codes: de, en, es, fr, ja.
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          if (typingEl) typingEl.textContent = `downloading model… ${Math.round(e.loaded * 100)}%`;
        });
      },
    }).then((s) => { session = s; creating = null; return s; });
    return creating;
  }

  let typingEl = null;

  async function send() {
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = '';
    addMsg('me', text);
    busy = true;
    sendBtn.disabled = true;

    typingEl = addMsg('pet', '…');
    typingEl.classList.add('pet-typing');
    try {
      const s = await getSession();
      typingEl.classList.remove('pet-typing');
      typingEl.textContent = '';
      // Stream tokens in for a lively feel; fall back to a single shot.
      if (typeof s.promptStreaming === 'function') {
        const stream = s.promptStreaming(text);
        for await (const chunk of stream) {
          typingEl.textContent += chunk;
          log.scrollTop = log.scrollHeight;
        }
      } else {
        typingEl.textContent = await s.prompt(text);
      }
      if (!typingEl.textContent) typingEl.textContent = '*purrs quietly*';
    } catch (err) {
      typingEl.classList.remove('pet-typing');
      typingEl.textContent = 'Mrrp… I couldn’t think of a reply. ' +
        '(on-device model error: ' + (err && err.message ? err.message : err) + ')';
    } finally {
      typingEl = null;
      busy = false;
      sendBtn.disabled = false;
      log.scrollTop = log.scrollHeight;
      input.focus();
    }
  }

  // ── Enable / disable ─────────────────────────────────────────────────────────
  function setPetEnabled(on) {
    enabled = !!on;
    if (enabled) {
      build();
      pet.hidden = false;
      startWandering();
    } else {
      stopWandering();
      if (pet) pet.hidden = true;
      if (chat) chat.hidden = true;
      // Drop the model session so it isn't held while disabled.
      if (session && typeof session.destroy === 'function') session.destroy();
      session = null;
    }
  }
  window.setPetEnabled = setPetEnabled;

  // Reposition things on resize so nothing gets stranded off-screen.
  window.addEventListener('resize', () => {
    if (!booted) return;
    if (chat.hidden === false) positionChat();
    else if (enabled) step();
  });

  // ── Boot from settings ───────────────────────────────────────────────────────
  // settings.js fetches settings on this same event; default off until loaded.
  document.addEventListener('DOMContentLoaded', () => {
    const sync = () => {
      const s = (typeof getSettings === 'function') ? getSettings() : null;
      if (s && 'petEnabled' in s) setPetEnabled(s.petEnabled);
    };
    setTimeout(sync, 0);
    setTimeout(sync, 400);
  });
})();
