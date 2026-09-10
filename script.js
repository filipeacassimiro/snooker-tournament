/**
 * TORNEIO DE SINUCA — script.js
 * Gerencia todas as fases: cadastro, grupos, partidas, eliminatórias, campeão.
 * Persistência via LocalStorage. Sem dependências externas.
 */

// ============================================================
// ESTADO GLOBAL
// ============================================================
const LS_KEY = 'sinuca_torneio_v2';

// Limites de participantes — todo o sistema deve se adaptar dinamicamente
// entre esses dois valores, sem números fixos espalhados pelo código.
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 50;

let state = {
  phase: 'setup',      // setup | groups | matches | bracket | done
  players: [],         // [{ id, name }]
  groups: { A: [], B: [] }, // array of player ids
  groupsConfirmed: false,
  matches: [],         // { id, group, p1, p2, winner, status }
  semifinals: [],      // { id, label, p1, p2, winner, status }
  final: null,         // { id, p1, p2, winner, status }
  champion: null,
  runnerUp: null,
  tiebreakSeed: Date.now(), // para sorteio determinístico
};

// ============================================================
// PERSISTÊNCIA
// ============================================================
function saveState() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch(e) {}
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = Object.assign({}, state, parsed);
    }
  } catch(e) {}
}

// ============================================================
// UTILITÁRIOS
// ============================================================
function uid() { return Math.random().toString(36).slice(2,9); }

function getPlayer(id) { return state.players.find(p => p.id === id) || { id, name: '?' }; }

// ============================================================
// FORMATO DO TORNEIO (dinâmico, sem números fixos)
// ============================================================
// 'direct' -> 2 jogadores: vão direto para a Grande Final.
// 'single' -> 3 jogadores: um único grupo (Grupo A), depois final direta.
// 'groups' -> 4 a 50 jogadores: dois grupos, semifinais e final.
function getTournamentFormat() {
  const n = state.players.length;
  if (n === 2) return 'direct';
  if (n === 3) return 'single';
  return 'groups';
}

// Quantidade de partidas de "todos contra todos" para n jogadores: n*(n-1)/2
function combinationsCount(n) {
  return n > 1 ? (n * (n - 1)) / 2 : 0;
}

// Distribuição equilibrada entre os dois grupos (diferença máxima de 1).
function computeGroupSizes(n, format) {
  if (format === 'single') return { A: n, B: 0 };
  const half = Math.ceil(n / 2);
  return { A: half, B: n - half };
}

// Classe visual da bolinha (ball-1..ball-10), reaproveitada ciclicamente
// para qualquer quantidade de jogadores. O número exibido no texto
// continua sendo o número real do jogador.
function getBallClass(index) {
  return `ball-${(index % 10) + 1}`;
}

// Total real de partidas do torneio, calculado a partir da distribuição
// efetiva do estado atual (sem valores fixos como 13 ou 23).
function getTotalMatchesCount() {
  const format = getTournamentFormat();
  if (format === 'direct') return 1; // apenas a Grande Final
  const totalA = combinationsCount(state.groups.A.length);
  const totalB = combinationsCount(state.groups.B.length);
  if (format === 'single') return totalA + 1; // partidas de grupo + final
  return totalA + totalB + 2 + 1; // partidas de grupo + 2 semifinais + final
}

function shuffle(arr, seed) {
  // Fisher-Yates com seed simples
  const a = [...arr];
  let s = seed || 12345;
  const rng = () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.display = 'none'; }, duration);
}

function confirm(title, msg, onOk) {
  const overlay = document.getElementById('confirm-modal');
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = msg;
  overlay.style.display = 'flex';
  const ok = document.getElementById('confirm-ok');
  const cancel = document.getElementById('confirm-cancel');
  const close = () => { overlay.style.display = 'none'; };
  ok.onclick = () => { close(); onOk(); };
  cancel.onclick = close;
}

// ============================================================
// NAVEGAÇÃO POR ABAS
// ============================================================
function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
  document.querySelectorAll('.tab-content').forEach(s => s.classList.toggle('active', s.id === 'tab-' + tabName));
}

// ============================================================
// FASE: SETUP — CADASTRO DE JOGADORES
// ============================================================
function renderSetup() {
  const list      = document.getElementById('player-list');
  const hint      = document.getElementById('player-count-hint');
  const btn       = document.getElementById('btn-start-tournament');
  const startHint = document.getElementById('start-hint');
  const n         = state.players.length;

  hint.textContent = `${n} / ${MAX_PLAYERS} jogadores adicionados`;
  btn.disabled = n < MIN_PLAYERS;
  btn.textContent = n >= MIN_PLAYERS
    ? `🎱 Iniciar Torneio com ${n} Jogadores`
    : `🎱 Iniciar Torneio`;

  if (startHint) {
    startHint.textContent = n < MIN_PLAYERS
      ? `Adicione ao menos ${MIN_PLAYERS} jogadores para iniciar`
      : n >= MAX_PLAYERS
        ? `Máximo de ${MAX_PLAYERS} jogadores atingido.`
        : `Pronto para iniciar com ${n} jogadores`;
  }

  if (n === 0) {
    list.innerHTML = '<li class="empty-state">Nenhum jogador cadastrado ainda.</li>';
    return;
  }

  list.innerHTML = state.players.map((p, i) => `
    <li class="player-item" data-id="${p.id}">
      <span class="player-num ${getBallClass(i)}">${i+1}</span>
      <span class="player-name-text">${escHtml(p.name)}</span>
      ${state.phase === 'setup' ? `<button class="btn-remove" data-remove="${p.id}" title="Remover">✕</button>` : ''}
    </li>
  `).join('');
}

