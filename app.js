/**
 * MY CRICK - Local Cricket Manager PWA
 * Full ball-by-ball scoring engine with match history
 */

// ============================================================
//  GLOBAL STATE
// ============================================================
const DB_KEY   = 'myCrick_matches';
const ST_KEY   = 'myCrick_state';
const CFG_KEY  = 'myCrick_config';
const PLAYERS_KEY = 'myCrick_registered_players';
const TEAMS_KEY   = 'myCrick_saved_teams';
let _isFromSetup = false;

let state = null;              // Live match state
let config = {};               // App settings
let viewingHistoryMatch = null; // Set when viewing a history match's scorecard
let viewingOverIdx = null;     // Index of past over being viewed (null = current live over)

// ============================================================
//  STORAGE HELPERS
// ============================================================
const load = (k)          => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const save = (k, v)       => localStorage.setItem(k, JSON.stringify(v));
const loadMatches = ()    => load(DB_KEY) || [];
const saveMatches = (m)   => save(DB_KEY, m);
const saveState   = ()    => save(ST_KEY, state);
const clearState  = ()    => localStorage.removeItem(ST_KEY);

// ============================================================
//  APP INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  config = load(CFG_KEY) || { sound: true, vibration: true, autoRotate: true };
  applyConfig();

  // Restore live match from storage
  const savedState = load(ST_KEY);
  if (savedState && !savedState.matchOver) {
    state = savedState;
    showToast('🏏 Match restored!', '');
    renderHomeScreen();
    renderScoringScreen();
    navigate('home');
  } else {
    state = null;
    navigate('home');
  }

  registerServiceWorker();
  setupPWAInstall();
  setupEventListeners();
  populateMatchDate();
  populateTeamDropdowns();
});

function applyConfig() {
  document.getElementById('setting-sound').checked     = config.sound;
  document.getElementById('setting-vibration').checked = config.vibration;
  document.getElementById('setting-auto-rotate').checked = config.autoRotate !== false;
  const autoOverEl = document.getElementById('setting-auto-rotate-over');
  if (autoOverEl) autoOverEl.checked = config.autoRotateOver !== false;
}

function setupEventListeners() {
  // Settings toggles
  document.getElementById('setting-sound').addEventListener('change', e => { config.sound = e.target.checked; save(CFG_KEY, config); });
  document.getElementById('setting-vibration').addEventListener('change', e => { config.vibration = e.target.checked; save(CFG_KEY, config); });
  document.getElementById('setting-auto-rotate').addEventListener('change', e => { config.autoRotate = e.target.checked; save(CFG_KEY, config); });
  document.getElementById('setting-auto-rotate-over')?.addEventListener('change', e => { config.autoRotateOver = e.target.checked; save(CFG_KEY, config); });

  // Clear data button — use event listener so it works regardless of onclick scope
  document.getElementById('btn-clear-data').addEventListener('click', clearAllData);

  // New Match flow
  document.getElementById('btn-new-match').addEventListener('click', () => navigate('new-match'));
  document.getElementById('btn-player-registration')?.addEventListener('click', () => openPlayerRegistrationModal(false));
  document.getElementById('reg-player-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitNewPlayer();
    }
  });
  document.getElementById('btn-back-home').addEventListener('click', () => navigate('home'));
  document.getElementById('btn-step0-next').addEventListener('click', step0Next);
  document.getElementById('btn-step1-back').addEventListener('click', () => setSetupStep(0));
  document.getElementById('btn-step1-next').addEventListener('click', step1Next);
  document.getElementById('btn-step2-back').addEventListener('click', () => setSetupStep(1));
  document.getElementById('btn-start-match').addEventListener('click', startNewMatch);

  // Scoring screen
  document.getElementById('btn-change-bowler').addEventListener('click', () => openBowlerModal(false));
  document.getElementById('bowler-card').addEventListener('click', (e) => { if (e.target.id !== 'btn-change-bowler') openBowlerModal(false); });
  document.getElementById('btn-change-batsman').addEventListener('click', () => {
    if (!state) return;
    const inn = currentInnings();
    if (!inn) return;
    const openersBtn = document.getElementById('btn-change-openers-action');
    if (openersBtn) {
      openersBtn.style.display = inn.allBalls.length === 0 ? 'block' : 'none';
    }
    if (inn.allBalls.length === 0) {
      openOpeningBattersModal(false);
    } else {
      openModal('change-batter-modal');
    }
  });
  document.getElementById('btn-view-scorecard-live').addEventListener('click', () => { renderScorecard(state.currentInnings); navigate('scorecard'); });
  document.getElementById('btn-end-innings').addEventListener('click', handleEndInnings);
  document.getElementById('btn-return-scoring').addEventListener('click', () => navigate('scoring'));
  document.getElementById('btn-back-from-scorecard').addEventListener('click', () => { if (state && !state.matchOver) navigate('scoring'); else navigate('history'); });

  // History / quick buttons
  document.getElementById('btn-quick-history').addEventListener('click', () => navigate('history'));
  document.getElementById('btn-see-all-history').addEventListener('click', () => navigate('history'));
  document.getElementById('btn-settings').addEventListener('click', () => navigate('settings'));

  // Innings tabs
  document.querySelectorAll('.innings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.innings-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      // If viewing a history match, temporarily swap state so renderScorecard sees the right data
      const inningsIdx = parseInt(tab.dataset.innings);
      if (viewingHistoryMatch) {
        const prev = state;
        state = viewingHistoryMatch;
        renderScorecard(inningsIdx);
        state = prev;
      } else {
        renderScorecard(inningsIdx);
      }
    });
  });

  // Swipe / drag gestures for "This Over"
  setupThisOverGestures();
}

// ============================================================
//  NAVIGATION
// ============================================================
const SCREENS = ['home', 'new-match', 'scoring', 'scorecard', 'history', 'settings', 'stats'];

function navigate(screen) {
  SCREENS.forEach(s => {
    const el = document.getElementById(`screen-${s}`);
    if (el) el.classList.toggle('active', s === screen);
  });

  // Clear history-match view when leaving scorecard
  if (screen !== 'scorecard') viewingHistoryMatch = null;

  // Update bottom nav
  const navMap = { home: 'nav-home', scoring: 'nav-scoring', scorecard: 'nav-scorecard', stats: 'nav-stats', history: 'nav-history' };
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (navMap[screen]) document.getElementById(navMap[screen])?.classList.add('active');

  // Hide/show bottom nav on new-match & settings
  const hideNav = ['new-match', 'settings'];
  document.getElementById('bottom-nav').style.display = hideNav.includes(screen) ? 'none' : '';

  // Screen-specific render
  if (screen === 'home')      renderHomeScreen();
  if (screen === 'history')   renderHistoryScreen();
  if (screen === 'stats')     renderPlayerStatsScreen();
  if (screen === 'new-match') populateTeamDropdowns();
  if (screen === 'scorecard' && (state || viewingHistoryMatch)) {
    const matchToShow = viewingHistoryMatch || state;
    const hasTwo = matchToShow.innings.length > 1;
    document.getElementById('innings-tabs').style.display = hasTwo ? 'flex' : 'none';
    document.getElementById('btn-return-scoring').style.display = (state && !state.matchOver && !viewingHistoryMatch) ? '' : 'none';
    if (matchToShow.matchOver) renderResultCard();
  }
  if (screen === 'scoring' && state) {
    viewingOverIdx = null;
    renderScoringScreen();
  }
}

// ============================================================
//  SETUP STEPS
// ============================================================
let setupData = {};

function populateMatchDate() {
  const d = document.getElementById('match-date');
  if (d) d.value = new Date().toISOString().split('T')[0];
}

function setSetupStep(step) {
  for (let i = 0; i < 3; i++) {
    const el = document.getElementById(`setup-step-${i}`);
    if (el) el.style.display = i === step ? '' : 'none';
  }
  document.querySelectorAll('.step-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i === step);
    dot.classList.toggle('done', i < step);
  });
}

function step0Next() {
  const t1 = document.getElementById('team1-name').value.trim() || 'Team A';
  const t2 = document.getElementById('team2-name').value.trim() || 'Team B';
  const overs = parseInt(document.getElementById('match-overs').value) || 10;
  const numPlayers = parseInt(document.getElementById('players-per-side').value) || 11;
  const venue = document.getElementById('match-venue').value.trim();
  const date  = document.getElementById('match-date').value || new Date().toISOString().split('T')[0];

  if (!t1 || !t2) { showToast('⚠️', 'Please enter both team names'); return; }
  if (t1 === t2)  { showToast('⚠️', 'Team names must be different'); return; }
  if (overs < 1 || overs > 50) { showToast('⚠️', 'Overs must be between 1 and 50'); return; }

  // Check if saved teams were selected
  const teams = loadSavedTeams();
  const t1SelectVal = document.getElementById('team1-select')?.value;
  const t2SelectVal = document.getElementById('team2-select')?.value;

  const savedTeam1 = teams.find(t => t.id === t1SelectVal || t.name.toLowerCase() === t1.toLowerCase());
  const savedTeam2 = teams.find(t => t.id === t2SelectVal || t.name.toLowerCase() === t2.toLowerCase());

  setupData = { team1: t1, team2: t2, overs, numPlayers, venue, date };

  // Build player input fields, pre-filling from saved team if available
  buildPlayerInputs('team1-players-builder', t1, numPlayers, savedTeam1?.players);
  buildPlayerInputs('team2-players-builder', t2, numPlayers, savedTeam2?.players);
  document.getElementById('team1-players-title').textContent = `${t1} Players`;
  document.getElementById('team2-players-title').textContent = `${t2} Players`;
  document.getElementById('players-count-label').textContent = `${numPlayers} players`;

  setSetupStep(1);
}

function buildPlayerInputs(containerId, teamName, count, prefillList = null) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  const defaultNames = [
    'Player 1','Player 2','Player 3','Player 4','Player 5',
    'Player 6','Player 7','Player 8','Player 9','Player 10','Player 11'
  ];
  const regPlayers = loadRegisteredPlayers();

  // Top action bar
  const topBar = document.createElement('div');
  topBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;font-size:12px;flex-wrap:wrap;gap:6px';
  const isLoadedFromTeam = prefillList && prefillList.length > 0;
  topBar.innerHTML = `
    <span style="color:var(--text-muted);font-size:11px">${isLoadedFromTeam ? '🛡️ Loaded from Saved Team' : 'Pick from dropdown or type name'}</span>
    <div style="display:flex;gap:6px">
      ${regPlayers.length > 0 ? `<button type="button" class="btn btn-sm btn-secondary" onclick="quickFillSquad('${containerId}', ${count})" style="padding:3px 8px;font-size:11px" title="Auto-fill slots with registered players">⚡ Quick Fill</button>` : ''}
      <button type="button" class="btn btn-sm btn-secondary" onclick="openPlayerRegistrationModal(true)" style="padding:3px 8px;font-size:11px">+ Register</button>
      <button type="button" class="btn btn-sm btn-secondary" onclick="saveLineupAsTeam('${containerId}', '${teamName.replace(/'/g, "\\'")}')" style="padding:3px 8px;font-size:11px" title="Save this lineup to saved teams">💾 Save Team</button>
    </div>
  `;
  container.appendChild(topBar);

  for (let i = 0; i < count; i++) {
    const card = document.createElement('div');
    card.className = 'player-slot-card';
    card.id = `${containerId}-slot-${i}`;

    let optionsHtml = `<option value="">-- Choose from Registered (${regPlayers.length}) --</option>`;
    regPlayers.forEach(p => {
      const roleIcon = p.role === 'Batsman' ? '🏏' : p.role === 'Bowler' ? '🎳' : p.role === 'Wicket-Keeper' ? '🧤' : '⚡';
      optionsHtml += `<option value="${p.name}">${roleIcon} ${p.name} (${p.role || 'Player'})</option>`;
    });

    const prefillVal = prefillList && prefillList[i] ? (typeof prefillList[i] === 'string' ? prefillList[i] : prefillList[i].name) : '';

    card.innerHTML = `
      <div class="player-slot-card-top">
        <div class="player-num">${i+1}</div>
        <select class="form-select player-dropdown-select" data-idx="${i}" onchange="onPlayerDropdownSelect(this, '${containerId}', ${i})">
          ${optionsHtml}
        </select>
      </div>
      <input class="form-input player-name-input" type="text" placeholder="${defaultNames[i] || `Player ${i+1}`}" maxlength="25" data-idx="${i}" value="${prefillVal.replace(/"/g, '&quot;')}" />
    `;
    container.appendChild(card);

    if (prefillVal) {
      const selectEl = card.querySelector('.player-dropdown-select');
      if (selectEl) selectEl.value = prefillVal;
    }
  }
}

function saveLineupAsTeam(containerId, teamName) {
  const inputs = document.querySelectorAll(`#${containerId} .player-name-input`);
  const players = [];
  inputs.forEach(inp => {
    const val = inp.value.trim();
    if (val) players.push(val);
  });
  if (!teamName) {
    showToast('⚠️', 'Team name missing');
    return;
  }
  const teams = loadSavedTeams();
  const existingIdx = teams.findIndex(t => t.name.toLowerCase() === teamName.toLowerCase());
  if (existingIdx !== -1) {
    teams[existingIdx].players = players;
    teams[existingIdx].updatedAt = new Date().toISOString();
  } else {
    teams.push({
      id: 'team_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      name: teamName,
      players: players,
      createdAt: new Date().toISOString()
    });
  }
  saveSavedTeams(teams);
  populateTeamDropdowns();
  showToast('💾', `Lineup saved to team "${teamName}" (${players.length} players)`);
}

function onPlayerDropdownSelect(selectEl, containerId, idx) {
  const slotCard = document.getElementById(`${containerId}-slot-${idx}`);
  if (!slotCard) return;
  const inputEl = slotCard.querySelector('.player-name-input');
  if (!inputEl) return;

  const val = selectEl.value;
  if (val) {
    inputEl.value = val;
    inputEl.classList.add('populated-flash');
    setTimeout(() => inputEl.classList.remove('populated-flash'), 600);
  }
}

function quickFillSquad(containerId, count) {
  const regPlayers = loadRegisteredPlayers();
  if (regPlayers.length === 0) {
    showToast('ℹ️', 'No registered players found');
    return;
  }
  const inputs = document.querySelectorAll(`#${containerId} .player-name-input`);
  const selects = document.querySelectorAll(`#${containerId} .player-dropdown-select`);

  let filledCount = 0;
  inputs.forEach((inp, i) => {
    if (i < regPlayers.length) {
      inp.value = regPlayers[i].name;
      if (selects[i]) selects[i].value = regPlayers[i].name;
      inp.classList.add('populated-flash');
      setTimeout(() => inp.classList.remove('populated-flash'), 600);
      filledCount++;
    }
  });
  showToast('⚡', `Filled ${filledCount} players`);
}

function refreshPlayerDropdowns(containerId) {
  const regPlayers = loadRegisteredPlayers();
  const selects = document.querySelectorAll(`#${containerId} .player-dropdown-select`);
  selects.forEach(selectEl => {
    const currentVal = selectEl.value;
    let optionsHtml = `<option value="">-- Choose from Registered (${regPlayers.length}) --</option>`;
    regPlayers.forEach(p => {
      const roleIcon = p.role === 'Batsman' ? '🏏' : p.role === 'Bowler' ? '🎳' : p.role === 'Wicket-Keeper' ? '🧤' : '⚡';
      optionsHtml += `<option value="${p.name}">${roleIcon} ${p.name} (${p.role || 'Player'})</option>`;
    });
    selectEl.innerHTML = optionsHtml;
    selectEl.value = currentVal;
  });
}

function getPlayerNames(builderId, count, prefix) {
  const inputs = document.querySelectorAll(`#${builderId} .player-name-input`);
  const names = [];
  inputs.forEach((inp, i) => {
    names.push(inp.value.trim() || `${prefix} P${i+1}`);
  });
  return names;
}

function step1Next() {
  setupData.team1Players = getPlayerNames('team1-players-builder', setupData.numPlayers, setupData.team1);
  setupData.team2Players = getPlayerNames('team2-players-builder', setupData.numPlayers, setupData.team2);

  // Toss options
  const tossOpts = document.getElementById('toss-winner-options');
  tossOpts.innerHTML = `
    <div class="toss-option" data-team="0" onclick="selectTossWinner(0)">${setupData.team1}</div>
    <div class="toss-option" data-team="1" onclick="selectTossWinner(1)">${setupData.team2}</div>
  `;
  setupData.tossWinner = null;
  setupData.tossDecision = null;
  setSetupStep(2);
}

