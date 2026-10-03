/* iLOG 수행평가 설계실
   연간 지도계획의 과목·단원·학습목표를 불러와 수행평가계획을 만들고
   기존 학생평가 기능으로 넘겨 실제 평가 기록까지 이어 준다.
   로그인 전에는 UI만 만들고 DB/API는 읽지 않는다. */
(function () {
  'use strict';

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const state = {
    settings: {}, subjects: [], schedule: [], plans: [], units: [], editingPlanId: null,
    sourceLessons: [], rubricLabels: ['잘함', '보통', '노력요함']
  };

  const AssessmentPlanRepo = {
    getAll: () => DBManager.getAll('assessment_plans'),
    get: (id) => DBManager.get('assessment_plans', id),
    save: async (data) => {
      const now = new Date().toISOString();
      const rec = { ...data, planId: data.planId || uid('assess'), createdAt: data.createdAt || now, updatedAt: now };
      await DBManager.put('assessment_plans', rec);
      return rec;
    },
    delete: async (planId) => {
      const [tasks, rubrics] = await Promise.all([
        DBManager.query('assessment_tasks', 'planId', planId),
        DBManager.query('assessment_rubrics', 'planId', planId)
      ]);
      await Promise.all([
        ...tasks.map(x => DBManager.delete('assessment_tasks', x.taskId)),
        ...rubrics.map(x => DBManager.delete('assessment_rubrics', x.rubricId))
      ]);
      return DBManager.delete('assessment_plans', planId);
    }
  };

  const AssessmentTaskRepo = {
    getByPlan: (planId) => DBManager.query('assessment_tasks', 'planId', planId),
    replace: async (planId, task) => {
      const old = await DBManager.query('assessment_tasks', 'planId', planId);
      await Promise.all(old.map(x => DBManager.delete('assessment_tasks', x.taskId)));
      const rec = { ...task, taskId: uid('astask'), planId };
      await DBManager.put('assessment_tasks', rec);
      return rec;
    }
  };

  const AssessmentRubricRepo = {
    getByPlan: (planId) => DBManager.query('assessment_rubrics', 'planId', planId),
    replace: async (planId, rubrics) => {
      const old = await DBManager.query('assessment_rubrics', 'planId', planId);
      await Promise.all(old.map(x => DBManager.delete('assessment_rubrics', x.rubricId)));
      const rows = rubrics.map((r, i) => ({ ...r, rubricId: uid('rubric'), planId, order: i + 1 }));
      if (rows.length) await DBManager.putMany('assessment_rubrics', rows);
      return rows;
    }
  };

  function ensureShell() {
    const menu = $('#menu-list');
    const content = $('.content-area');
    if (!menu || !content) return false;

    if (!menu.querySelector('[data-target="assessment"]')) {
      const legacy = menu.querySelector('[data-target="evaluation"]');
      if (legacy) legacy.innerHTML = '<i class="fas fa-clipboard-check"></i> 평가 실시·기록';
      const li = document.createElement('li');
      li.className = 'nav-item';
      li.innerHTML = '<a class="nav-link" data-target="assessment"><i class="fas fa-clipboard-list"></i> 평가</a>';
      if (legacy && legacy.parentElement) menu.insertBefore(li, legacy.parentElement);
      else menu.appendChild(li);
    }

    if (!$('#assessment')) {
      const section = document.createElement('div');
      section.id = 'assessment';
      section.className = 'page-section';
      section.innerHTML = `
        <div class="container-fluid">
          <section class="ilog-assess-hero">
            <div class="ilog-assess-hero-copy">
              <div class="ilog-assess-kicker">PERFORMANCE ASSESSMENT STUDIO</div>
              <h4 class="fw-bold"><i class="fas fa-clipboard-list me-2"></i>수행평가 설계실</h4>
              <p>지도계획의 단원·학습목표를 다시 입력하지 않고 불러와 평가계획을 만들고,<br>완성한 계획을 학생평가 기록으로 바로 이어갑니다.</p>
            </div>
            <div class="ilog-assess-flow" aria-label="평가 흐름">
              <span>지도계획</span><i class="fas fa-chevron-right"></i><span>수행평가계획</span><i class="fas fa-chevron-right"></i><span>학생평가</span><i class="fas fa-chevron-right"></i><span>학급경영록</span>
            </div>
          </section>

          <div class="ilog-assess-overview">
            <div class="ilog-assess-mini sky"><span class="mini-icon"><i class="fas fa-book-open"></i></span><div><small>지도계획 연결 단원</small><strong id="assess-unit-count">0개</strong></div></div>
            <div class="ilog-assess-mini pink"><span class="mini-icon"><i class="fas fa-clipboard-list"></i></span><div><small>수행평가 계획</small><strong id="assess-plan-count">0개</strong></div></div>
            <div class="ilog-assess-mini mint"><span class="mini-icon"><i class="fas fa-check-circle"></i></span><div><small>학생평가 연결</small><strong id="assess-ready-count">0개</strong></div></div>
            <div class="ilog-assess-mini yellow"><span class="mini-icon"><i class="fas fa-file-alt"></i></span><div><small>다음 연결</small><strong>경영록 · 공시</strong></div></div>
          </div>

          <div class="ilog-assess-workspace">
            <div>
              <div class="card ilog-assess-card mb-3">
                <div class="card-header d-flex justify-content-between align-items-center gap-2 flex-wrap">
                  <h5 class="fw-bold mb-0"><span class="ilog-assess-step">1</span>지도계획에서 평가 근거 불러오기</h5>
                  <button type="button" id="assess-new-btn" class="btn btn-sm btn-outline-secondary ilog-assess-cancel"><i class="fas fa-plus me-1"></i>새 계획</button>
                </div>
                <div class="card-body">
                  <div class="row g-3">
                    <div class="col-md-4"><label class="form-label">과목</label><select id="assess-subject" class="form-select"></select></div>
                    <div class="col-md-5"><label class="form-label">단원</label><select id="assess-unit" class="form-select"></select></div>
                    <div class="col-md-3"><label class="form-label">평가 예정일</label><input id="assess-date" type="date" class="form-control"></div>
                    <div class="col-12" id="assess-custom-unit-wrap" style="display:none"><label class="form-label">단원 직접 입력</label><input id="assess-custom-unit" class="form-control" placeholder="예: 3. 날씨와 우리 생활"></div>
                    <div class="col-12"><div id="assess-source-panel" class="ilog-source-panel"><div class="ilog-source-empty">과목과 단원을 선택하면 지도계획의 차시·학습목표가 여기에 모입니다.</div></div></div>
                  </div>
                </div>
              </div>

              <div class="card ilog-assess-card mb-3">
                <div class="card-header"><h5 class="fw-bold mb-0"><span class="ilog-assess-step">2</span>수행평가 계획 세우기</h5></div>
                <div class="card-body">
                  <div class="row g-3">
                    <div class="col-md-8"><label class="form-label">평가명</label><input id="assess-title" class="form-control" placeholder="예: 날씨 자료를 분석하여 생활과의 관계 설명하기"></div>
                    <div class="col-md-4"><label class="form-label">평가 영역</label><select id="assess-domain" class="form-select"><option>지식·이해</option><option>과정·기능</option><option>가치·태도</option><option>통합</option></select></div>
                    <div class="col-md-4"><label class="form-label">평가 방법</label><select id="assess-method" class="form-select"><option>관찰</option><option>실험·실습</option><option>보고서</option><option>발표</option><option>프로젝트</option><option>포트폴리오</option><option>서·논술형</option><option>기타</option></select></div>
                    <div class="col-md-8"><label class="form-label">성취기준</label><input id="assess-standard" class="form-control" placeholder="지도계획에 없으면 직접 입력할 수 있습니다."></div>
                    <div class="col-12"><label class="form-label">학습목표</label><textarea id="assess-objective" rows="2" class="form-control" placeholder="선택한 단원의 학습목표가 자동으로 모입니다."></textarea></div>
                    <div class="col-md-5"><label class="form-label">수행과제명</label><input id="assess-task-title" class="form-control" placeholder="학생에게 제시할 과제 제목"></div>
                    <div class="col-md-7 d-flex align-items-end"><button type="button" id="assess-draft-btn" class="btn ilog-draft-btn w-100"><i class="fas fa-magic me-1"></i>학습목표와 평가방법으로 수행과제 초안 만들기</button></div>
                    <div class="col-12"><label class="form-label">수행과제</label><textarea id="assess-task-desc" rows="4" class="form-control" placeholder="학생이 무엇을 어떻게 수행해야 하는지 적습니다."></textarea></div>
                    <div class="col-12"><label class="form-label">평가 시 유의점 · 증거자료</label><input id="assess-evidence" class="form-control" placeholder="예: 활동 과정 관찰, 결과물, 발표 내용, 자기평가 등"></div>
                  </div>
                </div>
              </div>

              <div class="card ilog-assess-card mb-3">
                <div class="card-header d-flex justify-content-between align-items-center gap-2 flex-wrap">
                  <h5 class="fw-bold mb-0"><span class="ilog-assess-step">3</span>평가기준 만들기</h5>
                  <button type="button" id="assess-rubric-btn" class="btn btn-sm ilog-draft-btn"><i class="fas fa-wand-magic-sparkles me-1"></i>기준 초안</button>
                </div>
                <div class="card-body">
                  <div class="ilog-rubric-grid">
                    <div class="ilog-rubric-box"><div id="assess-level-1" class="ilog-rubric-level">잘함</div><textarea id="assess-rubric-1" rows="4" class="form-control form-control-sm"></textarea></div>
                    <div class="ilog-rubric-box"><div id="assess-level-2" class="ilog-rubric-level">보통</div><textarea id="assess-rubric-2" rows="4" class="form-control form-control-sm"></textarea></div>
                    <div class="ilog-rubric-box"><div id="assess-level-3" class="ilog-rubric-level">노력요함</div><textarea id="assess-rubric-3" rows="4" class="form-control form-control-sm"></textarea></div>
                  </div>
                </div>
                <div class="card-footer bg-white border-0 d-flex justify-content-end gap-2 pb-3 px-3">
                  <button type="button" id="assess-reset-btn" class="btn btn-sm btn-outline-secondary ilog-assess-cancel">입력 초기화</button>
                  <button type="button" id="assess-save-btn" class="btn btn-sm ilog-assess-save"><i class="fas fa-save me-1"></i>평가계획 저장</button>
                </div>
              </div>
            </div>

            <div class="card ilog-assess-card">
              <div class="card-header"><h5 class="fw-bold mb-1"><i class="fas fa-folder-open me-2"></i>저장된 수행평가</h5><div class="ilog-assess-helper">계획을 완성하면 학생평가 메뉴로 보내 바로 기록할 수 있습니다.</div></div>
              <div class="card-body">
                <div id="assess-plan-list" class="ilog-assess-list"><div class="ilog-assess-empty"><i class="fas fa-heart"></i>아직 저장한 수행평가가 없습니다.</div></div>
                <div class="ilog-next-phase"><strong>다음 개발 단계</strong><br>NEIS 지도계획 엑셀 자동 매칭 → 평가계획 HWPX → 학급경영록·정보공시용 출력까지 같은 데이터로 연결합니다.</div>
              </div>
            </div>
          </div>
        </div>`;

      const evaluation = $('#evaluation');
      if (evaluation) content.insertBefore(section, evaluation);
      else content.appendChild(section);
    }
    return true;
  }

  function normalizeText(v) { return String(v || '').trim(); }
  function unique(arr) { return [...new Set(arr.map(normalizeText).filter(Boolean))]; }
  function currentUnit() {
    const sel = $('#assess-unit');
    if (!sel) return '';
    if (sel.value === '__custom__') return normalizeText($('#assess-custom-unit')?.value);
    return sel.value;
  }

  function parseRubricLabels(settings) {
    const raw = normalizeText(settings.evalScale);
    const arr = raw.split(/[,·/]/).map(x => x.trim()).filter(Boolean);
    state.rubricLabels = arr.length >= 3 ? arr.slice(0, 3) : ['잘함', '보통', '노력요함'];
    state.rubricLabels.forEach((label, i) => {
      const el = $(`#assess-level-${i + 1}`); if (el) el.textContent = label;
    });
  }

  function subjectInfo() {
    const sel = $('#assess-subject');
    if (!sel || sel.selectedIndex < 0) return null;
    return state.subjects.find(s => s.subjectId === sel.value) || null;
  }

  function buildUnits() {
    const sub = subjectInfo();
    const groups = new Map();
    if (sub) {
      state.schedule.forEach(day => {
        (day.subjects || []).forEach(lesson => {
          if (![sub.name, sub.shortName].includes(lesson.name)) return;
          const unit = normalizeText(lesson.unit) || '단원 미입력';
          if (!groups.has(unit)) groups.set(unit, []);
          groups.get(unit).push({ ...lesson, date: day.date });
        });
      });
    }
    state.units = [...groups.entries()].map(([unit, lessons]) => ({
      unit,
      lessons: lessons.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (Number(a.period) || 0) - (Number(b.period) || 0))
    }));

    const sel = $('#assess-unit');
    if (!sel) return;
    const keep = sel.value;
    sel.innerHTML = '<option value="">단원 선택</option>' + state.units.map(g => `<option value="${esc(g.unit)}">${esc(g.unit)} (${g.lessons.length}차시)</option>`).join('') + '<option value="__custom__">직접 입력...</option>';
    if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
    $('#assess-unit-count').textContent = `${state.units.length}개`;
  }

  function sourceStandards(lessons) {
    return unique(lessons.map(x => x.standard || x.achievementStandard || x.achievement || x.standardText));
  }

  function renderSource(fillForm = true) {
    const unit = currentUnit();
    const panel = $('#assess-source-panel');
    const custom = $('#assess-custom-unit-wrap');
    const customMode = $('#assess-unit')?.value === '__custom__';
    if (custom) custom.style.display = customMode ? '' : 'none';

    if (!unit || customMode) {
      state.sourceLessons = [];
      if (panel) panel.innerHTML = customMode
        ? '<div class="ilog-source-empty"><i class="fas fa-pencil-alt me-1"></i>직접 입력 단원입니다. 학습목표와 성취기준을 아래에서 작성해 주세요.</div>'
        : '<div class="ilog-source-empty">과목과 단원을 선택하면 지도계획의 차시·학습목표가 여기에 모입니다.</div>';
      return;
    }

    const group = state.units.find(g => g.unit === unit);
    const lessons = group ? group.lessons : [];
    state.sourceLessons = lessons;
    if (!lessons.length) return;

    const objectives = unique(lessons.map(x => x.objective));
    const standards = sourceStandards(lessons);
    const contents = unique(lessons.map(x => x.content)).slice(0, 6);
    const first = lessons[0], last = lessons[lessons.length - 1];
    panel.innerHTML = `
      <div class="ilog-source-head"><div><strong>${esc(unit)}</strong><small class="d-block">${esc(first.date || '')}${last.date && last.date !== first.date ? ' ~ ' + esc(last.date) : ''}</small></div><span class="ilog-source-chip">${lessons.length}차시 연결</span></div>
      <div>${lessons.slice(0, 10).map(x => `<span class="ilog-source-chip">${esc(x.date || '')} · ${esc(x.period || '-')}교시${x.lessonSeq ? ' · ' + esc(x.lessonSeq) + '차시' : ''}</span>`).join('')}</div>
      ${objectives.length ? `<div class="ilog-source-objective"><b>학습목표</b><br>${objectives.map(esc).join('<br>')}</div>` : ''}
      ${standards.length ? `<div class="ilog-source-objective"><b>성취기준</b><br>${standards.map(esc).join('<br>')}</div>` : ''}
      ${contents.length ? `<div class="ilog-source-content"><b>주요 학습내용</b> · ${contents.map(esc).join(' · ')}</div>` : ''}`;

    if (fillForm) {
      if (objectives.length) $('#assess-objective').value = objectives.join('\n');
      if (standards.length) $('#assess-standard').value = standards.join(' / ');
      if (!normalizeText($('#assess-title').value)) $('#assess-title').value = `${unit} 수행평가`;
      if (!normalizeText($('#assess-task-title').value)) $('#assess-task-title').value = `${unit} 학습내용 적용하기`;
      if (!$('#assess-date').value) $('#assess-date').value = last.date || '';
    }
  }

  function termFromDate(date) {
    if (!date) return '';
    const s = state.settings;
    if (s.term1Start && s.term1End && date >= s.term1Start && date <= s.term1End) return 1;
    if (s.term2Start && s.term2End && date >= s.term2Start && date <= s.term2End) return 2;
    return '';
  }

  function buildTaskDraft() {
    const objective = normalizeText($('#assess-objective').value).split('\n')[0] || currentUnit() || '학습목표';
    const unit = currentUnit() || '선택한 단원';
    const method = $('#assess-method').value;
    const title = normalizeText($('#assess-task-title').value) || `${unit} 수행과제`;
    const templates = {
      '관찰': `${objective}와 관련된 활동을 수행한다. 교사는 활동 과정에서 개념 이해, 수행 과정, 의사소통 모습을 관찰하고 학생은 자신의 생각과 수행 근거를 설명한다.`,
      '실험·실습': `${unit}에서 배운 내용을 활용하여 실험·실습 과제를 계획하고 안전하게 수행한다. 결과를 기록한 뒤 관찰한 사실을 근거로 학습목표와 연결하여 설명한다.`,
      '보고서': `${unit}의 학습내용을 바탕으로 자료를 조사·분석하고 핵심 내용을 자신의 말로 정리한 보고서를 작성한다. 주장이나 결론에는 학습한 근거를 제시한다.`,
      '발표': `${unit}의 핵심 내용을 정리하여 친구들이 이해할 수 있도록 발표한다. 자료를 적절히 활용하고 질문에 학습내용을 근거로 답한다.`,
      '프로젝트': `${unit}의 학습목표와 연결되는 실제 문제를 정하고 해결 과정과 결과물을 만든다. 계획-수행-성찰의 과정을 기록하고 결과를 공유한다.`,
      '포트폴리오': `${unit} 학습 과정에서 만든 활동지·결과물·성찰 기록을 모아 성장 과정을 설명하고, 학습목표에 비추어 자신의 강점과 보완점을 정리한다.`,
      '서·논술형': `${unit}에서 배운 개념을 활용하여 제시된 상황을 해석하고, 자신의 판단이나 해결 과정을 근거와 함께 글로 설명한다.`,
      '기타': `${objective}를 확인할 수 있는 수행 결과물을 만들고, 수행 과정과 결과를 학습내용에 근거하여 설명한다.`
    };
    $('#assess-task-title').value = title;
    $('#assess-task-desc').value = templates[method] || templates['기타'];
    if (!normalizeText($('#assess-evidence').value)) $('#assess-evidence').value = '수행 과정 관찰, 학생 결과물, 설명·발표 내용, 자기성찰 기록';
    if (!normalizeText($('#assess-title').value)) $('#assess-title').value = title;
  }

  function buildRubricDraft() {
    const objective = normalizeText($('#assess-objective').value).split('\n')[0] || '학습목표';
    const method = $('#assess-method').value;
    const desc = [
      `${objective}를 정확히 이해하고 ${method} 과제를 스스로 수행하며, 결과와 근거를 구체적으로 설명한다.`,
      `${objective}를 대체로 이해하고 ${method} 과제를 안내에 따라 수행하며, 주요 결과를 설명한다.`,
      `${objective}의 이해와 ${method} 과제 수행에 도움이 필요하며, 교사의 안내를 받아 핵심 내용을 표현한다.`
    ];
    desc.forEach((v, i) => { $(`#assess-rubric-${i + 1}`).value = v; });
  }

  async function saveAssessment() {
    const sub = subjectInfo();
    const unit = currentUnit();
    const title = normalizeText($('#assess-title').value);
    const taskTitle = normalizeText($('#assess-task-title').value);
    const taskDescription = normalizeText($('#assess-task-desc').value);
    if (!sub) return showToast('과목을 선택하세요.', 'warning');
    if (!unit) return showToast('단원을 선택하거나 직접 입력하세요.', 'warning');
    if (!title) return showToast('평가명을 입력하세요.', 'warning');
    if (!taskTitle || !taskDescription) return showToast('수행과제명과 수행과제를 입력하세요.', 'warning');

    const old = state.editingPlanId ? await AssessmentPlanRepo.get(state.editingPlanId) : null;
    const date = $('#assess-date').value || '';
    const plan = await AssessmentPlanRepo.save({
      ...(old || {}),
      planId: old?.planId,
      schoolYear: state.settings.schoolYear || '', grade: state.settings.grade || '', classNo: state.settings.classNo || '',
      term: termFromDate(date), subjectId: sub.subjectId, subjectName: sub.name, subjectShort: sub.shortName,
      unit, date, title, domain: $('#assess-domain').value, method: $('#assess-method').value,
      objective: normalizeText($('#assess-objective').value), standard: normalizeText($('#assess-standard').value),
      source: state.sourceLessons.length ? 'annual_schedule' : 'manual',
      lessonRefs: state.sourceLessons.map(x => ({ date: x.date, period: x.period, lessonSeq: x.lessonSeq || '', content: x.content || '' })),
      status: old?.legacyEvalPlanId ? 'ready' : 'draft'
    });
    await AssessmentTaskRepo.replace(plan.planId, {
      title: taskTitle, description: taskDescription, evidence: normalizeText($('#assess-evidence').value), method: $('#assess-method').value
    });
    await AssessmentRubricRepo.replace(plan.planId, [1,2,3].map((n, i) => ({
      level: state.rubricLabels[i], descriptor: normalizeText($(`#assess-rubric-${n}`).value)
    })));

    showToast(state.editingPlanId ? '수행평가 계획을 수정했습니다.' : '수행평가 계획을 저장했습니다.', 'success');
    state.editingPlanId = null;
    await loadAssessmentStudio(false);
    resetForm(false);
  }

  async function editAssessment(planId) {
    const [plan, tasks, rubrics] = await Promise.all([
      AssessmentPlanRepo.get(planId), AssessmentTaskRepo.getByPlan(planId), AssessmentRubricRepo.getByPlan(planId)
    ]);
    if (!plan) return;
    state.editingPlanId = planId;
    const subSel = $('#assess-subject');
    if ([...subSel.options].some(o => o.value === plan.subjectId)) subSel.value = plan.subjectId;
    buildUnits();
    const unitSel = $('#assess-unit');
    if ([...unitSel.options].some(o => o.value === plan.unit)) unitSel.value = plan.unit;
    else { unitSel.value = '__custom__'; $('#assess-custom-unit').value = plan.unit || ''; }
    renderSource(false);
    $('#assess-date').value = plan.date || '';
    $('#assess-title').value = plan.title || '';
    $('#assess-domain').value = plan.domain || '지식·이해';
    $('#assess-method').value = plan.method || '관찰';
    $('#assess-objective').value = plan.objective || '';
    $('#assess-standard').value = plan.standard || '';
    const task = tasks[0] || {};
    $('#assess-task-title').value = task.title || '';
    $('#assess-task-desc').value = task.description || '';
    $('#assess-evidence').value = task.evidence || '';
    rubrics.sort((a,b) => (a.order || 0) - (b.order || 0)).slice(0,3).forEach((r,i) => { $(`#assess-rubric-${i+1}`).value = r.descriptor || ''; });
    $('#assess-save-btn').innerHTML = '<i class="fas fa-save me-1"></i>수정 저장';
    $('#assessment').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function sendToEvaluation(planId) {
    const [plan, tasks, rubrics, subjects] = await Promise.all([
      AssessmentPlanRepo.get(planId), AssessmentTaskRepo.getByPlan(planId), AssessmentRubricRepo.getByPlan(planId), SubjectRepo.getAll()
    ]);
    if (!plan) return;
    let legacyId = plan.legacyEvalPlanId;
    if (!legacyId) {
      legacyId = uid('plan');
      const sub = subjects.find(s => s.subjectId === plan.subjectId) || subjects.find(s => [s.name, s.shortName].includes(plan.subjectName));
      const scale = rubrics.sort((a,b) => (a.order || 0) - (b.order || 0)).map(r => r.level).filter(Boolean);
      await DBManager.put('eval_plans', {
        planId: legacyId,
        subjectId: sub?.subjectId || plan.subjectId || '', subjectName: sub?.name || plan.subjectName || '',
        title: plan.title, date: plan.date || DBManager.getTodayStr(), domain: plan.domain || '',
        element: tasks[0]?.title || '', standard: plan.standard || '', method: plan.method || '',
        scale: scale.length >= 2 ? scale : (typeof EVAL_SCALE !== 'undefined' ? EVAL_SCALE.slice() : ['상','중','하']),
        assessmentPlanId: plan.planId
      });
      await AssessmentPlanRepo.save({ ...plan, legacyEvalPlanId: legacyId, status: 'ready' });
      showToast('학생평가에 연결했습니다. 이제 학생별 결과를 기록할 수 있습니다.', 'success');
      await loadAssessmentStudio(false);
    }
    if (typeof navigate === 'function') await navigate('evaluation');
    if (typeof openGrading === 'function') await openGrading(legacyId);
  }

  async function deleteAssessment(planId) {
    if (!confirm('이 수행평가 계획을 삭제할까요?\n이미 학생평가로 보낸 평가기록은 삭제하지 않습니다.')) return;
    await AssessmentPlanRepo.delete(planId);
    if (state.editingPlanId === planId) resetForm();
    showToast('수행평가 계획을 삭제했습니다.', 'success');
    await loadAssessmentStudio(false);
  }

  function resetForm(clearSelectors = true) {
    state.editingPlanId = null;
    if (clearSelectors) {
      $('#assess-unit').value = '';
      $('#assess-custom-unit').value = '';
      state.sourceLessons = [];
      renderSource(false);
    }
    ['assess-title','assess-objective','assess-standard','assess-task-title','assess-task-desc','assess-evidence','assess-rubric-1','assess-rubric-2','assess-rubric-3'].forEach(id => { const el = $('#' + id); if (el) el.value = ''; });
    $('#assess-date').value = '';
    $('#assess-domain').value = '지식·이해';
    $('#assess-method').value = '관찰';
    $('#assess-save-btn').innerHTML = '<i class="fas fa-save me-1"></i>평가계획 저장';
  }

  function renderPlans() {
    const box = $('#assess-plan-list');
    if (!box) return;
    const plans = [...state.plans].sort((a,b) => (b.date || '').localeCompare(a.date || '') || (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    $('#assess-plan-count').textContent = `${plans.length}개`;
    $('#assess-ready-count').textContent = `${plans.filter(p => !!p.legacyEvalPlanId).length}개`;
    if (!plans.length) {
      box.innerHTML = '<div class="ilog-assess-empty"><i class="fas fa-heart"></i>아직 저장한 수행평가가 없습니다.<br><small>왼쪽에서 지도계획을 불러와 첫 계획을 만들어 보세요.</small></div>';
      return;
    }
    box.innerHTML = plans.map(p => `
      <article class="ilog-assess-plan" data-plan-id="${esc(p.planId)}">
        <div class="ilog-plan-top"><div><div class="ilog-plan-subject">${esc(p.subjectName || p.subjectShort || '과목')}</div><div class="ilog-plan-title">${esc(p.title || '수행평가')}</div></div><span class="ilog-status-badge ${p.legacyEvalPlanId ? 'ready' : 'draft'}">${p.legacyEvalPlanId ? '평가 연결됨' : '계획 작성'}</span></div>
        <div class="ilog-plan-unit">${esc(p.unit || '')}</div>
        <div class="ilog-plan-meta"><span>${esc(p.date || '날짜 미정')}</span><span>${esc(p.domain || '-')}</span><span>${esc(p.method || '-')}</span>${p.source === 'annual_schedule' ? '<span>지도계획 연결</span>' : '<span>직접 작성</span>'}</div>
        <div class="ilog-plan-actions">
          <button type="button" class="btn btn-sm btn-outline-secondary" data-assess-action="edit">수정</button>
          <button type="button" class="btn btn-sm btn-outline-primary" data-assess-action="send"><i class="fas fa-arrow-right me-1"></i>${p.legacyEvalPlanId ? '평가 열기' : '학생평가로 보내기'}</button>
          <button type="button" class="btn btn-sm btn-outline-danger ms-auto" data-assess-action="delete">삭제</button>
        </div>
      </article>`).join('');
  }

  async function loadAssessmentStudio(refreshSelection = true) {
    if (!$('#assessment')?.classList.contains('active')) return;
    try {
      const [settings, subjects, schedule, plans] = await Promise.all([
        SettingsRepo.get(), SubjectRepo.getAll(), AnnualScheduleRepo.getAll(), AssessmentPlanRepo.getAll()
      ]);
      state.settings = settings || {};
      state.subjects = subjects || [];
      state.schedule = schedule || [];
      state.plans = plans || [];
      parseRubricLabels(state.settings);

      const sel = $('#assess-subject');
      const keep = sel.value;
      sel.innerHTML = state.subjects.map(s => `<option value="${esc(s.subjectId)}">${esc(s.name)}${s.shortName && s.shortName !== s.name ? ' (' + esc(s.shortName) + ')' : ''}</option>`).join('');
      if (keep && [...sel.options].some(o => o.value === keep)) sel.value = keep;
      if (!sel.value && sel.options.length) sel.selectedIndex = 0;
      if (refreshSelection) buildUnits();
      else {
        const oldUnit = $('#assess-unit').value;
        buildUnits();
        if ([...$('#assess-unit').options].some(o => o.value === oldUnit)) $('#assess-unit').value = oldUnit;
      }
      renderPlans();
    } catch (e) {
      if (String(e?.message || e).includes('잠겨 있습니다')) return;
      console.error('assessment studio:', e);
      showToast('평가 설계실을 불러오지 못했습니다: ' + (e.message || e), 'danger');
    }
  }

  function bind() {
    $('#assess-subject')?.addEventListener('change', () => { buildUnits(); resetForm(false); renderSource(false); });
    $('#assess-unit')?.addEventListener('change', () => renderSource(true));
    $('#assess-custom-unit')?.addEventListener('input', () => { if ($('#assess-unit').value === '__custom__' && !normalizeText($('#assess-title').value)) $('#assess-title').value = `${currentUnit()} 수행평가`; });
    $('#assess-draft-btn')?.addEventListener('click', buildTaskDraft);
    $('#assess-rubric-btn')?.addEventListener('click', buildRubricDraft);
    $('#assess-save-btn')?.addEventListener('click', () => saveAssessment().catch(showError));
    $('#assess-reset-btn')?.addEventListener('click', () => resetForm());
    $('#assess-new-btn')?.addEventListener('click', () => resetForm());
    $('#assess-plan-list')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-assess-action]');
      const card = e.target.closest('[data-plan-id]');
      if (!btn || !card) return;
      const id = card.dataset.planId;
      const action = btn.dataset.assessAction;
      if (action === 'edit') editAssessment(id).catch(showError);
      if (action === 'send') sendToEvaluation(id).catch(showError);
      if (action === 'delete') deleteAssessment(id).catch(showError);
    });
  }

  function start() {
    if (!ensureShell()) { setTimeout(start, 250); return; }
    bind();
    const section = $('#assessment');
    if (section) new MutationObserver(() => {
      if (section.classList.contains('active')) setTimeout(() => loadAssessmentStudio(true), 80);
    }).observe(section, { attributes: true, attributeFilter: ['class'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