function addPlayer(name) {
  name = name.trim();
  if (!name) return showToast('Digite o nome do jogador.');
  if (state.players.length >= MAX_PLAYERS) return showToast(`Máximo de ${MAX_PLAYERS} jogadores atingido.`);
  if (state.players.find(p => p.name.toLowerCase() === name.toLowerCase()))
    return showToast('Já existe um jogador com esse nome.');
  state.players.push({ id: uid(), name });
  saveState();
  renderSetup();
}

function removePlayer(id) {
  state.players = state.players.filter(p => p.id !== id);
  saveState();
  renderSetup();
}

// ============================================================
// FASE: GROUPS — COMPOSIÇÃO E EDIÇÃO
// ============================================================
function autoAssignGroups() {
  const format = getTournamentFormat();
  const shuffled = shuffle(state.players.map(p => p.id), state.tiebreakSeed + Date.now());

  if (format === 'direct') {
    // Sem fase de grupos: os 2 jogadores vão direto para a Grande Final.
    state.groups.A = [];
    state.groups.B = [];
    return;
  }

  const sizes = computeGroupSizes(state.players.length, format);
  state.groups.A = shuffled.slice(0, sizes.A);
  state.groups.B = shuffled.slice(sizes.A, sizes.A + sizes.B);
}

function renderGroups() {
  const grid = document.getElementById('groups-grid');
  // Garante que os botões de composição de grupos estejam visíveis ao
  // (re)entrar nesta fase — eles são ocultados após a confirmação dos
  // grupos por updateGroupsTab(), e precisam voltar em um novo torneio.
  document.getElementById('btn-shuffle-groups').style.display = '';
  document.getElementById('btn-confirm-groups').style.display = '';
  // Só renderiza grupos que de fato possuem jogadores (Grupo B fica vazio
  // no formato de 3 jogadores, que usa somente o Grupo A).
  const groups = ['A', 'B'].filter(g => state.groups[g].length > 0);

  grid.innerHTML = groups.map(g => `
    <div class="group-card" id="group-card-${g}">
      <div class="group-header ${g==='A' ? 'group-a-header' : 'group-b-header'}">
        🎱 GRUPO ${g}
      </div>
      <ul class="group-players-list" id="group-list-${g}" data-group="${g}">
        ${state.groups[g].map(id => {
          const p = getPlayer(id);
          const idx = state.players.findIndex(pl => pl.id === id);
          return `<li class="group-player-item" draggable="true" data-id="${id}" data-group="${g}">
            <span class="player-num ${getBallClass(idx)}">${idx+1}</span>
            <span>${escHtml(p.name)}</span>
          </li>`;
        }).join('')}
      </ul>
      <p class="drag-hint">⇅ Arraste para trocar jogadores entre grupos</p>
    </div>
  `).join('');

  // Drag & drop entre grupos
  setupGroupDrag();
}

let _dragItem = null;

function setupGroupDrag() {
  document.querySelectorAll('.group-player-item').forEach(el => {
    el.addEventListener('dragstart', e => {
      _dragItem = el;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      _dragItem = null;
    });
    el.addEventListener('dragover', e => {
      e.preventDefault();
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', e => {
      e.preventDefault();
      el.classList.remove('drag-over');
      if (!_dragItem || _dragItem === el) return;

      const fromId    = _dragItem.dataset.id;
      const fromGroup = _dragItem.dataset.group;
      const toId      = el.dataset.id;
      const toGroup   = el.dataset.group;

      // Swap
      const fi = state.groups[fromGroup].indexOf(fromId);
      const ti = state.groups[toGroup].indexOf(toId);
      state.groups[fromGroup][fi] = toId;
      state.groups[toGroup][ti]   = fromId;

      saveState();
      renderGroups();
    });
  });

  // Drop on list background (empty area)
  document.querySelectorAll('.group-players-list').forEach(list => {
    list.addEventListener('dragover', e => e.preventDefault());
    list.addEventListener('drop', e => {
      e.preventDefault();
      if (!_dragItem) return;
      const toGroup   = list.dataset.group;
      const fromId    = _dragItem.dataset.id;
      const fromGroup = _dragItem.dataset.group;
      if (fromGroup === toGroup) return;
      // Move from one group to other, swapping with last item if sizes differ
      // We keep groups equal (5/5), so just swap with any from target
      // Find first item in target that's not already being dragged
    });
  });
}