function selectTossWinner(idx) {
  document.querySelectorAll('#toss-winner-options .toss-option').forEach((o,i) => o.classList.toggle('selected', i === idx));
  setupData.tossWinner = idx;
}
window.selectTossWinner = selectTossWinner;

function selectTossDecision(decision) {
  document.querySelectorAll('#toss-decision-group .toss-option').forEach(o => o.classList.toggle('selected', o.dataset.decision === decision));
  setupData.tossDecision = decision;
}
window.selectTossDecision = selectTossDecision;

// ============================================================
//  MATCH STATE CREATION
// ============================================================
function createInningsState(battingTeamIdx, bowlingTeamIdx) {
  const teams = [setupData.team1, setupData.team2];
  const players = [setupData.team1Players, setupData.team2Players];
  return {
    battingTeam:  battingTeamIdx,
    bowlingTeam:  bowlingTeamIdx,
    battingPlayers:  players[battingTeamIdx].map((name, i) => ({
      name, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, dismissal: '', fielder: '', notYetBatted: i >= 2
    })),
    bowlingPlayers:  players[bowlingTeamIdx].map((name, i) => ({
      name, overs: 0, balls: 0, runs: 0, wickets: 0, maidens: 0, wides: 0, noBalls: 0
    })),
    runs:      0,
    wickets:   0,
    overs:     0,
    balls:     0,  // legal balls in current over
    extras:    { wides: 0, noBalls: 0, legByes: 0, byes: 0 },
    allBalls:  [],              // full ball-by-ball log
    overs_log: [],              // [ [ball, ball,...] per over ]
    currentBatters: [0, 1],    // indices into battingPlayers
    strikerIdx:  0,             // which of currentBatters is striker
    currentBowlerIdx: null,
    completed: false
  };
}

function startNewMatch() {
  if (setupData.tossWinner === null || setupData.tossWinner === undefined) {
    showToast('⚠️', 'Please select toss winner'); return;
  }
  if (!setupData.tossDecision) {
    showToast('⚠️', 'Please select bat or bowl'); return;
  }

  const tossWon = setupData.tossWinner; // 0 or 1
  let battingFirst, bowlingFirst;
  if (setupData.tossDecision === 'bat') {
    battingFirst  = tossWon;
    bowlingFirst  = tossWon === 0 ? 1 : 0;
  } else {
    bowlingFirst  = tossWon;
    battingFirst  = tossWon === 0 ? 1 : 0;
  }

  state = {
    id:            Date.now().toString(),
    teams:         [setupData.team1, setupData.team2],
    players:       [setupData.team1Players, setupData.team2Players],
    maxOvers:      setupData.overs,
    numPlayers:    setupData.numPlayers,
    venue:         setupData.venue,
    date:          setupData.date,
    tossWinner:    setupData.team1 + (tossWon === 0 ? '' : setupData.team2),
    battingFirstIdx: battingFirst,
    innings:       [createInningsState(battingFirst, bowlingFirst)],
    currentInnings: 0,
    matchOver:     false,
    result:        null,
    startTime:     Date.now()
  };

  saveState();
  navigate('scoring');

  // Ask for opening batters first
  setTimeout(() => openOpeningBattersModal(true), 350);
}

// ============================================================
//  SCORING ENGINE
// ============================================================
function currentInnings() { return state.innings[state.currentInnings]; }

// Capture full state before every scoring action for 100% reliable undo
function takeSnapshot() {
  if (!state) return;
  if (!state.history) state.history = [];
  const { history, ...snapshot } = state;
  state.history.push(JSON.parse(JSON.stringify(snapshot)));
  if (state.history.length > 50) state.history.shift();
}

function recordBall(opts) {
  if (!state || state.matchOver) return;
  const inn = currentInnings();
  if (inn.completed) return;

  // 1. Guard: vacant batter slot?
  const vacantPos = inn.currentBatters.indexOf(-1);
  if (vacantPos !== -1) {
    showToast('⚠️', 'Select the incoming batsman first');
    openNewBatterModal(vacantPos);
    return;
  }

  // 2. Guard: bowler missing or restricted from consecutive overs?
  if (inn.currentBowlerIdx === null || inn.currentBowlerIdx === undefined) {
    showToast('⚠️', 'Select a bowler for this over first');
    openBowlerModal(true);
    return;
  }
  const lastBowler = getLastOverBowler();
  if (inn.overs > 0 && inn.balls === 0 && inn.currentBowlerIdx === lastBowler && inn.bowlingPlayers.length > 1) {
    showToast('⚠️', 'Bowler cannot bowl consecutive overs');
    openBowlerModal(true);
    return;
  }

  takeSnapshot();
  viewingOverIdx = null;

  const { runs = 0, extra = null } = opts;
  const isLegal = !extra || (extra === 'LegBye' || extra === 'Bye');
  const bowlerIdx = inn.currentBowlerIdx;
  const striker   = inn.currentBatters[inn.strikerIdx];

  // Exact over and ball number for THIS ball before over progresses
  const overNum = inn.overs;
  const ballInOver = isLegal ? inn.balls + 1 : inn.balls;

  // Build ball record
  const ball = { runs, extra, bowlerIdx, strikerIdx: striker, overNum, ballInOver, timestamp: Date.now() };

  // Update batting stats
  if (!extra || extra === 'LegBye' || extra === 'Bye') {
    inn.battingPlayers[striker].balls++;
  }
  if (!extra) {
    inn.battingPlayers[striker].runs += runs;
    if (runs === 4) inn.battingPlayers[striker].fours++;
    if (runs === 6) inn.battingPlayers[striker].sixes++;
  }

  // Update extras
  if (extra === 'Wide')   { inn.extras.wides++;   if (bowlerIdx !== null) inn.bowlingPlayers[bowlerIdx].wides++; }
  if (extra === 'NoBall') { inn.extras.noBalls++; if (bowlerIdx !== null) inn.bowlingPlayers[bowlerIdx].noBalls++; }
  if (extra === 'LegBye') { inn.extras.legByes += runs; }
  if (extra === 'Bye')    { inn.extras.byes    += runs; }

  // Total runs
  inn.runs += runs;

  // Update bowler runs
  if (bowlerIdx !== null) {
    inn.bowlingPlayers[bowlerIdx].runs += runs;
  }

  // Push ball to log
  inn.allBalls.push(ball);

  let overFinished = false;
  // Legal ball count & over completion
  if (isLegal) {
    inn.balls++;
    if (bowlerIdx !== null) inn.bowlingPlayers[bowlerIdx].balls++;

    // 1. Rotate strike on odd runs scored on THIS delivery (batters cross ends)
    if (runs % 2 === 1 && config.autoRotate !== false) {
      swapStrikeAuto();
    }

    // 2. Over complete?
    if (inn.balls === 6) {
      overFinished = true;
      inn.overs++;
      inn.balls = 0;
      if (bowlerIdx !== null) {
        inn.bowlingPlayers[bowlerIdx].overs++;
        inn.bowlingPlayers[bowlerIdx].balls = 0;
        // Check maiden
        const thisOverBalls = inn.allBalls.filter(b => b.bowlerIdx === bowlerIdx && b.overNum === overNum);
        const thisOverRuns  = thisOverBalls.reduce((s, b) => s + b.runs, 0);
        if (thisOverRuns === 0) inn.bowlingPlayers[bowlerIdx].maidens++;
      }
      inn.lastOverBowlerIdx = bowlerIdx;
      // Clear current bowler so next over MUST select a different bowler!
      inn.currentBowlerIdx = null;

      // Auto-swap strike between overs (ends change)
      if (config.autoRotateOver !== false) {
        swapStrikeAuto();
      }
    }
  }

  saveState();

  // Feedback
  if (runs === 6) { showToast('💥 SIX!', ''); vibrate([100,30,100,30,200]); }
  else if (runs === 4) { showToast('🔥 FOUR!', ''); vibrate([80,20,80]); }

  renderScoringScreen();
  checkInningsEnd();

  // If over finished and innings is still active, immediately prompt for new bowler
  if (overFinished && !inn.completed && !state.matchOver) {
    const nextStrikerName = (inn.currentBatters[inn.strikerIdx] >= 0)
      ? inn.battingPlayers[inn.currentBatters[inn.strikerIdx]].name
      : 'Next batter';
    showToast('🔔 OVER COMPLETE', `${nextStrikerName} is on strike`);
    openBowlerModal(true);
  }
}

function recordWicket(opts) {
  if (!state || state.matchOver) return;
  const inn = currentInnings();
  if (inn.completed) return;

  // 1. Guard: vacant batter slot?
  const vacantPos = inn.currentBatters.indexOf(-1);
  if (vacantPos !== -1) {
    showToast('⚠️', 'Select the incoming batsman first');
    openNewBatterModal(vacantPos);
    return;
  }

  // 2. Guard: bowler missing or restricted from consecutive overs?
  if (inn.currentBowlerIdx === null || inn.currentBowlerIdx === undefined) {
    showToast('⚠️', 'Select a bowler for this over first');
    openBowlerModal(true);
    return;
  }
  const lastBowler = getLastOverBowler();
  if (inn.overs > 0 && inn.balls === 0 && inn.currentBowlerIdx === lastBowler && inn.bowlingPlayers.length > 1) {
    showToast('⚠️', 'Bowler cannot bowl consecutive overs');
    openBowlerModal(true);
    return;
  }

  takeSnapshot();
  viewingOverIdx = null;

  const { batsmanOut, dismissal, fielder, runs = 0, bowlerIdx } = opts;
  const strikerAtCrease = inn.currentBatters[inn.strikerIdx];
  const bwlr = bowlerIdx !== null ? bowlerIdx : inn.currentBowlerIdx;
  const isStrikerOut = (batsmanOut === strikerAtCrease);

  // Exact over and ball number for this ball
  const overNum = inn.overs;
  const ballInOver = inn.balls + 1; // Legal delivery

  // Mark batsman out
  inn.battingPlayers[batsmanOut].out       = true;
  inn.battingPlayers[batsmanOut].dismissal = dismissal;
  inn.battingPlayers[batsmanOut].fielder   = fielder || '';

  // The batsman facing at striker's end faced the delivery
  if (strikerAtCrease >= 0) {
    inn.battingPlayers[strikerAtCrease].balls++;
    if (runs > 0) inn.battingPlayers[strikerAtCrease].runs += runs;
  }

  // Bowler stats: Bowler gets the wicket UNLESS Run Out or Retired
  if (bwlr !== null) {
    if (dismissal !== 'Run Out' && dismissal !== 'Retired') {
      inn.bowlingPlayers[bwlr].wickets++;
    }
    inn.bowlingPlayers[bwlr].runs += runs;
    inn.bowlingPlayers[bwlr].balls++;
  }

  inn.wickets++;
  inn.runs += runs;
  inn.balls++;

  const ball = {
    runs,
    wicket: true,
    dismissal,
    fielder,
    bowlerIdx: bwlr,
    strikerIdx: strikerAtCrease,
    batsmanOut,
    overNum,
    ballInOver,
    timestamp: Date.now()
  };
  inn.allBalls.push(ball);

  // 1. If odd runs were completed before run-out, batters crossed ends
  let battersCrossed = false;
  if (runs % 2 === 1 && config.autoRotate !== false) {
    battersCrossed = true;
    swapStrikeAuto();
  }

  // 2. Over complete?
  let overFinished = false;
  if (inn.balls === 6) {
    overFinished = true;
    inn.overs++;
    inn.balls = 0;
    if (bwlr !== null) {
      inn.bowlingPlayers[bwlr].overs++;
      inn.bowlingPlayers[bwlr].balls = 0;
      const thisOverBalls = inn.allBalls.filter(b => b.bowlerIdx === bwlr && b.overNum === overNum);
      const thisOverRuns  = thisOverBalls.reduce((s, b) => s + b.runs, 0);
      if (thisOverRuns === 0) inn.bowlingPlayers[bwlr].maidens++;
    }
    inn.lastOverBowlerIdx = bwlr;
    inn.currentBowlerIdx = null;

    // Auto-swap strike between overs (ends change)
    if (config.autoRotateOver !== false) {
      swapStrikeAuto();
    }
  }

  showToast('🔴 WICKET!', `${inn.battingPlayers[batsmanOut].name} — ${dismissal}`);
  vibrate([200, 50, 200]);

  // Vacate the dismissed batsman's position in currentBatters
  const outPos = inn.currentBatters.indexOf(batsmanOut);
  if (outPos !== -1) {
    inn.currentBatters[outPos] = -1;
  }

  // Determine who takes strike when the incoming batsman enters:
  if (overFinished) {
    // If over finished on this ball, the not-out batter faces the first ball of the next over!
    window._newBatterTakesStrike = false;
  } else {
    // Over did not finish:
    if (isStrikerOut) {
      // Striker was dismissed. If batters crossed, partner faces; otherwise new batter takes strike.
      window._newBatterTakesStrike = !battersCrossed;
    } else {
      // Non-striker was dismissed. If batters crossed, new batter takes strike; otherwise striker stays on strike.
      window._newBatterTakesStrike = battersCrossed;
    }
  }

  saveState();
  checkInningsEnd();
  renderScoringScreen();

  // If innings not complete, prompt for incoming batsman
  if (!inn.completed && !state.matchOver) {
    if (outPos !== -1) {
      openNewBatterModal(outPos);
    } else if (overFinished) {
      const nextStrikerName = (inn.currentBatters[inn.strikerIdx] >= 0)
        ? inn.battingPlayers[inn.currentBatters[inn.strikerIdx]].name
        : 'Next batter';
      showToast('🔔 OVER COMPLETE', `${nextStrikerName} is on strike`);
      openBowlerModal(true);
    }
  }
}

function undoLastBall() {
  if (!state || state.matchOver) return;
  if (!state.history || state.history.length === 0) {
    showToast('ℹ️', 'Nothing to undo');
    return;
  }

  const historyStack = state.history;
  const prevState = historyStack.pop();
  state = prevState;
  state.history = historyStack;
  viewingOverIdx = null;

  // Close modals that might have opened
  closeModal('new-batter-modal');
  closeModal('new-bowler-modal');
  closeModal('wicket-modal');

  saveState();
  renderScoringScreen();
  showToast('↶', 'Last ball undone (wicket & strike restored)');
  vibrate(50);
}

// ============================================================
//  OVER / INNINGS MANAGEMENT
// ============================================================
function swapStrikeAuto() {
  if (!state) return;
  const inn = currentInnings();
  inn.strikerIdx = inn.strikerIdx === 0 ? 1 : 0;
}
window.swapStrike = function() {
  swapStrikeAuto();
  closeModal('change-batter-modal');
  renderScoringScreen();
  saveState();
};

function checkInningsEnd() {
  if (!state) return;
  const inn = currentInnings();
  if (inn.completed) return;

  const allOut   = inn.wickets >= state.numPlayers - 1;
  const oversUp  = inn.overs >= state.maxOvers && inn.balls === 0 && (inn.allBalls.length > 0);
  const chasing  = state.currentInnings === 1;
  const target   = chasing && state.innings[0] ? state.innings[0].runs + 1 : Infinity;
  const won      = chasing && inn.runs >= target;

  if (won) {
    inn.completed = true;
    const wktLeft = (state.numPlayers - 1) - inn.wickets;
    finishMatch({ winner: state.teams[inn.battingTeam], by: `${wktLeft} wickets` });
    return;
  }

  if (allOut || oversUp) {
    if (state.currentInnings === 0) {
      inn.completed = true;
      openInningsEndModal();
    } else {
      inn.completed = true;
      // 2nd innings ended — determine result
      const diff = target - 1 - inn.runs;
      if (inn.runs >= target) {
        // Safety net: team 2 actually passed the target (should have been caught by `won` check above)
        const wktLeft = (state.numPlayers - 1) - inn.wickets;
        finishMatch({ winner: state.teams[inn.battingTeam], by: `${wktLeft} wickets` });
      } else if (diff === 0 || inn.runs === target - 1) {
        finishMatch({ winner: 'Tie', by: 'Match tied' });
      } else {
        finishMatch({ winner: state.teams[state.innings[0].battingTeam], by: `${diff} runs` });
      }
    }
  }
}

function openInningsEndModal() {
  const inn   = currentInnings();
  const team  = state.teams[inn.battingTeam];
  const score = `${inn.runs}/${inn.wickets}`;
  document.getElementById('innings-end-title').textContent = '1st Innings Complete!';
  document.getElementById('innings-end-subtitle').textContent = `${team} scored ${score} in ${formatOvers(inn.overs, inn.balls)} overs`;
  openModal('innings-end-modal');
  saveState();
}

