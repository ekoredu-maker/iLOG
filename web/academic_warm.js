/* iLOG Academic Warm UI
   교외체험학습·학생평가 화면에 요약 카드와 상태 표현을 더한다.
   기존 app.js의 기능/ID는 그대로 사용한다. */
(function () {
  'use strict';

  const $ = (s, root = document) => root.querySelector(s);

  function canReadData() {
    const login = $('#login-overlay');
    return !login || login.style.display === 'none';
  }

  function ensureExperientialOverview() {
    const section = $('#experiential .container-fluid');
    if (!section || $('#ilog-exp-overview', section)) return;
    const h = section.querySelector(':scope > h4');
    if (!h) return;
    const box = document.createElement('div');
    box.id = 'ilog-exp-overview';
    box.className = 'ilog-academic-overview';
    box.innerHTML = `
      <div class="ilog-academic-mini pink">
        <span class="mini-icon"><i class="fas fa-suitcase-rolling"></i></span>
        <small>전체 체험학습</small><strong id="ilog-exp-total">0건</strong>
      </div>
      <div class="ilog-academic-mini mint">
        <span class="mini-icon"><i class="fas fa-check"></i></span>
        <small>승인 · 출결 반영</small><strong id="ilog-exp-approved">0건</strong>
      </div>
      <div class="ilog-academic-mini yellow">
        <span class="mini-icon"><i class="fas fa-file-signature"></i></span>
        <small>서류 완료</small><strong id="ilog-exp-docs">0건</strong>
      </div>`;
    h.insertAdjacentElement('afterend', box);
  }

  function ensureEvaluationOverview() {
    const section = $('#evaluation .container-fluid');
    if (!section || $('#ilog-eval-overview', section)) return;
    const h = section.querySelector(':scope > h4');
    if (!h) return;
    const box = document.createElement('div');
    box.id = 'ilog-eval-overview';
    box.className = 'ilog-academic-overview';
    box.innerHTML = `
      <div class="ilog-academic-mini yellow">
        <span class="mini-icon"><i class="fas fa-star"></i></span>
        <small>평가 계획</small><strong id="ilog-eval-total">0개</strong>
      </div>
      <div class="ilog-academic-mini lilac">
        <span class="mini-icon"><i class="fas fa-book-open"></i></span>
        <small>선택한 평가</small><strong id="ilog-eval-current">선택 필요</strong>
      </div>
      <div class="ilog-academic-mini sky">
        <span class="mini-icon"><i class="fas fa-pencil-alt"></i></span>
        <small>평가 입력</small><strong id="ilog-eval-progress">0 / 0명</strong>
      </div>`;
    h.insertAdjacentElement('afterend', box);
  }

  async function refreshExperiential() {
    ensureExperientialOverview();
    if (!canReadData() || typeof ExperientialRepo === 'undefined') return;
    try {
      const list = await ExperientialRepo.getAll();
      const approved = list.filter(x => x.status === 'approved').length;
      const docs = list.filter(x => x.docs && x.docs.app && x.docs.report).length;
      const t = $('#ilog-exp-total'); if (t) t.textContent = `${list.length}건`;
      const a = $('#ilog-exp-approved'); if (a) a.textContent = `${approved}건`;
      const d = $('#ilog-exp-docs'); if (d) d.textContent = `${docs}건`;
    } catch (e) {
      console.debug('academic warm experiential:', e);
    }
  }

  function scoreClass(select) {
    if (!select) return;
    select.classList.remove('ilog-score-good', 'ilog-score-mid', 'ilog-score-care');
    const v = String(select.value || '').trim();
    if (!v) return;
    if (/잘함|우수|상|매우/.test(v)) select.classList.add('ilog-score-good');
    else if (/보통|중|적정/.test(v)) select.classList.add('ilog-score-mid');
    else if (/노력|하|미흡|보완/.test(v)) select.classList.add('ilog-score-care');
  }

  async function refreshEvaluation() {
    ensureEvaluationOverview();
    if (!canReadData()) return;
    try {
      let total = 0;
      if (typeof EvaluationRepo !== 'undefined' && EvaluationRepo.getPlans) {
        total = (await EvaluationRepo.getPlans()).length;
      } else {
        total = $('#eval-plan-list')?.querySelectorAll('.list-group-item').length || 0;
      }
      const totalEl = $('#ilog-eval-total'); if (totalEl) totalEl.textContent = `${total}개`;

      const title = ($('#grading-title')?.textContent || '').trim() || '선택 필요';
      const current = $('#ilog-eval-current'); if (current) current.textContent = title;

      const selects = [...document.querySelectorAll('#grading-table-body select[id^="sv_"]')];
      selects.forEach(scoreClass);
      const filled = selects.filter(s => String(s.value || '').trim()).length;
      const progress = $('#ilog-eval-progress'); if (progress) progress.textContent = `${filled} / ${selects.length}명`;
    } catch (e) {
      console.debug('academic warm evaluation:', e);
    }
  }

  function refreshForActiveSection() {
    if (!canReadData()) return;
    const exp = $('#experiential');
    const ev = $('#evaluation');
    if (exp && exp.classList.contains('active')) refreshExperiential();
    if (ev && ev.classList.contains('active')) refreshEvaluation();
  }

  document.addEventListener('change', (e) => {
    if (e.target && e.target.matches('#grading-table-body select[id^="sv_"]')) {
      scoreClass(e.target);
      refreshEvaluation();
    }
    if (e.target && e.target.closest('#experiential')) setTimeout(refreshExperiential, 120);
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('#experiential button, #experiential .badge.cursor-pointer')) {
      setTimeout(refreshExperiential, 350);
    }
    if (e.target.closest('#evaluation button, #eval-plan-list .list-group-item')) {
      setTimeout(refreshEvaluation, 250);
    }
  });

  function start() {
    ensureExperientialOverview();
    ensureEvaluationOverview();

    const exp = $('#experiential');
    const ev = $('#evaluation');
    [exp, ev].filter(Boolean).forEach(section => {
      new MutationObserver(() => {
        if (section.classList.contains('active')) setTimeout(refreshForActiveSection, 100);
      }).observe(section, { attributes: true, attributeFilter: ['class'] });
    });

    const expBody = $('#exp-list-body');
    if (expBody) new MutationObserver(() => setTimeout(refreshExperiential, 80))
      .observe(expBody, { childList: true, subtree: true });

    const gradeBody = $('#grading-table-body');
    if (gradeBody) new MutationObserver(() => setTimeout(refreshEvaluation, 80))
      .observe(gradeBody, { childList: true, subtree: true });

    const planList = $('#eval-plan-list');
    if (planList) new MutationObserver(() => setTimeout(refreshEvaluation, 80))
      .observe(planList, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

    // 로그인 전에는 DB를 읽지 않는다. 로그인 후 각 화면을 여는 순간 자동 갱신된다.
    if (canReadData()) refreshForActiveSection();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 0));
  else setTimeout(start, 0);
})();