function generateGroupMatches() {
  state.matches = [];
  ['A', 'B'].forEach(g => {
    const ids = state.groups[g];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        state.matches.push({
          id: uid(),
          group: g,
          p1: ids[i],
          p2: ids[j],
          winner: null,
          status: 'pending',
        });
      }
    }
  });
}

// ============================================================
// STANDINGS (Classificação)
// ============================================================
function computeStanding(group) {
  const ids = state.groups[group];
  const stats = {};
  ids.forEach(id => { stats[id] = { id, w: 0, l: 0, pts: 0, gp: 0 }; });

  state.matches
    .filter(m => m.group === group && m.status === 'done')
    .forEach(m => {
      stats[m.p1].gp++; stats[m.p2].gp++;
      if (m.winner === m.p1) {
        stats[m.p1].w++; stats[m.p1].pts += 3;
        stats[m.p2].l++;
      } else {
        stats[m.p2].w++; stats[m.p2].pts += 3;
        stats[m.p1].l++;
      }
    });

  let sorted = Object.values(stats);

  // Sort: pts → wins → h2h → tiebreak seed
  sorted.sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.w   !== a.w)   return b.w   - a.w;
    // h2h
    const h2h = state.matches.find(
      m => m.status === 'done' &&
           ((m.p1 === a.id && m.p2 === b.id) || (m.p1 === b.id && m.p2 === a.id))
    );
    if (h2h) {
      if (h2h.winner === b.id) return 1;
      if (h2h.winner === a.id) return -1;
    }
    // Tiebreak seed
    const seedA = state.tiebreakSeed ^ a.id.charCodeAt(0);
    const seedB = state.tiebreakSeed ^ b.id.charCodeAt(0);
    return seedA - seedB;
  });

  return sorted;
}