function startSecondInnings() {
  if (!state) return;
  closeModal('innings-end-modal');
  const inn0 = state.innings[0];
  const battingNow  = inn0.bowlingTeam;
  const bowlingNow  = inn0.battingTeam;
  state.innings.push(createInningsState(battingNow, bowlingNow));
  state.currentInnings = 1;
  saveState();
  renderScoringScreen();
  navigate('scoring');
  // Ask for 2nd innings opening batters first
  setTimeout(() => openOpeningBattersModal(true), 350);
}

function finishMatch(result) {
  state.matchOver = true;
  state.result    = result;
  state.endTime   = Date.now();

  // Save to history
  const matches = loadMatches();
  matches.unshift(buildMatchRecord());
  saveMatches(matches);
  clearState();

  saveState();

  // Show result modal
  document.getElementById('match-result-emoji').textContent = result.winner === 'Tie' ? '🤝' : '🏆';
  document.getElementById('match-end-headline').textContent = result.winner === 'Tie' ? "It's a Tie!" : `${result.winner} Won!`;
  document.getElementById('match-end-by').textContent = `by ${result.by}`;
  openModal('match-end-modal');
}

function viewMatchScorecard() {
  closeModal('match-end-modal');
  renderScorecard(0);
  navigate('scorecard');
}

function endMatch() {
  closeModal('match-end-modal');
  state = null;
  navigate('home');
}

// ============================================================
//  BOWLER MODAL
// ============================================================
function openBowlerModal(required) {
  if (!state) return;
  const inn = currentInnings();
  const list = document.getElementById('new-bowler-list');
  list.innerHTML = '';
  window._bowlerRequired = !!required;
  window._selectedBowlerIdx = null;

  const lastBowlerIdx = getLastOverBowler();
  // Restrict same bowler from bowling consecutive overs
  const canRestrict = inn.bowlingPlayers.length > 1 && lastBowlerIdx !== -1 && inn.overs > 0;

  inn.bowlingPlayers.forEach((p, i) => {
    const isRestricted = canRestrict && i === lastBowlerIdx;
    const item = document.createElement('div');
    item.className = `player-select-item ${isRestricted ? 'disabled' : ''}`;
    item.innerHTML = `
      <div class="player-jersey">${i + 1}</div>
      <div style="flex:1">
        <div class="player-select-name">
          ${p.name}
          ${isRestricted ? '<span style="font-size:11px;color:var(--accent-red);margin-left:6px;font-weight:600">Cannot bowl consecutive overs</span>' : ''}
        </div>
        <div style="font-size:12px;color:var(--text-muted)">${formatOvers(p.overs, p.balls)} ov  •  ${p.wickets}/${p.runs}</div>
      </div>
    `;
    if (!isRestricted) {
      item.addEventListener('click', () => {
        document.querySelectorAll('#new-bowler-list .player-select-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        window._selectedBowlerIdx = i;
      });
    }
    list.appendChild(item);
  });

  const cancelBtn = document.querySelector('#new-bowler-modal button.btn-secondary');
  if (cancelBtn) {
    cancelBtn.style.display = required ? 'none' : '';
  }

  openModal('new-bowler-modal');
}

function getLastOverBowler() {
  if (!state) return -1;
  const inn = currentInnings();
  if (!inn || inn.overs === 0) return -1;
  if (inn.lastOverBowlerIdx !== undefined && inn.lastOverBowlerIdx !== null) {
    return inn.lastOverBowlerIdx;
  }
  // Fallback: look for the bowler of the previous completed over
  for (let i = inn.allBalls.length - 1; i >= 0; i--) {
    const b = inn.allBalls[i];
    if (b.overNum === inn.overs - 1 && b.bowlerIdx !== null && b.bowlerIdx !== undefined) {
      return b.bowlerIdx;
    }
  }
  return -1;
}

function confirmNewBowler() {
  if (window._selectedBowlerIdx === null) {
    showToast('⚠️', 'Select a bowler');
    return;
  }
  const inn = currentInnings();
  const lastBowlerIdx = getLastOverBowler();
  if (inn.bowlingPlayers.length > 1 && window._selectedBowlerIdx === lastBowlerIdx && inn.overs > 0) {
    showToast('⚠️', 'Bowler cannot bowl consecutive overs');
    return;
  }
  inn.currentBowlerIdx = window._selectedBowlerIdx;
  closeModal('new-bowler-modal');
  saveState();
  renderScoringScreen();
  showToast('🎳', `${inn.bowlingPlayers[inn.currentBowlerIdx].name} is bowling`);
}
window.confirmNewBowler = confirmNewBowler;

// ============================================================
//  OPENING BATTERS MODAL
// ============================================================
function openOpeningBattersModal(required) {
  if (!state) return;
  const inn = currentInnings();
  if (!inn) return;

  const teamName = state.teams[inn.battingTeam];
  const subtitle = document.getElementById('opening-batters-subtitle');
  if (subtitle) {
    subtitle.textContent = `Select ${teamName}'s opening pair`;
  }

  const strikerSel = document.getElementById('select-striker');
  const nonStrikerSel = document.getElementById('select-non-striker');
  if (!strikerSel || !nonStrikerSel) return;

  strikerSel.innerHTML = '';
  nonStrikerSel.innerHTML = '';

  const currentStriker = (inn.currentBatters && inn.currentBatters[0] >= 0) ? inn.currentBatters[0] : 0;
  const currentNonStriker = (inn.currentBatters && inn.currentBatters[1] >= 0) ? inn.currentBatters[1] : 1;

  inn.battingPlayers.forEach((p, idx) => {
    // Only players who haven't already batted and been dismissed
    if (p.out) return;

    const opt1 = document.createElement('option');
    opt1.value = idx;
    opt1.textContent = `${idx + 1}. ${p.name}`;
    if (idx === currentStriker) opt1.selected = true;
    strikerSel.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = idx;
    opt2.textContent = `${idx + 1}. ${p.name}`;
    if (idx === currentNonStriker) opt2.selected = true;
    nonStrikerSel.appendChild(opt2);
  });

  // Cancel button display
  const cancelBtn = document.getElementById('btn-cancel-opening-batters');
  if (cancelBtn) {
    cancelBtn.style.display = required ? 'none' : '';
  }

  window._openingBattersRequired = !!required;
  openModal('opening-batters-modal');
}
window.openOpeningBattersModal = openOpeningBattersModal;

function confirmOpeningBatters() {
  if (!state) return;
  const inn = currentInnings();
  if (!inn) return;

  const strikerSel = document.getElementById('select-striker');
  const nonStrikerSel = document.getElementById('select-non-striker');
  if (!strikerSel || !nonStrikerSel) return;

  const strikerIdx = parseInt(strikerSel.value);
  const nonStrikerIdx = parseInt(nonStrikerSel.value);

  if (isNaN(strikerIdx) || isNaN(nonStrikerIdx)) {
    showToast('⚠️', 'Please select both opening batsmen');
    return;
  }

  if (strikerIdx === nonStrikerIdx && inn.battingPlayers.length > 1) {
    showToast('⚠️', 'Striker and Non-Striker must be different players');
    return;
  }

  // Update current batters
  inn.currentBatters = [strikerIdx, nonStrikerIdx];
  inn.strikerIdx = 0; // First element is striker

  // Update notYetBatted flags
  inn.battingPlayers.forEach((p, i) => {
    p.notYetBatted = !inn.currentBatters.includes(i);
  });

  closeModal('opening-batters-modal');
  saveState();
  renderScoringScreen();

  const strikerName = inn.battingPlayers[strikerIdx].name;
  const nonStrikerName = inn.battingPlayers[nonStrikerIdx].name;
  showToast('🏏', `Openers: ${strikerName} & ${nonStrikerName}`);

  // If opening bowler hasn't been chosen yet, prompt for bowler next
  if (inn.currentBowlerIdx === null || inn.currentBowlerIdx === undefined) {
    setTimeout(() => openBowlerModal(true), 350);
  }
}
window.confirmOpeningBatters = confirmOpeningBatters;

// ============================================================
//  BATTER MODAL
// ============================================================
function openNewBatterModal(posToFill) {
  if (!state) return;
  const inn = currentInnings();
  const list = document.getElementById('new-batter-list');
  list.innerHTML = '';
  window._newBatterPos    = posToFill;
  window._selectedBatter  = null;

  const available = inn.battingPlayers
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => !p.out && !inn.currentBatters.includes(i) && i !== -1);

  if (available.length === 0) { checkInningsEnd(); return; }

  document.getElementById('new-batter-subtitle').textContent = `Select the incoming batsman (${available.length} remaining)`;

  available.forEach(({ p, i }) => {
    const item = document.createElement('div');
    item.className = 'player-select-item';
    item.innerHTML = `
      <div class="player-jersey">${i + 1}</div>
      <div class="player-select-name">${p.name}</div>
    `;
    item.addEventListener('click', () => {
      document.querySelectorAll('#new-batter-list .player-select-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      window._selectedBatter = i;
    });
    list.appendChild(item);
  });

  openModal('new-batter-modal');
}

function confirmNewBatter() {
  if (window._selectedBatter === null) { showToast('⚠️', 'Select a batsman'); return; }
  const inn = currentInnings();
  inn.currentBatters[window._newBatterPos] = window._selectedBatter;

  // Determine strike:
  if (window._newBatterTakesStrike === false) {
    // Partner faces (the other slot)
    inn.strikerIdx = window._newBatterPos === 0 ? 1 : 0;
  } else {
    // New batter faces
    inn.strikerIdx = window._newBatterPos;
  }

  closeModal('new-batter-modal');
  saveState();
  renderScoringScreen();

  // If over had also completed on that wicket ball, prompt for the new bowler now
  if (inn.balls === 0 && inn.overs > 0 && inn.currentBowlerIdx === null && !inn.completed && !state.matchOver) {
    const nextStrikerName = (inn.currentBatters[inn.strikerIdx] >= 0)
      ? inn.battingPlayers[inn.currentBatters[inn.strikerIdx]].name
      : 'Next batter';
    showToast('🔔 OVER COMPLETE', `${nextStrikerName} is on strike`);
    setTimeout(() => openBowlerModal(true), 350);
  }
}
window.confirmNewBatter = confirmNewBatter;

// ============================================================
//  WICKET MODAL
// ============================================================
let wicketState = { dismissal: null, batsmanOut: null, fielder: null, runs: 0, batterSlot: 0 };

function openWicketModal() {
  if (!state || state.matchOver) return;
  const inn = currentInnings();
  if (inn.completed) return;

  // 1. Guard: vacant batter slot?
  const vacantPos = inn.currentBatters.indexOf(-1);
  if (vacantPos !== -1) {
    showToast('⚠️', 'Select the incoming batsman first');
    openNewBatterModal(vacantPos);
    return;
  }

  // 2. Guard: bowler missing or restricted from consecutive overs?
  if (inn.currentBowlerIdx === null || inn.currentBowlerIdx === undefined) {
    showToast('⚠️', 'Select a bowler for this over first');
    openBowlerModal(true);
    return;
  }
  const lastBowler = getLastOverBowler();
  if (inn.overs > 0 && inn.balls === 0 && inn.currentBowlerIdx === lastBowler && inn.bowlingPlayers.length > 1) {
    showToast('⚠️', 'Bowler cannot bowl consecutive overs');
    openBowlerModal(true);
    return;
  }

  const strikerIdx = inn.strikerIdx;
  const nonStrikerIdx = inn.strikerIdx === 0 ? 1 : 0;
  const strikerBatterIdx = inn.currentBatters[strikerIdx];
  const nonStrikerBatterIdx = inn.currentBatters[nonStrikerIdx];
  const strikerP = inn.battingPlayers[strikerBatterIdx];
  const nonStrikerP = inn.battingPlayers[nonStrikerBatterIdx];

  const roStrikerName = document.getElementById('ro-striker-name');
  const roStrikerStats = document.getElementById('ro-striker-stats');
  const roNonStrikerName = document.getElementById('ro-nonstriker-name');
  const roNonStrikerStats = document.getElementById('ro-nonstriker-stats');

  if (roStrikerName && strikerP) {
    roStrikerName.textContent = strikerP.name;
    roStrikerStats.textContent = `${strikerP.runs} (${strikerP.balls}b) • Striker`;
  }
  if (roNonStrikerName && nonStrikerP) {
    roNonStrikerName.textContent = nonStrikerP.name;
    roNonStrikerStats.textContent = `${nonStrikerP.runs} (${nonStrikerP.balls}b) • Non-Striker`;
  }

  wicketState = {
    dismissal: null,
    batsmanOut: strikerBatterIdx,
    fielder: null,
    runs: 0,
    batterSlot: 0
  };
  setWicketRuns(0);
  selectWicketBatter(0);

  // Populate fielder select
  const fldSel = document.getElementById('wicket-fielder');
  if (fldSel) {
    fldSel.innerHTML = '<option value="">—</option>';
    currentInnings().bowlingPlayers.forEach((p, i) => {
      const opt = document.createElement('option');
      opt.value = i; opt.textContent = p.name;
      fldSel.appendChild(opt);
    });
    fldSel.onchange = () => { wicketState.fielder = fldSel.options[fldSel.selectedIndex].text; };
  }

  // Reset selection & default to Bowled
  document.querySelectorAll('#wicket-types .wicket-type-btn').forEach(b => b.classList.remove('selected'));
  selectDismissal('Bowled');

  openModal('wicket-modal');
}
window.openWicketModal = openWicketModal;

function selectWicketBatter(cardIdx) {
  if (!state) return;
  const inn = currentInnings();
  if (!inn) return;

  const strikerBatterIdx = inn.currentBatters[inn.strikerIdx];
  const nonStrikerBatterIdx = inn.currentBatters[inn.strikerIdx === 0 ? 1 : 0];

  const strikerCard = document.getElementById('ro-striker-card');
  const nonStrikerCard = document.getElementById('ro-nonstriker-card');

  if (cardIdx === 0) {
    // Striker selected
    wicketState.batsmanOut = strikerBatterIdx;
    wicketState.batterSlot = 0;
    if (strikerCard) strikerCard.classList.add('selected');
    if (nonStrikerCard) nonStrikerCard.classList.remove('selected');
  } else {
    // Non-striker selected
    wicketState.batsmanOut = nonStrikerBatterIdx;
    wicketState.batterSlot = 1;
    if (strikerCard) strikerCard.classList.remove('selected');
    if (nonStrikerCard) nonStrikerCard.classList.add('selected');
  }
}
window.selectWicketBatter = selectWicketBatter;

function selectDismissal(type) {
  wicketState.dismissal = type;
  document.querySelectorAll('#wicket-types .wicket-type-btn').forEach(b => {
    b.classList.toggle('selected', b.textContent.includes(type.split(' ')[0]));
  });

  const headingEl = document.getElementById('wicket-batter-heading');
  const strikerCard = document.getElementById('ro-striker-card');
  const nonStrikerCard = document.getElementById('ro-nonstriker-card');
  const runsGroup = document.getElementById('wicket-runs-group');
  const fielderGroup = document.getElementById('fielder-group');
  const fielderLabel = document.getElementById('wicket-fielder-label');

  if (type === 'Run Out') {
    if (headingEl) headingEl.textContent = 'Which Batter is Run Out?';
    if (strikerCard) strikerCard.classList.remove('disabled');
    if (nonStrikerCard) nonStrikerCard.classList.remove('disabled');
    if (runsGroup) runsGroup.style.display = 'block';
    if (fielderGroup) fielderGroup.style.display = 'block';
    if (fielderLabel) fielderLabel.textContent = 'Fielder (Throw / Direct Hit)';
  } else if (type === 'Retired') {
    if (headingEl) headingEl.textContent = 'Which Batter is Retiring?';
    if (strikerCard) strikerCard.classList.remove('disabled');
    if (nonStrikerCard) nonStrikerCard.classList.remove('disabled');
    if (runsGroup) runsGroup.style.display = 'none';
    if (fielderGroup) fielderGroup.style.display = 'none';
    setWicketRuns(0);
  } else {
    // Bowled, Caught, LBW, Stumped, Hit Wicket, Caught Behind
    // In cricket, only the striker can be dismissed this way
    if (headingEl) headingEl.textContent = 'Batter Dismissed (Striker Facing)';
    selectWicketBatter(0); // auto-select striker
    if (strikerCard) strikerCard.classList.remove('disabled');
    if (nonStrikerCard) nonStrikerCard.classList.add('disabled');
    if (runsGroup) runsGroup.style.display = 'none';
    setWicketRuns(0);

    const needsFielder = (type === 'Caught' || type === 'Caught Behind' || type === 'Stumped');
    if (fielderGroup) fielderGroup.style.display = needsFielder ? 'block' : 'none';
    if (fielderLabel) fielderLabel.textContent = type === 'Stumped' ? 'Wicket-Keeper' : 'Fielder (Catch)';
  }
}
window.selectDismissal = selectDismissal;

function setWicketRuns(r) {
  wicketState.runs = r;
  document.querySelectorAll('#wicket-runs-selector button').forEach(b => {
    b.classList.toggle('selected', parseInt(b.textContent) === r);
  });
}
window.setWicketRuns = setWicketRuns;

function confirmWicket() {
  if (!wicketState.dismissal) { showToast('⚠️', 'Select a dismissal type'); return; }
  closeModal('wicket-modal');
  recordWicket({
    batsmanOut: wicketState.batsmanOut,
    dismissal:  wicketState.dismissal,
    fielder:    wicketState.fielder,
    runs:       wicketState.runs,
    bowlerIdx:  currentInnings().currentBowlerIdx
  });
}
window.confirmWicket = confirmWicket;

function handleEndInnings() {
  if (!state) return;
  if (state.currentInnings === 0) {
    currentInnings().completed = true;
    openInningsEndModal();
  } else {
    const inn = currentInnings();
    inn.completed = true;
    const target = state.innings[0].runs + 1;
    const diff = target - 1 - inn.runs;
    if (inn.runs >= target) {
      // Safety net: team 2 already won — should rarely happen via manual end
      const wktLeft = (state.numPlayers - 1) - inn.wickets;
      finishMatch({ winner: state.teams[inn.battingTeam], by: `${wktLeft} wickets` });
    } else if (inn.runs === target - 1) {
      finishMatch({ winner: 'Tie', by: 'Match tied' });
    } else {
      finishMatch({ winner: state.teams[state.innings[0].battingTeam], by: `${diff} runs` });
    }
  }
}

// ============================================================
//  RENDER SCORING SCREEN
// ============================================================
function renderScoringScreen() {
  if (!state) return;
  const inn = currentInnings();

  // Batting team
  document.getElementById('batting-team-name').textContent = state.teams[inn.battingTeam];
  document.getElementById('batting-score').innerHTML = `${inn.runs}<span class="wickets">/${inn.wickets}</span>`;
  document.getElementById('batting-overs-info').textContent = `${formatOvers(inn.overs, inn.balls)} ov`;

  // CRR
  const totalBalls = inn.overs * 6 + inn.balls;
  const crr = totalBalls > 0 ? ((inn.runs / totalBalls) * 6).toFixed(2) : '—';
  document.getElementById('crr-display').textContent = `CRR ${crr}`;

  // Bowling team / target
  document.getElementById('bowling-team-name').textContent = state.teams[inn.bowlingTeam];

  if (state.currentInnings === 1 && state.innings[0]) {
    const target = state.innings[0].runs + 1;
    const needed = target - inn.runs;
    const ballsLeft = (state.maxOvers * 6) - (inn.overs * 6 + inn.balls);
    const rrr = ballsLeft > 0 ? ((needed / ballsLeft) * 6).toFixed(2) : '—';
    document.getElementById('target-score').textContent = `T: ${target}`;
    document.getElementById('target-score').style.fontSize = '18px';
    document.getElementById('target-score').style.color = 'var(--accent-gold)';
    document.getElementById('chase-info').textContent = `Need ${needed} off ${ballsLeft}`;
    document.getElementById('target-row').style.display = '';
    document.getElementById('runs-needed').textContent  = needed;
    document.getElementById('balls-remaining').textContent = ballsLeft;
    document.getElementById('rrr-display').textContent  = rrr;
  } else {
    document.getElementById('target-score').textContent = '—';
    document.getElementById('target-score').style.fontSize = '20px';
    document.getElementById('target-score').style.color = 'var(--text-secondary)';
    document.getElementById('chase-info').textContent = 'Bowling';
    document.getElementById('target-row').style.display = 'none';
  }

  // This over balls
  renderThisOver(inn);

  // Batters
  renderBattersTable(inn);

  // Bowler
  renderBowlerCard(inn);
}

function renderThisOver(inn) {
  const container = document.getElementById('this-over-balls');
  if (!container) return;
  container.innerHTML = '';

  const liveOver = inn.overs;
  const isLive = (viewingOverIdx === null || viewingOverIdx === liveOver);
  const currentOver = isLive ? liveOver : Math.max(0, Math.min(viewingOverIdx, liveOver));

  // Controls & indicators
  const titleEl = document.getElementById('this-over-title');
  const badgeEl = document.getElementById('over-number-badge');
  const subinfoEl = document.getElementById('this-over-subinfo');
  const prevBtn = document.getElementById('btn-prev-over');
  const nextBtn = document.getElementById('btn-next-over');
  const liveBtn = document.getElementById('btn-live-over');
  const summaryEl = document.getElementById('over-summary-text');
  const hintEl = document.getElementById('over-swipe-hint');

  if (titleEl) titleEl.textContent = isLive ? 'This Over' : `Over ${currentOver + 1}`;
  if (badgeEl) badgeEl.textContent = `Over ${currentOver + 1}`;
  if (prevBtn) prevBtn.disabled = (currentOver <= 0);
  if (nextBtn) nextBtn.disabled = (currentOver >= liveOver);
  if (liveBtn) liveBtn.style.display = isLive ? 'none' : 'inline-flex';

  // Balls bowled in this specific over
  const ballsInOver = inn.allBalls.filter(b => b.overNum === currentOver);
  const overRuns = ballsInOver.reduce((s, b) => s + b.runs, 0);
  const overWkts = ballsInOver.filter(b => b.wicket).length;

  // Identify bowler who bowled this over
  let bowlerName = '';
  const firstWithBowler = ballsInOver.find(b => b.bowlerIdx !== null && b.bowlerIdx !== undefined);
  if (firstWithBowler && inn.bowlingPlayers[firstWithBowler.bowlerIdx]) {
    bowlerName = inn.bowlingPlayers[firstWithBowler.bowlerIdx].name;
  } else if (isLive && inn.currentBowlerIdx !== null && inn.bowlingPlayers[inn.currentBowlerIdx]) {
    bowlerName = inn.bowlingPlayers[inn.currentBowlerIdx].name;
  }

  if (subinfoEl) {
    if (!isLive) {
      const parts = [];
      if (bowlerName) parts.push(`🎳 ${bowlerName}`);
      parts.push(`${overRuns} run${overRuns === 1 ? '' : 's'}`);
      if (overWkts > 0) parts.push(`${overWkts} wkt${overWkts === 1 ? '' : 's'}`);
      subinfoEl.textContent = parts.join(' • ');
    } else {
      subinfoEl.textContent = bowlerName ? `🎳 ${bowlerName}` : '';
    }
  }

  if (summaryEl) {
    if (liveOver === 0 && ballsInOver.length === 0) {
      summaryEl.textContent = 'First over – 0 balls bowled';
    } else if (isLive) {
      summaryEl.textContent = `Live • Over ${currentOver + 1} of ${state.maxOvers}`;
    } else {
      summaryEl.textContent = `Completed Over ${currentOver + 1} of ${state.maxOvers} (${overRuns} runs)`;
    }
  }

  if (hintEl) {
    hintEl.style.display = (liveOver > 0) ? 'inline' : 'none';
  }

  // Label inside ball container
  const label = document.createElement('span');
  label.className = 'this-over-label';
  label.textContent = isLive ? 'This over:' : `Over ${currentOver + 1}:`;
  container.appendChild(label);

  if (ballsInOver.length === 0 && !isLive) {
    const emptySpan = document.createElement('span');
    emptySpan.style.cssText = 'font-size:12px;color:var(--text-muted);font-style:italic;padding:4px 0';
    emptySpan.textContent = 'No balls recorded in this over';
    container.appendChild(emptySpan);
    return;
  }

  // Render ball chips
  ballsInOver.forEach(b => {
    const chip = document.createElement('div');
    chip.className = 'ball-chip';
    if (b.wicket) { chip.className += ' ball-W'; chip.textContent = 'W'; }
    else if (b.extra === 'Wide') { chip.className += ' ball-Wd'; chip.textContent = 'Wd'; }
    else if (b.extra === 'NoBall') { chip.className += ' ball-Nb'; chip.textContent = 'Nb'; }
    else if (b.extra === 'LegBye') { chip.className += ' ball-Lb'; chip.textContent = `Lb${b.runs}`; }
    else if (b.extra === 'Bye') { chip.className += ' ball-Lb'; chip.textContent = `B${b.runs}`; }
    else { chip.className += ` ball-${b.runs}`; chip.textContent = b.runs === 0 ? '●' : b.runs; }
    container.appendChild(chip);
  });

  if (isLive) {
    // Upcoming dots for in-progress over
    const legalSoFar = ballsInOver.filter(b => !b.extra || b.extra === 'LegBye' || b.extra === 'Bye').length;
    for (let i = legalSoFar; i < 6; i++) {
      const chip = document.createElement('div');
      chip.className = 'ball-chip upcoming';
      chip.textContent = '·';
      container.appendChild(chip);
    }
  } else {
    // Show summary badge of over runs for past over
    const totalPill = document.createElement('span');
    totalPill.className = 'over-total-pill';
    totalPill.textContent = `= ${overRuns} runs`;
    container.appendChild(totalPill);
  }
}

function changeViewingOver(delta) {
  if (!state) return;
  const inn = currentInnings();
  const liveOver = inn.overs;

  if (liveOver === 0 && delta < 0) {
    showToast('ℹ️', 'Currently in the first over');
    return;
  }

  const current = (viewingOverIdx === null) ? liveOver : viewingOverIdx;
  const target = current + delta;

  if (target < 0) {
    showToast('ℹ️', 'First over reached');
    return;
  }
  if (target > liveOver) {
    showToast('ℹ️', 'Already at current live over');
    return;
  }

  viewingOverIdx = (target === liveOver) ? null : target;
  if (config.vibration && navigator.vibrate) navigator.vibrate(25);
  renderThisOver(inn);
}

function jumpToLiveOver() {
  if (!state) return;
  viewingOverIdx = null;
  if (config.vibration && navigator.vibrate) navigator.vibrate(30);
  renderThisOver(currentInnings());
}

function setupThisOverGestures() {
  const card = document.getElementById('this-over-card');
  if (!card) return;

  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  let isSwiping = false;

  // Touch handlers
  card.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartTime = Date.now();
    isSwiping = true;
  }, { passive: true });

  card.addEventListener('touchend', (e) => {
    if (!isSwiping || !state || e.changedTouches.length !== 1) return;
    isSwiping = false;

    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const diffX = endX - touchStartX;
    const diffY = endY - touchStartY;
    const duration = Date.now() - touchStartTime;

    // Horizontal swipe: > 35px, predominantly horizontal, under 700ms
    if (Math.abs(diffX) > 35 && Math.abs(diffX) > Math.abs(diffY) * 1.3 && duration < 700) {
      if (diffX > 0) {
        // Swiped Left to Right -> Previous Over
        changeViewingOver(-1);
      } else {
        // Swiped Right to Left -> Next / Live Over
        changeViewingOver(1);
      }
    }
  }, { passive: true });

  // Mouse drag handlers (desktop browser support)
  let isMouseDown = false;
  let mouseStartX = 0;
  let mouseStartY = 0;
  let mouseStartTime = 0;

  card.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    isMouseDown = true;
    mouseStartX = e.clientX;
    mouseStartY = e.clientY;
    mouseStartTime = Date.now();
  });

  window.addEventListener('mouseup', (e) => {
    if (!isMouseDown) return;
    isMouseDown = false;
    if (!state) return;

    const diffX = e.clientX - mouseStartX;
    const diffY = e.clientY - mouseStartY;
    const duration = Date.now() - mouseStartTime;

    if (Math.abs(diffX) > 35 && Math.abs(diffX) > Math.abs(diffY) * 1.3 && duration < 800) {
      if (diffX > 0) {
        // Dragged Left to Right -> Previous Over
        changeViewingOver(-1);
      } else {
        // Dragged Right to Left -> Next / Live Over
        changeViewingOver(1);
      }
    }
  });
}

