/* iLOG Classroom Warm UI behavior
   기존 student-list-body / attendance-list-body의 기능 이벤트를 그대로 살리고
   학생 명렬표를 카드 뷰로 보조한다. */
(function () {
  'use strict';

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

  const palettes = [
    ['#fff0f4', '#b97588'], ['#eef7fd', '#668fae'], ['#edf9f5', '#5d9585'],
    ['#fff8df', '#a88b42'], ['#f5f0ff', '#8875ae'], ['#fff3eb', '#b27d60']
  ];

  function ensureStudentView() {
    const page = $('#students');
    const tbody = $('#student-list-body');
    if (!page || !tbody) return false;

    const table = tbody.closest('table');
    const tableWrap = table && table.parentElement;
    const card = table && table.closest('.card');
    if (!table || !tableWrap || !card) return false;

    tableWrap.classList.add('ilog-original-student-table-wrap');

    if (!$('#ilog-student-toolbar', page)) {
      const title = page.querySelector('.container-fluid > h4');
      const toolbar = document.createElement('div');
      toolbar.id = 'ilog-student-toolbar';
      toolbar.className = 'ilog-student-toolbar';
      toolbar.innerHTML = `
        <div class="ilog-student-toolbar-copy">
          <span class="ilog-student-toolbar-icon"><i class="fas fa-users"></i></span>
          <div><strong>우리 반 친구들</strong><small>카드를 눌러 상담·출결 기록을 바로 살펴볼 수 있어요.</small></div>
        </div>
        <div class="ilog-student-toolbar-actions">
          <button type="button" class="ilog-class-soft-btn" data-ilog-student-action="add"><i class="fas fa-user-plus me-1"></i>한 명 등록</button>
          <button type="button" class="ilog-class-soft-btn" data-ilog-student-action="batch"><i class="fas fa-file-excel me-1"></i>엑셀 일괄등록</button>
        </div>`;
      if (title) title.insertAdjacentElement('afterend', toolbar);
    }

    if (!$('#ilog-student-grid', page)) {
      const grid = document.createElement('div');
      grid.id = 'ilog-student-grid';
      grid.className = 'ilog-student-grid';
      card.querySelector('.card-header')?.insertAdjacentElement('afterend', grid);
    }

    renderStudentCards();
    return true;
  }

  function renderStudentCards() {
    const tbody = $('#student-list-body');
    const grid = $('#ilog-student-grid');
    if (!tbody || !grid) return;
    const rows = $$(':scope > tr', tbody);
    const realRows = rows.filter(r => r.children.length >= 6 && !r.querySelector('td[colspan]'));

    if (!realRows.length) {
      grid.innerHTML = `<div class="ilog-student-empty"><i class="fas fa-heart"></i>아직 등록된 학생이 없어요.<br><small>오른쪽에서 학생을 등록하면 카드가 만들어집니다.</small></div>`;
      return;
    }

    grid.innerHTML = '';
    realRows.forEach((row, idx) => {
      const cells = row.children;
      const no = (cells[0]?.textContent || '').trim();
      const name = (cells[1]?.textContent || '').trim();
      const gender = (cells[2]?.textContent || '').trim();
      const phone = (cells[3]?.textContent || '').trim();
      const note = (cells[4]?.textContent || '').trim();
      const [soft, accent] = palettes[idx % palettes.length];
      const initial = name ? name.slice(0, 1) : '♡';

      const card = document.createElement('div');
      card.className = 'ilog-student-card';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.style.setProperty('--student-soft', soft);
      card.style.setProperty('--student-accent', accent);
      card.innerHTML = `
        <div class="ilog-student-card-head">
          <div class="ilog-student-avatar">${escapeHtml(initial)}</div>
          <div class="ilog-student-main">
            <div class="ilog-student-number">${escapeHtml(no)}번</div>
            <div class="ilog-student-name">${escapeHtml(name)}</div>
          </div>
        </div>
        <div class="ilog-student-meta">
          ${gender ? `<span class="ilog-student-pill"><i class="fas fa-child me-1"></i>${escapeHtml(gender)}</span>` : ''}
          ${phone ? `<span class="ilog-student-pill"><i class="fas fa-phone-alt me-1"></i>${escapeHtml(maskPhone(phone))}</span>` : '<span class="ilog-student-pill">연락처 미입력</span>'}
        </div>
        <div class="ilog-student-note">${note ? escapeHtml(note) : '특이사항 없이 편안하게 기록 중이에요.'}</div>
        <div class="ilog-student-card-foot"><span>기록 살펴보기</span><span class="open">상담 · 출결 <i class="fas fa-chevron-right ms-1"></i></span></div>`;

      const open = () => row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      card.addEventListener('click', open);
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      grid.appendChild(card);
    });
  }

  function enhanceAttendance() {
    const modal = $('#attendanceModal');
    const tbody = $('#attendance-list-body');
    if (!modal || !tbody) return false;

    // 학생별 상태에 따라 카드 가장자리에 은은한 색을 표시
    $$(':scope > tr', tbody).forEach(row => {
      const checked = row.querySelector('input[type="radio"]:checked');
      applyAttendanceState(row, checked ? checked.value : '출석');
      $$('input[type="radio"]', row).forEach(radio => {
        if (radio.dataset.ilogWarmBound) return;
        radio.dataset.ilogWarmBound = '1';
        radio.addEventListener('change', () => { if (radio.checked) applyAttendanceState(row, radio.value); });
      });
    });
    return true;
  }

  function applyAttendanceState(row, status) {
    const colors = {
      '출석': ['#75b7a3', '#f5fcf9'],
      '결석': ['#df8fa1', '#fff7f8'],
      '지각': ['#e6c467', '#fffaf0'],
      '조퇴': ['#82abd2', '#f5f9fd'],
      '결과': ['#a898b5', '#faf8fc']
    };
    const [line, bg] = colors[status] || colors['출석'];
    row.style.borderLeft = `4px solid ${line}`;
    row.style.background = bg;
  }

  function maskPhone(v) {
    const s = String(v || '').trim();
    if (!s) return '';
    const digits = s.replace(/\D/g, '');
    if (digits.length >= 8) return `${digits.slice(0, 3)}-••••-${digits.slice(-4)}`;
    return s;
  }

  function escapeHtml(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  document.addEventListener('click', e => {
    const action = e.target.closest('[data-ilog-student-action]');
    if (!action) return;
    const type = action.dataset.ilogStudentAction;
    if (type === 'batch') {
      const trigger = document.querySelector('#students [data-bs-target="#batchStudentModal"]');
      if (trigger) trigger.click();
    } else if (type === 'add') {
      const input = $('#stdNum');
      if (input) { input.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => input.focus(), 300); }
    }
  });

  function start() {
    if (!ensureStudentView()) { setTimeout(start, 300); return; }

    const studentBody = $('#student-list-body');
    if (studentBody) new MutationObserver(() => renderStudentCards()).observe(studentBody, { childList: true, subtree: true, characterData: true });

    const attendanceBody = $('#attendance-list-body');
    if (attendanceBody) new MutationObserver(() => enhanceAttendance()).observe(attendanceBody, { childList: true, subtree: true });

    const attModal = $('#attendanceModal');
    if (attModal) attModal.addEventListener('shown.bs.modal', () => setTimeout(enhanceAttendance, 30));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
