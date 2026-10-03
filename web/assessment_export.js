/* iLOG 수행평가 출력 연결
   - 저장된 수행평가 계획별 HWPX 출력
   - 학기/전체 평가계획 묶음 HWPX 출력
   - 정보공시 제출 전 필수항목 점검
   - 수행평가 계획이 자동 포함된 학급경영록 미리보기/엑셀 출력
   로그인 전에는 DB를 읽지 않고, 사용자가 점검/출력 버튼을 누를 때만 읽는다. */
(function () {
  'use strict';

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const disclosureState = { checked: false, missing: 0 };

  async function save(kind, params, okText) {
    try {
      setBusy(true);
      const path = await deliverFile(kind, params || {});
      if (path) showToast(okText || '파일을 만들었습니다.', 'success');
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  async function previewClassBook() {
    try {
      setBusy(true);
      await openReport('class_book', { incidents: false });
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  function ensureDisclosureModal() {
    if ($('#assessmentDisclosureModal')) return;
    const modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.id = 'assessmentDisclosureModal';
    modal.tabIndex = -1;
    modal.innerHTML = `
      <div class="modal-dialog modal-lg modal-dialog-scrollable"><div class="modal-content ilog-disclosure-modal">
        <div class="modal-header">
          <div><h5 class="modal-title fw-bold"><i class="fas fa-check-circle me-2"></i>정보공시 평가계획 점검</h5><div class="small text-muted mt-1">학생 개인별 결과는 제외하고 평가계획의 공시용 항목만 확인합니다.</div></div>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <div id="assessment-disclosure-summary" class="ilog-disclosure-summary"></div>
          <div class="ilog-disclosure-note"><i class="fas fa-info-circle me-1"></i>이 점검은 iLOG 입력자료의 완성도를 확인하는 기능입니다. 실제 공시 항목·제출 형식은 해당 학년도 학교 및 교육청 안내를 최종 확인하세요.</div>
          <div id="assessment-disclosure-list" class="ilog-disclosure-list"></div>
        </div>
        <div class="modal-footer ilog-disclosure-footer">
          <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">닫기</button>
          <div class="dropdown">
            <button type="button" class="btn ilog-disclosure-export dropdown-toggle" data-bs-toggle="dropdown"><i class="fas fa-file-word me-1"></i>공시용 HWPX 만들기</button>
            <ul class="dropdown-menu dropdown-menu-end">
              <li><button type="button" class="dropdown-item" data-disclosure-export="all">전체 평가계획</button></li>
              <li><button type="button" class="dropdown-item" data-disclosure-export="1">1학기 평가계획</button></li>
              <li><button type="button" class="dropdown-item" data-disclosure-export="2">2학기 평가계획</button></li>
            </ul>
          </div>
        </div>
      </div></div>`;
    document.body.appendChild(modal);
    $$('[data-disclosure-export]', modal).forEach(btn => btn.addEventListener('click', () => {
      if (disclosureState.checked && disclosureState.missing > 0) {
        const go = window.confirm(`아직 보완이 필요한 평가계획이 ${disclosureState.missing}개 있습니다. 그래도 HWPX를 만들까요?`);
        if (!go) return;
      }
      const v = btn.dataset.disclosureExport;
      save('assessment_plans_hwpx', v === 'all' ? {} : { term: Number(v) }, `${v === 'all' ? '전체' : v + '학기'} 교과별 평가계획 HWPX를 만들었습니다.`);
    }));
  }

  function missingFields(plan, tasks, rubrics) {
    const miss = [];
    if (!(plan.subjectName || plan.subjectShort)) miss.push('교과');
    if (![1, 2, '1', '2'].includes(plan.term)) miss.push('학기');
    if (!String(plan.unit || '').trim()) miss.push('단원');
    if (!String(plan.title || '').trim()) miss.push('평가명');
    if (!String(plan.date || '').trim()) miss.push('평가시기');
    if (!String(plan.domain || '').trim()) miss.push('평가영역');
    if (!String(plan.method || '').trim()) miss.push('평가방법');
    if (!String(plan.standard || '').trim()) miss.push('성취기준');
    if (!String(plan.objective || '').trim()) miss.push('학습목표');
    const task = (tasks || [])[0] || {};
    if (!String(task.description || '').trim()) miss.push('수행과제');
    const validRubrics = (rubrics || []).filter(r => String(r.descriptor || '').trim());
    if (validRubrics.length < 3) miss.push('평가기준 3단계');
    return miss;
  }

  async function checkDisclosure() {
    try {
      setBusy(true);
      const [plans, tasks, rubrics] = await Promise.all([
        DBManager.getAll('assessment_plans'),
        DBManager.getAll('assessment_tasks'),
        DBManager.getAll('assessment_rubrics')
      ]);
      ensureDisclosureModal();
      const taskMap = new Map();
      const rubricMap = new Map();
      (tasks || []).forEach(t => {
        if (!taskMap.has(t.planId)) taskMap.set(t.planId, []);
        taskMap.get(t.planId).push(t);
      });
      (rubrics || []).forEach(r => {
        if (!rubricMap.has(r.planId)) rubricMap.set(r.planId, []);
        rubricMap.get(r.planId).push(r);
      });
      const rows = (plans || []).map(p => ({ plan: p, missing: missingFields(p, taskMap.get(p.planId), rubricMap.get(p.planId)) }));
      const ready = rows.filter(r => !r.missing.length).length;
      const incomplete = rows.length - ready;
      disclosureState.checked = true;
      disclosureState.missing = incomplete;

      const summary = $('#assessment-disclosure-summary');
      summary.innerHTML = `
        <div class="ilog-disclosure-stat mint"><small>저장된 평가계획</small><strong>${rows.length}개</strong></div>
        <div class="ilog-disclosure-stat sky"><small>공시자료 준비 완료</small><strong>${ready}개</strong></div>
        <div class="ilog-disclosure-stat ${incomplete ? 'peach' : 'mint'}"><small>보완 필요</small><strong>${incomplete}개</strong></div>`;

      const list = $('#assessment-disclosure-list');
      if (!rows.length) {
        list.innerHTML = '<div class="ilog-disclosure-empty">저장된 수행평가 계획이 없습니다. 먼저 평가계획을 작성해 주세요.</div>';
      } else {
        list.innerHTML = rows.map(({plan, missing}) => {
          const subject = plan.subjectName || plan.subjectShort || '교과 미입력';
          const title = plan.title || '평가명 미입력';
          return `<div class="ilog-disclosure-row ${missing.length ? 'needs-work' : 'ready'}">
            <div class="ilog-disclosure-row-head"><strong>${esc(subject)} · ${esc(title)}</strong><span>${missing.length ? '보완 필요' : '준비 완료'}</span></div>
            <div class="ilog-disclosure-row-meta">${esc(String(plan.term || '-'))}학기 · ${esc(plan.unit || '단원 미입력')} · ${esc(plan.date || '시기 미입력')}</div>
            ${missing.length ? `<div class="ilog-disclosure-missing">누락: ${missing.map(esc).join(' · ')}</div>` : '<div class="ilog-disclosure-ok">필수 입력항목이 모두 채워져 있습니다.</div>'}
          </div>`;
        }).join('');
      }
      bootstrap.Modal.getOrCreateInstance($('#assessmentDisclosureModal')).show();
    } catch (e) {
      if (!String(e?.message || e).includes('잠겨 있습니다')) showError(e);
    } finally {
      setBusy(false);
    }
  }

  function ensureToolbar() {
    const section = $('#assessment .container-fluid');
    if (!section || $('#ilog-assessment-export-bar')) return;
    const anchor = $('#ilog-neis-import-card') || section.querySelector('.ilog-assess-hero');
    const bar = document.createElement('div');
    bar.id = 'ilog-assessment-export-bar';
    bar.className = 'ilog-assessment-export-bar';
    bar.innerHTML = `
      <div class="ilog-assessment-export-copy">
        <span class="ilog-assessment-export-icon"><i class="fas fa-file-word"></i></span>
        <div><strong>평가계획 문서 · 정보공시 · 학급경영록</strong><small>같은 평가계획 데이터로 한글 문서, 정보공시 점검, 학급경영록까지 이어집니다.</small></div>
      </div>
      <div class="ilog-assessment-export-actions">
        <button class="btn btn-sm ilog-disclosure-check-btn" type="button" id="assess-disclosure-check"><i class="fas fa-check-circle me-1"></i>정보공시 점검</button>
        <div class="dropdown">
          <button class="btn btn-sm dropdown-toggle" type="button" data-bs-toggle="dropdown"><i class="fas fa-file-export me-1"></i>평가계획 HWPX</button>
          <ul class="dropdown-menu dropdown-menu-end">
            <li><button class="dropdown-item" type="button" data-assess-export-all="all">전체 평가계획</button></li>
            <li><button class="dropdown-item" type="button" data-assess-export-all="1">1학기 평가계획</button></li>
            <li><button class="dropdown-item" type="button" data-assess-export-all="2">2학기 평가계획</button></li>
          </ul>
        </div>
        <button class="btn btn-sm" type="button" id="assess-classbook-preview"><i class="fas fa-eye me-1"></i>학급경영록 미리보기</button>
        <button class="btn btn-sm" type="button" id="assess-classbook-xlsx"><i class="fas fa-file-excel me-1"></i>학급경영록 Excel</button>
      </div>`;
    if (anchor) anchor.insertAdjacentElement('afterend', bar);
    else section.prepend(bar);

    $$('[data-assess-export-all]', bar).forEach(btn => btn.addEventListener('click', () => {
      const v = btn.dataset.assessExportAll;
      save('assessment_plans_hwpx', v === 'all' ? {} : { term: Number(v) }, `${v === 'all' ? '전체' : v + '학기'} 교과별 평가계획 HWPX를 만들었습니다.`);
    }));
    $('#assess-disclosure-check')?.addEventListener('click', () => checkDisclosure());
    $('#assess-classbook-preview')?.addEventListener('click', previewClassBook);
    $('#assess-classbook-xlsx')?.addEventListener('click', () => save('class_book_xlsx', { incidents: false }, '수행평가 계획이 포함된 학급경영록을 만들었습니다.'));

    const phase = $('.ilog-next-phase');
    if (phase) phase.innerHTML = '<strong>현재 연결 상태</strong><br>NEIS 지도계획 → 수행평가 설계 → HWPX → 정보공시 점검 → 학생평가 → 학급경영록까지 같은 데이터로 이어집니다.';
  }

  function decoratePlanCards() {
    $$('#assess-plan-list .ilog-assess-plan').forEach(card => {
      const actions = $('.ilog-plan-actions', card);
      if (!actions || actions.querySelector('[data-assess-export-one]')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm ilog-assess-hwpx-btn';
      btn.dataset.assessExportOne = card.dataset.planId || '';
      btn.innerHTML = '<i class="fas fa-file-word me-1"></i>계획 HWPX';
      const del = actions.querySelector('[data-assess-action="delete"]');
      if (del) actions.insertBefore(btn, del);
      else actions.appendChild(btn);
      btn.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        const planId = btn.dataset.assessExportOne;
        if (planId) save('assessment_plan_hwpx', { planId }, '수행평가 계획 HWPX를 만들었습니다.');
      });
    });
  }

  function start() {
    const assessment = $('#assessment');
    if (!assessment) { setTimeout(start, 250); return; }
    ensureDisclosureModal();
    ensureToolbar();
    decoratePlanCards();
    const list = $('#assess-plan-list');
    if (list) new MutationObserver(decoratePlanCards).observe(list, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