function renderBattersTable(inn) {
  const container = document.getElementById('batters-table');
  container.innerHTML = '';

  inn.currentBatters.forEach((bi, pos) => {
    if (bi < 0) return;
    const p = inn.battingPlayers[bi];
    const isStriker = (pos === inn.strikerIdx);
    const sr = p.balls > 0 ? ((p.runs / p.balls) * 100).toFixed(0) : '0';

    const row = document.createElement('div');
    row.className = `batter-row ${isStriker ? 'on-strike' : ''}`;
    row.innerHTML = `
      <div class="${isStriker ? 'strike-indicator' : 'no-strike-indicator'}"></div>
      <div class="batter-name">${p.name}${isStriker ? ' *' : ''}</div>
      <div class="batter-stats">
        <div class="batter-stat"><div class="batter-stat-val">${p.runs}</div><div class="batter-stat-lbl">Runs</div></div>
        <div class="batter-stat"><div class="batter-stat-val">${p.balls}</div><div class="batter-stat-lbl">Balls</div></div>
        <div class="batter-stat"><div class="batter-stat-val">${p.fours}</div><div class="batter-stat-lbl">4s</div></div>
        <div class="batter-stat"><div class="batter-stat-val">${p.sixes}</div><div class="batter-stat-lbl">6s</div></div>
        <div class="batter-stat"><div class="batter-stat-val">${sr}</div><div class="batter-stat-lbl">SR</div></div>
      </div>
    `;
    container.appendChild(row);
  });
}

function renderBowlerCard(inn) {
  const bi = inn.currentBowlerIdx;
  if (bi === null || bi === undefined) {
    document.getElementById('bowler-name').textContent     = 'Select Bowler';
    document.getElementById('bowler-overs').textContent    = 'Tap to choose';
    document.getElementById('bowler-figures').textContent  = '—';
    return;
  }
  const b = inn.bowlingPlayers[bi];
  document.getElementById('bowler-name').textContent     = b.name;
  document.getElementById('bowler-overs').textContent    = `${formatOvers(b.overs, b.balls)} ov`;
  document.getElementById('bowler-figures').textContent  = `${b.wickets}/${b.runs}`;
}

