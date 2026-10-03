/* iLOG NEIS 지도계획 스마트 가져오기
   - 로그인 전에는 UI만 구성하고 DB/API를 읽지 않는다.
   - 파일 분석은 사용자가 버튼을 눌렀을 때만 수행한다.
   - 제목행 자동 탐지 + 수동 열 매핑 + 날짜/교시 또는 차시 순서 연결을 지원한다. */
(function () {
  'use strict';

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state = { rows: [], headerRow: -1, headers: [], mapping: {}, subjects: [], settings: {}, filename: '' };

  const FIELD_DEFS = [
    ['date', '날짜', ['날짜','일자','지도일','수업일','수업일자','예정일','월일','학습일','일시']],
    ['period', '교시', ['교시','수업교시','교시번호']],
    ['lessonSeq', '차시', ['차시','차시수','차시번호','순번','차시시수','차시(시수)']],
    ['subject', '교과/과목', ['교과','교과명','과목','과목명','교과목','교과목명']],
    ['unit', '단원', ['단원','단원명','지도단원','대단원','중단원','소단원','단원주제','단원(주제)','단원/주제']],
    ['objective', '학습목표', ['학습목표','목표','차시목표','학습목표성취기준','학습목표및내용']],
    ['content', '지도내용/학습주제', ['지도내용','학습내용','학습주제','주제','수업내용','교수학습내용','학습활동','지도내용학습주제','지도내용(학습주제)']],
    ['standard', '성취기준', ['성취기준','교육과정성취기준','성취기준코드','성취기준평가기준','성취기준(평가기준)']],
    ['term', '학기', ['학기','학기구분','학기명']]
  ];

  function norm(v) {
    return String(v ?? '').toLowerCase().replace(/\s+/g, '').replace(/[·ㆍ.()\[\]{}\-_/,:;]/g, '');
  }
  function cell(row, idx) { return idx >= 0 && idx < row.length ? row[idx] : ''; }
  function nonempty(v) { return String(v ?? '').trim() !== ''; }
  function parseNumber(v) {
    const m = String(v ?? '').match(/\d+/);
    return m ? Number(m[0]) : 0;
  }
  function normalizeDate(v, year) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
      return d.toISOString().slice(0, 10);
    }
    let s = String(v).trim().replace(/\([^)]*\)$/, '').trim();
    let m = s.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    let y, mo, d;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else {
      m = s.match(/^(\d{1,2})\s*[./월-]\s*(\d{1,2})\s*일?/);
      if (!m) return '';
      y = Number(year) || new Date().getFullYear(); mo = +m[1]; d = +m[2];
    }
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
    return `${String(y).padStart(4,'0')}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }

  function headerMatch(text, aliases) {
    const n = norm(text);
    if (!n) return false;
    return aliases.some(a => {
      const an = norm(a);
      return n === an || n.includes(an) || an.includes(n);
    });
  }

  function analyzeHeader(rows) {
    let best = { row: -1, score: -1, mapping: {} };
    rows.slice(0, 20).forEach((row, ri) => {
      const mapping = {};
      let score = 0;
      FIELD_DEFS.forEach(([key, _label, aliases]) => {
        let found = -1;
        row.forEach((v, ci) => { if (found < 0 && headerMatch(v, aliases)) found = ci; });
        if (found >= 0) { mapping[key] = found; score += ['unit','content','objective','date','lessonSeq'].includes(key) ? 2 : 1; }
      });
      const populated = row.filter(nonempty).length;
      if (score > best.score || (score === best.score && populated > 2)) best = { row: ri, score, mapping };
    });
    if (best.score < 3) best.row = Math.min(rows.findIndex(r => r.filter(nonempty).length >= 3), 0);
    return best;
  }

  function ensureUI() {
    const assessment = $('#assessment .container-fluid');
    if (!assessment) return false;
    if (!$('#ilog-neis-import-card')) {
      const hero = assessment.querySelector('.ilog-assess-hero');
      const card = document.createElement('div');
      card.id = 'ilog-neis-import-card';
      card.className = 'ilog-neis-import-card';
      card.innerHTML = `
        <div class="ilog-neis-import-copy">
          <span class="ilog-neis-import-icon"><i class="fas fa-file-excel"></i></span>
          <div><strong>NEIS 지도계획 가져오기</strong><small>나이스에서 내려받은 지도계획 엑셀의 제목행과 열을 자동으로 찾고, iLOG 연간 지도계획에 연결합니다.</small></div>
        </div>
        <button type="button" id="neis-plan-open-btn" class="btn"><i class="fas fa-link me-1"></i>엑셀 연결하기</button>`;
      if (hero) hero.insertAdjacentElement('afterend', card); else assessment.prepend(card);
    }
    if (!$('#neisPlanImportModal')) {
      const modal = document.createElement('div');
      modal.className = 'modal fade'; modal.id = 'neisPlanImportModal'; modal.tabIndex = -1;
      modal.innerHTML = `
        <div class="modal-dialog modal-xl modal-dialog-scrollable"><div class="modal-content">
          <div class="modal-header"><div><h5 class="modal-title fw-bold"><i class="fas fa-file-excel me-2"></i>NEIS 지도계획 스마트 가져오기</h5><div class="ilog-neis-help mt-1">파일 형식이 학교·학년마다 달라도 자동 탐지 후 직접 열을 고칠 수 있습니다.</div></div><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
          <div class="modal-body">
            <div class="ilog-neis-step">
              <div class="ilog-neis-step-title"><span class="ilog-neis-num">1</span>파일과 적용 과목 선택</div>
              <div class="row g-3">
                <div class="col-lg-5"><label class="form-label">NEIS 지도계획 엑셀</label><input id="neis-plan-file" type="file" class="form-control" accept=".xlsx,.xlsm,.xls"><div id="neis-plan-file-name" class="ilog-neis-file-name">학생 개인정보가 없는 지도계획 파일만 사용하세요.</div></div>
                <div class="col-lg-4"><label class="form-label">iLOG 적용 과목</label><select id="neis-plan-subject" class="form-select"></select></div>
                <div class="col-lg-3 d-flex align-items-end"><button type="button" id="neis-plan-analyze-btn" class="btn ilog-neis-import-primary w-100"><i class="fas fa-search me-1"></i>파일 분석</button></div>
              </div>
            </div>
            <div id="neis-plan-analysis" class="ilog-neis-analysis">
              <div class="ilog-neis-step">
                <div class="ilog-neis-step-title"><span class="ilog-neis-num">2</span>제목행과 열 확인</div>
                <div class="row g-3 mb-3"><div class="col-lg-5"><label class="form-label">제목행</label><select id="neis-header-row" class="form-select form-select-sm"></select></div><div class="col-lg-7 d-flex align-items-end"><div id="neis-detected" class="ilog-neis-detected"></div></div></div>
                <div id="neis-map-grid" class="ilog-neis-map-grid"></div>
                <div class="ilog-neis-help mt-3">날짜·교시가 있으면 해당 수업에 우선 연결합니다. 날짜가 없으면 차시 순서대로 연결하므로 아래에서 학기를 선택하세요.</div>
                <div id="neis-preview" class="ilog-neis-preview"></div>
              </div>
              <div class="ilog-neis-step">
                <div class="ilog-neis-step-title"><span class="ilog-neis-num">3</span>적용 방법</div>
                <div class="ilog-neis-options">
                  <div><label class="form-label">학기</label><select id="neis-plan-term" class="form-select"><option value="">날짜 기준 자동</option><option value="1">1학기</option><option value="2">2학기</option></select><div class="ilog-neis-help mt-1">날짜 열이 없으면 반드시 1학기 또는 2학기를 선택하세요.</div></div>
                  <div class="ilog-neis-overwrite"><div class="form-check"><input id="neis-plan-overwrite" class="form-check-input" type="checkbox"><label class="form-check-label fw-bold" for="neis-plan-overwrite">기존 지도내용도 덮어쓰기</label></div><div class="ilog-neis-help mt-1">기본은 빈 칸만 채웁니다. 직접 작성한 지도계획을 보호하려면 체크하지 마세요.</div></div>
                </div>
                <div id="neis-import-result" class="ilog-neis-result"></div>
              </div>
            </div>
          </div>
          <div class="modal-footer"><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">닫기</button><button type="button" id="neis-plan-import-btn" class="btn ilog-neis-import-primary" disabled><i class="fas fa-file-import me-1"></i>iLOG 지도계획에 반영</button></div>
        </div></div>`;
      document.body.appendChild(modal);
    }
    return true;
  }

  async function openModal() {
    try {
      const [subjects, settings] = await Promise.all([SubjectRepo.getAll(), SettingsRepo.get()]);
      state.subjects = subjects || []; state.settings = settings || {};
      const sel = $('#neis-plan-subject');
      const assessSel = $('#assess-subject');
      sel.innerHTML = state.subjects.map(s => `<option value="${esc(s.subjectId)}">${esc(s.name)}${s.shortName && s.shortName !== s.name ? ' ('+esc(s.shortName)+')' : ''}</option>`).join('');
      if (assessSel?.value && [...sel.options].some(o => o.value === assessSel.value)) sel.value = assessSel.value;
      $('#neis-plan-analysis').classList.remove('show'); $('#neis-plan-import-btn').disabled = true;
      $('#neis-import-result').className = 'ilog-neis-result'; $('#neis-import-result').textContent = '';
      bootstrap.Modal.getOrCreateInstance($('#neisPlanImportModal')).show();
    } catch (e) { if (!String(e?.message || e).includes('잠겨 있습니다')) showError(e); }
  }

  function headerOptions() {
    const sel = $('#neis-header-row');
    sel.innerHTML = state.rows.slice(0, 20).map((r, i) => `<option value="${i}">${i+1}행 · ${esc(r.filter(nonempty).slice(0,5).join(' | ') || '(빈 행)')}</option>`).join('');
    sel.value = String(Math.max(0, state.headerRow));
  }

  function rebuildMapping(autoMap) {
    state.headerRow = Number($('#neis-header-row').value || 0);
    state.headers = state.rows[state.headerRow] || [];
    state.mapping = autoMap || analyzeHeader([state.headers]).mapping || {};
    const grid = $('#neis-map-grid');
    const colOpts = '<option value="-1">사용 안 함</option>' + state.headers.map((h,i) => `<option value="${i}">${String.fromCharCode(65+i)} · ${esc(h || '(제목 없음)')}</option>`).join('');
    grid.innerHTML = FIELD_DEFS.map(([key,label]) => `<div class="ilog-neis-map-item"><label>${esc(label)}</label><select class="form-select form-select-sm" data-neis-field="${key}">${colOpts}</select></div>`).join('');
    $$('[data-neis-field]').forEach(s => { const v = state.mapping[s.dataset.neisField]; s.value = String(Number.isInteger(v) ? v : -1); s.addEventListener('change', renderPreview); });
    renderPreview();
  }

  function currentMapping() {
    const m = {}; $$('[data-neis-field]').forEach(s => m[s.dataset.neisField] = Number(s.value)); return m;
  }

  function renderPreview() {
    const mapping = currentMapping(); state.mapping = mapping;
    const mapped = FIELD_DEFS.filter(([k]) => mapping[k] >= 0).map(([,l]) => l);
    const hasCore = mapping.unit >= 0 || mapping.content >= 0 || mapping.objective >= 0;
    $('#neis-detected').innerHTML = `<span class="ilog-neis-badge">제목 ${state.headerRow+1}행</span><span class="ilog-neis-badge ${hasCore ? '' : 'ilog-neis-warn'}">자동 연결 ${mapped.length}개 열</span>${!hasCore ? '<span class="ilog-neis-badge ilog-neis-warn">단원·학습내용 열을 확인하세요</span>' : ''}`;
    const rows = state.rows.slice(state.headerRow + 1).filter(r => r.some(nonempty)).slice(0, 7);
    const cols = FIELD_DEFS.filter(([k]) => mapping[k] >= 0);
    $('#neis-preview').innerHTML = cols.length ? `<table class="table table-sm table-hover"><thead><tr>${cols.map(([,l]) => `<th>${esc(l)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(([k]) => `<td>${esc(cell(r,mapping[k]))}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<div class="p-3 text-muted small">연결된 열이 없습니다.</div>';
    $('#neis-plan-import-btn').disabled = !hasCore;
  }

  async function analyzeFile() {
    const file = $('#neis-plan-file')?.files?.[0];
    if (!file) return showToast('NEIS 지도계획 엑셀 파일을 선택하세요.', 'warning');
    if (!$('#neis-plan-subject').value) return showToast('적용할 과목을 선택하세요.', 'warning');
    setBusy(true);
    try {
      state.filename = file.name;
      $('#neis-plan-file-name').textContent = file.name;
      state.rows = await api.parse_excel(await readFileAsBase64(file), file.name);
      if (!state.rows?.length) return showToast('엑셀에서 읽을 내용이 없습니다.', 'warning');
      const a = analyzeHeader(state.rows); state.headerRow = a.row >= 0 ? a.row : 0;
      headerOptions(); rebuildMapping(a.mapping);
      $('#neis-plan-analysis').classList.add('show');
    } finally { setBusy(false); }
  }

  function rowRecords() {
    const m = currentMapping();
    const year = Number(state.settings.schoolYear) || new Date().getFullYear();
    const carry = { date:'', subject:'', unit:'', standard:'' };
    const out = [];
    state.rows.slice(state.headerRow + 1).forEach((r, index) => {
      if (!r.some(nonempty)) return;
      ['date','subject','unit','standard'].forEach(k => { if (m[k] >= 0 && nonempty(cell(r,m[k]))) carry[k] = cell(r,m[k]); });
      const rawDate = m.date >= 0 ? (nonempty(cell(r,m.date)) ? cell(r,m.date) : carry.date) : '';
      const rec = {
        sourceRow: state.headerRow + 2 + index,
        date: normalizeDate(rawDate, year),
        period: m.period >= 0 ? parseNumber(cell(r,m.period)) : 0,
        lessonSeq: m.lessonSeq >= 0 ? parseNumber(cell(r,m.lessonSeq)) : 0,
        subject: m.subject >= 0 ? String(nonempty(cell(r,m.subject)) ? cell(r,m.subject) : carry.subject).trim() : '',
        unit: m.unit >= 0 ? String(nonempty(cell(r,m.unit)) ? cell(r,m.unit) : carry.unit).trim() : '',
        objective: m.objective >= 0 ? String(cell(r,m.objective) ?? '').trim() : '',
        content: m.content >= 0 ? String(cell(r,m.content) ?? '').trim() : '',
        standard: m.standard >= 0 ? String(nonempty(cell(r,m.standard)) ? cell(r,m.standard) : carry.standard).trim() : '',
        term: m.term >= 0 ? parseNumber(cell(r,m.term)) : 0
      };
      if (rec.unit || rec.objective || rec.content || rec.standard) out.push(rec);
    });
    return out;
  }

  function inTerm(date, term) {
    if (!term) return true;
    const s = state.settings;
    const a = term === 1 ? s.term1Start : s.term2Start;
    const b = term === 1 ? s.term1End : s.term2End;
    return !a || !b ? true : date >= a && date <= b;
  }

  function subjectMatches(text, sub) {
    if (!text) return true;
    const n = norm(text), names = [sub.name, sub.shortName].filter(Boolean).map(norm);
    return names.some(x => n === x || n.includes(x) || x.includes(n));
  }

  async function importPlan() {
    const sub = state.subjects.find(s => s.subjectId === $('#neis-plan-subject').value);
    if (!sub) return showToast('적용할 과목을 선택하세요.', 'warning');
    const selectedTerm = Number($('#neis-plan-term').value || 0);
    const mapping = currentMapping();
    if (mapping.date < 0 && !selectedTerm) return showToast('날짜 열이 없으면 1학기 또는 2학기를 선택해 주세요.', 'warning');
    const records = rowRecords();
    if (!records.length) return showToast('반영할 지도계획 행을 찾지 못했습니다.', 'warning');
    const overwrite = $('#neis-plan-overwrite').checked;
    setBusy(true);
    try {
      const schedule = await AnnualScheduleRepo.getAll();
      const dayMap = new Map(schedule.map(d => [d.date, { ...d, subjects: (d.subjects || []).map(s => ({...s})) }]));
      const slots = [];
      [...dayMap.values()].sort((a,b) => a.date.localeCompare(b.date)).forEach(day => {
        if (!inTerm(day.date, selectedTerm)) return;
        day.subjects.forEach(s => {
          if ([sub.name, sub.shortName].includes(s.name)) slots.push({ day, lesson:s, key:`${day.date}|${s.period}` });
        });
      });
      if (!slots.length) return showToast('연간 지도계획에 해당 과목 수업이 없습니다. 먼저 연간 시간표를 생성해 주세요.', 'warning');

      const used = new Set(); let cursor = 0, applied = 0, skippedExisting = 0, unmatched = 0, subjectSkipped = 0;
      const changed = new Set();
      const nextSlot = () => { while (cursor < slots.length && used.has(slots[cursor].key)) cursor++; return slots[cursor++] || null; };

      records.forEach(rec => {
        if (rec.subject && !subjectMatches(rec.subject, sub)) { subjectSkipped++; return; }
        if (selectedTerm && rec.term && rec.term !== selectedTerm) return;
        let slot = null;
        if (rec.date && inTerm(rec.date, selectedTerm)) {
          const day = dayMap.get(rec.date);
          if (day) {
            const candidates = day.subjects.filter(s => [sub.name, sub.shortName].includes(s.name));
            const lesson = rec.period ? candidates.find(s => Number(s.period) === rec.period) : candidates.find(s => !used.has(`${rec.date}|${s.period}`));
            if (lesson) slot = { day, lesson, key:`${rec.date}|${lesson.period}` };
          }
        }
        if (!slot && rec.lessonSeq > 0 && rec.lessonSeq <= slots.length) slot = slots[rec.lessonSeq - 1];
        if (!slot) slot = nextSlot();
        if (!slot) { unmatched++; return; }
        used.add(slot.key);
        const lesson = slot.lesson;
        const patch = { unit:rec.unit, objective:rec.objective, content:rec.content, standard:rec.standard };
        let touched = false;
        Object.entries(patch).forEach(([k,v]) => {
          if (!v) return;
          if (overwrite || !nonempty(lesson[k])) { lesson[k] = v; touched = true; }
          else skippedExisting++;
        });
        if (rec.lessonSeq && (overwrite || !lesson.lessonSeq)) { lesson.lessonSeq = rec.lessonSeq; touched = true; }
        if (touched) {
          lesson.planSource = 'neis_excel'; lesson.planSourceFile = state.filename; lesson.planImportedAt = new Date().toISOString();
          changed.add(slot.day.date); applied++;
        }
      });

      const days = [...changed].map(d => dayMap.get(d));
      if (days.length) await DBManager.putMany('annual_schedule', days);
      const result = $('#neis-import-result');
      result.className = 'ilog-neis-result show' + (unmatched ? ' warning' : '');
      result.innerHTML = `<strong>${applied}개 차시 반영</strong> · 변경된 수업일 ${days.length}일${skippedExisting ? ` · 기존 내용 보호 ${skippedExisting}칸` : ''}${unmatched ? ` · 연결 못한 행 ${unmatched}개` : ''}${subjectSkipped ? ` · 다른 교과 행 제외 ${subjectSkipped}개` : ''}`;
      showToast(`${applied}개 차시를 지도계획에 반영했습니다.`, applied ? 'success' : 'warning');
      if (typeof navigate === 'function') await navigate('assessment');
    } catch (e) { showError(e); }
    finally { setBusy(false); }
  }

  function bind() {
    $('#neis-plan-open-btn')?.addEventListener('click', openModal);
    $('#neis-plan-analyze-btn')?.addEventListener('click', () => analyzeFile().catch(showError));
    $('#neis-header-row')?.addEventListener('change', () => rebuildMapping(analyzeHeader([state.rows[Number($('#neis-header-row').value || 0)] || []]).mapping));
    $('#neis-plan-import-btn')?.addEventListener('click', () => importPlan().catch(showError));
    $('#neis-plan-file')?.addEventListener('change', e => { const f = e.target.files?.[0]; $('#neis-plan-file-name').textContent = f ? f.name : '학생 개인정보가 없는 지도계획 파일만 사용하세요.'; });
  }

  function start() {
    if (!ensureUI()) { setTimeout(start, 250); return; }
    bind();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
