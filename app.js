// 网球比赛管理系统
// 赛制：4 组 × 4 队单循环 → 每组前 2 名（共 8 队）→ 1/4 决赛 → 半决赛 → 季军赛 / 决赛
(function () {
  'use strict';

  const DB_KEY = 'tennis_tournament_v1';
  const GROUP_NAMES = ['A组', 'B组', 'C组', 'D组'];

  const DEFAULT_CATS = [
    { id: 'c1', name: '男子单打', type: 'singles' },
    { id: 'c2', name: '女子单打', type: 'singles' },
    { id: 'c3', name: '男子双打', type: 'doubles' },
    { id: 'c4', name: '女子双打', type: 'doubles' },
    { id: 'c5', name: '混合双打', type: 'doubles' }
  ];

  // ================= 核心算法（可单测） =================
  const Core = {
    // 单循环赛程（圆桌轮转法），返回按轮次分组的对阵
    pairs(teamIds) {
      const arr = teamIds.slice();
      const n = arr.length;
      const rounds = [];
      if (n < 2) return rounds;
      const list = n % 2 === 0 ? arr : arr.concat([null]);
      const m = list.length;
      for (let r = 0; r < m - 1; r++) {
        const round = [];
        for (let i = 0; i < m / 2; i++) {
          const a = list[i];
          const b = list[m - 1 - i];
          if (a && b) round.push(r % 2 === 0 ? [a, b] : [b, a]);
        }
        rounds.push(round);
        list.splice(1, 0, list.pop()); // 固定首位，其余轮转
      }
      return rounds;
    },

    // 小组积分排名：胜场 > 净胜分 > 总得分
    rankGroup(teamIds, matches) {
      const stats = new Map();
      teamIds.forEach((id) => stats.set(id, { id, played: 0, win: 0, lose: 0, sf: 0, sa: 0 }));
      matches.forEach((m) => {
        if (m.sA === null || m.sA === undefined) return;
        const a = stats.get(m.a);
        const b = stats.get(m.b);
        if (!a || !b) return;
        a.played++; b.played++;
        a.sf += Number(m.sA); a.sa += Number(m.sB);
        b.sf += Number(m.sB); b.sa += Number(m.sA);
        if (Number(m.sA) > Number(m.sB)) { a.win++; b.lose++; }
        else { b.win++; a.lose++; }
      });
      const rows = Array.from(stats.values()).map((s) => ({
        ...s,
        diff: s.sf - s.sa
      }));
      rows.sort((x, y) =>
        y.win - x.win || y.diff - x.diff || y.sf - x.sf || String(x.id).localeCompare(String(y.id))
      );
      rows.forEach((r, i) => { r.rank = i + 1; });
      return rows;
    },

    // 生成淘汰赛对阵（8 强）
    buildKo(standings) {
      // standings: { 'A组': [rows...], ... }
      const g = (name, idx) => standings[name][idx].id;
      const qfPairs = [
        [g('A组', 0), g('B组', 1)],
        [g('C组', 0), g('D组', 1)],
        [g('B组', 0), g('A组', 1)],
        [g('D组', 0), g('C组', 1)]
      ];
      const qf = qfPairs.map((p, i) => ({
        id: 'qf' + i,
        title: `1/4 决赛 ${i + 1}`,
        a: { team: p[0] },
        b: { team: p[1] },
        sA: null, sB: null
      }));
      const sf = [0, 1].map((i) => ({
        id: 'sf' + i,
        title: `半决赛 ${i + 1}`,
        a: { from: 'qf' + (i * 2), want: 'winner', label: `1/4决赛${i * 2 + 1}胜者` },
        b: { from: 'qf' + (i * 2 + 1), want: 'winner', label: `1/4决赛${i * 2 + 2}胜者` },
        sA: null, sB: null
      }));
      return {
        qf,
        sf,
        third: {
          id: 'third',
          title: '季军争夺赛',
          a: { from: 'sf0', want: 'loser', label: '半决赛1负者' },
          b: { from: 'sf1', want: 'loser', label: '半决赛2负者' },
          sA: null, sB: null
        },
        final: {
          id: 'final',
          title: '决赛',
          a: { from: 'sf0', want: 'winner', label: '半决赛1胜者' },
          b: { from: 'sf1', want: 'winner', label: '半决赛2胜者' },
          sA: null, sB: null
        }
      };
    },

    allMatches(ko) {
      return ko ? [].concat(ko.qf, ko.sf, [ko.third, ko.final]) : [];
    },

    findMatch(ko, id) {
      return this.allMatches(ko).find((m) => m.id === id) || null;
    },

    // 解析对阵一侧的实际队伍；未决出返回 null
    resolveSide(side, ko, depth) {
      if (!side) return null;
      if (side.team) return side.team;
      if ((depth || 0) > 6) return null;
      const src = this.findMatch(ko, side.from);
      if (!src || src.sA === null || src.sA === undefined) return null;
      const aWin = Number(src.sA) > Number(src.sB);
      const winner = aWin ? this.resolveSide(src.a, ko, (depth || 0) + 1) : this.resolveSide(src.b, ko, (depth || 0) + 1);
      const loser = aWin ? this.resolveSide(src.b, ko, (depth || 0) + 1) : this.resolveSide(src.a, ko, (depth || 0) + 1);
      return side.want === 'winner' ? winner : loser;
    },

    winnerOf(match, ko) {
      if (!match || match.sA === null || match.sA === undefined) return null;
      const a = this.resolveSide(match.a, ko);
      const b = this.resolveSide(match.b, ko);
      if (!a || !b) return null;
      return Number(match.sA) > Number(match.sB) ? a : b;
    },

    loserOf(match, ko) {
      if (!match || match.sA === null || match.sA === undefined) return null;
      const a = this.resolveSide(match.a, ko);
      const b = this.resolveSide(match.b, ko);
      if (!a || !b) return null;
      return Number(match.sA) > Number(match.sB) ? b : a;
    }
  };

  // ================= 状态 =================
  let state = null;

  function initState() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(DB_KEY) || 'null');
    } catch (e) { saved = null; }

    if (saved && saved.cats && saved.cats.length) {
      state = saved;
    } else {
      state = { cats: DEFAULT_CATS.map((c) => ({ ...c })), activeId: 'c1', seq: 100, data: {} };
      state.cats.forEach((c) => {
        state.data[c.id] = emptyCatData();
      });
      save();
    }
    state.cats.forEach((c) => {
      migrateCatData(c.id);
    });
    save();
  }

  // 兼容旧版数据结构：单赛事 → 多赛事（含比赛时间、归档标记）
  function migrateCatData(catId) {
    const d = state.data[catId];
    if (!d || !d.tournaments) {
      if (d && (d.teams || d.groups || d.gm || d.ko)) {
        const t = {
          id: 't1', date: todayStr(), archived: false,
          teams: d.teams || [], groups: d.groups || null,
          gm: d.gm || [], ko: d.ko || null
        };
        state.data[catId] = { tournaments: [t], activeTId: t.id };
      } else {
        state.data[catId] = emptyCatData();
      }
      return;
    }
    if (!d.tournaments.length) {
      const t = newTournamentObj();
      d.tournaments = [t];
      d.activeTId = t.id;
    } else if (!d.tournaments.find((t) => t.id === d.activeTId)) {
      d.activeTId = d.tournaments[0].id;
    }
  }

  function todayStr() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function newTournamentObj(date) {
    return {
      id: 't' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      date: date || todayStr(),
      archived: false,
      teams: [], groups: null, gm: [], ko: null
    };
  }

  function emptyCatData() {
    const t = newTournamentObj();
    return { tournaments: [t], activeTId: t.id };
  }

  function save() {
    localStorage.setItem(DB_KEY, JSON.stringify(state));
  }

  function cat() {
    return state.cats.find((c) => c.id === state.activeId) || state.cats[0];
  }

  function catData() {
    const c = cat();
    if (!state.data[c.id] || !state.data[c.id].tournaments) {
      state.data[c.id] = emptyCatData();
    }
    return state.data[c.id];
  }

  function db() {
    const d = catData();
    let t = d.tournaments.find((x) => x.id === d.activeTId);
    if (!t) {
      t = d.tournaments[0];
      d.activeTId = t.id;
    }
    return t;
  }

  function isReadOnly() {
    return !!db().archived;
  }

  function nextId(prefix) {
    state.seq = (state.seq || 100) + 1;
    return `${prefix}${state.seq}`;
  }

  // ================= 工具 =================
  const $ = (id) => document.getElementById(id);

  function toast(msg, type) {
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function teamLabel(teamId) {
    const t = db().teams.find((x) => x.id === teamId);
    return t ? t.players.join(' / ') : '未知队伍';
  }

  function played(m) {
    return m && m.sA !== null && m.sA !== undefined;
  }

  function koSideName(side, ko) {
    const id = Core.resolveSide(side, ko);
    if (id) return teamLabel(id);
    return side.label || '待定';
  }

  function koSideResolved(side, ko) {
    return !!Core.resolveSide(side, ko);
  }

  // ================= 渲染：类别 =================
  function renderCats() {
    const sel = $('catSelect');
    sel.innerHTML = state.cats
      .map((c) => `<option value="${c.id}" ${c.id === state.activeId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
      .join('');

    $('catGrid').innerHTML = state.cats.map((c) => {
      const cd = state.data[c.id];
      const teamCount = cd && cd.tournaments && cd.tournaments.length
        ? (cd.tournaments.find((t) => t.id === cd.activeTId) || cd.tournaments[0]).teams.length
        : 0;
      const active = c.id === state.activeId;
      const typeText = c.type === 'singles' ? '单打' : '双打';
      return `
        <div class="cat-card ${active ? 'active' : ''}" data-cat="${c.id}">
          <div class="cat-name">
            <span>${escapeHtml(c.name)}</span>
            ${state.cats.length > 1 ? `<button class="cat-del" data-delcat="${c.id}">删除</button>` : ''}
          </div>
          <div class="cat-meta">${typeText} · 已报名 ${teamCount} 队</div>
        </div>`;
    }).join('');

    $('signupCatHint').textContent =
      `当前：${cat().name}（${cat().type === 'singles' ? '单打，1 人一队' : '双打，2 人一队'}）`;
    $('p2').style.display = cat().type === 'doubles' ? '' : 'none';
    $('p2').placeholder = '队员 2 姓名（双打必填）';
    if (cat().type !== 'doubles') $('p2').value = '';
  }

  // ================= 渲染：报名 =================
  function renderTeams() {
    const d = db();
    const tbody = $('teamTbody');
    if (!d.teams.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="empty-cell">暂无报名队伍</td></tr>';
    } else {
      tbody.innerHTML = d.teams.map((t, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(t.players.join(' / '))}</td>
          <td><button class="cat-del" data-delteam="${t.id}">删除</button></td>
        </tr>`).join('');
    }
  }

  function renderGroups() {
    const d = db();
    const wrap = $('groupGrid');
    if (!d.groups) {
      wrap.innerHTML = '<div class="empty-ko" style="grid-column:1/-1;">尚未抽签。报满 16 队后点击「随机抽签」。</div>';
      return;
    }
    wrap.innerHTML = d.groups.map((g, gi) => `
      <div class="group-box">
        <div class="group-head">${GROUP_NAMES[gi]}（${g.length} 队）</div>
        ${g.map((tid, i) => `
          <div class="group-team">
            <span class="seed">${i + 1}</span>
            <span>${escapeHtml(teamLabel(tid))}</span>
          </div>`).join('')}
      </div>`).join('');
  }

  // ================= 渲染：小组赛 =================
  function groupMatchesOf(gi) {
    return db().gm.filter((m) => m.g === gi);
  }

  // 小组赛卡片（小组赛页与历史页共用）
  function buildGroupCardsHtml(d) {
    return d.groups.map((gids, gi) => {
      const ms = d.gm.filter((m) => m.g === gi);
      const standings = Core.rankGroup(gids, ms);

      const matchRows = ms.map((m) => {
        const done = played(m);
        const aWin = done && Number(m.sA) > Number(m.sB);
        const scoreText = done ? `${m.sA} : ${m.sB}` : '待录入';
        return `
          <div class="match-row">
            <span class="match-round">第${m.round}轮</span>
            <span class="match-team ${done && !aWin ? 'match-loser' : ''} ${done && aWin ? 'match-winner' : ''}">${escapeHtml(teamLabel(m.a))}</span>
            <span class="match-score ${done ? '' : 'pending'}" data-gm="${m.id}">${scoreText}</span>
            <span class="match-team right ${done && aWin ? 'match-loser' : ''} ${done && !aWin ? 'match-winner' : ''}">${escapeHtml(teamLabel(m.b))}</span>
          </div>`;
      }).join('');

      const standingRows = standings.map((s) => `
        <tr class="${s.rank <= 2 ? 'rank-' + s.rank : ''}">
          <td>${s.rank <= 2 ? '<span class="qualify">' + s.rank + '</span>' : s.rank}</td>
          <td>${escapeHtml(teamLabel(s.id))}</td>
          <td>${s.played}</td>
          <td>${s.win}</td>
          <td>${s.lose}</td>
          <td>${s.diff > 0 ? '+' + s.diff : s.diff}</td>
        </tr>`).join('');

      return `
        <section class="stage-group">
          <div class="stage-group-head">
            <span>${GROUP_NAMES[gi]}</span>
            <span class="tag tag-blue">前 2 名晋级</span>
          </div>
          <div class="stage-group-body">
            ${matchRows}
            <table class="standings-table">
              <thead>
                <tr><th>排名</th><th>队伍</th><th>赛</th><th>胜</th><th>负</th><th>净胜分</th></tr>
              </thead>
              <tbody>${standingRows}</tbody>
            </table>
          </div>
        </section>`;
    }).join('');
  }

  function renderGroupStage() {
    const d = db();
    const wrap = $('groupStageWrap');

    if (!d.groups || !d.gm.length) {
      wrap.innerHTML = '<section class="card"><div class="empty-ko">尚未生成小组赛程，请先在「报名分组」完成抽签并生成赛程。</div></section>';
      $('gmProgress').textContent = '';
      $('tourBadgeGroup').innerHTML = tourBadgeHtml();
      return;
    }

    wrap.innerHTML = `<div class="group-stage-grid">${buildGroupCardsHtml(d)}</div>`;

    const total = d.gm.length;
    const doneCount = d.gm.filter(played).length;
    $('gmProgress').textContent = `已完成 ${doneCount}/${total} 场`;
    $('btnBuildKo').disabled = doneCount < total;
    $('tourBadgeGroup').innerHTML = tourBadgeHtml();
  }

  // ================= 渲染：淘汰赛 =================
  function koCard(m, ko) {
    const aId = Core.resolveSide(m.a, ko);
    const bId = Core.resolveSide(m.b, ko);
    const done = played(m);
    const aWin = done && Number(m.sA) > Number(m.sB);
    const clickable = !!(aId && bId) && !isReadOnly();
    const side = (id, isA) => {
      const name = id ? teamLabel(id) : (isA ? m.a.label : m.b.label) || '待定';
      const cls = [];
      if (!id) cls.push('tbd');
      if (done) cls.push(isA === aWin ? 'win' : 'lose');
      return `
        <div class="ko-side ${cls.join(' ')}">
          <span class="name">${escapeHtml(name)}</span>
          <span class="score">${done ? (isA ? m.sA : m.sB) : '-'}</span>
        </div>`;
    };
    return `
      <div class="ko-match ${clickable ? 'clickable' : ''} ${done ? 'finished' : ''}" ${clickable ? `data-ko="${m.id}"` : ''}>
        <div class="ko-title">${m.title}</div>
        ${side(aId, true)}
        ${side(bId, false)}
      </div>`;
  }

  function championBannerHtml(ko) {
    const d = db();
    const championId = Core.winnerOf(ko.final, ko);
    if (!championId) return '';
    const runnerId = Core.loserOf(ko.final, ko);
    const thirdId = Core.winnerOf(ko.third, ko);
    return `
      <div class="champion">
        <div class="champion-icon">🏆</div>
        <div>
          <div class="champion-title">比赛时间 ${escapeHtml(d.date)} · 冠军</div>
          <div class="champion-name">${escapeHtml(teamLabel(championId))}</div>
        </div>
        <div class="champion-sub">
          <div>亚军：${escapeHtml(teamLabel(runnerId))}</div>
          <div>季军：${thirdId ? escapeHtml(teamLabel(thirdId)) : '待决出'}</div>
        </div>
      </div>`;
  }

  function bracketHtml(ko) {
    const championId = Core.winnerOf(ko.final, ko);
    return `
      <div class="bracket-col">
        <div class="bracket-col-title">1/4 决赛</div>
        ${ko.qf.map((m) => koCard(m, ko)).join('')}
      </div>
      <div class="bracket-col">
        <div class="bracket-col-title">半决赛</div>
        ${ko.sf.map((m) => koCard(m, ko)).join('')}
      </div>
      <div class="bracket-col">
        <div class="bracket-col-title">决赛阶段</div>
        ${koCard(ko.final, ko)}
        ${koCard(ko.third, ko)}
      </div>
      <div class="bracket-col">
        <div class="bracket-col-title">冠军</div>
        <div class="ko-match" style="text-align:center;padding:22px 12px;">
          <div style="font-size:34px;">${championId ? '🏆' : '🎾'}</div>
          <div style="margin-top:8px;font-weight:600;${championId ? '' : 'color:#c9cdd4;'}">
            ${championId ? escapeHtml(teamLabel(championId)) : '待决出'}
          </div>
        </div>
      </div>`;
  }

  function renderKo() {
    const d = db();
    const ko = d.ko;
    const box = $('bracket');
    const banner = $('championBanner');

    if (!ko) {
      banner.innerHTML = '';
      box.innerHTML = '<div class="empty-ko" style="grid-column:1/-1;">尚未生成淘汰赛对阵。请先在「小组赛」完成全部比赛后点击「生成淘汰赛对阵」。</div>';
      $('btnRebuildKo').style.display = 'none';
      $('tourBadgeKo').innerHTML = tourBadgeHtml();
      return;
    }
    $('btnRebuildKo').style.display = '';

    banner.innerHTML = championBannerHtml(ko);
    box.innerHTML = bracketHtml(ko);

    $('tourBadgeKo').innerHTML = tourBadgeHtml();
  }

  // ================= 渲染：历史赛事详情 =================
  function renderHistory() {
    const d = catData();
    const t = db();
    // 所有产生过比赛数据的赛事（进行中 + 已归档）都可回看
    const list = d.tournaments.filter((x) => (x.gm && x.gm.length) || x.ko);

    if (list.length) {
      $('histQuick').innerHTML = `<div class="tour-badge hist-switch"><span class="hist-switch-label">选择赛事：</span>${list
        .map((x) => {
          const champ = tournamentChampionLabel(x).replace(' · 冠军：', '');
          const label = `${x.date}${x.archived ? '（已归档）' : '（进行中）'}${champ ? ' · 冠军：' + champ : ''}`;
          return `<button class="btn-ghost btn-sm-hist ${x.id === d.activeTId ? 'hist-active' : ''}" data-histsel="${x.id}">${escapeHtml(label)}</button>`;
        })
        .join('')}</div>`;
    } else {
      $('histQuick').innerHTML =
        '<div class="empty-ko" style="margin-bottom:16px;">当前类别还没有任何比赛数据。完成小组赛或淘汰赛后，这里会自动出现历史记录；也可在「报名分组 → 赛事管理」新建赛事归档当前赛事。</div>';
    }

    $('histBadge').innerHTML = tourBadgeHtml() + (state.cats.length > 1
      ? `<div class="form-tip-inline">当前类别：${escapeHtml(cat().name)}（其他类别的历史请在右上角切换比赛类别后查看）</div>`
      : '');

    // 最终名次
    if (t.ko && Core.winnerOf(t.ko.final, t.ko)) {
      $('histChampion').innerHTML = championBannerHtml(t.ko);
    } else {
      $('histChampion').innerHTML = '<div class="empty-ko">该赛事尚未决出名次</div>';
    }

    // 小组赛全程
    $('histGroups').innerHTML = t.groups && t.gm.length
      ? `<div class="group-stage-grid">${buildGroupCardsHtml(t)}</div>`
      : '<div class="empty-ko">该赛事没有小组赛数据</div>';

    // 淘汰赛全程
    $('histKo').innerHTML = t.ko
      ? `<div class="bracket">${bracketHtml(t.ko)}</div>`
      : '<div class="empty-ko">该赛事没有淘汰赛数据</div>';
  }

  // ================= 渲染：赛事管理（历史归档） =================
  function tournamentChampionLabel(t) {
    if (!t.ko) return '';
    const champ = Core.winnerOf(t.ko.final, t.ko);
    if (!champ) return '';
    const team = t.teams.find((x) => x.id === champ);
    return team ? ` · 冠军：${team.players.join(' / ')}` : '';
  }

  function renderTournamentBar() {
    const d = catData();
    const t = db();
    $('tourSelect').innerHTML = d.tournaments
      .map((x) => {
        const label = `${x.date}（${x.archived ? '已归档' : '进行中'}）${tournamentChampionLabel(x)}`;
        return `<option value="${x.id}" ${x.id === d.activeTId ? 'selected' : ''}>${escapeHtml(label)}</option>`;
      })
      .join('');
    $('tourDate').value = t.date;
    $('tourDate').disabled = t.archived;
    $('tourStatus').textContent = t.archived ? '已归档（只读）' : '进行中';
    $('tourStatus').className = 'tag ' + (t.archived ? 'tag-orange' : 'tag-blue');
  }

  function tourBadgeHtml() {
    const t = db();
    return `<div class="tour-badge">🎾 比赛时间：${escapeHtml(t.date)}${t.archived ? '<span class="ro-tag">历史赛事 · 只读</span>' : ''}</div>`;
  }

  // ================= 赛事管理操作 =================
  function selectTournament(id, keepTab) {
    catData().activeTId = id;
    save();
    renderAll();
    if (keepTab) {
      switchTab('history');
      return;
    }
    // 选中历史赛事直接跳到详情页；选中进行中的赛事回到报名页
    switchTab(db().archived ? 'history' : 'signup');
  }

  function newTournament() {
    const d = catData();
    const cur = db();
    const hasData = cur.teams.length || cur.gm.length || cur.ko;
    if (hasData && !confirm('将归档当前赛事并创建新赛事，确定继续吗？')) return;
    if (hasData) cur.archived = true;
    const t = newTournamentObj();
    d.tournaments.push(t);
    d.activeTId = t.id;
    save();
    renderAll();
    switchTab('signup');
    toast('新赛事已创建' + (hasData ? '，原赛事已归档可在历史中查看' : ''), 'success');
  }

  function deleteTournament() {
    const d = catData();
    if (d.tournaments.length <= 1) return toast('至少保留一个赛事', 'error');
    const t = db();
    if (!confirm(`确定删除赛事（${t.date}）及其全部报名与赛程数据吗？`)) return;
    d.tournaments = d.tournaments.filter((x) => x.id !== t.id);
    d.activeTId = d.tournaments[d.tournaments.length - 1].id;
    save();
    renderAll();
    toast('赛事已删除', 'success');
  }

  function changeTourDate() {
    const t = db();
    if (t.archived) {
      renderTournamentBar();
      return toast('历史赛事为只读，不能修改比赛时间', 'error');
    }
    t.date = $('tourDate').value || todayStr();
    save();
    renderAll();
    toast('比赛时间已更新', 'success');
  }

  // ================= 渲染总入口 =================
  function renderAll() {
    renderCats();
    renderTournamentBar();
    renderTeams();
    renderGroups();
    renderGroupStage();
    renderKo();
    renderHistory();
  }

  // ================= 操作：类别 / 报名 =================
  function addCategory() {
    const name = $('newCatName').value.trim();
    const type = $('newCatType').value;
    if (!name) return toast('请填写类别名称', 'error');
    if (state.cats.some((c) => c.name === name)) return toast('类别已存在', 'error');
    const c = { id: 'c' + Date.now(), name, type };
    state.cats.push(c);
    state.data[c.id] = emptyCatData();
    state.activeId = c.id;
    $('newCatName').value = '';
    save();
    renderAll();
    toast('类别已添加', 'success');
  }

  function deleteCategory(id) {
    if (state.cats.length <= 1) return toast('至少保留一个类别', 'error');
    const c = state.cats.find((x) => x.id === id);
    if (!c) return;
    if (!confirm(`确定删除类别「${c.name}」及其全部报名、赛程数据吗？`)) return;
    state.cats = state.cats.filter((x) => x.id !== id);
    delete state.data[id];
    if (state.activeId === id) state.activeId = state.cats[0].id;
    save();
    renderAll();
    toast('已删除', 'success');
  }

  function addTeam() {
    const p1 = $('p1').value.trim();
    const p2 = $('p2').value.trim();
    const type = cat().type;
    if (isReadOnly()) return toast('历史赛事为只读，请切换到进行中的赛事', 'error');
    if (!p1) return toast('请填写队员姓名', 'error');
    if (type === 'doubles' && !p2) return toast('双打项目需填写 2 名队员', 'error');

    const d = db();
    if (d.teams.length >= 16) return toast('每个类别最多 16 队', 'error');
    if (d.gm.some(played) || (d.ko && Core.allMatches(d.ko).some(played))) {
      return toast('比赛已开始，不能新增队伍', 'error');
    }

    const players = type === 'doubles' ? [p1, p2] : [p1];
    const label = players.join(' / ');
    if (d.teams.some((t) => t.players.join(' / ') === label)) {
      return toast('该队伍已报名', 'error');
    }

    d.teams.push({ id: nextId('t'), players });
    $('p1').value = '';
    $('p2').value = '';
    save();
    renderAll();
    toast(`报名成功（${d.teams.length}/16）`, 'success');
  }

  function deleteTeam(id) {
    if (isReadOnly()) return toast('历史赛事为只读，不能删除队伍', 'error');
    const d = db();
    if (d.gm.some(played) || (d.ko && Core.allMatches(d.ko).some(played))) {
      return toast('比赛已开始，不能删除队伍', 'error');
    }
    d.teams = d.teams.filter((t) => t.id !== id);
    d.groups = null;
    d.gm = [];
    d.ko = null;
    save();
    renderAll();
    toast('已删除', 'success');
  }

  // ================= 操作：抽签与赛程 =================
  function drawGroups() {
    if (isReadOnly()) return toast('历史赛事为只读，不能重新抽签', 'error');
    const d = db();
    if (d.teams.length !== 16) {
      return toast(`需报满 16 队才能抽签（当前 ${d.teams.length} 队）`, 'error');
    }
    if (d.gm.some(played)) return toast('小组赛已开始，不能重新抽签', 'error');
    if (d.ko && Core.allMatches(d.ko).some(played)) return toast('淘汰赛已开始，不能重新抽签', 'error');
    if (d.groups && !confirm('重新抽签将清空已生成的小组赛程，确定继续吗？')) return;

    const shuffled = d.teams.map((t) => t.id).sort(() => Math.random() - 0.5);
    d.groups = [0, 1, 2, 3].map((i) => shuffled.slice(i * 4, i * 4 + 4));
    d.gm = [];
    d.ko = null;
    save();
    renderAll();
    toast('抽签完成', 'success');
  }

  function drawGroupsSilent() {
    const d = db();
    const shuffled = d.teams.map((t) => t.id).sort(() => Math.random() - 0.5);
    d.groups = [0, 1, 2, 3].map((i) => shuffled.slice(i * 4, i * 4 + 4));
    d.gm = [];
    d.ko = null;
  }

  function generateGroupMatches(silent) {
    if (!silent && isReadOnly()) {
      toast('历史赛事为只读，不能生成赛程', 'error');
      return false;
    }
    const d = db();
    if (!d.groups) {
      if (!silent) toast('请先完成抽签', 'error');
      return false;
    }
    if (d.gm.some(played)) {
      if (!silent) toast('已有比赛结果，不能重新生成赛程', 'error');
      return false;
    }
    if (!silent && d.gm.length && !confirm('重新生成将清空当前赛程，确定继续吗？')) return false;

    const gm = [];
    d.groups.forEach((ids, gi) => {
      const rounds = Core.pairs(ids);
      rounds.forEach((round, ri) => {
        round.forEach(([a, b]) => {
          gm.push({
            id: nextId('m'),
            g: gi,
            round: ri + 1,
            a, b,
            sA: null, sB: null
          });
        });
      });
    });
    d.gm = gm;
    d.ko = null;
    save();
    if (!silent) {
      renderAll();
      switchTab('group');
      toast('小组赛程已生成', 'success');
    }
    return true;
  }

  function groupStandings() {
    const d = db();
    const map = {};
    d.groups.forEach((ids, gi) => {
      map[GROUP_NAMES[gi]] = Core.rankGroup(ids, groupMatchesOf(gi));
    });
    return map;
  }

  function buildKo(silent) {
    if (!silent && isReadOnly()) {
      toast('历史赛事为只读，不能生成对阵', 'error');
      return false;
    }
    const d = db();
    if (!d.gm.length || d.gm.some((m) => !played(m))) {
      if (!silent) toast('请先完成全部小组赛', 'error');
      return false;
    }
    if (d.ko && Core.allMatches(d.ko).some(played)) {
      if (!silent && !confirm('重新生成对阵将清空淘汰赛比分，确定继续吗？')) return false;
    }
    d.ko = Core.buildKo(groupStandings());
    save();
    if (!silent) {
      renderAll();
      switchTab('ko');
      toast('淘汰赛对阵已生成', 'success');
    }
    return true;
  }

  // ================= 比分弹窗 =================
  let editing = null; // { scope: 'gm' | 'ko', id }

  function openScore(scope, id) {
    if (isReadOnly()) return toast('历史赛事为只读，仅可查看', 'error');
    if (scope === 'gm') {
      const m = db().gm.find((x) => x.id === id);
      if (!m) return;
      editing = { scope, id };
      $('scoreModalTitle').textContent = `小组赛 第${m.round}轮`;
      $('scoreNameA').textContent = teamLabel(m.a);
      $('scoreNameB').textContent = teamLabel(m.b);
      $('scoreA').value = played(m) ? m.sA : '';
      $('scoreB').value = played(m) ? m.sB : '';
    } else {
      const ko = db().ko;
      if (!ko) return;
      const m = Core.findMatch(ko, id);
      if (!m) return;
      const aId = Core.resolveSide(m.a, ko);
      const bId = Core.resolveSide(m.b, ko);
      if (!aId || !bId) return toast('对阵尚未确定', 'error');
      editing = { scope, id };
      $('scoreModalTitle').textContent = m.title;
      $('scoreNameA').textContent = teamLabel(aId);
      $('scoreNameB').textContent = teamLabel(bId);
      $('scoreA').value = played(m) ? m.sA : '';
      $('scoreB').value = played(m) ? m.sB : '';
    }
    $('scoreMask').style.display = 'flex';
  }

  function closeScore() {
    editing = null;
    $('scoreMask').style.display = 'none';
  }

  function saveScore() {
    if (!editing) return;
    const sA = $('scoreA').value.trim();
    const sB = $('scoreB').value.trim();
    if (sA === '' || sB === '') return toast('请填写双方比分', 'error');
    const a = Number(sA);
    const b = Number(sB);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) {
      return toast('比分需为非负整数', 'error');
    }
    if (a === b) return toast('网球比赛不能出现平局，请填写不同比分', 'error');

    const d = db();
    let changedKo = false;
    if (editing.scope === 'gm') {
      const m = d.gm.find((x) => x.id === editing.id);
      if (!m) return;
      m.sA = a; m.sB = b;
      // 小组赛结果变化会改变晋级队伍，需重新生成淘汰赛
      if (d.ko) { d.ko = null; changedKo = true; }
    } else {
      const m = Core.findMatch(d.ko, editing.id);
      if (!m) return;
      m.sA = a; m.sB = b;
      // 上游比分变化后，依赖该结果的下游比赛比分失效
      clearDependents(d.ko, editing.id);
    }
    save();
    closeScore();
    renderAll();
    if (changedKo) toast('比分已保存，请重新生成淘汰赛对阵', 'success');
    else toast('比分已保存', 'success');
  }

  function clearScore() {
    if (!editing) return;
    const d = db();
    if (editing.scope === 'gm') {
      const m = d.gm.find((x) => x.id === editing.id);
      if (!m) return;
      m.sA = null; m.sB = null;
      if (d.ko) d.ko = null;
    } else {
      const ko = d.ko;
      const m = Core.findMatch(ko, editing.id);
      if (!m) return;
      m.sA = null; m.sB = null;
      // 清除上游结果时，下游依赖的比赛结果同步失效
      clearDependents(ko, editing.id);
    }
    save();
    closeScore();
    renderAll();
    toast('结果已清除', 'success');
  }

  // 判断某场比赛是否（间接）依赖另一场比赛的结果
  function dependsOn(ko, match, id, depth) {
    if (!match || (depth || 0) > 6) return false;
    const sides = [match.a, match.b];
    for (const s of sides) {
      if (!s || !s.from) continue;
      if (s.from === id) return true;
      const src = Core.findMatch(ko, s.from);
      if (src && dependsOn(ko, src, id, (depth || 0) + 1)) return true;
    }
    return false;
  }

  // 清理依赖指定比赛结果的所有下游比分
  function clearDependents(ko, id) {
    Core.allMatches(ko).forEach((m) => {
      if (m.id !== id && dependsOn(ko, m, id)) {
        m.sA = null;
        m.sB = null;
      }
    });
  }

  // ================= Tab 切换 =================
  let currentTab = 'signup';

  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.nav-tab').forEach((el) => {
      el.classList.toggle('active', el.dataset.tab === tab);
    });
    $('tab-signup').style.display = tab === 'signup' ? '' : 'none';
    $('tab-group').style.display = tab === 'group' ? '' : 'none';
    $('tab-ko').style.display = tab === 'ko' ? '' : 'none';
    $('tab-history').style.display = tab === 'history' ? '' : 'none';
    if (tab === 'history') renderHistory();
  }

  // ================= 演示数据 =================
  const DEMO_NAMES = [
    ['张伟', '王强'], ['李娜', '刘洋'], ['陈晨', '赵磊'], ['杨帆', '周涛'],
    ['吴迪', '徐鹏'], ['孙悦', '马超'], ['朱琳', '胡军'], ['郭婷', '林峰'],
    ['何欣', '高远'], ['罗静', '梁宇'], ['宋佳', '唐斌'], ['许阳', '邓超'],
    ['冯雪', '曹阳'], ['彭飞', '曾敏'], ['萧然', '蒋涛'], ['田野', '董浩']
  ];

  function fillDemo() {
    if (isReadOnly()) return toast('历史赛事为只读，请切换到进行中的赛事', 'error');
    const d = db();
    if (d.gm.some(played) || (d.ko && Core.allMatches(d.ko).some(played))) {
      return toast('比赛已开始，无法生成演示数据', 'error');
    }
    if (!confirm('将用演示数据覆盖当前类别的报名与赛程，并自动模拟全部比赛，确定继续吗？')) return;

    const type = cat().type;
    d.teams = DEMO_NAMES.slice(0, 16).map((pair, i) => ({
      id: 'demo_t' + (i + 1),
      players: type === 'doubles' ? pair.slice(0, 2) : [pair[0] + (i >= 8 ? String(i + 1) : '')]
    }));

    drawGroupsSilent();
    generateGroupMatches(true);

    // 自动填充小组赛比分
    d.gm.forEach((m) => {
      const winA = Math.random() > 0.5;
      const hi = 6;
      const lo = Math.floor(Math.random() * 5);
      m.sA = winA ? hi : lo;
      m.sB = winA ? lo : hi;
    });

    d.ko = Core.buildKo(groupStandings());
    Core.allMatches(d.ko).forEach((m) => {
      const winA = Math.random() > 0.5;
      const hi = 6;
      const lo = Math.floor(Math.random() * 5);
      m.sA = winA ? hi : lo;
      m.sB = winA ? lo : hi;
    });

    save();
    renderAll();
    switchTab('ko');
    toast('演示数据已生成', 'success');
  }

  // ================= 事件绑定 =================
  $('catSelect').addEventListener('change', (e) => {
    state.activeId = e.target.value;
    save();
    renderAll();
    switchTab(currentTab);
  });

  $('catGrid').addEventListener('click', (e) => {
    const del = e.target.closest('[data-delcat]');
    if (del) {
      e.stopPropagation();
      return deleteCategory(del.dataset.delcat);
    }
    const card = e.target.closest('[data-cat]');
    if (card) {
      state.activeId = card.dataset.cat;
      save();
      renderAll();
      switchTab(currentTab);
    }
  });

  $('btnAddCat').addEventListener('click', addCategory);
  $('newCatName').addEventListener('keydown', (e) => { if (e.key === 'Enter') addCategory(); });

  $('btnAddTeam').addEventListener('click', addTeam);
  ['p1', 'p2'].forEach((id) => {
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') addTeam(); });
  });

  $('teamTbody').addEventListener('click', (e) => {
    const del = e.target.closest('[data-delteam]');
    if (del) deleteTeam(del.dataset.delteam);
  });

  $('btnDraw').addEventListener('click', drawGroups);
  $('btnGenGM').addEventListener('click', () => generateGroupMatches(false));
  $('btnBuildKo').addEventListener('click', () => buildKo(false));
  $('btnDemo').addEventListener('click', fillDemo);

  // 赛事管理
  $('tourSelect').addEventListener('change', (e) => selectTournament(e.target.value));
  $('btnNewTour').addEventListener('click', newTournament);
  $('btnDeleteTour').addEventListener('click', deleteTournament);
  $('tourDate').addEventListener('change', changeTourDate);

  $('btnRebuildKo').addEventListener('click', () => {
    if (isReadOnly()) return toast('历史赛事为只读，不能重新生成对阵', 'error');
    if (!db().ko) return;
    if (!confirm('重新生成将根据当前小组排名重建对阵并清空淘汰赛比分，确定继续吗？')) return;
    buildKo(true);
    renderAll();
    toast('对阵已重新生成', 'success');
  });

  // 小组赛比分点击
  $('groupStageWrap').addEventListener('click', (e) => {
    const el = e.target.closest('[data-gm]');
    if (el) openScore('gm', el.dataset.gm);
  });

  // 历史页往届快捷入口
  $('histQuick').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-histsel]');
    if (btn) selectTournament(btn.dataset.histsel, true);
  });

  // 顶部 Tab 切换
  document.querySelectorAll('.nav-tab').forEach((el) => {
    el.addEventListener('click', () => switchTab(el.dataset.tab));
  });

  // 淘汰赛比分点击
  $('bracket').addEventListener('click', (e) => {
    const el = e.target.closest('[data-ko]');
    if (el) openScore('ko', el.dataset.ko);
  });

  // 比分弹窗按钮
  $('btnScoreSave').addEventListener('click', saveScore);
  $('btnScoreCancel').addEventListener('click', closeScore);
  $('btnScoreClear').addEventListener('click', clearScore);
  $('scoreMask').addEventListener('click', (e) => {
    if (e.target === $('scoreMask')) closeScore();
  });
  ['scoreA', 'scoreB'].forEach((id) => {
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') saveScore(); });
  });

  // ================= 启动 =================
  initState();
  renderAll();
  switchTab('signup');

  // 暴露核心算法用于自动化测试
  window.__tennisCore = Core;

  if (!state.cats.some((c) => c.id === state.activeId)) {
    state.activeId = state.cats[0].id;
    save();
    renderAll();
  }
})();