// ============================================================
//  RENDER SCORECARD
// ============================================================
function renderScorecard(inningsIdx) {
  const matchToShow = viewingHistoryMatch || state;
  if (!matchToShow || !matchToShow.innings[inningsIdx]) return;
  // Temporarily point state at the match being shown so all helpers work correctly
  const prev = state;
  state = matchToShow;
  const inn  = state.innings[inningsIdx];
  const team = state.teams[inn.battingTeam];
  const container = document.getElementById('scorecard-content');

  const totalExtras = inn.extras.wides + inn.extras.noBalls + inn.extras.legByes + inn.extras.byes;

  let html = `
    <div class="card" style="margin-bottom:12px">
      <div style="font-weight:700;font-size:15px;color:var(--text-secondary);margin-bottom:14px">🏏 ${team} Batting</div>
      <table class="scorecard-table">
        <thead>
          <tr>
            <th>Batsman</th>
            <th>R</th>
            <th>B</th>
            <th>4s</th>
            <th>6s</th>
            <th>SR</th>
          </tr>
        </thead>
        <tbody>
  `;

  inn.battingPlayers.forEach((p, i) => {
    const hasBatted = p.balls > 0 || p.out || inn.currentBatters.includes(i);
    if (!hasBatted) return;
    const sr = p.balls > 0 ? ((p.runs / p.balls) * 100).toFixed(0) : '—';
    const status = p.out
      ? `<div class="out-text">${p.dismissal}${p.fielder ? ` b/c ${p.fielder}` : ''}</div>`
      : `<div class="out-text" style="color:var(--accent-green)">${inn.currentBatters.includes(i) ? '* Not Out' : 'Not Out'}</div>`;
    html += `
      <tr>
        <td><div>${p.name}</div>${status}</td>
        <td>${p.runs}</td>
        <td>${p.balls}</td>
        <td>${p.fours}</td>
        <td>${p.sixes}</td>
        <td>${sr}</td>
      </tr>
    `;
  });

  html += `
        <tr class="extras-row">
          <td colspan="2">Extras (${inn.extras.wides}w ${inn.extras.noBalls}nb ${inn.extras.legByes}lb ${inn.extras.byes}b)</td>
          <td colspan="4" style="text-align:right">${totalExtras}</td>
        </tr>
        <tr class="total-row">
          <td colspan="2">TOTAL</td>
          <td colspan="4" style="text-align:right">${inn.runs}/${inn.wickets} (${formatOvers(inn.overs, inn.balls)} ov)</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="card">
    <div style="font-weight:700;font-size:15px;color:var(--text-secondary);margin-bottom:14px">🎳 ${state.teams[inn.bowlingTeam]} Bowling</div>
    <table class="bowling-scorecard-table">
      <thead>
        <tr>
          <th>Bowler</th>
          <th>O</th>
          <th>M</th>
          <th>R</th>
          <th>W</th>
          <th>Econ</th>
        </tr>
      </thead>
      <tbody>
  `;

  inn.bowlingPlayers.forEach(b => {
    if (b.overs === 0 && b.balls === 0) return;
    const totalOvBalls = b.overs * 6 + b.balls;
    const econ = totalOvBalls > 0 ? ((b.runs / totalOvBalls) * 6).toFixed(1) : '—';
    html += `
      <tr>
        <td>${b.name}</td>
        <td>${formatOvers(b.overs, b.balls)}</td>
        <td>${b.maidens}</td>
        <td>${b.runs}</td>
        <td>${b.wickets}</td>
        <td>${econ}</td>
      </tr>
    `;
  });

  html += `</tbody></table></div>`;

  // Fall of wickets
  const fow = inn.allBalls.filter(b => b.wicket);
  if (fow.length > 0) {
    html += `
      <div class="card" style="margin-top:12px">
        <div style="font-weight:700;font-size:13px;color:var(--text-muted);margin-bottom:10px">FALL OF WICKETS</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
    `;
    let wktNum = 0;
    fow.forEach(b => {
      wktNum++;
      const bal = inn.allBalls.indexOf(b);
      // Count runs at this point
      const runsAtWicket = inn.allBalls.slice(0, bal + 1).reduce((s, x) => s + x.runs, 0);
      html += `<div class="stat-chip" style="min-width:50px;flex:none">
        <div class="stat-chip-val">${runsAtWicket}</div>
        <div class="stat-chip-lbl">${wktNum}W</div>
      </div>`;
    });
    html += `</div></div>`;
  }

  container.innerHTML = html;
  document.getElementById('scorecard-match-label').textContent = `${state.teams[0]} vs ${state.teams[1]}`;
  state = prev; // restore state after rendering history match
}

function renderResultCard() {
  const matchToShow = viewingHistoryMatch || state;
  if (!matchToShow || !matchToShow.result) return;
  const area = document.getElementById('result-card-area');
  const r = matchToShow.result;
  const isT = r.winner === 'Tie';
  area.innerHTML = `
    <div class="result-main-card">
      <span class="result-emoji">${isT ? '🤝' : '🏆'}</span>
      <div class="result-headline">${isT ? "It's a Tie!" : r.winner + ' Won!'}</div>
      <div class="result-by">by <strong>${r.by}</strong></div>
      <div style="margin-top:14px;font-size:13px;color:var(--text-muted)">${matchToShow.date} • ${matchToShow.venue || ''}</div>
    </div>
  `;
}

// ============================================================
//  HOME SCREEN
// ============================================================
function renderHomeScreen() {
  renderLiveMatchCard();
  renderRecentMatches();
  renderGlobalStats();
}

function renderLiveMatchCard() {
  const area = document.getElementById('live-match-area');
  if (!state || state.matchOver) { area.innerHTML = ''; return; }

  const inn = currentInnings();
  const totalBalls = inn.overs * 6 + inn.balls;
  const crr = totalBalls > 0 ? ((inn.runs / totalBalls) * 6).toFixed(2) : '0.00';

  let chaseInfo = '';
  if (state.currentInnings === 1 && state.innings[0]) {
    const target = state.innings[0].runs + 1;
    const needed = target - inn.runs;
    chaseInfo = `<div class="match-meta" style="margin-top:6px">Need <strong>${needed}</strong> more runs</div>`;
  }

  area.innerHTML = `
    <div class="match-summary-card" onclick="navigate('scoring')">
      <div class="live-badge">LIVE</div>
      <div class="match-teams">
        <div class="team-score-block">
          <div class="team-name-small">${state.teams[inn.battingTeam]}</div>
          <div class="team-score-big">${inn.runs}<span>/${inn.wickets}</span></div>
        </div>
        <div class="vs-divider">vs</div>
        <div class="team-score-block" style="text-align:right">
          <div class="team-name-small">${state.teams[inn.bowlingTeam]}</div>
          <div class="team-score-big" style="font-size:18px;color:var(--text-secondary)">
            ${state.currentInnings === 1 ? 'T: ' + (state.innings[0].runs + 1) : 'Bowling'}
          </div>
        </div>
      </div>
      <div class="match-meta">${formatOvers(inn.overs, inn.balls)} ov • CRR <strong>${crr}</strong></div>
      ${chaseInfo}
    </div>
  `;
}

function renderRecentMatches() {
  const container = document.getElementById('recent-matches-list');
  const matches   = loadMatches().slice(0, 4);

  if (matches.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:30px 0">
        <div class="empty-icon">🏏</div>
        <div class="empty-title">No matches yet</div>
        <div class="empty-desc">Start your first local cricket match!</div>
      </div>
    `;
    return;
  }

  container.innerHTML = matches.map(m => buildHistoryCardHTML(m)).join('');
}

function renderGlobalStats() {
  const container = document.getElementById('global-stats');
  const matches = loadMatches();

  const totalMatches = matches.length;
  const totalRuns = matches.reduce((s, m) => {
    return s + (m.innings?.[0]?.runs || 0) + (m.innings?.[1]?.runs || 0);
  }, 0);
  const totalSixes = matches.reduce((s, m) => {
    if (!Array.isArray(m.innings)) return s;
    return s + m.innings.reduce((ss, inn) => ss + (inn.battingPlayers || []).reduce((x, p) => x + (p.sixes || 0), 0), 0);
  }, 0);
  const totalFours = matches.reduce((s, m) => {
    if (!Array.isArray(m.innings)) return s;
    return s + m.innings.reduce((ss, inn) => ss + (inn.battingPlayers || []).reduce((x, p) => x + (p.fours || 0), 0), 0);
  }, 0);

  container.innerHTML = `
    <div class="stat-chip"><div class="stat-chip-val">${totalMatches}</div><div class="stat-chip-lbl">Matches</div></div>
    <div class="stat-chip"><div class="stat-chip-val">${totalRuns}</div><div class="stat-chip-lbl">Runs</div></div>
    <div class="stat-chip"><div class="stat-chip-val" style="color:var(--accent-green)">${totalSixes}</div><div class="stat-chip-lbl">Sixes</div></div>
    <div class="stat-chip"><div class="stat-chip-val" style="color:var(--accent-teal)">${totalFours}</div><div class="stat-chip-lbl">Fours</div></div>
  `;
}

// ============================================================
//  HISTORY SCREEN
// ============================================================
function renderHistoryScreen() {
  const container = document.getElementById('history-list');
  const matches   = loadMatches();

  if (matches.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📜</div>
        <div class="empty-title">No match history</div>
        <div class="empty-desc">Completed matches will appear here</div>
      </div>
    `;
    return;
  }

  container.innerHTML = matches.map(m => buildHistoryCardHTML(m)).join('');
}

function buildHistoryCardHTML(m) {
  const inn0  = m.innings ? m.innings[0] : null;
  const inn1  = m.innings ? m.innings[1] : null;
  const r     = m.result;
  const isT   = r?.winner === 'Tie';
  const badgeClass = isT ? 'badge-tie' : 'badge-win';

  return `
    <div class="card history-card card-interactive" onclick="openHistoryMatch('${m.id}')">
      <div class="history-top">
        <div class="history-teams">${m.teams[0]} vs ${m.teams[1]}</div>
        <div class="history-result-badge ${badgeClass}">${isT ? 'TIE' : r?.winner + ' WON'}</div>
      </div>
      <div class="history-scores">
        <div class="h-score-item"><strong>${inn0 ? inn0.runs + '/' + inn0.wickets : '—'}</strong> &nbsp;${m.teams[inn0?.battingTeam ?? 0]}</div>
        ${inn1 ? `<div class="h-score-item"><strong>${inn1.runs}/${inn1.wickets}</strong> &nbsp;${m.teams[inn1.battingTeam]}</div>` : ''}
      </div>
      <div class="history-info">
        ${m.date} ${m.venue ? '• ' + m.venue : ''} • ${m.maxOvers} overs
        ${r ? '• Won by ' + r.by : ''}
      </div>
    </div>
  `;
}

function openHistoryMatch(id) {
  const matches = loadMatches();
  const match   = matches.find(m => m.id === id);
  if (!match) return;

  // Store history match so tab click handlers can reference it
  viewingHistoryMatch = match;

  const hasTwo = match.innings.length > 1;
  document.getElementById('innings-tabs').style.display = hasTwo ? 'flex' : 'none';

  // Reset tabs to innings 1
  document.querySelectorAll('.innings-tab').forEach(t => t.classList.remove('active'));
  const tab1 = document.getElementById('tab-innings-1');
  if (tab1) tab1.classList.add('active');

  document.getElementById('btn-return-scoring').style.display = 'none';

  // Render scorecard using history match state
  const prev = state;
  state = match;
  renderScorecard(0);
  renderResultCard();
  state = prev;

  navigate('scorecard');
}

// ============================================================
//  BUILD MATCH RECORD
// ============================================================
function buildMatchRecord() {
  return {
    id:       state.id,
    teams:    state.teams,
    players:  state.players,
    innings:  state.innings,
    maxOvers: state.maxOvers,
    venue:    state.venue,
    date:     state.date,
    result:   state.result,
    startTime: state.startTime,
    endTime:   state.endTime
  };
}

// ============================================================
//  UTILITY
// ============================================================
function formatOvers(overs, balls) {
  return `${overs}.${balls}`;
}

function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
window.closeModal = closeModal;

function showToast(icon, message) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  const cls = icon.includes('SIX') || icon.includes('💥') ? 'six' : icon.includes('FOUR') || icon.includes('🔥') ? 'four' : icon.includes('WICKET') || icon.includes('🔴') ? 'wicket' : '';
  toast.className = `toast ${cls}`;
  toast.innerHTML = `<span>${icon}</span> ${message}`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 2900);
}

function vibrate(pattern) {
  if (config.vibration && navigator.vibrate) navigator.vibrate(pattern);
}

let _clearPending = false;
function clearAllData() {
  if (!_clearPending) {
    _clearPending = true;
    showConfirmToast('⚠️ Tap again to confirm — all match data will be deleted', () => {
      localStorage.clear();
      state = null;
      config = { sound: true, vibration: true, autoRotate: true };
      applyConfig();
      showToast('🗑', 'All data cleared');
      navigate('home');
      _clearPending = false;
    }, () => { _clearPending = false; });
  }
}
window.clearAllData = clearAllData;

function showConfirmToast(message, onConfirm, onCancel) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast wicket';
  toast.style.cssText = 'cursor:default; pointer-events:auto; flex-direction:column; align-items:stretch; gap:10px;';
  toast.innerHTML = `
    <span style="font-size:13px;font-weight:600">${message}</span>
    <div style="display:flex;gap:8px">
      <button id="toast-confirm-yes" style="flex:1;padding:8px;border-radius:8px;border:none;background:rgba(255,82,82,0.8);color:#fff;font-weight:700;cursor:pointer;font-size:13px">Yes, Clear</button>
      <button id="toast-confirm-no" style="flex:1;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:#fff;font-weight:700;cursor:pointer;font-size:13px">Cancel</button>
    </div>
  `;
  container.appendChild(toast);
  toast.querySelector('#toast-confirm-yes').addEventListener('click', () => { toast.remove(); onConfirm(); });
  toast.querySelector('#toast-confirm-no').addEventListener('click', () => { toast.remove(); if (onCancel) onCancel(); });
  setTimeout(() => { if (toast.parentNode) { toast.remove(); if (onCancel) onCancel(); } }, 8000);
}

// ============================================================
//  PWA SETUP
// ============================================================
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      reg.update().catch(() => {});
    }).catch(() => {});
  }
}

let deferredPrompt = null;
function setupPWAInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    document.getElementById('install-banner').style.display = 'flex';
  });

  document.getElementById('btn-install')?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === 'accepted') {
      document.getElementById('install-banner').style.display = 'none';
    }
    deferredPrompt = null;
  });

  window.addEventListener('appinstalled', () => {
    document.getElementById('install-banner').style.display = 'none';
    showToast('📲', 'App installed successfully!');
  });
}

// ============================================================
//  EXPOSE GLOBALS (for inline onclick handlers)
// ============================================================

// ============================================================
//  PLAYER REGISTRATION
// ============================================================
function loadRegisteredPlayers() {
  const p = load(PLAYERS_KEY);
  if (Array.isArray(p)) return p;
  const defaults = [
    { id: 'p1', name: 'Ali Khan', role: 'Batsman' },
    { id: 'p2', name: 'Bilal Ahmed', role: 'Bowler' },
    { id: 'p3', name: 'Usman Tariq', role: 'All-Rounder' },
    { id: 'p4', name: 'Zain Malik', role: 'Wicket-Keeper' },
    { id: 'p5', name: 'Hamza Farooq', role: 'All-Rounder' },
    { id: 'p6', name: 'Saad Rafiq', role: 'Batsman' }
  ];
  save(PLAYERS_KEY, defaults);
  return defaults;
}

function saveRegisteredPlayers(players) {
  save(PLAYERS_KEY, players);
}

function openPlayerRegistrationModal(fromSetup = false) {
  _isFromSetup = !!fromSetup;
  renderRegisteredPlayersList();
  const nameInput = document.getElementById('reg-player-name');
  if (nameInput) nameInput.value = '';
  openModal('player-registration-modal');
  setTimeout(() => nameInput?.focus(), 150);
}

function closePlayerRegistrationModal() {
  closeModal('player-registration-modal');
  if (_isFromSetup || document.getElementById('setup-step-1')?.style.display !== 'none') {
    refreshPlayerDropdowns('team1-players-builder');
    refreshPlayerDropdowns('team2-players-builder');
  }
}

function renderRegisteredPlayersList() {
  const players = loadRegisteredPlayers();
  const countEl = document.getElementById('reg-players-count');
  const listEl  = document.getElementById('registered-players-list');
  if (countEl) countEl.textContent = `Registered Players (${players.length})`;
  if (!listEl) return;

  if (players.length === 0) {
    listEl.innerHTML = `
      <div style="text-align:center;padding:24px 12px;color:var(--text-muted);font-size:13px">
        No players registered yet.<br>Enter a name above and tap <strong>+ Add</strong>!
      </div>
    `;
    return;
  }

  let html = '';
  players.forEach(p => {
    const roleIcon = p.role === 'Batsman' ? '🏏' : p.role === 'Bowler' ? '🎳' : p.role === 'Wicket-Keeper' ? '🧤' : '⚡';
    const roleClass = (p.role || '').toLowerCase().replace(/[^a-z]/g, '');
    html += `
      <div class="registered-player-item">
        <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1">
          <span style="font-size:18px">${roleIcon}</span>
          <div style="min-width:0;flex:1">
            <div style="font-weight:700;font-size:14px;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name}</div>
            <span class="role-badge ${roleClass}">${p.role || 'Player'}</span>
          </div>
        </div>
        <button class="icon-btn" onclick="deletePlayer('${p.id}')" title="Delete ${p.name}" style="width:30px;height:30px;font-size:13px;border-color:rgba(255,82,82,0.3);color:var(--accent-red)">
          🗑️
        </button>
      </div>
    `;
  });
  listEl.innerHTML = html;
}

function submitNewPlayer() {
  const nameInput = document.getElementById('reg-player-name');
  const roleSelect = document.getElementById('reg-player-role');
  const name = nameInput ? nameInput.value.trim() : '';
  const role = roleSelect ? roleSelect.value : 'All-Rounder';

  if (!name) {
    showToast('⚠️', 'Please enter player name');
    nameInput?.focus();
    return;
  }

  const players = loadRegisteredPlayers();
  const exists = players.some(p => p.name.toLowerCase() === name.toLowerCase());
  if (exists) {
    showToast('⚠️', `"${name}" is already registered`);
    nameInput?.focus();
    return;
  }

  const newPlayer = {
    id: 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    name,
    role
  };
  players.unshift(newPlayer);
  saveRegisteredPlayers(players);

  if (nameInput) {
    nameInput.value = '';
    nameInput.focus();
  }

  renderRegisteredPlayersList();
  showToast('✅', `${name} registered!`);

  if (_isFromSetup || document.getElementById('setup-step-1')?.style.display !== 'none') {
    refreshPlayerDropdowns('team1-players-builder');
    refreshPlayerDropdowns('team2-players-builder');
  }
}

