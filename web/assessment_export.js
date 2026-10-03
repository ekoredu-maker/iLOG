/* iLOG 수행평가 출력 연결
   - 저장된 수행평가 계획별 HWPX 출력
   - 학기/전체 평가계획 묶음 HWPX 출력
   - 수행평가 계획이 자동 포함된 학급경영록 미리보기/엑셀 출력
   DB는 직접 읽지 않고 사용자가 출력 버튼을 눌렀을 때 기존 파일 API만 호출한다. */
(function () {
  'use strict';

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

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
        <div><strong>평가계획 문서 · 학급경영록</strong><small>저장한 수행평가 계획을 한글 문서로 만들고, 학급경영록에도 자동으로 포함합니다.</small></div>
      </div>
      <div class="ilog-assessment-export-actions">
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
      save('assessment_plans_hwpx', v === 'all' ? {} : { term: Number(v) }, `${v === 'all' ? '전체' : v + '학기'} 평가계획 HWPX를 만들었습니다.`);
    }));
    $('#assess-classbook-preview')?.addEventListener('click', previewClassBook);
    $('#assess-classbook-xlsx')?.addEventListener('click', () => save('class_book_xlsx', { incidents: false }, '수행평가 계획이 포함된 학급경영록을 만들었습니다.'));
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
    ensureToolbar();
    decoratePlanCards();
    const list = $('#assess-plan-list');
    if (list) new MutationObserver(decoratePlanCards).observe(list, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
