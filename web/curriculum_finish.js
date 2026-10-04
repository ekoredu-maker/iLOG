(() => {
  'use strict';

  const norm = (v) => String(v ?? '').replace(/\s+/g, '').trim();
  const esc = (v) => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const isNational = (p) => p && p.publisher === '국가수준 기본안' && p.curriculum === '2022 개정';

  function patchCurriculumModal() {
    const modalEl = document.getElementById('curriculumModal');
    if (!modalEl) return;
    const title = modalEl.querySelector('.modal-title');
    if (title) title.innerHTML = '<i class="fas fa-book-open me-2"></i>국가수준·교과서 지도계획 기본자료';

    const info = modalEl.querySelector('.alert.alert-info');
    if (info) info.innerHTML = '① [연간활동관리]에서 연간 시간표 생성 → ② 과목별 <b>국가수준 기본안</b> 또는 교사가 가져온 자료 선택 → ③ [적용].<br><span class="text-muted">국가수준 기본안은 2022 개정 교육과정의 영역·내용체계를 바탕으로 한 출판사 독립형 자료이며, 교사가 채택 교과서와 학급교육과정에 맞게 수정·재구성할 수 있습니다.</span>';

    const mainTable = modalEl.querySelector('#cur-subject-body')?.closest('table');
    if (mainTable) {
      const heads = mainTable.querySelectorAll('thead th');
      if (heads[1]) heads[1].textContent = '기본안·교과서 자료';
    }
    const packTable = document.getElementById('cur-pack-body')?.closest('table');
    if (packTable) {
      const heads = packTable.querySelectorAll('thead th');
      if (heads[2]) heads[2].textContent = '자료 구분';
    }

    const guide = [...modalEl.querySelectorAll('.small.text-muted')].find(el => /엑셀 1행 제목/.test(el.textContent || ''));
    if (guide) guide.textContent = '교과서·학교 재구성 자료를 추가하려면 엑셀 1행 제목을 학년 · 과목 · 출판사/자료구분 · 학기 · 차시 · 영역 · 단원 · 성취기준 · 학습목표 · 지도내용 형태로 작성하세요.';

    if (!document.getElementById('cur-national-all-btn')) {
      const keep = document.getElementById('cur-keep-existing');
      const wrap = document.createElement('div');
      wrap.className = 'd-flex gap-2 flex-wrap align-items-center mb-3';
      wrap.innerHTML = '<button class="btn btn-success" id="cur-national-all-btn"><i class="fas fa-wand-magic-sparkles me-1"></i>국가수준 기본안 전체 적용</button><span class="small text-muted">비어 있는 지도내용만 채우며, 교사가 이미 입력·수정한 내용은 유지합니다.</span>';
      (keep?.closest('.form-check') || mainTable)?.after(wrap);
      document.getElementById('cur-national-all-btn')?.addEventListener('click', applyNationalAll);
    }
  }

  function nationalMatch(packs, subject) {
    const keys = new Set([norm(subject.name), norm(subject.shortName)]);
    return packs.find(p => isNational(p) && keys.has(norm(p.subject))) || null;
  }

  function upgradedCurriculumRow(subject, packs, chosen) {
    const tr = document.createElement('tr');
    const sorted = [...packs].sort((a,b) => Number(isNational(b)) - Number(isNational(a)) || String(a.publisher).localeCompare(String(b.publisher), 'ko'));
    const validChosen = sorted.some(p => p.packId === chosen) ? chosen : (sorted.find(isNational)?.packId || '');
    const opts = sorted.map(p => {
      const mark = isNational(p) ? '★ ' : '';
      const countLabel = p.adaptive ? `${p.lessonCount}주제` : `${p.lessonCount}차시`;
      return `<option value="${esc(p.packId)}" ${p.packId === validChosen ? 'selected' : ''}>${mark}${esc(p.publisher)}${p.curriculum ? ' · ' + esc(p.curriculum) : ''} (${countLabel})</option>`;
    }).join('');
    tr.innerHTML = `<td class="fw-bold">${esc(subject.name)}</td>
      <td><select class="form-select form-select-sm">${validChosen ? '' : '<option value="">자료 선택</option>'}${opts}</select></td>
      <td class="small preview text-muted">-</td>
      <td class="text-nowrap"><button class="btn btn-sm btn-primary" disabled>적용</button></td>`;
    const sel = tr.querySelector('select');
    const btn = tr.querySelector('button');
    const pv = tr.querySelector('.preview');

    const refresh = async () => {
      if (!sel.value) { btn.disabled = true; pv.textContent = '-'; return; }
      const r = await api.curriculum_preview(sel.value, subject.shortName);
      const p = sorted.find(x => x.packId === sel.value);
      const source = isNational(p) ? '<span class="badge bg-success-subtle text-success-emphasis me-1">국가수준</span>' : '<span class="badge bg-secondary-subtle text-secondary-emphasis me-1">사용자 자료</span>';
      pv.innerHTML = source + r.terms.map(t => {
        const warn = t.leftLessons > 0 ? `<span class="text-danger">자료 ${t.leftLessons}개 남음</span>` : (t.emptySlots > 0 ? `<span class="text-primary">빈 칸 ${t.emptySlots}개</span>` : '<span class="text-success">배치 가능</span>');
        return `<div>${t.term}: 수업 ${t.slots}칸 · ${warn}</div>`;
      }).join('');
      btn.disabled = r.terms.every(t => t.slots === 0);
      if (btn.disabled) pv.innerHTML += '<div class="text-danger">연간 시간표에 이 과목 수업이 없습니다.</div>';
    };
    sel.addEventListener('change', () => refresh().catch(showError));
    btn.addEventListener('click', async () => {
      const p = sorted.find(x => x.packId === sel.value);
      if (!p) return;
      const keep = document.getElementById('cur-keep-existing')?.checked;
      const label = isNational(p) ? '국가수준 기본안' : p.publisher;
      if (!confirm(`${subject.name} 과목에 [${label}]을 적용합니다.\n${keep ? '이미 입력한 내용은 유지합니다.' : '이미 입력한 지도내용도 덮어씁니다.'}`)) return;
      btn.disabled = true;
      setBusy(true);
      try {
        const r = await api.curriculum_apply(sel.value, subject.shortName, !keep);
        showToast(`${subject.name}: ${r.applied}칸 적용` + (r.skipped ? `, 기존 내용 ${r.skipped}칸 유지` : ''), 'success');
        await refresh();
        if (document.getElementById('annual-plan')?.classList.contains('active')) await loadAnnualManage();
      } catch (e) { showError(e); }
      finally { setBusy(false); btn.disabled = false; }
    });
    if (sel.value) refresh().catch(showError);
    return tr;
  }

  async function upgradedLoadCurriculumLibrary() {
    patchCurriculumModal();
    const grade = Number(val('cur-grade')) || null;
    const [packs, subs, choices] = await Promise.all([api.curriculum_list(grade), SubjectRepo.getAll(), api.curriculum_choices()]);
    const body = document.getElementById('cur-subject-body');
    body.innerHTML = '';
    const byNorm = new Map();
    packs.forEach(p => {
      const key = norm(p.subject);
      if (!byNorm.has(key)) byNorm.set(key, []);
      byNorm.get(key).push(p);
    });
    const shown = new Set();
    subs.forEach(s => {
      const keys = [norm(s.name), norm(s.shortName)].filter(Boolean);
      const list = keys.flatMap(k => byNorm.get(k) || []).filter((p,i,a) => a.findIndex(x => x.packId === p.packId) === i);
      if (!list.length) return;
      list.forEach(p => shown.add(p.packId));
      body.appendChild(upgradedCurriculumRow(s, list, choices[s.shortName]));
    });
    if (!body.children.length) {
      body.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-4">${grade || ''}학년의 담임 개설과목과 연결되는 지도계획 자료가 없습니다.<br>과목설정을 확인해 주세요.</td></tr>`;
    }
    const unmatched = packs.filter(p => !shown.has(p.packId) && !isNational(p));
    document.getElementById('cur-unmatched').innerHTML = unmatched.length
      ? `<i class="fas fa-exclamation-circle me-1"></i>담임 개설과목과 연결되지 않은 사용자 자료: <b>${[...new Set(unmatched.map(p=>p.subject))].map(esc).join(', ')}</b>` : '';

    const pl = document.getElementById('cur-pack-body');
    pl.innerHTML = packs.length ? '' : '<tr><td colspan="6" class="text-center text-muted small">없음</td></tr>';
    packs.forEach(p => {
      const tr = document.createElement('tr');
      const badge = isNational(p) ? '<span class="badge bg-success">국가수준 기본 탑재</span>' : (p.builtin ? '<span class="badge bg-secondary">기본 탑재</span>' : '<button class="btn btn-sm btn-outline-danger">삭제</button>');
      const countText = p.adaptive ? `${p.lessonCount}개 기본주제 <span class="text-success small">(연간 차시에 자동 확장)</span>` : `${p.lessonCount}차시`;
      tr.innerHTML = `<td>${p.grade}</td><td>${esc(p.subject)}</td><td>${esc(p.publisher)}</td><td class="small">${esc(p.curriculum || '')}</td><td>${countText}</td><td>${badge}</td>`;
      const del = tr.querySelector('button');
      if (del) del.addEventListener('click', async () => {
        try {
          if (confirm(`${p.grade}학년 ${p.subject} (${p.publisher}) 자료를 삭제할까요?\n이미 시간표에 적용한 내용은 지워지지 않습니다.`)) {
            await api.curriculum_delete(p.packId);
            await upgradedLoadCurriculumLibrary();
          }
        } catch (e) { showError(e); }
      });
      pl.appendChild(tr);
    });
  }

  async function applyNationalAll() {
    const btn = document.getElementById('cur-national-all-btn');
    const grade = Number(val('cur-grade')) || null;
    if (!grade) return;
    if (!confirm(`${grade}학년 담임 개설과목의 비어 있는 연간 지도내용에 2022 개정 국가수준 기본안을 채웁니다.\n교사가 이미 입력하거나 수정한 내용은 덮어쓰지 않습니다. 계속할까요?`)) return;

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>국가수준 기본안 적용 중...';
    }
    setBusy(true);
    showToast('국가수준 기본안을 연간 지도계획에 적용하고 있습니다.', 'info');

    try {
      const subs = await SubjectRepo.getAll();
      let result;

      // 데스크톱은 연간시간표를 한 번만 읽고/쓰는 Python 일괄 처리 경로를 사용한다.
      if (Bridge.isDesktop() && typeof api.curriculum_apply_national_batch === 'function') {
        result = await api.curriculum_apply_national_batch(
          grade,
          subs.map(s => ({ name: s.name, shortName: s.shortName })),
          false
        );
      } else {
        // 브라우저 개발 모드는 기존 API만으로 호환한다.
        const packs = await api.curriculum_list(grade);
        let applied = 0, skipped = 0, matched = 0;
        for (const s of subs) {
          const p = nationalMatch(packs, s);
          if (!p) continue;
          matched += 1;
          const r = await api.curriculum_apply(p.packId, s.shortName, false);
          applied += Number(r.applied || 0);
          skipped += Number(r.skipped || 0);
        }
        result = { matched, applied, skipped };
      }

      showToast(`국가수준 기본안: ${result.matched}과목, ${result.applied}차시 적용` + (result.skipped ? ` · 기존 ${result.skipped}차시 유지` : ''), 'success');
      await upgradedLoadCurriculumLibrary();
      if (document.getElementById('annual-plan')?.classList.contains('active')) await loadAnnualManage();
    } catch (e) { showError(e); }
    finally {
      setBusy(false);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-wand-magic-sparkles me-1"></i>국가수준 기본안 전체 적용';
      }
    }
  }

  async function saveClassBookHwpx() {
    const btn = document.getElementById('class-book-hwpx-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>HWPX 만드는 중...';
    }
    setBusy(true);
    showToast('학급경영록 HWPX를 만들고 있습니다. 자료가 많으면 잠시 걸릴 수 있습니다.', 'info');
    try {
      let saved;
      if (Bridge.isDesktop() && typeof api.build_and_save_file === 'function') {
        // 큰 HWPX를 Python→JS→Python으로 base64 왕복하지 않고 Python 안에서 바로 저장한다.
        saved = await api.build_and_save_file('class_curriculum_hwpx', {});
      } else {
        saved = await deliverFile('class_curriculum_hwpx', {});
      }
      if (saved) showToast('학급경영록 HWPX를 저장했습니다.', 'success');
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-file-alt me-1"></i>한글 HWPX';
      }
    }
  }

  function addClassBookHwpxButton() {
    if (document.getElementById('class-book-hwpx-btn')) return;
    const excel = document.getElementById('excel-all-report-btn');
    if (!excel) return;
    const btn = document.createElement('button');
    btn.className = 'btn btn-outline-primary btn-lg';
    btn.id = 'class-book-hwpx-btn';
    btn.innerHTML = '<i class="fas fa-file-alt me-1"></i>한글 HWPX';
    btn.title = '학급교육과정·시수·지도계획·평가·학생기록을 포함한 학급경영록';
    btn.addEventListener('click', saveClassBookHwpx);
    excel.after(btn);
  }

  document.addEventListener('DOMContentLoaded', () => {
    patchCurriculumModal();
    addClassBookHwpxButton();
    // app.js의 기존 함수는 출판사 중심·정확 문자열 매칭이므로 국가수준/공백별칭을 처리하는 버전으로 교체한다.
    window.loadCurriculumLibrary = upgradedLoadCurriculumLibrary;
    window.curriculumRow = upgradedCurriculumRow;
  });
})();