function deletePlayer(id) {
  let players = loadRegisteredPlayers();
  const target = players.find(p => p.id === id);
  players = players.filter(p => p.id !== id);
  saveRegisteredPlayers(players);
  renderRegisteredPlayersList();
  showToast('🗑️', target ? `${target.name} removed` : 'Player deleted');

  if (_isFromSetup || document.getElementById('setup-step-1')?.style.display !== 'none') {
    refreshPlayerDropdowns('team1-players-builder');
    refreshPlayerDropdowns('team2-players-builder');
  }
}


// ============================================================
//  PLAYER STATS MODULE
// ============================================================
let currentStatsTab = 'batting';
let currentStatsSearchQuery = '';

function calculateAllPlayerStats() {
  const matches = loadMatches();
  const registered = loadRegisteredPlayers();
  const statsMap = {};

  function getOrCreate(name, role = 'Player') {
    const cleanName = name.trim();
    const key = cleanName.toLowerCase();
    if (!statsMap[key]) {
      statsMap[key] = {
        name: cleanName,
        role: role,
        matchesPlayedSet: new Set(),
        matchLogs: [],
        batting: {
          innings: 0,
          runs: 0,
          balls: 0,
          fours: 0,
          sixes: 0,
          highestScore: 0,
          highestNotOut: false,
          notOuts: 0,
          dismissals: 0,
          fifties: 0,
          hundreds: 0,
          ducks: 0
        },
        bowling: {
          innings: 0,
          overs: 0,
          balls: 0,
          runsConceded: 0,
          wickets: 0,
          maidens: 0,
          bestWickets: 0,
          bestRuns: 9999
        }
      };
    }
    if (role && role !== 'Player' && statsMap[key].role === 'Player') {
      statsMap[key].role = role;
    }
    return statsMap[key];
  }

  // Pre-seed with registered squad
  registered.forEach(rp => {
    getOrCreate(rp.name, rp.role || 'Player');
  });

  // Parse through matches
  matches.forEach(m => {
    const matchId = m.id || `${m.date}_${m.teams[0]}_${m.teams[1]}`;

    // Mark matches from player lists
    if (Array.isArray(m.players)) {
      m.players.forEach(teamPlayers => {
        if (Array.isArray(teamPlayers)) {
          teamPlayers.forEach(pName => {
            if (pName) {
              const p = getOrCreate(pName);
              p.matchesPlayedSet.add(matchId);
            }
          });
        }
      });
    }

    if (!Array.isArray(m.innings)) return;

    m.innings.forEach((inn, innIdx) => {
      // Batting
      if (Array.isArray(inn.battingPlayers)) {
        inn.battingPlayers.forEach(bp => {
          if (!bp || !bp.name) return;
          const hasBatted = (bp.balls > 0) || (bp.runs > 0) || bp.out;
          const p = getOrCreate(bp.name);
          p.matchesPlayedSet.add(matchId);

          if (hasBatted) {
            p.batting.innings++;
            p.batting.runs += (bp.runs || 0);
            p.batting.balls += (bp.balls || 0);
            p.batting.fours += (bp.fours || 0);
            p.batting.sixes += (bp.sixes || 0);

            if (bp.out) {
              p.batting.dismissals++;
              if (bp.runs === 0 && bp.balls > 0) p.batting.ducks++;
            } else {
              p.batting.notOuts++;
            }

            const isNo = !bp.out;
            if (bp.runs > p.batting.highestScore || (bp.runs === p.batting.highestScore && isNo && !p.batting.highestNotOut)) {
              p.batting.highestScore = bp.runs;
              p.batting.highestNotOut = isNo;
            }

            if (bp.runs >= 100) p.batting.hundreds++;
            else if (bp.runs >= 50) p.batting.fifties++;

            p.matchLogs.push({
              matchId,
              date: m.date,
              vs: m.teams[inn.bowlingTeam] || 'Opponent',
              type: 'bat',
              runs: bp.runs,
              balls: bp.balls,
              fours: bp.fours,
              sixes: bp.sixes,
              out: bp.out,
              dismissal: bp.dismissal
            });
          }
        });
      }

      // Bowling
      if (Array.isArray(inn.bowlingPlayers)) {
        inn.bowlingPlayers.forEach(b => {
          if (!b || !b.name) return;
          const totalOvBalls = (b.overs || 0) * 6 + (b.balls || 0);
          const hasBowled = totalOvBalls > 0 || (b.runs > 0) || (b.wickets > 0);
          if (!hasBowled) return;

          const p = getOrCreate(b.name);
          p.matchesPlayedSet.add(matchId);
          p.bowling.innings++;

          p.bowling.balls += totalOvBalls;
          p.bowling.runsConceded += (b.runs || 0);
          p.bowling.wickets += (b.wickets || 0);
          p.bowling.maidens += (b.maidens || 0);

          const w = b.wickets || 0;
          const r = b.runs || 0;
          if (w > p.bowling.bestWickets || (w === p.bowling.bestWickets && r < p.bowling.bestRuns)) {
            p.bowling.bestWickets = w;
            p.bowling.bestRuns = r;
          }

          p.matchLogs.push({
            matchId,
            date: m.date,
            vs: m.teams[inn.battingTeam] || 'Opponent',
            type: 'bowl',
            overs: formatOvers(b.overs || 0, b.balls || 0),
            runs: b.runs || 0,
            wickets: b.wickets || 0,
            maidens: b.maidens || 0
          });
        });
      }
    });
  });

  return Object.values(statsMap).map(p => {
    p.matches = p.matchesPlayedSet.size;

    // Batting averages & strike rate
    p.batting.average = p.batting.dismissals > 0
      ? (p.batting.runs / p.batting.dismissals).toFixed(1)
      : (p.batting.innings > 0 ? `${p.batting.runs}*` : '—');

    p.batting.strikeRate = p.batting.balls > 0
      ? ((p.batting.runs / p.batting.balls) * 100).toFixed(1)
      : '—';

    // Bowling metrics
    const ov = Math.floor(p.bowling.balls / 6);
    const bl = p.bowling.balls % 6;
    p.bowling.oversFormatted = `${ov}.${bl}`;

    p.bowling.economy = p.bowling.balls > 0
      ? ((p.bowling.runsConceded / p.bowling.balls) * 6).toFixed(2)
      : '—';

    p.bowling.average = p.bowling.wickets > 0
      ? (p.bowling.runsConceded / p.bowling.wickets).toFixed(1)
      : '—';

    p.bowling.strikeRate = p.bowling.wickets > 0
      ? (p.bowling.balls / p.bowling.wickets).toFixed(1)
      : '—';

    p.bowling.bestFigures = p.bowling.bestWickets > 0 || p.bowling.bestRuns < 9999
      ? `${p.bowling.bestWickets}/${p.bowling.bestRuns === 9999 ? 0 : p.bowling.bestRuns}`
      : '—';

    return p;
  });
}

function renderPlayerStatsScreen() {
  const allPlayers = calculateAllPlayerStats();

  // 1. Highlights
  renderLeaderboardHighlights(allPlayers);

  // 2. Tab Content
  renderStatsTabContent(allPlayers);
}

function renderLeaderboardHighlights(players) {
  const container = document.getElementById('stats-leaderboard-cards');
  if (!container) return;

  if (players.length === 0) {
    container.innerHTML = '';
    return;
  }

  // Top run scorer
  const topRun = [...players].sort((a, b) => b.batting.runs - a.batting.runs)[0];
  // Top wicket taker
  const topWkt = [...players].sort((a, b) => b.bowling.wickets - a.bowling.wickets)[0];
  // Most sixes
  const topSix = [...players].sort((a, b) => b.batting.sixes - a.batting.sixes)[0];

  container.innerHTML = `
    <div class="leaderboard-mini-card" onclick="openPlayerProfile('${topRun ? topRun.name.replace(/'/g, "\\'") : ''}')">
      <div class="l-emoji">👑</div>
      <div class="l-val" style="color:var(--accent-gold)">${topRun?.batting.runs || 0}</div>
      <div class="l-name">${topRun?.name || '—'}</div>
      <div class="l-lbl">Top Scorer</div>
    </div>
    <div class="leaderboard-mini-card" onclick="openPlayerProfile('${topWkt ? topWkt.name.replace(/'/g, "\\'") : ''}')">
      <div class="l-emoji">🎯</div>
      <div class="l-val" style="color:var(--accent-purple)">${topWkt?.bowling.wickets || 0}</div>
      <div class="l-name">${topWkt?.name || '—'}</div>
      <div class="l-lbl">Most Wkts</div>
    </div>
    <div class="leaderboard-mini-card" onclick="openPlayerProfile('${topSix ? topSix.name.replace(/'/g, "\\'") : ''}')">
      <div class="l-emoji">💥</div>
      <div class="l-val" style="color:var(--accent-green)">${topSix?.batting.sixes || 0}</div>
      <div class="l-name">${topSix?.name || '—'}</div>
      <div class="l-lbl">Most 6s</div>
    </div>
  `;
}

function switchStatsTab(tab) {
  currentStatsTab = tab;
  document.querySelectorAll('.stats-tab-btn').forEach(b => b.classList.toggle('active', b.id === `tab-stats-${tab}`));
  renderStatsTabContent();
}

function filterPlayerStats(query) {
  currentStatsSearchQuery = (query || '').trim().toLowerCase();
  renderStatsTabContent();
}

