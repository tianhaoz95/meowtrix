// ── Chat pet ─────────────────────────────────────────────────────────────────
// A cute cat that wanders around the app. Click it to chat; replies come from
// Chrome's on-device LLM (Gemini Nano via the Prompt API — the global
// `LanguageModel`). Everything here is purely cosmetic + local: no network, no
// PTY input. Toggled from Settings (`petEnabled`); the toggle is disabled there
// when the on-device model isn't available (see settings.js / petModelAvailability).

(function () {
  // Selectable looks. `id` is what's persisted in settings (`petFace`).
  const PET_FACES = [
    { id: 'cat',     emoji: '🐱', label: 'Cat' },
    { id: 'dog',     emoji: '🐶', label: 'Dog' },
    { id: 'fox',     emoji: '🦊', label: 'Fox' },
    { id: 'bunny',   emoji: '🐰', label: 'Bunny' },
    { id: 'panda',   emoji: '🐼', label: 'Panda' },
    { id: 'penguin', emoji: '🐧', label: 'Penguin' },
    { id: 'frog',    emoji: '🐸', label: 'Frog' },
    { id: 'chick',   emoji: '🐥', label: 'Chick' },
    { id: 'ghost',   emoji: '👻', label: 'Ghost' },
    { id: 'robot',   emoji: '🤖', label: 'Robot' },
    { id: 'dragon',  emoji: '🐲', label: 'Dragon' },
    { id: 'unicorn', emoji: '🦄', label: 'Unicorn' },
  ];
  window.PET_FACES = PET_FACES;
  const DEFAULT_FACE = 'cat';

  function faceEmoji(id) {
    const f = PET_FACES.find((x) => x.id === id);
    return (f || PET_FACES[0]).emoji;
  }

  let faceId = DEFAULT_FACE;
  const SYSTEM_PROMPT =
    "You are Mochi, a tiny, cheerful animal companion living inside a developer's " +
    "terminal workspace called Meowtrix. Keep replies short, warm, and playful " +
    "(1-3 sentences). You can be a little silly, but stay genuinely helpful when " +
    "asked a real question.";

  let enabled = false;
  let booted = false;
  let pet, chat, log, input, sendBtn;
  let wanderTimer = null;
  let speed = 3;             // 1 (lazy) … 10 (zoomies); see setPetSpeed

  // Movement speed → travel time per hop and pause between hops. Low speeds are
  // deliberately very slow (speed 1 ≈ an 18s amble with a long rest between).
  function durationMs() { return Math.round(18000 / speed); }
  function intervalMs() { return durationMs() + Math.round(2500 / speed) + 400; }
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
    pet.innerHTML = `<span class="pet-face">${faceEmoji(faceId)}</span>`;
    pet.addEventListener('click', toggleChat);

    chat = document.createElement('div');
    chat.id = 'pet-chat';
    chat.hidden = true;
    chat.innerHTML = `
      <div id="pet-chat-head">
        <span class="pet-face-sm">${faceEmoji(faceId)}</span>
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

    pet.style.transitionDuration = durationMs() + 'ms';

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
    wanderTimer = setInterval(step, intervalMs());
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
      addMsg('pet', `Hi! I’m Mochi ${faceEmoji(faceId)} Ask me anything.`);
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

  // ── Minimal, safe markdown → HTML (for pet replies) ──────────────────────────
  // Everything is HTML-escaped first, so model output can never inject markup.
  // Supports: fenced + inline code, bold, italic, links, headings, lists.
  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function renderMarkdown(src) {
    const blocks = [];   // fenced code blocks (already escaped)
    const inline = [];   // inline code spans (already escaped)

    // Pull out fenced code, then inline code, leaving NUL-delimited placeholders.
    let text = src.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_m, code) => {
      blocks.push('<pre class="pet-code"><code>' + escapeHtml(code.replace(/\n$/, '')) + '</code></pre>');
      return ' B' + (blocks.length - 1) + ' ';
    });
    text = text.replace(/`([^`\n]+)`/g, (_m, code) => {
      inline.push('<code>' + escapeHtml(code) + '</code>');
      return ' I' + (inline.length - 1) + ' ';
    });

    text = escapeHtml(text); // placeholders use NUL, untouched by escaping

    const fmt = (s) => s
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t, url) => {
        const safe = /^https?:\/\//i.test(url) ? url : '#';
        return '<a href="' + safe + '" target="_blank" rel="noopener noreferrer">' + t + '</a>';
      })
      .replace(/ I(\d+) /g, (_m, i) => inline[Number(i)]);

    let html = '', list = null, para = [];
    const flushP = () => { if (para.length) { html += '<p>' + fmt(para.join(' ')) + '</p>'; para = []; } };
    const closeL = () => { if (list) { html += '</' + list + '>'; list = null; } };

    for (const line of text.split('\n')) {
      let m;
      if (/^\s*$/.test(line)) { flushP(); closeL(); }
      else if (/^ B\d+ $/.test(line.trim())) { flushP(); closeL(); html += line.trim(); }
      else if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
        flushP(); closeL();
        const lvl = m[1].length;
        html += '<h' + lvl + '>' + fmt(m[2]) + '</h' + lvl + '>';
      } else if ((m = /^\s*[-*+]\s+(.*)$/.exec(line))) {
        flushP(); if (list !== 'ul') { closeL(); html += '<ul>'; list = 'ul'; }
        html += '<li>' + fmt(m[1]) + '</li>';
      } else if ((m = /^\s*\d+\.\s+(.*)$/.exec(line))) {
        flushP(); if (list !== 'ol') { closeL(); html += '<ol>'; list = 'ol'; }
        html += '<li>' + fmt(m[1]) + '</li>';
      } else { para.push(line); }
    }
    flushP(); closeL();

    return html.replace(/ B(\d+) /g, (_m, i) => blocks[Number(i)]);
  }

  function setMsgMarkdown(el, raw) {
    el.innerHTML = renderMarkdown(raw);
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
      let reply = '';
      if (typeof s.promptStreaming === 'function') {
        const stream = s.promptStreaming(text);
        for await (const chunk of stream) {
          reply += chunk;
          setMsgMarkdown(typingEl, reply);
          log.scrollTop = log.scrollHeight;
        }
      } else {
        reply = await s.prompt(text);
        setMsgMarkdown(typingEl, reply);
      }
      if (!reply.trim()) typingEl.textContent = '*purrs quietly*';
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

  // Change the pet's look (id from PET_FACES). Updates the live DOM if built.
  function setPetFace(id) {
    if (!PET_FACES.some((f) => f.id === id)) id = DEFAULT_FACE;
    faceId = id;
    if (booted) {
      const big = pet.querySelector('.pet-face');
      const sm = chat.querySelector('.pet-face-sm');
      if (big) big.textContent = faceEmoji(faceId);
      if (sm) sm.textContent = faceEmoji(faceId);
    }
  }
  window.setPetFace = setPetFace;

  // Set wander speed (1 lazy … 10 zoomies). Applies live.
  function setPetSpeed(val) {
    speed = Math.min(10, Math.max(1, Number(val) || 3));
    if (booted) pet.style.transitionDuration = durationMs() + 'ms';
    if (wanderTimer) startWandering(); // restart with the new interval
  }
  window.setPetSpeed = setPetSpeed;

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
      if (s && s.petFace) setPetFace(s.petFace);
      if (s && s.petSpeed != null) setPetSpeed(s.petSpeed);
      if (s && 'petEnabled' in s) setPetEnabled(s.petEnabled);
    };
    setTimeout(sync, 0);
    setTimeout(sync, 400);
  });
})();
