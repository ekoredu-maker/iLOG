/* iLOG Warm Workdesk behavior
   통계/서식/업무 화면의 DOM에 표시된 값만 사용한다.
   로그인 전 DB/API를 직접 읽지 않으므로 잠금 상태를 건드리지 않는다. */
(function () {
  'use strict';

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

  function isActive(id) {
    const el = document.getElementById(id);
    return !!(el && el.classList.contains('active'));
  }

  function ensureStatsOverview() {
    const section = $('#stats .container-fluid');
    if (!section || $('#ilog-stats-overview', section)) return;
    const h = section.querySelector(':scope > h4');
    if (!h) return;
    const box = document.createElement('div');
    box.id = 'ilog-stats-overview';
    box.className = 'ilog-work-overview';
    box.innerHTML = `
      <div class="ilog-work-mini sky"><span class="mini-icon"><i class="fas fa-users"></i></span><div><small>우리 반 학생</small><strong id="ilog-stats-students">0명</strong></div></div>
      <div class="ilog-work-mini pink"><span class="mini-icon"><i class="fas fa-user-clock"></i></span><div><small>결석 누계</small><strong id="ilog-stats-absent">0일</strong></div></div>
      <div class="ilog-work-mini mint"><span class="mini-icon"><i class="fas fa-book-open"></i></span><div><small>지금 보는 기록</small><strong id="ilog-stats-current">학급 전체</strong></div></div>`;
    h.insertAdjacentElement('afterend', box);
  }

  function refreshStats() {
    ensureStatsOverview();
    const studentCount = $$('#stats-student-list .list-group-item').length;
    const st = $('#ilog-stats-students'); if (st) st.textContent = `${studentCount}명`;
    const absent = ($('#total-absent')?.textContent || '0일').trim();
    const ab = $('#ilog-stats-absent'); if (ab) ab.textContent = absent || '0일';
    const reportVisible = $('#individual-report-view') && $('#individual-report-view').style.display !== 'none';
    const title = reportVisible ? (($('#report-title')?.textContent || '').trim() || '학생 기록') : '학급 전체';
    const cur = $('#ilog-stats-current'); if (cur) cur.textContent = title;
  }

  function ensureFormsDesk() {
    const section = $('#forms .container-fluid');
    if (!section || $('#ilog-form-desk', section)) return;
    const title = section.querySelector(':scope > h4');
    const intro = title ? title.nextElementSibling : null;
    const desk = document.createElement('div');
    desk.id = 'ilog-form-desk';
    desk.className = 'ilog-form-desk';
    desk.innerHTML = `
      <div class="ilog-form-desk-copy">
        <span class="ilog-form-desk-icon"><i class="fas fa-folder-open"></i></span>
        <div><strong>선생님의 문서 서랍</strong><small>입력한 기록을 다시 쓰지 않고 필요한 문서로 바로 꺼내세요.</small></div>
      </div>
      <div class="ilog-form-desk-tags"><span>한글 HWPX</span><span>인쇄 · PDF</span><span>학교 양식</span></div>`;
    if (intro && intro.tagName === 'P') intro.insertAdjacentElement('afterend', desk);
    else if (title) title.insertAdjacentElement('afterend', desk);
  }

  function ensureTaskOverview() {
    const section = $('#tasks .container-fluid');
    if (!section || $('#ilog-task-overview', section)) return;
    const h = section.querySelector(':scope > h4');
    if (!h) return;
    const box = document.createElement('div');
    box.id = 'ilog-task-overview';
    box.className = 'ilog-work-overview';
    box.innerHTML = `
      <div class="ilog-work-mini pink"><span class="mini-icon"><i class="fas fa-list-check"></i></span><div><small>남은 일</small><strong id="ilog-task-open">0건</strong></div></div>
      <div class="ilog-work-mini yellow"><span class="mini-icon"><i class="fas fa-calendar-day"></i></span><div><small>오늘까지</small><strong id="ilog-task-today">0건</strong></div></div>
      <div class="ilog-work-mini mint"><span class="mini-icon"><i class="fas fa-check-circle"></i></span><div><small>완료</small><strong id="ilog-task-done">0건</strong></div></div>`;
    h.insertAdjacentElement('afterend', box);
  }

  function refreshTasks() {
    ensureTaskOverview();
    const rows = $$('#task-list-body > tr').filter(r => !r.querySelector('td[colspan]'));
    let open = 0, done = 0, today = 0;
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });

    rows.forEach(row => {
      const checked = !!row.querySelector('input[type="checkbox"]:checked');
      if (checked) done++; else open++;
      const cells = row.children;
      const due = (cells[2]?.textContent || '').trim();
      if (!checked && due && due !== '-' && due <= todayStr) today++;
    });

    const a = $('#ilog-task-open'); if (a) a.textContent = `${open}건`;
    const b = $('#ilog-task-today'); if (b) b.textContent = `${today}건`;
    const c = $('#ilog-task-done'); if (c) c.textContent = `${done}건`;

    const old = $('#ilog-task-celebrate');
    if (old) old.remove();
    if (rows.length && open === 0) {
      const card = $('#tasks .container-fluid .card');
      if (card) {
        const msg = document.createElement('div');
        msg.id = 'ilog-task-celebrate';
        msg.className = 'ilog-task-celebrate';
        msg.innerHTML = '<i class="fas fa-heart"></i><div><strong>오늘 적어둔 일을 모두 정리했어요.</strong><div class="small">남은 시간은 수업과 아이들에게 편안하게 써도 좋아요.</div></div>';
        card.insertAdjacentElement('afterend', msg);
      }
    }
  }

  function refreshActive() {
    if (isActive('stats')) refreshStats();
    if (isActive('forms')) ensureFormsDesk();
    if (isActive('tasks')) refreshTasks();
  }

  function observeSection(id) {
    const section = document.getElementById(id);
    if (!section) return;
    new MutationObserver(() => {
      if (section.classList.contains('active')) setTimeout(refreshActive, 80);
    }).observe(section, { attributes: true, attributeFilter: ['class'] });
  }

  function start() {
    ensureStatsOverview();
    ensureFormsDesk();
    ensureTaskOverview();

    ['stats', 'forms', 'tasks'].forEach(observeSection);

    const statsList = $('#stats-student-list');
    if (statsList) new MutationObserver(() => { if (isActive('stats')) setTimeout(refreshStats, 50); })
      .observe(statsList, { childList: true, subtree: true });

    const report = $('#individual-report-view');
    if (report) new MutationObserver(() => { if (isActive('stats')) setTimeout(refreshStats, 50); })
      .observe(report, { attributes: true, subtree: true, childList: true, characterData: true });

    const taskBody = $('#task-list-body');
    if (taskBody) new MutationObserver(() => { if (isActive('tasks')) setTimeout(refreshTasks, 50); })
      .observe(taskBody, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'checked'] });

    document.addEventListener('change', e => {
      if (e.target && e.target.closest('#tasks')) setTimeout(refreshTasks, 80);
    });
    document.addEventListener('click', e => {
      if (e.target.closest('#tasks button, #stats-student-list .list-group-item')) setTimeout(refreshActive, 180);
    });

    // 로그인 직후 기존 navigate/load 함수가 화면을 채우므로 첫 진입 때만 DOM 값을 읽는다.
    setTimeout(refreshActive, 300);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 0));
  else setTimeout(start, 0);
})();