function renderStatsTabContent(allPlayers) {
  const container = document.getElementById('stats-content-area');
  if (!container) return;

  const players = allPlayers || calculateAllPlayerStats();

  let filtered = players;
  if (currentStatsSearchQuery) {
    filtered = filtered.filter(p => p.name.toLowerCase().includes(currentStatsSearchQuery));
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:30px 16px">
        <div class="empty-icon">📈</div>
        <div class="empty-title">No players found</div>
        <div class="empty-desc">${currentStatsSearchQuery ? 'No players matching your search.' : 'Play matches or register players to see career stats!'}</div>
      </div>
    `;
    return;
  }

  if (currentStatsTab === 'batting') {
    filtered.sort((a, b) => b.batting.runs - a.batting.runs);

    let html = `
      <div class="stats-table-container">
        <table class="stats-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>M</th>
              <th>Inn</th>
              <th>Runs</th>
              <th>HS</th>
              <th>Avg</th>
              <th>SR</th>
              <th>4s</th>
              <th>6s</th>
            </tr>
          </thead>
          <tbody>
    `;

    filtered.forEach(p => {
      const b = p.batting;
      const hsStr = `${b.highestScore}${b.highestNotOut ? '*' : ''}`;
      const safeName = p.name.replace(/'/g, "\\'");
      html += `
        <tr onclick="openPlayerProfile('${safeName}')">
          <td>
            <div style="color:var(--text-primary);font-size:13px">${p.name}</div>
            <div style="font-size:10px;color:var(--text-muted)">${p.role || 'Player'}</div>
          </td>
          <td>${p.matches}</td>
          <td>${b.innings}</td>
          <td style="font-weight:700;color:#fff">${b.runs}</td>
          <td>${hsStr}</td>
          <td>${b.average}</td>
          <td>${b.strikeRate}</td>
          <td>${b.fours}</td>
          <td style="color:var(--accent-green);font-weight:700">${b.sixes}</td>
        </tr>
      `;
    });

    html += `</tbody></table></div>`;
    container.innerHTML = html;
  } else if (currentStatsTab === 'bowling') {
    filtered.sort((a, b) => b.bowling.wickets - a.bowling.wickets || (parseFloat(a.bowling.economy) || 99) - (parseFloat(b.bowling.economy) || 99));

    let html = `
      <div class="stats-table-container">
        <table class="stats-table">
          <thead>
            <tr>
              <th>Bowler</th>
              <th>M</th>
              <th>O</th>
              <th>Mdn</th>
              <th>Runs</th>
              <th>Wkts</th>
              <th>BBI</th>
              <th>Econ</th>
              <th>Avg</th>
            </tr>
          </thead>
          <tbody>
    `;

    filtered.forEach(p => {
      const bw = p.bowling;
      const safeName = p.name.replace(/'/g, "\\'");
      html += `
        <tr onclick="openPlayerProfile('${safeName}')">
          <td>
            <div style="color:var(--text-primary);font-size:13px">${p.name}</div>
            <div style="font-size:10px;color:var(--text-muted)">${p.role || 'Bowler'}</div>
          </td>
          <td>${p.matches}</td>
          <td>${bw.oversFormatted}</td>
          <td>${bw.maidens}</td>
          <td>${bw.runsConceded}</td>
          <td style="font-weight:700;color:var(--accent-green)">${bw.wickets}</td>
          <td>${bw.bestFigures}</td>
          <td>${bw.economy}</td>
          <td>${bw.average}</td>
        </tr>
      `;
    });

    html += `</tbody></table></div>`;
    container.innerHTML = html;
  } else {
    // Overview
    filtered.sort((a, b) => (b.batting.runs + b.bowling.wickets * 20) - (a.batting.runs + a.bowling.wickets * 20));

    let html = `<div style="display:flex;flex-direction:column;gap:8px">`;
    filtered.forEach(p => {
      const roleIcon = p.role === 'Batsman' ? '🏏' : p.role === 'Bowler' ? '🎳' : p.role === 'Wicket-Keeper' ? '🧤' : '⚡';
      const roleClass = (p.role || '').toLowerCase().replace(/[^a-z]/g, '');
      const hsStr = `${p.batting.highestScore}${p.batting.highestNotOut ? '*' : ''}`;
      const safeName = p.name.replace(/'/g, "\\'");

      html += `
        <div class="player-overview-card" onclick="openPlayerProfile('${safeName}')">
          <div class="player-overview-header">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:18px">${roleIcon}</span>
              <div>
                <div style="font-weight:700;font-size:14px;color:#fff">${p.name}</div>
                <span class="role-badge ${roleClass}">${p.role || 'Player'}</span>
              </div>
            </div>
            <span style="font-size:11px;color:var(--text-muted)">${p.matches} Match${p.matches === 1 ? '' : 'es'}</span>
          </div>
          <div class="player-overview-grid">
            <div>
              <div class="g-val" style="color:var(--accent-gold)">${p.batting.runs}</div>
              <div class="g-lbl">Runs</div>
            </div>
            <div>
              <div class="g-val">${hsStr}</div>
              <div class="g-lbl">High Score</div>
            </div>
            <div>
              <div class="g-val" style="color:var(--accent-green)">${p.bowling.wickets}</div>
              <div class="g-lbl">Wickets</div>
            </div>
            <div>
              <div class="g-val">${p.bowling.economy}</div>
              <div class="g-lbl">Economy</div>
            </div>
          </div>
        </div>
      `;
    });
    html += `</div>`;
    container.innerHTML = html;
  }
}

function openPlayerProfile(playerName) {
  if (!playerName) return;
  const allPlayers = calculateAllPlayerStats();
  const p = allPlayers.find(x => x.name.toLowerCase() === playerName.trim().toLowerCase());
  if (!p) {
    showToast('⚠️', 'Player profile not found');
    return;
  }

  const roleIcon = p.role === 'Batsman' ? '🏏' : p.role === 'Bowler' ? '🎳' : p.role === 'Wicket-Keeper' ? '🧤' : '⚡';
  const roleClass = (p.role || '').toLowerCase().replace(/[^a-z]/g, '');

  document.getElementById('prof-player-name').textContent = p.name;
  document.getElementById('prof-role-icon').textContent = roleIcon;
  const roleBadge = document.getElementById('prof-player-role');
  roleBadge.textContent = p.role || 'Player';
  roleBadge.className = `role-badge ${roleClass}`;

  const hsStr = `${p.batting.highestScore}${p.batting.highestNotOut ? '*' : ''}`;

  let logsHtml = '';
  if (p.matchLogs && p.matchLogs.length > 0) {
    logsHtml = `
      <div style="margin-top:10px">
        <div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:6px">Recent Performances</div>
        <div style="display:flex;flex-direction:column;gap:6px;max-height:160px;overflow-y:auto">
    `;
    p.matchLogs.slice(0, 8).forEach(l => {
      const isBat = l.type === 'bat';
      const scoreStr = isBat
        ? `<strong>${l.runs}</strong> (${l.balls}b, ${l.fours}x4, ${l.sixes}x6) ${l.out ? `b/c ${l.dismissal}` : '*Not Out'}`
        : `<strong>${l.wickets}/${l.runs}</strong> in ${l.overs} ov (${l.maidens} mdn)`;
      logsHtml += `
        <div style="font-size:11px;background:rgba(255,255,255,0.03);padding:6px 8px;border-radius:6px;display:flex;justify-content:space-between;align-items:center">
          <div>
            <span style="color:var(--text-secondary)">${isBat ? '🏏' : '🎳'} vs ${l.vs || 'Opponent'}</span>
            <div style="color:var(--text-muted);font-size:10px">${l.date || ''}</div>
          </div>
          <div style="text-align:right">${scoreStr}</div>
        </div>
      `;
    });
    logsHtml += `</div></div>`;
  }

  const contentEl = document.getElementById('prof-player-content');
  contentEl.innerHTML = `
    <!-- Top Career Numbers -->
    <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px">
      <div class="card" style="padding:10px 8px;text-align:center">
        <div style="font-size:18px;font-weight:800;color:var(--accent-gold)">${p.batting.runs}</div>
        <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">Career Runs</div>
      </div>
      <div class="card" style="padding:10px 8px;text-align:center">
        <div style="font-size:18px;font-weight:800;color:var(--accent-green)">${p.bowling.wickets}</div>
        <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">Career Wkts</div>
      </div>
      <div class="card" style="padding:10px 8px;text-align:center">
        <div style="font-size:18px;font-weight:800;color:#fff">${p.matches}</div>
        <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">Matches</div>
      </div>
    </div>

    <!-- Batting Card -->
    <div class="card" style="padding:12px">
      <div style="font-size:13px;font-weight:700;color:var(--accent-blue);margin-bottom:8px">🏏 Batting Record</div>
      <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:6px;text-align:center;font-size:11px">
        <div><div style="font-weight:700;font-size:13px">${p.batting.innings}</div><div style="color:var(--text-muted)">Innings</div></div>
        <div><div style="font-weight:700;font-size:13px">${hsStr}</div><div style="color:var(--text-muted)">High Score</div></div>
        <div><div style="font-weight:700;font-size:13px">${p.batting.average}</div><div style="color:var(--text-muted)">Average</div></div>
        <div><div style="font-weight:700;font-size:13px">${p.batting.strikeRate}</div><div style="color:var(--text-muted)">Strike Rate</div></div>
        <div><div style="font-weight:700;font-size:13px">${p.batting.fours}</div><div style="color:var(--text-muted)">Fours</div></div>
        <div><div style="font-weight:700;font-size:13px;color:var(--accent-green)">${p.batting.sixes}</div><div style="color:var(--text-muted)">Sixes</div></div>
        <div><div style="font-weight:700;font-size:13px">${p.batting.fifties}</div><div style="color:var(--text-muted)">50s</div></div>
        <div><div style="font-weight:700;font-size:13px">${p.batting.hundreds}</div><div style="color:var(--text-muted)">100s</div></div>
      </div>
    </div>

    <!-- Bowling Card -->
    <div class="card" style="padding:12px">
      <div style="font-size:13px;font-weight:700;color:var(--accent-purple);margin-bottom:8px">🎳 Bowling Record</div>
      <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:6px;text-align:center;font-size:11px">
        <div><div style="font-weight:700;font-size:13px">${p.bowling.oversFormatted}</div><div style="color:var(--text-muted)">Overs</div></div>
        <div><div style="font-weight:700;font-size:13px">${p.bowling.maidens}</div><div style="color:var(--text-muted)">Maidens</div></div>
        <div><div style="font-weight:700;font-size:13px">${p.bowling.runsConceded}</div><div style="color:var(--text-muted)">Runs</div></div>
        <div><div style="font-weight:700;font-size:13px;color:var(--accent-green)">${p.bowling.wickets}</div><div style="color:var(--text-muted)">Wickets</div></div>
        <div><div style="font-weight:700;font-size:13px">${p.bowling.bestFigures}</div><div style="color:var(--text-muted)">BBI</div></div>
        <div><div style="font-weight:700;font-size:13px">${p.bowling.economy}</div><div style="color:var(--text-muted)">Economy</div></div>
        <div><div style="font-weight:700;font-size:13px">${p.bowling.average}</div><div style="color:var(--text-muted)">Average</div></div>
        <div><div style="font-weight:700;font-size:13px">${p.bowling.strikeRate}</div><div style="color:var(--text-muted)">Strike Rate</div></div>
      </div>
    </div>

    ${logsHtml}
  `;

  openModal('player-profile-modal');
}


// ============================================================

// ============================================================
//  TEAMS MANAGEMENT (CREATE, SAVE, EDIT, DELETE)
// ============================================================
let _isTeamsFromSetup = false;
let _currentEditingTeamId = null;

function loadSavedTeams() {
  const t = load(TEAMS_KEY);
  if (Array.isArray(t) && t.length > 0) return t;
  const defaults = [
    {
      id: 'team_kashmir',
      name: 'Kashmir XI',
      players: ['Ali Khan', 'Bilal Ahmed', 'Usman Tariq', 'Zain Malik', 'Hamza Farooq', 'Saad Rafiq', 'Irfan Pathan', 'Rashid Khan', 'Sohail Tanvir', 'Mohammad Amir', 'Babar Azam'],
      createdAt: new Date().toISOString()
    },
    {
      id: 'team_dubai',
      name: 'Dubai Stars',
      players: ['David Warner', 'Steve Smith', 'Glenn Maxwell', 'Mitchell Starc', 'Pat Cummins', 'Adam Zampa', 'Travis Head', 'Josh Hazlewood', 'Marcus Stoinis', 'Matthew Wade', 'Nathan Lyon'],
      createdAt: new Date().toISOString()
    }
  ];
  save(TEAMS_KEY, defaults);
  return defaults;
}

function saveSavedTeams(teams) {
  save(TEAMS_KEY, teams);
}

function openTeamsModal(fromSetup = false) {
  _isTeamsFromSetup = !!fromSetup;
  renderSavedTeamsList();
  openModal('teams-modal');
}
window.openTeamsModal = openTeamsModal;

function closeTeamsModal() {
  closeModal('teams-modal');
  populateTeamDropdowns();
}
window.closeTeamsModal = closeTeamsModal;

function renderSavedTeamsList() {
  const teams = loadSavedTeams();
  const searchInput = document.getElementById('teams-search-input');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

  const filtered = query
    ? teams.filter(t => t.name.toLowerCase().includes(query) || (t.players && t.players.some(p => (typeof p === 'string' ? p : p.name).toLowerCase().includes(query))))
    : teams;

  const countEl = document.getElementById('teams-count-label');
  if (countEl) countEl.textContent = `${teams.length} Team${teams.length === 1 ? '' : 's'} Saved`;

  const listEl = document.getElementById('saved-teams-list');
  if (!listEl) return;

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div style="text-align:center;padding:28px 12px;color:var(--text-muted);font-size:13px">
        ${query ? 'No teams match your search.' : 'No saved teams yet.<br>Tap <strong>+ Create Team</strong> to add your first team!'}
      </div>
    `;
    return;
  }

  let html = '';
  filtered.forEach(t => {
    const pCount = (t.players || []).length;
    const previewNames = (t.players || []).map(p => typeof p === 'string' ? p : p.name).slice(0, 5).join(', ');
    const moreText = pCount > 5 ? ` +${pCount - 5} more` : '';

    html += `
      <div class="team-card-item">
        <div class="team-card-header">
          <div class="team-card-title">
            <span>🛡️</span>
            <span>${t.name}</span>
          </div>
          <span class="team-card-badge">${pCount} Players</span>
        </div>
        <div class="team-card-players-preview">
          ${previewNames ? previewNames + moreText : 'No players added yet'}
        </div>
        <div class="team-card-actions">
          <button class="btn btn-sm btn-secondary" onclick="openTeamEditorModal('${t.id}')" style="padding:4px 10px;font-size:12px">
            ✏️ Edit
          </button>
          <button class="btn btn-sm btn-secondary" onclick="deleteSavedTeam('${t.id}')" style="padding:4px 8px;font-size:12px;color:var(--accent-red);border-color:rgba(255,82,82,0.3)" title="Delete Team">
            🗑️
          </button>
        </div>
      </div>
    `;
  });
  listEl.innerHTML = html;
}
window.renderSavedTeamsList = renderSavedTeamsList;
window.filterSavedTeamsList = renderSavedTeamsList;

function openTeamEditorModal(teamId = null) {
  _currentEditingTeamId = teamId;
  const nameInput = document.getElementById('team-editor-name');
  const idInput = document.getElementById('team-editor-id');
  const titleEl = document.getElementById('team-editor-title');
  const listEl = document.getElementById('team-editor-players-list');

  if (listEl) listEl.innerHTML = '';

  if (teamId) {
    const teams = loadSavedTeams();
    const target = teams.find(t => t.id === teamId);
    if (target) {
      if (titleEl) titleEl.textContent = 'Edit Team';
      if (idInput) idInput.value = target.id;
      if (nameInput) nameInput.value = target.name;
      (target.players || []).forEach(p => {
        addPlayerRowToTeamEditor(typeof p === 'string' ? p : p.name);
      });
    }
  } else {
    if (titleEl) titleEl.textContent = 'Create Team';
    if (idInput) idInput.value = '';
    if (nameInput) nameInput.value = '';
    // Pre-create 11 slots
    for (let i = 0; i < 11; i++) {
      addPlayerRowToTeamEditor('');
    }
  }

  updateTeamEditorCount();
  openModal('team-editor-modal');
  setTimeout(() => nameInput?.focus(), 150);
}
window.openTeamEditorModal = openTeamEditorModal;

