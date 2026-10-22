(() => {
  'use strict';

  const START_BALANCE = 10000;
  const CHIPS = [100, 500, 1000, 5000];
  const CHIP_COLORS = { 100: '#1e88e5', 500: '#2e7d32', 1000: '#d32f2f', 5000: '#6a1b9a' };
  const GOURD = '<svg class="gourd" viewBox="0 0 64 64" aria-hidden="true"><use href="#gourd"/></svg>';
  const SYMBOLS = [
    { id: 'nai', name: 'Nai', icon: '🦌' },
    { id: 'bau', name: 'Bầu', icon: GOURD },
    { id: 'ga', name: 'Gà', icon: '🐓' },
    { id: 'ca', name: 'Cá', icon: '🐟' },
    { id: 'cua', name: 'Cua', icon: '🦀' },
    { id: 'tom', name: 'Tôm', icon: '🦐' },
  ];
  const BY_ID = Object.fromEntries(SYMBOLS.map(s => [s.id, s]));
  const DICE_SPOTS = [[50, 32], [32, 64], [68, 64]];
  const HISTORY_SIZE = 10;
  const STORAGE_KEY = 'baucua:v1';
  const CONFETTI_COLORS = ['#f6c453', '#ff5252', '#69f0ae', '#40c4ff', '#ffffff'];

  const $ = id => document.getElementById(id);
  const els = {
    balance: $('balance'),
    wallet: $('wallet'),
    board: $('board'),
    chips: $('chips'),
    dice: $('dice'),
    bowl: $('bowl'),
    plate: $('plateWrap'),
    message: $('message'),
    history: $('history'),
    totalBet: $('totalBet'),
    roll: $('rollBtn'),
    clear: $('clearBtn'),
    rebet: $('rebetBtn'),
    refill: $('refillBtn'),
    sound: $('soundBtn'),
    music: $('musicBtn'),
  };

  const fmt = n => n.toLocaleString('vi-VN');
  const short = n => (n >= 1000 ? `${n / 1000}K` : String(n));
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const jitter = n => (Math.random() * 2 - 1) * n;
  const emptyBets = () => Object.fromEntries(SYMBOLS.map(s => [s.id, 0]));
  const sum = bets => Object.values(bets).reduce((a, b) => a + b, 0);

  function rand6() {
    const buf = new Uint32Array(1);
    do crypto.getRandomValues(buf); while (buf[0] >= 4294967292);
    return buf[0] % 6;
  }

  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
      return {
        balance: Number.isInteger(d.balance) && d.balance >= 0 ? d.balance : undefined,
        history: Array.isArray(d.history)
          ? d.history.filter(r => Array.isArray(r) && r.length === 3 && r.every(id => Object.hasOwn(BY_ID, id))).slice(0, HISTORY_SIZE)
          : undefined,
        sound: typeof d.sound === 'boolean' ? d.sound : undefined,
        music: typeof d.music === 'boolean' ? d.music : undefined,
      };
    } catch {
      return {};
    }
  }

  const saved = load();
  const state = {
    balance: saved.balance ?? START_BALANCE,
    history: saved.history ?? [],
    sound: saved.sound ?? true,
    music: saved.music ?? true,
    chip: CHIPS[0],
    bets: emptyBets(),
    lastBets: null,
    resolved: false,
    rolling: false,
  };
  let shownBalance = state.balance;
  let balanceAnim = 0;

  let audioCtx;
  let noiseBuf;

  function audio() {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended' && !document.hidden) audioCtx.resume();
    return audioCtx;
  }

  function voice(dest, t, freq, dur, { type = 'sine', vol = 0.15, slide, attack = 0.005 } = {}) {
    const c = audio();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function hiss(dest, t, dur, vol, { type = 'bandpass', freq = 3000, q = 1 } = {}) {
    const c = audio();
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const src = c.createBufferSource();
    const filter = c.createBiquadFilter();
    const gain = c.createGain();
    src.buffer = noiseBuf;
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(dest);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  function glide(param, value, timeConstant, delay = 0) {
    const t = audio().currentTime;
    if (param.cancelAndHoldAtTime) {
      param.cancelAndHoldAtTime(t);
    } else {
      param.cancelScheduledValues(t);
      param.setValueAtTime(param.value, t);
    }
    param.setTargetAtTime(value, t + delay, timeConstant);
  }

  const sfx = (() => {
    const tone = (freq, dur, { delay = 0, ...opts } = {}) => {
      if (!state.sound) return;
      const c = audio();
      voice(c.destination, c.currentTime + delay, freq, dur, opts);
    };

    return {
      chip: () => tone(1200, 0.06, { type: 'triangle', vol: 0.12 }),
      reveal: () => tone(660, 0.25, { vol: 0.12 }),
      lose: () => tone(330, 0.5, { type: 'sawtooth', vol: 0.06, slide: 140 }),
      win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.28, { type: 'triangle', vol: 0.15, delay: i * 0.1 })),
      shake(ms) {
        if (!state.sound) return;
        const c = audio();
        for (let t = 0; t < ms / 1000; t += 0.05 + Math.random() * 0.04) {
          hiss(c.destination, c.currentTime + t, 0.03, 0.15 + Math.random() * 0.3, { freq: 1800 + Math.random() * 2500, q: 2 });
        }
      },
    };
  })();

  const music = (() => {
    const VOLUME = 0.35;
    const STEP = 60 / 126 / 2;
    const MELODY = [
      69, 0, 71, 69, 66, 0, 64, 0,
      62, 0, 64, 66, 69, 0, 0, 0,
      71, 0, 74, 71, 69, 0, 66, 69,
      64, 0, 66, 64, 62, 0, 0, 0,
      74, 0, 76, 74, 71, 0, 69, 0,
      71, 0, 74, 0, 69, 0, 0, 0,
      66, 69, 71, 69, 66, 0, 64, 62,
      64, 0, 0, 66, 62, 0, 0, 0,
      81, 0, 78, 76, 78, 0, 74, 0,
      76, 78, 76, 74, 71, 0, 0, 0,
      74, 0, 71, 69, 71, 74, 76, 0,
      78, 0, 76, 74, 76, 0, 0, 0,
      74, 76, 74, 71, 69, 0, 66, 0,
      69, 71, 69, 66, 64, 0, 0, 0,
      62, 64, 66, 69, 71, 0, 69, 66,
      64, 0, 66, 0, 62, 0, 0, 0,
    ];
    const BASS = [
      [50, 57], [50, 57], [47, 54], [45, 50],
      [50, 57], [47, 54], [45, 52], [45, 50],
      [50, 57], [52, 59], [47, 54], [45, 52],
      [50, 57], [45, 52], [47, 54], [45, 50],
    ];
    const DRUM = [0.4, 0, 0, 0.25, 0.3, 0, 0, 0];
    const BLOCK = [0, 0, 1, 0, 0, 0, 1, 1];
    const hz = note => 440 * 2 ** ((note - 69) / 12);
    let out;
    let timer = 0;
    let step = 0;
    let nextTime = 0;

    function play(i, t) {
      const bar = Math.floor(i / 8);
      const pos = i % 8;
      const note = MELODY[i];
      if (note) {
        voice(out, t, hz(note), 0.9, { type: 'triangle', vol: 0.22 });
        voice(out, t, hz(note + 12), 0.3, { vol: 0.05 });
      }
      if (pos % 4 === 0) voice(out, t, hz(BASS[bar][pos / 4]), STEP * 3.5, { vol: 0.3, attack: 0.02 });
      if (DRUM[pos]) voice(out, t, 140, 0.25, { vol: DRUM[pos], slide: 50 });
      if (BLOCK[pos]) voice(out, t, 1400, 0.05, { vol: 0.12 });
      if (pos === 4 && bar % 2) hiss(out, t, 0.4, 0.1, { type: 'highpass', freq: 6000 });
    }

    function tick() {
      const now = audio().currentTime;
      if (nextTime < now) nextTime = now + 0.05;
      while (nextTime < now + 0.15) {
        play(step, nextTime);
        step = (step + 1) % MELODY.length;
        nextTime += STEP;
      }
    }

    return {
      start() {
        if (timer) return;
        const c = audio();
        if (!out) {
          out = c.createGain();
          out.gain.value = 0;
          out.connect(c.destination);
        }
        glide(out.gain, VOLUME, 0.4);
        step = 0;
        nextTime = c.currentTime + 0.1;
        timer = setInterval(tick, 25);
        tick();
      },
      stop() {
        if (!timer) return;
        clearInterval(timer);
        timer = 0;
        glide(out.gain, 0, 0.12);
      },
      duck(on) {
        if (timer) glide(out.gain, on ? VOLUME * 0.3 : VOLUME, 0.25, on ? 0 : 0.8);
      },
    };
  })();

  const tiles = {};
  for (const s of SYMBOLS) {
    const el = document.createElement('div');
    el.className = 'tile';
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `Đặt cược ${s.name}`);
    el.innerHTML = `
      <span class="icon">${s.icon}</span>
      <span class="name">${s.name}</span>
      <span class="hits"></span>
      <button class="minus" type="button" aria-label="Giảm cược ${s.name}">−</button>
      <span class="stake"></span>`;
    const minus = el.querySelector('.minus');
    el.addEventListener('click', () => placeBet(s.id));
    el.addEventListener('contextmenu', e => { e.preventDefault(); removeBet(s.id); });
    el.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      placeBet(s.id);
    });
    minus.addEventListener('click', e => { e.stopPropagation(); removeBet(s.id); });
    minus.addEventListener('keydown', e => e.stopPropagation());
    els.board.appendChild(el);
    tiles[s.id] = { el, stake: el.querySelector('.stake'), hits: el.querySelector('.hits') };
  }

  const chipEls = CHIPS.map(value => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.textContent = short(value);
    btn.title = `Phỉnh ${fmt(value)}`;
    btn.style.setProperty('--c', CHIP_COLORS[value]);
    btn.addEventListener('click', () => {
      state.chip = value;
      sfx.chip();
      render();
    });
    els.chips.appendChild(btn);
    return btn;
  });

  function setMessage(text, type = '') {
    els.message.textContent = text;
    els.message.className = `message ${type}`;
  }

  function bump(el) {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  function animateBalance(to) {
    cancelAnimationFrame(balanceAnim);
    const from = shownBalance;
    if (from === to) {
      els.balance.textContent = fmt(to);
      return;
    }
    const dur = Math.abs(to - from) > 2000 ? 700 : 300;
    let start;
    const step = now => {
      start ??= now;
      const p = Math.min(1, (now - start) / dur);
      shownBalance = Math.round(from + (to - from) * (1 - (1 - p) ** 3));
      els.balance.textContent = fmt(shownBalance);
      if (p < 1) balanceAnim = requestAnimationFrame(step);
    };
    balanceAnim = requestAnimationFrame(step);
  }

  function floatDelta(net) {
    if (!net) return;
    const span = document.createElement('span');
    span.className = `delta ${net > 0 ? 'win' : 'lose'}`;
    span.textContent = `${net > 0 ? '+' : '−'}${fmt(Math.abs(net))}`;
    span.addEventListener('animationend', () => span.remove());
    els.wallet.appendChild(span);
  }

  function confetti() {
    for (let i = 0; i < 70; i++) {
      const piece = document.createElement('span');
      piece.className = 'confetti';
      piece.style.left = `${Math.random() * 100}vw`;
      piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      piece.style.animationDuration = `${1.8 + Math.random() * 1.6}s`;
      piece.style.animationDelay = `${Math.random() * 0.4}s`;
      piece.style.setProperty('--x', `${jitter(140)}px`);
      piece.style.setProperty('--rot', `${jitter(900)}deg`);
      piece.addEventListener('animationend', () => piece.remove());
      document.body.appendChild(piece);
    }
  }

  function renderDice(result) {
    els.dice.replaceChildren(...result.map((id, i) => {
      const die = document.createElement('div');
      const [x, y] = DICE_SPOTS[i];
      die.className = 'die';
      die.style.left = `${x + jitter(3)}%`;
      die.style.top = `${y + jitter(3)}%`;
      die.style.setProperty('--r', `${jitter(20)}deg`);
      die.innerHTML = BY_ID[id].icon;
      return die;
    }));
  }

  function renderHistory() {
    els.history.innerHTML = state.history.length
      ? state.history.map(r => `<span class="h-item">${r.map(id => BY_ID[id].icon).join('')}</span>`).join('')
      : '<span class="h-empty">Chưa có ván nào</span>';
  }

  function save() {
    const pending = state.rolling || state.resolved ? 0 : sum(state.bets);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        balance: state.balance + pending,
        history: state.history,
        sound: state.sound,
        music: state.music,
      }));
    } catch {}
  }

  function render() {
    const total = sum(state.bets);
    const funds = state.balance + (state.resolved ? 0 : total);
    animateBalance(state.balance);
    els.totalBet.textContent = fmt(total);
    for (const s of SYMBOLS) {
      const bet = state.bets[s.id];
      tiles[s.id].stake.textContent = bet ? fmt(bet) : '';
      tiles[s.id].el.classList.toggle('has-bet', bet > 0);
    }
    chipEls.forEach((btn, i) => {
      btn.classList.toggle('active', CHIPS[i] === state.chip);
      btn.disabled = state.rolling;
    });
    els.board.classList.toggle('locked', state.rolling);
    els.board.classList.toggle('resolved', state.resolved);
    els.roll.disabled = state.rolling;
    els.clear.disabled = state.rolling || total === 0;
    els.rebet.disabled = state.rolling || !state.lastBets;
    els.refill.hidden = state.rolling || funds >= CHIPS[0];
    els.sound.textContent = state.sound ? '🔊' : '🔇';
    els.music.classList.toggle('off', !state.music);
    save();
  }

  function freshRound() {
    if (!state.resolved) return;
    state.resolved = false;
    state.bets = emptyBets();
    for (const t of Object.values(tiles)) {
      t.el.classList.remove('hit', 'lost');
      t.hits.textContent = '';
    }
    setMessage('Đặt cược rồi bấm LẮC');
  }

  function placeBet(id) {
    if (state.rolling) return;
    freshRound();
    if (state.balance < state.chip) {
      setMessage('Không đủ tiền cho mức phỉnh này!', 'lose');
      bump(els.wallet);
      render();
      return;
    }
    state.balance -= state.chip;
    state.bets[id] += state.chip;
    sfx.chip();
    render();
  }

  function removeBet(id) {
    if (state.rolling || state.resolved || !state.bets[id]) return;
    const amount = Math.min(state.chip, state.bets[id]);
    state.bets[id] -= amount;
    state.balance += amount;
    sfx.chip();
    render();
  }

  function clearBets() {
    if (state.rolling) return;
    if (!state.resolved) state.balance += sum(state.bets);
    state.resolved = true;
    freshRound();
    render();
  }

  function rebet() {
    if (state.rolling || !state.lastBets) return;
    freshRound();
    const available = state.balance + sum(state.bets);
    const need = sum(state.lastBets);
    if (need > available) {
      setMessage('Không đủ tiền để cược lại như ván trước!', 'lose');
      bump(els.wallet);
      render();
      return;
    }
    state.balance = available - need;
    state.bets = { ...state.lastBets };
    sfx.chip();
    render();
  }

  async function roll() {
    if (state.rolling) return;
    const total = state.resolved ? 0 : sum(state.bets);
    if (!total) {
      setMessage('Hãy đặt cược trước khi lắc!', 'lose');
      return;
    }
    state.rolling = true;
    state.lastBets = { ...state.bets };
    render();
    setMessage('Đang lắc...');
    music.duck(true);

    const result = Array.from({ length: 3 }, () => SYMBOLS[rand6()].id);

    if (els.bowl.classList.contains('open')) {
      els.bowl.classList.remove('open');
      await wait(500);
    }
    renderDice(result);
    els.plate.classList.add('shaking');
    sfx.shake(1300);
    await wait(1300);
    els.plate.classList.remove('shaking');
    await wait(250);
    els.bowl.classList.add('open');
    sfx.reveal();
    await wait(450);

    settle(result, total);
    music.duck(false);
    state.rolling = false;
    render();
  }

  function settle(result, total) {
    let payout = 0;
    for (const s of SYMBOLS) {
      const count = result.filter(id => id === s.id).length;
      const bet = state.bets[s.id];
      const tile = tiles[s.id];
      tile.hits.textContent = count ? `×${count}` : '';
      if (count) tile.el.classList.add('hit');
      else if (bet) tile.el.classList.add('lost');
      if (bet && count) payout += bet * (count + 1);
    }
    state.balance += payout;
    state.resolved = true;
    state.history = [result, ...state.history].slice(0, HISTORY_SIZE);
    renderHistory();

    const net = payout - total;
    const names = result.map(id => BY_ID[id].name).join(' · ');
    if (net > 0) {
      setMessage(`${names} — Thắng +${fmt(net)}!`, 'win');
      sfx.win();
      confetti();
    } else if (net === 0) {
      setMessage(`${names} — Hoà vốn`);
    } else {
      setMessage(`${names} — Thua ${fmt(-net)}`, 'lose');
      sfx.lose();
    }
    floatDelta(net);
  }

  els.roll.addEventListener('click', roll);
  els.clear.addEventListener('click', clearBets);
  els.rebet.addEventListener('click', rebet);
  els.refill.addEventListener('click', () => {
    if (state.rolling) return;
    state.resolved = true;
    freshRound();
    state.balance = START_BALANCE;
    setMessage(`Đã nạp lại ${fmt(START_BALANCE)}. Chúc may mắn!`, 'win');
    render();
  });
  els.sound.addEventListener('click', () => {
    state.sound = !state.sound;
    sfx.chip();
    render();
  });
  els.music.addEventListener('click', () => {
    state.music = !state.music;
    if (state.music) music.start();
    else music.stop();
    render();
  });
  const unlockAudio = () => {
    if (state.music) music.start();
    else audio();
  };
  ['pointerup', 'keydown'].forEach(type => document.addEventListener(type, unlockAudio, { once: true }));
  document.addEventListener('visibilitychange', () => {
    if (!audioCtx) return;
    if (document.hidden) audioCtx.suspend();
    else audioCtx.resume();
  });
  document.addEventListener('keydown', e => {
    if (e.code !== 'Space' || e.target !== document.body) return;
    e.preventDefault();
    roll();
  });

  renderDice(state.history[0] ?? Array.from({ length: 3 }, () => SYMBOLS[rand6()].id));
  renderHistory();
  setMessage('Chọn phỉnh, bấm vào các con để đặt cược rồi bấm LẮC');
  render();
})();