// ============================================================
// RENDER: STANDINGS TABLE
// ============================================================
function renderStanding(group) {
  const standing = computeStanding(group);
  const totalMatches = (state.groups[group].length * (state.groups[group].length - 1)) / 2;
  const doneMatches  = state.matches.filter(m => m.group === group && m.status === 'done').length;
  const groupDone    = doneMatches === totalMatches;

  return `
    <div class="standing-section">
      <div class="standing-title standing-title-${group.toLowerCase()}">
        🎱 GRUPO ${group}
        <span class="badge badge-${group==='A'?'green':'blue'}" style="margin-left:auto;font-size:.7rem">
          ${doneMatches}/${totalMatches} partidas
        </span>
      </div>
      <table class="standing-table">
        <thead>
          <tr>
            <th>#</th><th>Jogador</th><th>PJ</th><th>V</th><th>D</th><th>PTS</th>
          </tr>
        </thead>
        <tbody>
          ${standing.map((s, i) => {
            const p   = getPlayer(s.id);
            const pos = i + 1;
            const qualified = groupDone && pos <= 2;
            return `<tr class="${qualified ? 'qualified' : ''}">
              <td><span class="pos-badge pos-${pos <= 3 ? pos : 'other'}">${pos}</span></td>
              <td>${escHtml(p.name)}</td>
              <td>${s.gp}</td>
              <td>${s.w}</td>
              <td>${s.l}</td>
              <td class="pts-cell">${s.pts}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ============================================================
// RENDER: MATCHES
// ============================================================
function renderMatches() {
  const container = document.getElementById('matches-container');
  const filter    = document.querySelector('.filter-btn.active')?.dataset.filter || 'all';

  if (!state.groupsConfirmed) {
    container.innerHTML = '<div class="empty-state" style="padding:3rem">Confirme os grupos para gerar as partidas.</div>';
    return;
  }

  if (getTournamentFormat() === 'direct') {
    container.innerHTML = '<div class="empty-state" style="padding:3rem">Este torneio utiliza Final Direta. Acesse a aba Chaves para registrar o resultado.</div>';
    return;
  }

  const groups = ['A', 'B'];
  let html = '';

  groups.forEach(g => {
    const ms = state.matches.filter(m => m.group === g);
    const visible = ms.filter(m =>
      filter === 'all' ||
      (filter === 'pending' && m.status === 'pending') ||
      (filter === 'done'    && m.status === 'done')
    );
    if (visible.length === 0) return;

    html += `<p class="matches-group-title">Grupo ${g}</p>`;
    html += visible.map(m => renderMatchCard(m)).join('');
  });

  if (!html) {
    html = `<div class="empty-state" style="padding:3rem">Nenhuma partida ${filter === 'pending' ? 'pendente' : 'concluída'} no momento.</div>`;
  }

  container.innerHTML = html;
  bindMatchButtons();
}

function renderMatchCard(m) {
  const p1 = getPlayer(m.p1);
  const p2 = getPlayer(m.p2);
  const done = m.status === 'done';

  let resultHtml = '';
  if (done) {
    const wName = getPlayer(m.winner).name;
    const wClass = m.winner === m.p1 ? 'winner-p1' : 'winner-p2';
    resultHtml = `<span class="match-winner-badge ${wClass}">✓ ${escHtml(wName)}</span>`;
  }

  return `
    <div class="match-card ${done ? 'match-done' : ''}" data-match-id="${m.id}">
      <div class="match-top">
        <div class="match-players">
          <span class="match-p1">${escHtml(p1.name)}</span>
          <span class="match-vs">vs</span>
          <span class="match-p2">${escHtml(p2.name)}</span>
        </div>
        <span class="match-status ${done ? 'status-done' : 'status-pending'}">
          ${done ? '✓ Concluída' : '⏳ Pendente'}
        </span>
      </div>
      <div class="match-actions">
        ${!done ? `
          <button class="btn btn-win1 btn-sm" data-win="${m.p1}" data-mid="${m.id}">
            🏆 Vitória de ${escHtml(p1.name)}
          </button>
          <button class="btn btn-win2 btn-sm" data-win="${m.p2}" data-mid="${m.id}">
            🏆 Vitória de ${escHtml(p2.name)}
          </button>
        ` : `
          ${resultHtml}
          <button class="btn btn-ghost btn-sm" data-edit="${m.id}">✎ Editar</button>
        `}
      </div>
    </div>
  `;
}

function bindMatchButtons() {
  document.querySelectorAll('[data-mid]').forEach(btn => {
    btn.onclick = () => registerGroupResult(btn.dataset.mid, btn.dataset.win);
  });
  document.querySelectorAll('[data-edit]').forEach(btn => {
    btn.onclick = () => editMatch(btn.dataset.edit);
  });
}

function registerGroupResult(matchId, winnerId) {
  const m = state.matches.find(x => x.id === matchId);
  if (!m) return;
  m.winner = winnerId;
  m.status = 'done';
  saveState();
  afterGroupResult();
}

function editMatch(matchId) {
  const m = state.matches.find(x => x.id === matchId);
  if (!m) return;
  m.winner = null;
  m.status = 'pending';

  // A edição de uma partida de grupo pode mudar a classificação. Se as
  // fases eliminatórias já foram geradas a partir da classificação antiga,
  // elas precisam ser invalidadas para não apontar para classificados errados.
  if (state.semifinals.length || state.final) {
    state.semifinals = [];
    state.final = null;
    state.champion = null;
    state.runnerUp = null;
    if (state.phase === 'bracket' || state.phase === 'done') state.phase = 'matches';
  }

  saveState();
  afterGroupResult();
}

function afterGroupResult() {
  renderMatches();
  updateGroupsTab();
  updateProgress();
  checkGroupPhaseDone();
  renderBracket();
  renderPanel();
}

// ============================================================
// GROUPS TAB (standings view após confirmação)
// ============================================================
function updateGroupsTab() {
  if (!state.groupsConfirmed) return;
  const grid = document.getElementById('groups-grid');
  const format = getTournamentFormat();

  if (format === 'direct') {
    grid.innerHTML = '<div class="empty-state" style="padding:3rem">Formato de Final Direta — com 2 jogadores não há fase de grupos.</div>';
  } else if (format === 'single') {
    grid.innerHTML = renderStanding('A');
  } else {
    grid.innerHTML = renderStanding('A') + renderStanding('B');
  }

  // Hide edit buttons after confirming
  document.getElementById('btn-shuffle-groups').style.display = 'none';
  document.getElementById('btn-confirm-groups').style.display = 'none';
}

// ============================================================
// BRACKET: SEMIFINAIS E FINAL
// ============================================================
function checkGroupPhaseDone() {
  const format = getTournamentFormat();
  if (format === 'direct') return; // não há fase de grupos nesse formato

  const totalA = combinationsCount(state.groups.A.length);
  const totalB = combinationsCount(state.groups.B.length);
  const doneA  = state.matches.filter(m => m.group === 'A' && m.status === 'done').length;
  const doneB  = state.matches.filter(m => m.group === 'B' && m.status === 'done').length;

  if (doneA === totalA && doneB === totalB) {
    if (format === 'single') {
      generateFinalFromGroupA();
    } else {
      generateSemifinals();
    }
  }
}

function getQualified(group) {
  return computeStanding(group).slice(0, 2).map(s => s.id);
}

function generateSemifinals() {
  // Only generate once if not already set
  if (state.semifinals.length === 2) return;

  const [a1, a2] = getQualified('A');
  const [b1, b2] = getQualified('B');

  state.semifinals = [
    { id: uid(), label: 'Semifinal 1', p1: a1, p2: b2, winner: null, status: 'pending' },
    { id: uid(), label: 'Semifinal 2', p1: b1, p2: a2, winner: null, status: 'pending' },
  ];
  state.phase = 'bracket';
  saveState();
  showToast('🏆 Fase de grupos encerrada! Semifinais geradas.');
}

// Formato de 3 jogadores: os dois melhores do Grupo A vão direto para a
// Grande Final, sem passar por semifinal.
function generateFinalFromGroupA() {
  if (state.final) return;

  const [p1, p2] = getQualified('A');

  state.semifinals = [];
  state.final = {
    id: uid(),
    label: 'GRANDE FINAL',
    p1,
    p2,
    winner: null,
    status: 'pending',
  };
  state.phase = 'bracket';
  saveState();
  showToast('🏆 Fase de grupos encerrada! Final gerada entre os dois melhores.');
}

function registerSemifinalResult(sfId, winnerId) {
  const sf = state.semifinals.find(s => s.id === sfId);
  if (!sf) return;
  sf.winner  = winnerId;
  sf.status  = 'done';
  saveState();
  checkSemifinalsDone();
  renderBracket();
  renderPanel();
  updateProgress();
}

function editSemifinal(sfId) {
  const sf = state.semifinals.find(s => s.id === sfId);
  if (!sf) return;
  sf.winner = null; sf.status = 'pending';
  // Reset final if it exists
  state.final    = null;
  state.champion = null;
  state.runnerUp = null;
  saveState();
  renderBracket();
  renderPanel();
  updateProgress();
}

function checkSemifinalsDone() {
  if (state.semifinals.every(s => s.status === 'done')) {
    generateFinal();
  }
}

function generateFinal() {
  if (state.final) return;
  const [sf1, sf2] = state.semifinals;
  state.final = {
    id: uid(),
    label: 'GRANDE FINAL',
    p1: sf1.winner,
    p2: sf2.winner,
    winner: null,
    status: 'pending',
  };
  saveState();
  showToast('🏆 Final gerada! Boa sorte aos finalistas.');
}

function registerFinalResult(winnerId) {
  if (!state.final) return;
  state.final.winner = winnerId;
  state.final.status = 'done';
  const loser = winnerId === state.final.p1 ? state.final.p2 : state.final.p1;
  state.champion = winnerId;
  state.runnerUp = loser;
  state.phase    = 'done';
  saveState();
  renderBracket();
  renderPanel();
  updateProgress();
  showChampionModal();
}

function editFinal() {
  if (!state.final) return;
  state.final.winner = null; state.final.status = 'pending';
  state.champion = null; state.runnerUp = null;
  state.phase = 'bracket';
  saveState();
  renderBracket();
  renderPanel();
  updateProgress();
}

function showChampionModal() {
  const modal = document.getElementById('champion-modal');
  document.getElementById('champion-name').textContent = getPlayer(state.champion).name;
  document.getElementById('runner-up-name').textContent = getPlayer(state.runnerUp).name;
  modal.style.display = 'flex';
}

// ============================================================
// RENDER BRACKET
// ============================================================
function renderBracket() {
  const container = document.getElementById('bracket-container');

  // Sem semifinais (2 ou 3 jogadores) e sem final ainda gerada -> nada a mostrar.
  if (state.semifinals.length < 2 && !state.final) {
    container.innerHTML = `
      <div class="bracket-pending">
        <span class="bracket-pending-icon">⏳</span>
        <p>As chaves serão geradas automaticamente quando a fase de grupos for encerrada.</p>
      </div>`;
    return;
  }

  const hasSemifinals = state.semifinals.length === 2;
  const sf1 = hasSemifinals ? state.semifinals[0] : null;
  const sf2 = hasSemifinals ? state.semifinals[1] : null;

  const sfHtml = (sf) => {
    const p1 = getPlayer(sf.p1); const p2 = getPlayer(sf.p2);
    const done = sf.status === 'done';
    return `
      <div class="bracket-match">
        <div class="bracket-match-header">${escHtml(sf.label)}</div>
        <div class="bracket-player ${done && sf.winner===sf.p1 ? 'winner':''}">
          <span class="bracket-player-name">${escHtml(p1.name)}</span>
          ${done && sf.winner===sf.p1 ? '<span>🏆</span>' : ''}
        </div>
        <div class="bracket-player ${done && sf.winner===sf.p2 ? 'winner':''}">
          <span class="bracket-player-name">${escHtml(p2.name)}</span>
          ${done && sf.winner===sf.p2 ? '<span>🏆</span>' : ''}
        </div>
        ${!done ? `
          <div class="bracket-match-actions">
            <button class="btn btn-win1 btn-sm" onclick="registerSemifinalResult('${sf.id}','${sf.p1}')">
              ✓ ${escHtml(p1.name)}
            </button>
            <button class="btn btn-win2 btn-sm" onclick="registerSemifinalResult('${sf.id}','${sf.p2}')">
              ✓ ${escHtml(p2.name)}
            </button>
          </div>
        ` : `
          <div class="bracket-match-actions">
            <button class="btn btn-ghost btn-sm" onclick="editSemifinal('${sf.id}')">✎ Editar</button>
          </div>
        `}
      </div>
    `;
  };

  let finalHtml = '';
  if (state.final) {
    const f = state.final;
    const fp1 = getPlayer(f.p1); const fp2 = getPlayer(f.p2);
    const done = f.status === 'done';
    finalHtml = `
      <div class="bracket-match" style="border-color:var(--gold-dim)">
        <div class="bracket-match-header" style="color:var(--gold)">🏆 GRANDE FINAL</div>
        <div class="bracket-player ${done && f.winner===f.p1 ? 'winner':''}">
          <span class="bracket-player-name">${escHtml(fp1.name)}</span>
          ${done && f.winner===f.p1 ? '<span>🏆</span>' : ''}
        </div>
        <div class="bracket-player ${done && f.winner===f.p2 ? 'winner':''}">
          <span class="bracket-player-name">${escHtml(fp2.name)}</span>
          ${done && f.winner===f.p2 ? '<span>🏆</span>' : ''}
        </div>
        ${!done ? `
          <div class="bracket-match-actions">
            <button class="btn btn-win1 btn-sm" onclick="registerFinalResult('${f.p1}')">
              ✓ ${escHtml(fp1.name)}
            </button>
            <button class="btn btn-win2 btn-sm" onclick="registerFinalResult('${f.p2}')">
              ✓ ${escHtml(fp2.name)}
            </button>
          </div>
        ` : `
          <div class="bracket-match-actions">
            <button class="btn btn-ghost btn-sm" onclick="editFinal()">✎ Editar</button>
          </div>
        `}
      </div>
    `;
  } else {
    finalHtml = `
      <div class="bracket-match" style="opacity:.5">
        <div class="bracket-match-header">🏆 GRANDE FINAL</div>
        <div class="bracket-player"><span class="bracket-player-name">Aguardando semifinais…</span></div>
        <div class="bracket-player"><span class="bracket-player-name">Aguardando semifinais…</span></div>
      </div>
    `;
  }

  let championHtml = '';
  if (state.champion) {
    championHtml = `
      <div class="champion-card pulse">
        <span class="trophy">🏆</span>
        <div class="champion-card-label">CAMPEÃO</div>
        <div class="champion-card-name">${escHtml(getPlayer(state.champion).name)}</div>
        <div style="margin-top:.5rem;font-size:.85rem;opacity:.8">Vice: ${escHtml(getPlayer(state.runnerUp).name)}</div>
      </div>
    `;
  }

  const semifinalsColumn = hasSemifinals ? `
      <div class="bracket-col">
        <p class="bracket-label">SEMIFINAIS</p>
        ${sfHtml(sf1)}
        ${sfHtml(sf2)}
      </div>
  ` : '';

  container.innerHTML = `
    <div class="bracket-stage">
      ${semifinalsColumn}
      <div class="bracket-col bracket-vs-col">
        ${hasSemifinals ? '<div class="bracket-arrow">→</div>' : ''}
        ${finalHtml}
      </div>
      <div class="bracket-col">
        ${state.champion ? `<p class="bracket-label">CAMPEÃO</p>${championHtml}` : ''}
      </div>
    </div>
  `;
}

// ============================================================
// PANEL
// ============================================================
function renderPanel() {
  const container = document.getElementById('panel-container');
  container.innerHTML = buildPanelHTML();
  const tvContent = document.getElementById('tv-content');
  if (tvContent) tvContent.innerHTML = buildPanelHTML();
}

function buildPanelHTML() {
  if (!state.groupsConfirmed) {
    return '<div class="empty-state" style="padding:3rem">Inicie o torneio para ver o painel.</div>';
  }

  const format        = getTournamentFormat();
  const hasSemifinals = state.semifinals.length === 2;
  const hasFinal       = !!state.final;

  const doneMatches    = state.matches.filter(m => m.status === 'done');
  const pendingMatches = state.matches.filter(m => m.status === 'pending');

  const matchItem = (m) => {
    const p1 = getPlayer(m.p1); const p2 = getPlayer(m.p2);
    const res = m.status === 'done'
      ? `<span class="panel-match-result">${escHtml(getPlayer(m.winner).name)} venceu</span>`
      : `<span class="badge badge-gold">Pendente</span>`;
    return `
      <div class="panel-match-item">
        <span class="panel-match-players">${escHtml(p1.name)} <em>vs</em> ${escHtml(p2.name)}</span>
        ${res}
      </div>
    `;
  };

  // A seção de eliminatórias/final deve existir sempre que houver
  // semifinais (formato de 4+) OU uma final já gerada (formatos direct
  // e single, que pulam a etapa de semifinal).
  let bracketSection = '';
  if (hasSemifinals || hasFinal) {
    bracketSection = `
      <div class="panel-section">
        <div class="panel-section-header">🏆 Eliminatórias</div>
        <div class="panel-section-body">
          ${hasSemifinals ? state.semifinals.map(sf => {
            const p1 = getPlayer(sf.p1); const p2 = getPlayer(sf.p2);
            const res = sf.status === 'done'
              ? `<span class="panel-match-result">${escHtml(getPlayer(sf.winner).name)}</span>`
              : `<span class="badge badge-gold">Pendente</span>`;
            return `<div class="panel-match-item">
              <span class="panel-match-players"><strong>${escHtml(sf.label)}:</strong> ${escHtml(p1.name)} vs ${escHtml(p2.name)}</span>
              ${res}
            </div>`;
          }).join('') : ''}
          ${hasFinal ? (() => {
            const f = state.final;
            const fp1 = getPlayer(f.p1); const fp2 = getPlayer(f.p2);
            const res = f.status === 'done'
              ? `<span class="panel-match-result">🏆 ${escHtml(getPlayer(f.winner).name)}</span>`
              : `<span class="badge badge-gold">Pendente</span>`;
            return `<div class="panel-match-item" style="border-top:1px solid var(--border);margin-top:.5rem;padding-top:.5rem">
              <span class="panel-match-players"><strong>FINAL:</strong> ${escHtml(fp1.name)} vs ${escHtml(fp2.name)}</span>
              ${res}
            </div>`;
          })() : ''}
        </div>
      </div>
    `;
  }

  let championSection = '';
  if (state.champion) {
    championSection = `
      <div class="panel-section" style="border-color:var(--gold-dim);grid-column:1/-1">
        <div class="panel-section-header" style="color:var(--gold)">🏆 CAMPEÃO DO TORNEIO</div>
        <div class="panel-section-body" style="display:flex;gap:2rem;flex-wrap:wrap;align-items:center">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:2.5rem;letter-spacing:.05em;color:var(--gold)">
            ${escHtml(getPlayer(state.champion).name)}
          </div>
          <div style="color:var(--text-dim)">Vice-campeão: <strong>${escHtml(getPlayer(state.runnerUp).name)}</strong></div>
        </div>
      </div>
    `;
  }

  // As tabelas de classificação só existem para os grupos que de fato
  // são usados no formato atual do torneio: nenhuma no formato direto
  // (2 jogadores), apenas o Grupo A no formato de grupo único (3
  // jogadores), e ambos os grupos a partir de 4 jogadores.
  let standingsSection = '';
  if (format === 'single') {
    standingsSection = `
      <div class="panel-section">
        <div class="panel-section-header">📊 Classificação — Grupo A</div>
        <div class="panel-section-body">${renderStanding('A')}</div>
      </div>
    `;
  } else if (format === 'groups') {
    standingsSection = `
      <div class="panel-section">
        <div class="panel-section-header">📊 Classificação — Grupo A</div>
        <div class="panel-section-body">${renderStanding('A')}</div>
      </div>
      <div class="panel-section">
        <div class="panel-section-header">📊 Classificação — Grupo B</div>
        <div class="panel-section-body">${renderStanding('B')}</div>
      </div>
    `;
  }

  return `
    <div class="panel-grid">
      ${standingsSection}
      <div class="panel-section">
        <div class="panel-section-header">✅ Partidas Concluídas (${doneMatches.length})</div>
        <div class="panel-section-body">
          ${doneMatches.length ? doneMatches.map(matchItem).join('') : '<p class="empty-state">Nenhuma partida concluída.</p>'}
        </div>
      </div>
      <div class="panel-section">
        <div class="panel-section-header">⏳ Partidas Pendentes (${pendingMatches.length})</div>
        <div class="panel-section-body">
          ${pendingMatches.length ? pendingMatches.map(matchItem).join('') : '<p class="empty-state">Todas as partidas concluídas!</p>'}
        </div>
      </div>
      ${bracketSection}
      ${championSection}
    </div>
  `;
}

// ============================================================
// PROGRESS BAR
// ============================================================
function updateProgress() {
  const wrap = document.getElementById('progress-wrap');
  const bar  = document.getElementById('progress-bar');
  const lbl  = document.getElementById('progress-label');
  const sub  = document.getElementById('tournament-subtitle');

  if (!state.groupsConfirmed) { wrap.style.display = 'none'; return; }

  wrap.style.display = 'flex';

  const format     = getTournamentFormat();
  const groupDone  = state.matches.filter(m => m.status === 'done').length;
  const groupTotal = state.matches.length;
  const sfDone     = state.semifinals.filter(s => s.status === 'done').length;
  const finDone    = state.final?.status === 'done' ? 1 : 0;
  const total      = getTotalMatchesCount();
  const done       = groupDone + sfDone + finDone;
  const pct        = total > 0 ? Math.round((done / total) * 100) : 0;

  bar.style.width = pct + '%';
  lbl.textContent = pct + '%';

  if (state.phase === 'done') sub.textContent = `🏆 Campeão: ${getPlayer(state.champion).name}`;
  else if (state.phase === 'bracket') sub.textContent = format === 'direct' ? 'Final direta' : 'Fase eliminatória';
  else sub.textContent = `Fase de grupos — ${groupDone}/${groupTotal} partidas`;
}

// ============================================================
// RESET
// ============================================================
function resetTournament() {
  localStorage.removeItem(LS_KEY);
  state = {
    phase: 'setup', players: [], groups: { A: [], B: [] },
    groupsConfirmed: false, matches: [], semifinals: [],
    final: null, champion: null, runnerUp: null,
    tiebreakSeed: Date.now(),
  };
  saveState();
  document.getElementById('tournament-subtitle').textContent = 'Configure seu torneio';
  document.getElementById('progress-wrap').style.display = 'none';
  // Restaura os botões de composição de grupos, que ficam ocultos após a
  // confirmação dos grupos de um torneio anterior.
  document.getElementById('btn-shuffle-groups').style.display = '';
  document.getElementById('btn-confirm-groups').style.display = '';
  switchTab('setup');
  renderSetup();
  showToast('Torneio reiniciado.');
}

// ============================================================
// EXPORT PDF
// ============================================================
function exportPDF() {
  // Switch to panel for printing, then restore
  switchTab('panel');
  setTimeout(() => {
    window.print();
  }, 300);
}

// ============================================================
// ESCAPE HTML
// ============================================================
function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ============================================================
// INIT & EVENT BINDING
// ============================================================
function init() {
  loadState();

  // ---- Tab nav ----
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // ---- Player add ----
  const nameInput = document.getElementById('player-name-input');
  document.getElementById('btn-add-player').addEventListener('click', () => {
    addPlayer(nameInput.value);
    nameInput.value = '';
    nameInput.focus();
  });
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      addPlayer(nameInput.value);
      nameInput.value = '';
    }
  });

  // ---- Player remove (event delegation) ----
  document.getElementById('player-list').addEventListener('click', e => {
    const id = e.target.dataset.remove;
    if (id) removePlayer(id);
  });

  // ---- Start tournament ----
  document.getElementById('btn-start-tournament').addEventListener('click', () => {
    if (state.players.length < MIN_PLAYERS) return;

    const format = getTournamentFormat();

    if (format === 'direct') {
      // 2 jogadores: sem fase de grupos, vão direto para a Grande Final.
      autoAssignGroups(); // limpa os grupos (não utilizados nesse formato)
      const [p1, p2] = shuffle(state.players.map(p => p.id), state.tiebreakSeed + Date.now());
      state.matches = [];
      state.semifinals = [];
      state.final = {
        id: uid(),
        label: 'GRANDE FINAL',
        p1,
        p2,
        winner: null,
        status: 'pending',
      };
      state.groupsConfirmed = true;
      state.phase = 'bracket';
      saveState();
      updateGroupsTab();
      renderMatches();
      renderBracket();
      renderPanel();
      updateProgress();
      switchTab('bracket');
      showToast('🏆 Final direta gerada! Boa sorte aos finalistas.');
      return;
    }

    state.phase = 'groups';
    autoAssignGroups();
    saveState();
    renderGroups();
    switchTab('groups');
    showToast('Grupos sorteados! Confirme ou reordene os grupos.');
  });

  // ---- Shuffle groups ----
  document.getElementById('btn-shuffle-groups').addEventListener('click', () => {
    state.tiebreakSeed = Date.now();
    autoAssignGroups();
    saveState();
    renderGroups();
    showToast('Grupos sorteados novamente.');
  });

  // ---- Confirm groups ----
  document.getElementById('btn-confirm-groups').addEventListener('click', () => {
    state.groupsConfirmed = true;
    generateGroupMatches();
    saveState();
    updateGroupsTab();
    renderMatches();
    updateProgress();
    switchTab('matches');
    showToast('Grupos confirmados! Partidas geradas.');
  });

  // ---- Matches filter ----
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderMatches();
    });
  });

  // ---- Reset ----
  document.getElementById('btn-reset').addEventListener('click', () => {
    confirm(
      'Reiniciar Torneio',
      'Todos os dados serão apagados permanentemente. Deseja continuar?',
      resetTournament
    );
  });

  // ---- TV Mode ----
  document.getElementById('btn-tv-mode').addEventListener('click', () => {
    renderPanel();
    document.getElementById('tv-overlay').style.display = 'flex';
  });
  document.getElementById('btn-exit-tv').addEventListener('click', () => {
    document.getElementById('tv-overlay').style.display = 'none';
  });

  // ---- Export PDF ----
  document.getElementById('btn-export-pdf').addEventListener('click', exportPDF);

  // ---- Close champion modal ----
  document.getElementById('btn-close-champion').addEventListener('click', () => {
    document.getElementById('champion-modal').style.display = 'none';
    switchTab('bracket');
  });

  // ---- Restore state ----
  if (state.players.length) renderSetup();

  if (state.groupsConfirmed) {
    // Show standings in groups tab
    updateGroupsTab();
    renderMatches();
    updateProgress();
    renderBracket();
    renderPanel();

    // Show champion modal if needed
    if (state.champion) {
      // Don't auto-show on reload, just update UI
    }

    // Switch to appropriate tab
    if (state.phase === 'done' || state.phase === 'bracket') {
      switchTab('bracket');
    } else if (state.phase === 'matches') {
      switchTab('matches');
    } else {
      switchTab('groups');
    }
  } else if (state.phase === 'groups') {
    renderGroups();
    switchTab('groups');
  }
}

// Start when DOM is ready
document.addEventListener('DOMContentLoaded', init);
