(() => {
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const garden = document.getElementById('garden');
  const startCard = document.getElementById('startCard');
  const resultCard = document.getElementById('resultCard');
  const startButton = document.getElementById('startButton');
  const restartButton = document.getElementById('restartButton');
  const soundButton = document.getElementById('soundButton');
  const hint = document.getElementById('hint');
  const scoreEl = document.getElementById('score');
  const comboEl = document.getElementById('combo');
  const timeEl = document.getElementById('time');
  const timeStat = document.getElementById('timeStat');
  const paceEl = document.getElementById('pace');
  const countdownFill = document.getElementById('countdownFill');
  const finalScoreEl = document.getElementById('finalScore');
  const bestComboEl = document.getElementById('bestCombo');
  const resultTitleEl = document.getElementById('resultTitle');
  const resultLineEl = document.getElementById('resultLine');
  const liveRegion = document.getElementById('liveRegion');

  const GAME_TIME = 45;
  const state = {
    running: false, score: 0, combo: 0, bestCombo: 0, moonCount: 0,
    timeLeft: GAME_TIME, lastTime: 0, spawnTimer: 0, muted: false,
    particles: [], notices: [], flowers: [], keys: new Set(), basketX: 0, targetX: 0
  };
  let width = 0, height = 0, dpr = 1, timerId = null, audio = null, musicTimer = null, musicStep = 0;

  function resize() {
    const rect = garden.getBoundingClientRect();
    width = rect.width; height = rect.height; dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!state.basketX) state.basketX = width / 2;
    state.basketX = Math.max(52, Math.min(width - 52, state.basketX));
    state.targetX = state.basketX;
  }

  function tone(freq, duration = .08, type = 'sine', volume = .06) {
    if (state.muted) return;
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = type; osc.frequency.value = freq;
      gain.gain.setValueAtTime(volume, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + duration);
      osc.connect(gain); gain.connect(audio.destination);
      osc.start(); osc.stop(audio.currentTime + duration);
    } catch (_) {}
  }

  async function playAmbientNote() {
    if (state.muted || !state.running) return;
    const melody = [293.66, 369.99, 440, 329.63, 293.66, 246.94, null, 293.66, 329.63, 369.99, 440, 369.99, 329.63, null, 493.88, 440, 369.99, 329.63, 293.66, null];
    const freq = melody[musicStep++ % melody.length];
    if (!freq) return;
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') await audio.resume();
      const now = audio.currentTime;
      const body = audio.createOscillator();
      const overtone = audio.createOscillator();
      const bodyGain = audio.createGain();
      const overtoneGain = audio.createGain();
      const warmth = audio.createBiquadFilter();
      body.type = 'triangle'; overtone.type = 'sine';
      body.frequency.setValueAtTime(freq * .985, now);
      body.frequency.exponentialRampToValueAtTime(freq, now + .14);
      overtone.frequency.setValueAtTime(freq * 2.01, now);
      bodyGain.gain.setValueAtTime(.0001, now);
      bodyGain.gain.exponentialRampToValueAtTime(.047, now + .018);
      bodyGain.gain.exponentialRampToValueAtTime(.009, now + .72);
      bodyGain.gain.exponentialRampToValueAtTime(.0001, now + 2.7);
      overtoneGain.gain.setValueAtTime(.0001, now);
      overtoneGain.gain.exponentialRampToValueAtTime(.014, now + .012);
      overtoneGain.gain.exponentialRampToValueAtTime(.0001, now + 1.25);
      warmth.type = 'lowpass'; warmth.frequency.value = 2100; warmth.Q.value = .7;
      body.connect(bodyGain); overtone.connect(overtoneGain);
      bodyGain.connect(warmth); overtoneGain.connect(warmth); warmth.connect(audio.destination);

      const attackLength = Math.floor(audio.sampleRate * .035);
      const attackBuffer = audio.createBuffer(1, attackLength, audio.sampleRate);
      const attackData = attackBuffer.getChannelData(0);
      for (let i = 0; i < attackLength; i++) attackData[i] = (Math.random() * 2 - 1) * (1 - i / attackLength);
      const attack = audio.createBufferSource();
      const attackFilter = audio.createBiquadFilter();
      const attackGain = audio.createGain();
      attack.buffer = attackBuffer;
      attackFilter.type = 'bandpass'; attackFilter.frequency.value = Math.min(2400, freq * 4); attackFilter.Q.value = 1.1;
      attackGain.gain.setValueAtTime(.016, now); attackGain.gain.exponentialRampToValueAtTime(.0001, now + .09);
      attack.connect(attackFilter); attackFilter.connect(attackGain); attackGain.connect(audio.destination);
      body.start(now); overtone.start(now); attack.start(now);
      body.stop(now + 2.75); overtone.stop(now + 1.3); attack.stop(now + .1);
    } catch (_) {}
  }

  function stopMusic() {
    clearInterval(musicTimer); musicTimer = null;
  }

  function startMusic() {
    stopMusic(); musicStep = 0; playAmbientNote();
    musicTimer = setInterval(playAmbientNote, 1250);
  }

  function animateStat(element, className) {
    element.classList.remove('stat-gain', 'stat-loss', 'stat-tick');
    void element.offsetWidth;
    element.classList.add(className);
  }

  function spawnFlower(overrides = {}) {
    const roll = Math.random();
    const type = overrides.type || (roll < .09 ? 'leaf' : roll < .16 ? 'moon' : roll < .28 ? 'white' : roll < .42 ? 'big' : 'gold');
    const size = type === 'white' ? 18 + Math.random() * 4 : type === 'moon' ? 12 : type === 'big' ? 16 + Math.random() * 4 : type === 'leaf' ? 12 : 8 + Math.random() * 4;
    const elapsed = GAME_TIME - state.timeLeft;
    const speedRange = elapsed < 10 ? [96, 124] : elapsed < 20 ? [108, 138] : [128, 168];
    state.flowers.push({
      x: overrides.x ?? 28 + Math.random() * (width - 56), y: overrides.y ?? -24, size, type,
      vy: overrides.vy ?? speedRange[0] + Math.random() * (speedRange[1] - speedRange[0]),
      drift: (Math.random() - .5) * 38, phase: Math.random() * Math.PI * 2,
      rot: Math.random() * Math.PI * 2, spin: (Math.random() - .5) * 2.2
    });
  }

  function drawFlower(item) {
    ctx.save(); ctx.translate(item.x, item.y); ctx.rotate(item.rot);
    if (item.type === 'leaf') {
      ctx.fillStyle = '#94684b'; ctx.beginPath(); ctx.ellipse(0, 0, item.size, item.size * .45, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,220,160,.45)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-item.size * .8, 0); ctx.lineTo(item.size * .8, 0); ctx.stroke();
    } else if (item.type === 'moon') {
      ctx.shadowColor = '#d9fff5'; ctx.shadowBlur = 18;
      ctx.fillStyle = '#e8fff8'; ctx.beginPath(); ctx.arc(0, 0, item.size, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.48)'; ctx.beginPath(); ctx.arc(-item.size * .28, -item.size * .28, item.size * .22, 0, Math.PI * 2); ctx.fill();
    } else {
      const color = item.type === 'white' ? '#fff8dc' : '#f6bd45';
      ctx.shadowColor = color; ctx.shadowBlur = item.type === 'white' ? 18 : item.type === 'big' ? 13 : 8;
      ctx.fillStyle = color;
      for (let i = 0; i < 4; i++) {
        ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.ellipse(0, -item.size * .48, item.size * .34, item.size * .62, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.shadowBlur = 0; ctx.fillStyle = item.type === 'white' ? '#f7c956' : '#fff0a3';
      ctx.beginPath(); ctx.arc(0, 0, item.size * .24, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawBasket() {
    const x = state.basketX, y = height - 72;
    ctx.save(); ctx.translate(x, y);
    ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 8;
    const grad = ctx.createLinearGradient(-46, 0, 46, 34); grad.addColorStop(0, '#9e6339'); grad.addColorStop(.5, '#e0ad62'); grad.addColorStop(1, '#82502f');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.moveTo(-50, 0); ctx.quadraticCurveTo(-42, 38, 0, 41); ctx.quadraticCurveTo(42, 38, 50, 0); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0; ctx.strokeStyle = '#f3ce88'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-52, 0); ctx.quadraticCurveTo(0, 10, 52, 0); ctx.stroke();
    ctx.globalAlpha = .38; ctx.lineWidth = 1.5;
    for (let i = -32; i <= 32; i += 16) { ctx.beginPath(); ctx.moveTo(i, 5); ctx.lineTo(i * .72, 34); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(-42, 16); ctx.quadraticCurveTo(0, 25, 42, 16); ctx.stroke();
    ctx.restore();
  }

  function burst(x, y, color, amount = 10) {
    for (let i = 0; i < amount; i++) state.particles.push({ x, y, vx: (Math.random() - .5) * 100, vy: -20 - Math.random() * 90, life: .7 + Math.random() * .35, color, size: 2 + Math.random() * 3 });
  }

  function notice(x, y, text, color) {
    state.notices.push({ x, y, text, color, life: 1.05 });
  }

  function flowSettings() {
    const elapsed = GAME_TIME - state.timeLeft;
    if (elapsed < 10) return { label: '初雨 · 缓', interval: .68, className: '' };
    if (elapsed < 20) return { label: '渐密 · 中', interval: .62, className: 'medium' };
    return { label: '盛落 · 快', interval: .34, className: 'fast' };
  }

  function updateTimerUI() {
    const flow = flowSettings();
    timeEl.textContent = state.timeLeft;
    paceEl.textContent = flow.label;
    timeStat.setAttribute('aria-label', `倒计时，还剩${state.timeLeft}秒，${flow.label}`);
    timeStat.classList.toggle('urgent', state.timeLeft <= 5);
    countdownFill.style.transform = `scaleX(${Math.min(1, Math.max(0, state.timeLeft / GAME_TIME))})`;
    countdownFill.className = flow.className;
  }

  function update(dt) {
    const speed = 430;
    if (state.keys.has('ArrowLeft') || state.keys.has('a')) state.targetX -= speed * dt;
    if (state.keys.has('ArrowRight') || state.keys.has('d')) state.targetX += speed * dt;
    state.targetX = Math.max(52, Math.min(width - 52, state.targetX));
    state.basketX += (state.targetX - state.basketX) * Math.min(1, dt * 14);
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      spawnFlower();
      const flow = flowSettings();
      state.spawnTimer = flow.interval * (.82 + Math.random() * .38);
    }

    const basketY = height - 72;
    for (let i = state.flowers.length - 1; i >= 0; i--) {
      const f = state.flowers[i];
      f.y += f.vy * dt; f.x += (f.drift + Math.sin(f.phase + f.y * .02) * 16) * dt; f.rot += f.spin * dt;
      const caught = f.y > basketY - 17 && f.y < basketY + 26 && Math.abs(f.x - state.basketX) < 50;
      if (caught) {
        state.flowers.splice(i, 1);
        if (f.type === 'moon') {
          state.timeLeft += 1; updateTimerUI(); animateStat(timeEl, 'stat-gain');
          tone(900, .18, 'sine', .055); burst(f.x, f.y, '#d9fff5', 16); notice(f.x, f.y, '月时 +1 秒', '#d9fff5');
        } else if (f.type === 'leaf') {
          state.score = Math.max(0, state.score - 1); state.combo = 0;
          scoreEl.textContent = state.score; comboEl.textContent = '×1';
          animateStat(scoreEl, 'stat-loss'); animateStat(comboEl, 'stat-loss');
          tone(130, .16, 'triangle', .05); burst(f.x, f.y, '#a77a56', 7); notice(f.x, f.y, '污染 −1', '#d59a6d');
        } else {
          state.combo++; state.bestCombo = Math.max(state.bestCombo, state.combo);
          const multiplier = Math.min(4, 1 + Math.floor(state.combo / 8));
          const base = f.type === 'white' ? 4 : f.type === 'big' ? 2 : 1; state.score += base * multiplier;
          scoreEl.textContent = state.score; comboEl.textContent = `×${multiplier}`;
          animateStat(scoreEl, 'stat-gain'); animateStat(comboEl, 'stat-gain');
          tone(f.type === 'white' ? 820 : f.type === 'big' ? 660 : 540 + Math.min(state.combo, 10) * 16, .1, 'sine', .055);
          burst(f.x, f.y, f.type === 'white' ? '#fff8dc' : '#f6bd45', f.type === 'white' ? 20 : f.type === 'big' ? 15 : 10);
          notice(f.x, f.y, `+${base * multiplier}`, f.type === 'white' ? '#fff8dc' : '#ffd96a');
        }
      } else if (f.y > height + 30) state.flowers.splice(i, 1);
    }
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i]; p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt;
      if (p.life <= 0) state.particles.splice(i, 1);
    }
    for (let i = state.notices.length - 1; i >= 0; i--) {
      const n = state.notices[i]; n.life -= dt; n.y -= 34 * dt;
      if (n.life <= 0) state.notices.splice(i, 1);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    for (const f of state.flowers) drawFlower(f);
    for (const p of state.particles) { ctx.save(); ctx.globalAlpha = Math.min(1, p.life * 1.7); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    for (const n of state.notices) { ctx.save(); ctx.globalAlpha = Math.min(1, n.life * 1.8); ctx.fillStyle = n.color; ctx.font = '700 18px sans-serif'; ctx.textAlign = 'center'; ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 6; ctx.fillText(n.text, n.x, n.y); ctx.restore(); }
    if (state.running) drawBasket();
  }

  function frame(now) {
    const dt = Math.min(.033, (now - state.lastTime) / 1000 || 0); state.lastTime = now;
    if (state.running) update(dt); draw(); requestAnimationFrame(frame);
  }

  function animateResultScore(value) {
    const start = performance.now();
    const duration = 850;
    function step(now) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      finalScoreEl.textContent = Math.round(value * eased);
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function startGame() {
    clearInterval(timerId);
    Object.assign(state, { running: true, score: 0, combo: 0, bestCombo: 0, moonCount: 0, timeLeft: GAME_TIME, spawnTimer: .2, flowers: [], particles: [], notices: [] });
    state.basketX = state.targetX = width / 2;
    spawnFlower({ type: 'gold', x: width / 2, y: height * .62, vy: 180 });
    spawnFlower({ type: 'gold', x: width * .32, y: height * .42, vy: 155 });
    spawnFlower({ type: 'gold', x: width * .7, y: height * .24, vy: 145 });
    scoreEl.textContent = '0'; comboEl.textContent = '×1'; updateTimerUI();
    startCard.hidden = true; resultCard.hidden = true; garden.classList.add('playing'); hint.classList.add('visible');
    setTimeout(() => hint.classList.remove('visible'), 2500);
    tone(420, .12); setTimeout(() => tone(620, .16), 100); setTimeout(() => { if (state.running) startMusic(); }, 320);
    timerId = setInterval(() => {
      state.timeLeft--; updateTimerUI(); animateStat(timeEl, 'stat-tick');
      if (state.timeLeft <= 0) endGame();
      else if (state.timeLeft <= 5) tone(240, .05, 'square', .025);
    }, 1000);
  }

  function resultTitleForScore(score) {
    if (score <= 0) return '桂雨初歇';
    if (score <= 20) return '桂子初收';
    if (score <= 40) return '一袖秋香';
    if (score <= 70) return '满庭清芬';
    if (score <= 80) return '桂雨盈袖';
    if (score <= 90) return '金粟满庭';
    if (score <= 100) return '月桂流芳';
    if (score <= 110) return '十里桂香';
    if (score <= 130) return '桂馥兰馨';
    if (score <= 140) return '蟾宫折桂';
    return '香飘十里';
  }

  function endGame() {
    clearInterval(timerId); stopMusic(); state.running = false; state.flowers = []; garden.classList.remove('playing');
    finalScoreEl.textContent = '0'; bestComboEl.textContent = state.bestCombo;
    resultTitleEl.textContent = resultTitleForScore(state.score);
    resultCard.hidden = false; animateResultScore(state.score); liveRegion.textContent = `游戏结束，收集了${state.score}缕桂香，最高连香${state.bestCombo}次。`;
    tone(620, .16); setTimeout(() => tone(820, .28), 150);
    restartButton.focus();
  }

  function pointerMove(event) {
    if (!state.running) return;
    const rect = garden.getBoundingClientRect(); const point = event.touches ? event.touches[0] : event;
    state.targetX = Math.max(52, Math.min(width - 52, point.clientX - rect.left));
  }

  startButton.addEventListener('click', startGame); restartButton.addEventListener('click', startGame);
  garden.addEventListener('pointermove', pointerMove); garden.addEventListener('touchmove', pointerMove, { passive: true });
  window.addEventListener('keydown', e => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (['ArrowLeft','ArrowRight',' ','a','d','r'].includes(key)) e.preventDefault();
    state.keys.add(key);
    if (key === ' ' && !state.running && !startCard.hidden) startGame();
    if (key === 'r' && !state.running && !resultCard.hidden) startGame();
  });
  window.addEventListener('keyup', e => state.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
  soundButton.addEventListener('click', () => {
    state.muted = !state.muted; soundButton.setAttribute('aria-pressed', String(!state.muted));
    soundButton.setAttribute('aria-label', state.muted ? '打开声音' : '关闭声音'); soundButton.textContent = state.muted ? '♩' : '♪';
    if (state.muted) stopMusic(); else if (state.running) startMusic();
  });
  window.addEventListener('resize', resize); resize(); requestAnimationFrame(frame);
})();

