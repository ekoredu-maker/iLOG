(() => {
  'use strict';

  const ORDER_PREFIX = 'subject_order_';
  const originalGetAll = SubjectRepo.getAll.bind(SubjectRepo);
  const originalStringToColor = stringToColor;
  const byId = new Map();
  const aliasToId = new Map();
  let rowBusy = false;
  let labelPatched = false;

  const norm = (v) => String(v ?? '').replace(/\s+/g, '').trim();
  const orderKey = (s) => `${ORDER_PREFIX}${Number(s.schoolYear) || new Date().getFullYear()}_${Number(s.grade) || 0}_${String(s.classNo || '0')}`;

  function unlocked() {
    try {
      if (typeof isLocked !== 'undefined') return isLocked === false;
    } catch (_) {}
    const overlay = document.getElementById('login-overlay');
    return !!overlay && getComputedStyle(overlay).display === 'none';
  }

  function cacheSubjects(list) {
    byId.clear();
    aliasToId.clear();
    list.forEach(s => {
      const id = String(s.subjectId || '');
      if (!id) return;
      byId.set(id, s);
      [s.subjectId, s.name, s.shortName].forEach(v => {
        const k = norm(v);
        if (k) aliasToId.set(k, id);
      });
    });
  }

  SubjectRepo.getAll = async () => {
    const list = await originalGetAll();
    let rec = null;
    try {
      const st = await SettingsRepo.get();
      rec = await DBManager.get('settings', orderKey(st));
    } catch (_) {}
    const order = Array.isArray(rec?.order) ? rec.order.map(String) : [];
    const rank = new Map(order.map((id, i) => [id, i]));
    const rawRank = new Map(list.map((s, i) => [String(s.subjectId || ''), i]));
    list.sort((a, b) => {
      const ai = rank.has(String(a.subjectId)) ? rank.get(String(a.subjectId)) : order.length + (rawRank.get(String(a.subjectId)) || 0);
      const bi = rank.has(String(b.subjectId)) ? rank.get(String(b.subjectId)) : order.length + (rawRank.get(String(b.subjectId)) || 0);
      return ai - bi;
    });
    cacheSubjects(list);
    return list;
  };

  stringToColor = function(value) {
    const id = aliasToId.get(norm(value));
    return originalStringToColor(id || norm(value));
  };

  setCell = function(c, id, nm) {
    const s = byId.get(String(id || ''));
    const shortName = String(s?.shortName || nm || '');
    const fullName = String(s?.name || shortName);
    const color = stringToColor(s?.subjectId || fullName);
    c.innerHTML = `<div class="ilog-subject-chip" style="background-color:${color}"><span class="badge bg-dark bg-opacity-25 me-1">${h(shortName)}</span><span class="ilog-subject-chip-name">${h(fullName)}</span></div>`;
    c.dataset.sid = id;
    c.dataset.sname = shortName;
  };

  async function saveOrder(list) {
    const st = await SettingsRepo.get();
    await DBManager.put('settings', {
      id: orderKey(st),
      schoolYear: Number(st.schoolYear) || new Date().getFullYear(),
      grade: Number(st.grade) || 0,
      classNo: String(st.classNo || '0'),
      order: list.map(s => String(s.subjectId)),
      updatedAt: new Date().toISOString()
    });
  }

  async function moveSubject(subjectId, delta) {
    const list = await SubjectRepo.getAll();
    const i = list.findIndex(s => String(s.subjectId) === String(subjectId));
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await saveOrder(list);
    if (typeof loadSubjects === 'function') await loadSubjects();
    if (document.getElementById('timetable-pane')?.classList.contains('active') && typeof loadTimetable === 'function') {
      await loadTimetable();
    }
    setTimeout(enhanceSubjectRows, 30);
  }

  async function enhanceSubjectRows() {
    if (!unlocked() || rowBusy) return;
    const tbody = document.getElementById('subject-list-body');
    if (!tbody) return;
    rowBusy = true;
    try {
      const list = await SubjectRepo.getAll();
      const rows = [...tbody.querySelectorAll('tr')];
      if (!list.length || rows.length !== list.length) return;
      rows.forEach((tr, i) => {
        if (tr.dataset.ilogOrderReady === '1') return;
        const cell = tr.lastElementChild;
        if (!cell) return;
        const s = list[i];
        const wrap = document.createElement('span');
        wrap.className = 'ilog-order-buttons me-1';
        const up = document.createElement('button');
        up.type = 'button';
        up.className = 'btn btn-sm btn-outline-secondary me-1';
        up.innerHTML = '<i class="fas fa-arrow-up"></i>';
        up.title = '위로 이동';
        up.disabled = i === 0;
        up.addEventListener('click', (e) => {
          e.stopPropagation();
          moveSubject(s.subjectId, -1).catch(showError);
        });
        const down = document.createElement('button');
        down.type = 'button';
        down.className = 'btn btn-sm btn-outline-secondary me-1';
        down.innerHTML = '<i class="fas fa-arrow-down"></i>';
        down.title = '아래로 이동';
        down.disabled = i === list.length - 1;
        down.addEventListener('click', (e) => {
          e.stopPropagation();
          moveSubject(s.subjectId, 1).catch(showError);
        });
        wrap.append(up, down);
        cell.prepend(wrap);
        tr.dataset.ilogOrderReady = '1';
      });
    } finally {
      rowBusy = false;
    }
  }

  function patchLabels() {
    const tab = document.querySelector('a[href="#subject-pane"]');
    if (tab) tab.textContent = '담임 개설과목';

    const tbody = document.getElementById('subject-list-body');
    const subjectCard = tbody?.closest('.card');
    const subjectHeader = subjectCard?.querySelector('.card-header .fw-bold, .card-header');
    if (subjectHeader && !subjectHeader.querySelector('#subject-count')) subjectHeader.textContent = '담임 개설과목';
    else if (subjectHeader) {
      const textNode = [...subjectHeader.childNodes].find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
      if (textNode) textNode.textContent = '담임 개설과목';
      const span = subjectHeader.querySelector('.fw-bold');
      if (span) span.textContent = '담임 개설과목';
    }

    const addCard = document.getElementById('subName')?.closest('.card');
    const addHeader = addCard?.querySelector('.card-header');
    if (addHeader) addHeader.textContent = '담임 개설과목 추가';

    const palette = document.getElementById('draggable-subjects')?.closest('.card');
    const paletteHeader = palette?.querySelector('.card-header');
    if (paletteHeader) paletteHeader.textContent = '담임 개설과목 팔레트 (드래그)';
    labelPatched = true;
  }

  function weekRows(container) {
    return [...container.querySelectorAll('details')].filter(d => {
      const s = d.querySelector(':scope > summary');
      return s && /주간 과목별/.test(s.textContent || '');
    });
  }

  function renumberWeeks() {
    const containers = [
      document.getElementById('curriculum-management-panel'),
      document.getElementById('instruction-hours-panel')
    ].filter(Boolean);
    containers.forEach(container => {
      weekRows(container).forEach(detail => {
        const rows = [...detail.querySelectorAll('tbody tr')];
        let weekNo = 0;
        rows.forEach(tr => {
          const first = tr.querySelector('td');
          if (!first) return;
          const m = (first.textContent || '').match(/\d{4}-\d{2}-\d{2}/);
          if (!m) return;
          weekNo += 1;
          const start = m[0];
          const d = new Date(start + 'T00:00:00');
          d.setDate(d.getDate() + 4);
          const end = d.toISOString().slice(0, 10);
          const desired = `제${weekNo}주 ${start}~${end}`;
          if (first.dataset.ilogWeekNo === String(weekNo) && (first.textContent || '').replace(/\s+/g, ' ').trim() === desired) return;
          first.innerHTML = `<b>제${weekNo}주</b><br><small>${start}~${end}</small>`;
          first.dataset.ilogWeekNo = String(weekNo);
        });
      });
    });
  }

  function installStyle() {
    if (document.getElementById('ilog-curriculum-polish-style')) return;
    const style = document.createElement('style');
    style.id = 'ilog-curriculum-polish-style';
    style.textContent = `
      .ilog-order-buttons{display:inline-flex;vertical-align:middle}
      .ilog-subject-chip{display:flex;align-items:center;justify-content:flex-start;gap:.15rem;width:100%;min-height:34px;border-radius:8px;padding:.35rem .45rem;color:#27313a;box-shadow:inset 0 0 0 1px rgba(0,0,0,.05)}
      .ilog-subject-chip-name{font-weight:700;font-size:.82rem;line-height:1.1}
      #timetable-grid td.droppable{padding:.3rem!important}
      #draggable-subjects .draggable-item{border:1px solid rgba(0,0,0,.05)!important;border-radius:8px!important}
      #subject-list-body .ilog-order-buttons .btn{padding:.18rem .4rem}
    `;
    document.head.appendChild(style);
  }

  function polish() {
    installStyle();
    if (!labelPatched) patchLabels();
    if (unlocked()) enhanceSubjectRows().catch(() => {});
    renumberWeeks();
  }

  document.addEventListener('DOMContentLoaded', () => {
    patchLabels();
    installStyle();
    const tbody = document.getElementById('subject-list-body');
    if (tbody) new MutationObserver(() => {
      if (unlocked()) setTimeout(enhanceSubjectRows, 10);
    }).observe(tbody, {childList:true, subtree:false});

    const annual = document.getElementById('annual-plan');
    if (annual) new MutationObserver(() => setTimeout(renumberWeeks, 20)).observe(annual, {childList:true, subtree:true});

    document.getElementById('tab-timetable')?.addEventListener('click', () => setTimeout(() => {
      if (unlocked() && typeof loadTimetable === 'function') loadTimetable().catch(showError);
    }, 30));

    setTimeout(polish, 500);
  });

  window.addEventListener('pywebviewready', () => setTimeout(polish, 300));
})();