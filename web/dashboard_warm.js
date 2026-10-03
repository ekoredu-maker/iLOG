/* iLOG Warm Classroom Dashboard
   기존 app.js의 기능을 바꾸지 않고 대시보드에 따뜻한 학급 맥락을 더한다. */
(function () {
  'use strict';

  const $ = (s, root = document) => root.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function todayStr() {
    try { if (typeof DBManager !== 'undefined' && DBManager.getTodayStr) return DBManager.getTodayStr(); } catch (_) {}
    return new Date().toLocaleDateString('en-CA');
  }

  function seasonMeta(d = new Date()) {
    const m = d.getMonth() + 1;
    if (m >= 3 && m <= 5) return { key: 'spring', icon: 'fa-seedling', label: '봄빛 교실', note: '새로운 발견이 자라는 계절이에요' };
    if (m >= 6 && m <= 8) return { key: 'summer', icon: 'fa-sun', label: '여름 교실', note: '밝은 에너지로 하루를 채워요' };
    if (m >= 9 && m <= 11) return { key: 'autumn', icon: 'fa-leaf', label: '가을빛 교실', note: '차분하게 배우고 익어가는 계절이에요' };
    return { key: 'winter', icon: 'fa-snowflake', label: '겨울 교실', note: '따뜻하게 한 해를 돌아보는 계절이에요' };
  }

  function greeting() {
    const h = new Date().getHours();
    if (h < 11) return '기분 좋은 아침이에요';
    if (h < 15) return '오늘 수업도 차근차근 이어가요';
    if (h < 19) return '오늘 하루도 잘 채워가고 있어요';
    return '오늘의 기록을 편안하게 정리해요';
  }

  function ensureLayout() {
    const dash = $('#dashboard');
    if (!dash) return false;

    const summary = dash.querySelector('.row.g-4.mb-4');
    if (!summary) return false;

    if (!$('#ilog-classroom-hero', dash)) {
      const hero = document.createElement('section');
      hero.id = 'ilog-classroom-hero';
      hero.className = 'ilog-classroom-hero';
      hero.innerHTML = `
        <div class="ilog-hero-copy">
          <div class="ilog-hero-kicker"><span class="ilog-spark">✦</span> <span id="ilog-season-label">우리 반의 오늘</span></div>
          <h2 id="ilog-hero-greeting">선생님, 오늘도 반가워요</h2>
          <div id="ilog-hero-class" class="ilog-hero-class">학급 정보를 불러오는 중이에요</div>
          <div class="ilog-hero-chips">
            <span class="ilog-chip ilog-chip-pink"><i class="fas fa-heart"></i><span id="ilog-hero-students">학생 -명</span></span>
            <span class="ilog-chip ilog-chip-sky"><i class="fas fa-calendar-day"></i><span id="ilog-hero-date">오늘</span></span>
            <span class="ilog-chip ilog-chip-mint"><i class="fas fa-cloud-sun"></i><span id="ilog-hero-season-note">우리 반의 하루</span></span>
          </div>
        </div>
        <div class="ilog-hero-art" aria-hidden="true">
          <div class="ilog-art-sun"></div>
          <div class="ilog-art-cloud c1"></div>
          <div class="ilog-art-cloud c2"></div>
          <div class="ilog-art-hill h1"></div>
          <div class="ilog-art-hill h2"></div>
          <div class="ilog-art-school"><i class="fas fa-school"></i></div>
          <span class="ilog-art-star s1">✦</span><span class="ilog-art-star s2">✦</span><span class="ilog-art-heart">♡</span>
        </div>`;
      summary.parentNode.insertBefore(hero, summary);
    }

    const cards = summary.querySelectorAll(':scope > .col-md-4');
    if (cards.length >= 3) {
      const third = cards[2];
      const label = third.querySelector('h6');
      const value = third.querySelector('h5, h3');
      const icon = third.querySelector('i.fs-1');
      if (label) label.textContent = '우리 반 학생';
      if (value) { value.id = 'dashboard-student-count'; value.textContent = '-명'; value.classList.remove('text-success'); }
      if (icon) { icon.className = 'fas fa-user-friends fs-1 opacity-25'; }
      third.classList.add('ilog-student-summary');
    }

    if (!$('#ilog-daily-board', dash)) {
      const row = document.createElement('div');
      row.id = 'ilog-daily-board';
      row.className = 'row g-4 mb-4 ilog-daily-board';
      row.innerHTML = `
        <div class="col-lg-7">
          <div class="card h-100 ilog-note-card ilog-tasks-card">
            <div class="card-body">
              <div class="ilog-card-title-row">
                <div><div class="ilog-mini-label">TODAY CHECK</div><h5><i class="fas fa-check-circle me-2"></i>오늘 챙길 일</h5></div>
                <button type="button" class="btn btn-sm ilog-soft-btn" data-ilog-go="tasks">업무 전체보기</button>
              </div>
              <div id="ilog-today-tasks" class="ilog-task-list"><div class="ilog-empty-soft">오늘 할 일을 불러오는 중이에요.</div></div>
            </div>
          </div>
        </div>
        <div class="col-lg-5">
          <div class="card h-100 ilog-note-card ilog-event-card">
            <div class="card-body">
              <div class="ilog-card-title-row">
                <div><div class="ilog-mini-label">NEXT MOMENT</div><h5><i class="fas fa-calendar-heart me-2"></i>다가오는 일정</h5></div>
                <button type="button" class="btn btn-sm ilog-soft-btn" data-ilog-go="scheduler-modal-trigger">달력 보기</button>
              </div>
              <div id="ilog-next-event" class="ilog-next-event"><div class="ilog-empty-soft">다음 일정을 찾는 중이에요.</div></div>
            </div>
          </div>
        </div>`;
      summary.insertAdjacentElement('afterend', row);
    }

    return true;
  }

  function prettyDate(ds) {
    if (!ds) return '';
    const d = new Date(ds + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return ds;
    return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
  }

  async function refresh() {
    if (!ensureLayout()) return;
    const dash = $('#dashboard');
    const login = $('#login-overlay');
    if (!dash || !dash.classList.contains('active') || (login && login.style.display !== 'none')) return;
    if (typeof SettingsRepo === 'undefined' || typeof StudentRepo === 'undefined' || typeof TaskRepo === 'undefined' || typeof SchoolEventRepo === 'undefined') return;

    try {
      const [settings, students, tasks, events] = await Promise.all([
        SettingsRepo.get(), StudentRepo.getAll(), TaskRepo.getAll(), SchoolEventRepo.getAll()
      ]);
      const teacher = (settings.teacherName || '').trim();
      const school = (settings.schoolName || '').trim();
      const grade = String(settings.grade || '').trim();
      const cls = String(settings.classNo || '').trim();
      const today = todayStr();
      const season = seasonMeta();

      const greetingEl = $('#ilog-hero-greeting');
      if (greetingEl) greetingEl.textContent = `${teacher ? teacher + ' 선생님, ' : '선생님, '}${greeting()}`;

      const classParts = [];
      if (school) classParts.push(school);
      if (grade || cls) classParts.push(`${grade ? grade + '학년' : ''}${grade && cls ? ' ' : ''}${cls ? cls + '반' : ''}`);
      const clsEl = $('#ilog-hero-class');
      if (clsEl) clsEl.textContent = classParts.length ? classParts.join(' · ') : '기본설정에서 우리 반 정보를 입력해 주세요';

      const stuText = `학생 ${students.length}명`;
      const hs = $('#ilog-hero-students'); if (hs) hs.textContent = stuText;
      const sc = $('#dashboard-student-count'); if (sc) sc.textContent = `${students.length}명`;
      const hd = $('#ilog-hero-date'); if (hd) hd.textContent = prettyDate(today);
      const sl = $('#ilog-season-label'); if (sl) sl.innerHTML = `<i class="fas ${season.icon} me-1"></i>${season.label}`;
      const sn = $('#ilog-hero-season-note'); if (sn) sn.textContent = season.note;
      const hero = $('#ilog-classroom-hero'); if (hero) hero.dataset.season = season.key;

      renderTasks(tasks, today);
      renderEvent(events, today);
    } catch (e) {
      console.debug('warm dashboard:', e);
    }
  }

  function renderTasks(tasks, today) {
    const box = $('#ilog-today-tasks');
    if (!box) return;
    const list = (tasks || [])
      .filter(t => t.status !== 'done' && t.dueDate && t.dueDate <= today)
      .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '') || String(a.title || '').localeCompare(String(b.title || '')));

    if (!list.length) {
      box.innerHTML = `<div class="ilog-all-clear"><span class="ilog-all-clear-icon">♡</span><div><strong>오늘은 급한 일이 없어요</strong><small>여유가 생긴 만큼 아이들을 천천히 바라봐도 좋아요.</small></div></div>`;
      return;
    }

    box.innerHTML = list.slice(0, 4).map(t => {
      const overdue = t.dueDate < today;
      return `<button type="button" class="ilog-task-row" data-ilog-go="tasks">
        <span class="ilog-task-check"><i class="far fa-circle"></i></span>
        <span class="ilog-task-main"><strong>${esc(t.title || '할 일')}</strong><small>${esc(t.category || '업무')}</small></span>
        <span class="ilog-due ${overdue ? 'overdue' : ''}">${overdue ? '미처리 · ' : ''}${esc(prettyDate(t.dueDate))}</span>
      </button>`;
    }).join('') + (list.length > 4 ? `<div class="ilog-more-note">외 ${list.length - 4}건이 더 있어요.</div>` : '');
  }

  function renderEvent(events, today) {
    const box = $('#ilog-next-event');
    if (!box) return;
    const list = (events || [])
      .filter(e => (e.endDate || e.startDate || '') >= today)
      .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
    const e = list[0];
    if (!e) {
      box.innerHTML = `<div class="ilog-event-empty"><i class="fas fa-paper-plane"></i><div><strong>등록된 다음 일정이 없어요</strong><small>학사일정을 넣으면 여기에서 먼저 알려드려요.</small></div></div>`;
      return;
    }
    const d = new Date(e.startDate + 'T00:00:00');
    const day = Number.isNaN(d.getTime()) ? '--' : String(d.getDate()).padStart(2, '0');
    const month = Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}월`;
    box.innerHTML = `<div class="ilog-event-preview ${e.isHoliday ? 'holiday' : ''}">
      <div class="ilog-event-date"><span>${esc(month)}</span><strong>${day}</strong></div>
      <div class="ilog-event-copy"><span class="ilog-event-badge">${e.isHoliday ? '쉬어가는 날' : '학교 일정'}</span><h6>${esc(e.title || '학교 일정')}</h6><small>${esc(prettyDate(e.startDate))}${e.endDate && e.endDate !== e.startDate ? ` ~ ${esc(prettyDate(e.endDate))}` : ''}</small></div>
    </div>`;
  }

  function go(target) {
    try {
      if (typeof navigate === 'function') return navigate(target);
      const link = document.querySelector(`#menu-list .nav-link[data-target="${target}"]`);
      if (link) link.click();
    } catch (_) {}
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-ilog-go]');
    if (!el) return;
    e.preventDefault();
    go(el.dataset.ilogGo);
  });

  function start() {
    if (!ensureLayout()) { setTimeout(start, 350); return; }
    refresh();
    const dash = $('#dashboard');
    if (dash) new MutationObserver(() => { if (dash.classList.contains('active')) setTimeout(refresh, 120); })
      .observe(dash, { attributes: true, attributeFilter: ['class'] });
    setInterval(refresh, 7000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 0));
  else setTimeout(start, 0);
})();