function addPlayerRowToTeamEditor(playerName = '') {
  const listEl = document.getElementById('team-editor-players-list');
  if (!listEl) return;
  const currentRows = listEl.querySelectorAll('.team-editor-slot-card, .team-editor-row').length;
  const rowIdx = currentRows + 1;

  const regPlayers = loadRegisteredPlayers();
  let optionsHtml = `<option value="">-- Choose from Registered (${regPlayers.length}) --</option>`;
  regPlayers.forEach(p => {
    const roleIcon = p.role === 'Batsman' ? '🏏' : p.role === 'Bowler' ? '🎳' : p.role === 'Wicket-Keeper' ? '🧤' : '⚡';
    const isMatch = playerName && (playerName.trim().toLowerCase() === p.name.trim().toLowerCase());
    optionsHtml += `<option value="${p.name.replace(/"/g, '&quot;')}" ${isMatch ? 'selected' : ''}>${roleIcon} ${p.name} (${p.role || 'Player'})</option>`;
  });

  const card = document.createElement('div');
  card.className = 'team-editor-slot-card';
  const escapedName = playerName ? playerName.replace(/"/g, '&quot;') : '';

  card.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px">
      <span class="row-num">${rowIdx}</span>
      <select class="form-select team-player-dropdown" onchange="onTeamEditorPlayerDropdownChange(this)" style="flex:1;padding:6px 8px;font-size:12px">
        ${optionsHtml}
      </select>
      <button type="button" class="icon-btn" onclick="removePlayerRowFromTeamEditor(this)" style="width:28px;height:28px;font-size:11px;color:var(--accent-red);border-color:rgba(255,82,82,0.3)" title="Remove player slot">✕</button>
    </div>
    <input class="form-input team-player-input" type="text" placeholder="Player ${rowIdx} Name" value="${escapedName}" maxlength="25" style="padding:6px 10px;font-size:13px" />
  `;
  listEl.appendChild(card);
  updateTeamEditorCount();
}
window.addPlayerRowToTeamEditor = addPlayerRowToTeamEditor;

function onTeamEditorPlayerDropdownChange(selectEl) {
  const card = selectEl.closest('.team-editor-slot-card') || selectEl.closest('.team-editor-row');
  if (!card) return;
  const inputEl = card.querySelector('.team-player-input');
  if (!inputEl) return;
  const val = selectEl.value;
  if (val) {
    inputEl.value = val;
    inputEl.classList.add('populated-flash');
    setTimeout(() => inputEl.classList.remove('populated-flash'), 600);
  }
}
window.onTeamEditorPlayerDropdownChange = onTeamEditorPlayerDropdownChange;

function removePlayerRowFromTeamEditor(btn) {
  const row = btn.closest('.team-editor-slot-card') || btn.closest('.team-editor-row');
  if (row) {
    row.remove();
    const listEl = document.getElementById('team-editor-players-list');
    if (listEl) {
      listEl.querySelectorAll('.team-editor-slot-card, .team-editor-row').forEach((r, idx) => {
        const numEl = r.querySelector('.row-num');
        if (numEl) numEl.textContent = idx + 1;
        const inp = r.querySelector('.team-player-input');
        if (inp && !inp.value) inp.placeholder = `Player ${idx + 1} Name`;
      });
    }
    updateTeamEditorCount();
  }
}
window.removePlayerRowFromTeamEditor = removePlayerRowFromTeamEditor;

function addRegisteredToTeamEditor() {
  const regPlayers = loadRegisteredPlayers();
  if (regPlayers.length === 0) {
    showToast('ℹ️', 'No registered players found in directory');
    return;
  }
  const listEl = document.getElementById('team-editor-players-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  regPlayers.forEach(p => {
    addPlayerRowToTeamEditor(p.name);
  });
  updateTeamEditorCount();
  showToast('👥', `Added ${regPlayers.length} registered players`);
}
window.addRegisteredToTeamEditor = addRegisteredToTeamEditor;

function updateTeamEditorCount() {
  const listEl = document.getElementById('team-editor-players-list');
  const label = document.getElementById('team-editor-players-label');
  if (listEl && label) {
    const count = listEl.querySelectorAll('.team-editor-slot-card, .team-editor-row').length;
    label.textContent = `Squad Players (${count})`;
  }
}

function saveTeamFromEditor() {
  const nameInput = document.getElementById('team-editor-name');
  const idInput = document.getElementById('team-editor-id');
  const name = nameInput ? nameInput.value.trim() : '';
  const teamId = idInput ? idInput.value : '';

  if (!name) {
    showToast('⚠️', 'Please enter a team name');
    nameInput?.focus();
    return;
  }

  const inputs = document.querySelectorAll('#team-editor-players-list .team-player-input');
  const players = [];
  inputs.forEach((inp) => {
    const val = inp.value.trim();
    if (val) players.push(val);
  });

  const teams = loadSavedTeams();

  if (teamId) {
    const idx = teams.findIndex(t => t.id === teamId);
    if (idx !== -1) {
      teams[idx].name = name;
      teams[idx].players = players;
      teams[idx].updatedAt = new Date().toISOString();
    }
  } else {
    const newTeam = {
      id: 'team_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      name: name,
      players: players,
      createdAt: new Date().toISOString()
    };
    teams.push(newTeam);
  }

  saveSavedTeams(teams);
  closeModal('team-editor-modal');
  renderSavedTeamsList();
  populateTeamDropdowns();
  showToast('🛡️', `Team "${name}" saved! (${players.length} players)`);
}
window.saveTeamFromEditor = saveTeamFromEditor;

function deleteSavedTeam(teamId) {
  let teams = loadSavedTeams();
  const target = teams.find(t => t.id === teamId);
  if (!confirm(`Delete team "${target?.name || ''}"?`)) return;

  teams = teams.filter(t => t.id !== teamId);
  saveSavedTeams(teams);
  renderSavedTeamsList();
  populateTeamDropdowns();
  showToast('🗑️', 'Team deleted');
}
window.deleteSavedTeam = deleteSavedTeam;

function populateTeamDropdowns() {
  const teams = loadSavedTeams();
  const t1Select = document.getElementById('team1-select');
  const t2Select = document.getElementById('team2-select');
  if (!t1Select || !t2Select) return;

  const currentT1 = t1Select.value;
  const currentT2 = t2Select.value;

  let opts = '<option value="">— Select Saved Team or Custom —</option>';
  teams.forEach(t => {
    const pCount = (t.players || []).length;
    opts += `<option value="${t.id}">🛡️ ${t.name} (${pCount} players)</option>`;
  });
  opts += '<option value="__custom__">✏️ Custom / New Team</option>';

  t1Select.innerHTML = opts;
  t2Select.innerHTML = opts;

  if (currentT1) t1Select.value = currentT1;
  if (currentT2) t2Select.value = currentT2;
}
window.populateTeamDropdowns = populateTeamDropdowns;

function onTeamSelectChange(teamNum) {
  const selectEl = document.getElementById(`team${teamNum}-select`);
  const nameInput = document.getElementById(`team${teamNum}-name`);
  if (!selectEl || !nameInput) return;

  const val = selectEl.value;
  if (!val || val === '__custom__') {
    return;
  }

  const teams = loadSavedTeams();
  const team = teams.find(t => t.id === val);
  if (team) {
    nameInput.value = team.name;
    nameInput.classList.add('populated-flash');
    setTimeout(() => nameInput.classList.remove('populated-flash'), 600);
    showToast('🛡️', `Selected "${team.name}" (${(team.players || []).length} players)`);
  }
}
window.onTeamSelectChange = onTeamSelectChange;

//  DATA BACKUP & SYNC (IMPORT & EXPORT)
// ============================================================
let pendingImportData = null;

function exportAppData() {
  const matches = loadMatches();
  const players = loadRegisteredPlayers();
  const teams   = loadSavedTeams();

  const backup = {
    app: 'My Crick',
    version: '2.10.0',
    exportedAt: new Date().toISOString(),
    matchCount: matches.length,
    playerCount: players.length,
    teamCount: teams.length,
    data: {
      matches: matches,
      players: players,
      teams: teams,
      config: config
    }
  };

  const jsonStr = JSON.stringify(backup, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const filename = 'mycrick_backup_' + dateStr + '_' + hh + mm + '.json';

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('📤', 'Backup exported: ' + matches.length + ' matches, ' + players.length + ' players');
}

function handleImportFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const parsed = JSON.parse(e.target.result);

      let matches = [];
      let players = [];
      let importedConfig = null;

      let teams = [];
      if (parsed.data) {
        matches = Array.isArray(parsed.data.matches) ? parsed.data.matches : [];
        players = Array.isArray(parsed.data.players) ? parsed.data.players : [];
        teams   = Array.isArray(parsed.data.teams) ? parsed.data.teams : [];
        importedConfig = parsed.data.config;
      } else {
        matches = Array.isArray(parsed.matches) ? parsed.matches : [];
        players = Array.isArray(parsed.players) ? parsed.players : [];
        teams   = Array.isArray(parsed.teams) ? parsed.teams : [];
        importedConfig = parsed.config;
      }

      if (matches.length === 0 && players.length === 0) {
        showToast('⚠️', 'No matches or players found in backup file');
        event.target.value = '';
        return;
      }

      pendingImportData = {
        matches: matches,
        players: players,
        teams: teams,
        config: importedConfig,
        filename: file.name,
        exportedAt: parsed.exportedAt || null
      };

      const matchesEl = document.getElementById('import-summary-matches');
      const playersEl = document.getElementById('import-summary-players');
      const dateEl    = document.getElementById('import-summary-date');

      if (matchesEl) matchesEl.textContent = matches.length + ' Match' + (matches.length === 1 ? '' : 'es');
      if (playersEl) playersEl.textContent = players.length + ' Player' + (players.length === 1 ? '' : 's');
      if (dateEl) {
        dateEl.textContent = parsed.exportedAt
          ? new Date(parsed.exportedAt).toLocaleDateString()
          : 'Custom';
      }

      openModal('import-confirm-modal');
    } catch (err) {
      console.error('Import parse error:', err);
      showToast('❌', 'Invalid JSON backup file');
    }
    event.target.value = '';
  };
  reader.readAsText(file);
}

function executeImport(mode) {
  if (!pendingImportData) return;

  const currentMatches = loadMatches();
  const currentPlayers = loadRegisteredPlayers();

  let finalMatches = [];
  let finalPlayers = [];

  if (mode === 'replace') {
    finalMatches = pendingImportData.matches;
    finalPlayers = pendingImportData.players;
    if (pendingImportData.teams) {
      saveSavedTeams(pendingImportData.teams);
    }
    if (pendingImportData.config) {
      config = Object.assign({}, config, pendingImportData.config);
      save(CFG_KEY, config);
      applyConfig();
    }
  } else {
    // Merge teams:
    if (Array.isArray(pendingImportData.teams)) {
      const currentTeams = loadSavedTeams();
      const existingTeamNames = new Set(currentTeams.map(t => t.name.trim().toLowerCase()));
      const newTeamsToAdd = pendingImportData.teams.filter(t => !existingTeamNames.has(t.name.trim().toLowerCase()));
      saveSavedTeams(currentTeams.concat(newTeamsToAdd));
    }
    // Merge mode:
    const existingMatchIds = new Set(currentMatches.map(function(m) {
      return m.id || (m.date + '_' + m.teams[0] + '_' + m.teams[1]);
    }));
    const newMatchesToAdd = pendingImportData.matches.filter(function(m) {
      const id = m.id || (m.date + '_' + m.teams[0] + '_' + m.teams[1]);
      return !existingMatchIds.has(id);
    });
    finalMatches = currentMatches.concat(newMatchesToAdd);

    const existingPlayerNames = new Set(currentPlayers.map(function(p) {
      return p.name.trim().toLowerCase();
    }));
    const newPlayersToAdd = pendingImportData.players.filter(function(p) {
      return !existingPlayerNames.has(p.name.trim().toLowerCase());
    });
    finalPlayers = currentPlayers.concat(newPlayersToAdd);
  }

  saveMatches(finalMatches);
  saveRegisteredPlayers(finalPlayers);

  closeModal('import-confirm-modal');

  const addedMatches = mode === 'replace' ? finalMatches.length : (finalMatches.length - currentMatches.length);
  const addedPlayers = mode === 'replace' ? finalPlayers.length : (finalPlayers.length - currentPlayers.length);

  showToast('✅', mode === 'replace'
    ? ('Restored ' + finalMatches.length + ' matches & ' + finalPlayers.length + ' players!')
    : ('Imported ' + addedMatches + ' new matches & ' + addedPlayers + ' new players!'));

  pendingImportData = null;

  renderHomeScreen();
  renderHistoryScreen();
  if (typeof renderPlayerStatsScreen === 'function') renderPlayerStatsScreen();
  populateTeamDropdowns();
}

window.navigate       = navigate;
window.recordBall     = recordBall;
window.startSecondInnings = startSecondInnings;
window.viewMatchScorecard = viewMatchScorecard;
window.endMatch       = endMatch;
window.openHistoryMatch = openHistoryMatch;
window.openBowlerModal  = openBowlerModal;
window.openOpeningBattersModal = openOpeningBattersModal;
window.confirmOpeningBatters = confirmOpeningBatters;
window.selectTossWinner = selectTossWinner;
window.selectTossDecision = selectTossDecision;
window.downloadScorecard = downloadScorecard;
window.changeViewingOver = changeViewingOver;
window.jumpToLiveOver = jumpToLiveOver;
window.openPlayerRegistrationModal = openPlayerRegistrationModal;
window.closePlayerRegistrationModal = closePlayerRegistrationModal;
window.submitNewPlayer = submitNewPlayer;
window.deletePlayer = deletePlayer;
window.onPlayerDropdownSelect = onPlayerDropdownSelect;
window.quickFillSquad = quickFillSquad;
window.switchStatsTab = switchStatsTab;
window.filterPlayerStats = filterPlayerStats;
window.openPlayerProfile = openPlayerProfile;
window.exportAppData = exportAppData;
window.handleImportFile = handleImportFile;
window.executeImport = executeImport;
window.openTeamsModal = openTeamsModal;
window.closeTeamsModal = closeTeamsModal;
window.renderSavedTeamsList = renderSavedTeamsList;
window.filterSavedTeamsList = filterSavedTeamsList;
window.openTeamEditorModal = openTeamEditorModal;
window.addPlayerRowToTeamEditor = addPlayerRowToTeamEditor;
window.removePlayerRowFromTeamEditor = removePlayerRowFromTeamEditor;
window.addRegisteredToTeamEditor = addRegisteredToTeamEditor;
window.saveTeamFromEditor = saveTeamFromEditor;
window.deleteSavedTeam = deleteSavedTeam;
window.populateTeamDropdowns = populateTeamDropdowns;
window.onTeamSelectChange = onTeamSelectChange;
window.saveLineupAsTeam = saveLineupAsTeam;
window.selectWicketBatter = selectWicketBatter;

window.renderPlayerStatsScreen = renderPlayerStatsScreen;



// ============================================================
//  DOWNLOAD SCORECARD AS IMAGE
// ============================================================
function buildScorecardTableHTML(inn, teams) {
  const totalExtras = inn.extras.wides + inn.extras.noBalls + inn.extras.legByes + inn.extras.byes;
  const battingTeam = teams[inn.battingTeam];
  const bowlingTeam = teams[inn.bowlingTeam];

  // Batting table
  let battingRows = '';
  inn.battingPlayers.forEach((p, i) => {
    const hasBatted = p.balls > 0 || p.out || inn.currentBatters.includes(i);
    if (!hasBatted) return;
    const sr = p.balls > 0 ? ((p.runs / p.balls) * 100).toFixed(0) : '-';
    const statusText = p.out
      ? `<span style="color:#ef5350;font-size:10px">${p.dismissal}${p.fielder ? ` b/c ${p.fielder}` : ''}</span>`
      : `<span style="color:#00e676;font-size:10px">${inn.currentBatters.includes(i) ? '* Not Out' : 'Not Out'}</span>`;
    battingRows += `
      <tr>
        <td style="padding:5px 8px;border-bottom:1px solid #2a3040">
          <div style="font-weight:600;font-size:12px;color:#e8eaf6">${p.name}</div>
          ${statusText}
        </td>
        <td style="padding:5px 8px;border-bottom:1px solid #2a3040;text-align:center;font-weight:700;font-size:13px;color:#fff">${p.runs}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #2a3040;text-align:center;font-size:12px;color:#9e9e9e">${p.balls}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #2a3040;text-align:center;font-size:12px;color:#9e9e9e">${p.fours}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #2a3040;text-align:center;font-size:12px;color:#9e9e9e">${p.sixes}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #2a3040;text-align:center;font-size:12px;color:#9e9e9e">${sr}</td>
      </tr>`;
  });

  // Bowling table
  let bowlingRows = '';
  inn.bowlingPlayers.forEach(b => {
    if (b.overs === 0 && b.balls === 0) return;
    const totalBalls = b.overs * 6 + b.balls;
    const econ = totalBalls > 0 ? ((b.runs / totalBalls) * 6).toFixed(1) : '-';
    bowlingRows += `
      <tr>
        <td style="padding:5px 8px;border-bottom:1px solid #2a3040;font-weight:600;font-size:12px;color:#e8eaf6">${b.name}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #2a3040;text-align:center;font-size:12px;color:#9e9e9e">${formatOvers(b.overs, b.balls)}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #2a3040;text-align:center;font-size:12px;color:#9e9e9e">${b.maidens}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #2a3040;text-align:center;font-weight:700;font-size:13px;color:#fff">${b.runs}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #2a3040;text-align:center;font-weight:700;font-size:13px;color:#00e676">${b.wickets}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #2a3040;text-align:center;font-size:12px;color:#9e9e9e">${econ}</td>
      </tr>`;
  });

  const thStyle = `style="padding:6px 8px;text-align:center;font-size:10px;color:#78909c;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #374151"`;

  return `
    <div style="margin-bottom:16px">
      <div style="font-size:13px;font-weight:700;color:#00e676;margin-bottom:8px;letter-spacing:0.3px">🏏 ${battingTeam} Batting</div>
      <table style="width:100%;border-collapse:collapse;background:#1a2234;border-radius:8px;overflow:hidden">
        <thead><tr style="background:#0f1724">
          <th style="padding:6px 8px;text-align:left;font-size:10px;color:#78909c;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #374151">Batsman</th>
          <th ${thStyle}>R</th><th ${thStyle}>B</th><th ${thStyle}>4s</th><th ${thStyle}>6s</th><th ${thStyle}>SR</th>
        </tr></thead>
        <tbody>${battingRows}
          <tr style="background:#111827">
            <td colspan="2" style="padding:5px 8px;font-size:11px;color:#78909c">Extras (${inn.extras.wides}w ${inn.extras.noBalls}nb ${inn.extras.legByes}lb ${inn.extras.byes}b)</td>
            <td colspan="4" style="padding:5px 8px;text-align:right;font-size:12px;color:#9e9e9e">${totalExtras}</td>
          </tr>
          <tr style="background:#0f1724">
            <td colspan="2" style="padding:7px 8px;font-weight:700;font-size:13px;color:#fff">TOTAL</td>
            <td colspan="4" style="padding:7px 8px;text-align:right;font-weight:700;font-size:13px;color:#fff">${inn.runs}/${inn.wickets} (${formatOvers(inn.overs, inn.balls)} ov)</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div>
      <div style="font-size:13px;font-weight:700;color:#42a5f5;margin-bottom:8px;letter-spacing:0.3px">🎳 ${bowlingTeam} Bowling</div>
      <table style="width:100%;border-collapse:collapse;background:#1a2234;border-radius:8px;overflow:hidden">
        <thead><tr style="background:#0f1724">
          <th style="padding:6px 8px;text-align:left;font-size:10px;color:#78909c;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #374151">Bowler</th>
          <th ${thStyle}>O</th><th ${thStyle}>M</th><th ${thStyle}>R</th><th ${thStyle}>W</th><th ${thStyle}>Econ</th>
        </tr></thead>
        <tbody>${bowlingRows}</tbody>
      </table>
    </div>`;
}

async function downloadScorecard() {
  const matchToShow = viewingHistoryMatch || state;
  if (!matchToShow) { showToast('⚠️', 'No scorecard to download'); return; }

  showToast('⏳', 'Generating image…');

  const r = matchToShow.result;
  const isT = r && r.winner === 'Tie';
  const resultHTML = r ? `
    <div style="text-align:center;padding:16px 0 20px;border-bottom:1px solid #2a3040;margin-bottom:20px">
      <div style="font-size:36px;margin-bottom:6px">${isT ? '🤝' : '🏆'}</div>
      <div style="font-size:18px;font-weight:800;color:#fff;margin-bottom:4px">${isT ? "It's a Tie!" : r.winner + ' Won!'}</div>
      <div style="font-size:14px;color:#00e676;font-weight:600">by ${r.by}</div>
      <div style="font-size:11px;color:#546e7a;margin-top:6px">${matchToShow.date || ''}${matchToShow.venue ? ' • ' + matchToShow.venue : ''}</div>
    </div>` : '';

  const innings1HTML = matchToShow.innings[0] ? buildScorecardTableHTML(matchToShow.innings[0], matchToShow.teams) : '';
  const innings2Divider = matchToShow.innings[1] ? `<div style="height:1px;background:#2a3040;margin:20px 0"></div>` : '';
  const innings2HTML = matchToShow.innings[1] ? buildScorecardTableHTML(matchToShow.innings[1], matchToShow.teams) : '';

  // Build off-screen container
  const container = document.createElement('div');
  container.style.cssText = `
    position:fixed; left:-9999px; top:0;
    width:390px; padding:20px;
    background:#0d1117;
    font-family:'Inter',system-ui,sans-serif;
    color:#e8eaf6;
    box-sizing:border-box;
  `;
  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid #2a3040">
      <div style="font-size:28px">🏏</div>
      <div>
        <div style="font-size:18px;font-weight:800;color:#fff;letter-spacing:0.3px">My Crick</div>
        <div style="font-size:12px;color:#546e7a">Match Scorecard</div>
      </div>
      <div style="margin-left:auto;text-align:right">
        <div style="font-size:13px;font-weight:700;color:#e8eaf6">${matchToShow.teams[0]} vs ${matchToShow.teams[1]}</div>
        <div style="font-size:11px;color:#546e7a">${matchToShow.maxOvers} overs • ${matchToShow.numPlayers} players</div>
      </div>
    </div>
    ${resultHTML}
    ${innings1HTML}
    ${innings2Divider}
    ${innings2HTML}
    <div style="text-align:center;margin-top:18px;padding-top:14px;border-top:1px solid #1e2a38;font-size:10px;color:#37474f">
      Generated by My Crick • Local Cricket Manager
    </div>
  `;
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, {
      backgroundColor: '#0d1117',
      scale: 2,            // 2x for crisp display on mobile
      useCORS: true,
      logging: false
    });
    document.body.removeChild(container);

    // Download
    const link = document.createElement('a');
    const teamLabel = `${matchToShow.teams[0]}_vs_${matchToShow.teams[1]}`.replace(/\s+/g, '_');
    const dateLabel = (matchToShow.date || new Date().toLocaleDateString()).replace(/\//g, '-');
    link.download = `MyCrick_${teamLabel}_${dateLabel}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();

    showToast('📥', 'Scorecard downloaded!');
  } catch (err) {
    if (document.body.contains(container)) document.body.removeChild(container);
    console.error('Download failed:', err);
    showToast('❌', 'Download failed — try again');
  }
}
