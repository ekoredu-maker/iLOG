(() => {
  'use strict';

  const NATIONAL = {
    '1-2': {'국어':482,'수학':256,'바른 생활':144,'슬기로운 생활':224,'즐거운 생활':400,'창의적 체험활동':238,'총 수업시간':1744},
    '3-4': {'국어':408,'사회/도덕':272,'수학':272,'과학/실과':204,'체육':204,'예술(음악/미술)':272,'영어':136,'창의적 체험활동':204,'총 수업시간':1972},
    '5-6': {'국어':408,'사회/도덕':272,'수학':272,'과학/실과':340,'체육':204,'예술(음악/미술)':272,'영어':204,'창의적 체험활동':204,'총 수업시간':2176}
  };

  let refreshing = false;
  let queued = false;
  let lastContext = null;

  const esc = (v) => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : 0; };
  const bandOf = (g) => Number(g) <= 2 ? '1-2' : (Number(g) <= 4 ? '3-4' : '5-6');
  const planKey = (s) => `instruction_hours_${Number(s.schoolYear)||new Date().getFullYear()}_${Number(s.grade)||0}`;
  const today = () => (window.DBManager && DBManager.getTodayStr ? DBManager.getTodayStr() : new Date().toISOString().slice(0,10));

  function isUnlocked() {
    const overlay = document.getElementById('login-overlay');
    return overlay && getComputedStyle(overlay).display === 'none';
  }
  function activeAnnualPage() {
    return !!document.querySelector('#annual-plan.page-section.active');
  }
  function groupOf(name, grade) {
    const n = String(name || '').replace(/\s+/g,'');
    const band = bandOf(grade);
    if (n === '창의적체험활동' || n === '창체') return '창의적 체험활동';
    if (band === '1-2') {
      const m = {'국어':'국어','수학':'수학','바른생활':'바른 생활','슬기로운생활':'슬기로운 생활','즐거운생활':'즐거운 생활'};
      return m[n] || name;
    }
    if (n === '국어') return '국어';
    if (n === '사회' || n === '도덕') return '사회/도덕';
    if (n === '수학') return '수학';
    if (n === '과학' || n === '실과') return '과학/실과';
    if (n === '체육') return '체육';
    if (n === '음악' || n === '미술') return '예술(음악/미술)';
    if (n === '영어') return '영어';
    return name;
  }
  function termOf(settings, d) {
    if (settings.term1Start && settings.term1End && settings.term1Start <= d && d <= settings.term1End) return 1;
    if (settings.term2Start && settings.term2End && settings.term2Start <= d && d <= settings.term2End) return 2;
    return 0;
  }
  function mondayOf(ds) {
    const d = new Date(ds + 'T00:00:00');
    const dow = d.getDay() || 7;
    d.setDate(d.getDate() - dow + 1);
    return d.toISOString().slice(0,10);
  }
  function addDays(ds, n) {
    const d = new Date(ds + 'T00:00:00'); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10);
  }
  function monthLabel(key) { const [y,m] = key.split('-'); return `${Number(y)}년 ${Number(m)}월`; }

  async function loadContext() {
    const [settings, subjects, annual] = await Promise.all([
      SettingsRepo.get(), SubjectRepo.getAll(), AnnualScheduleRepo.getAll()
    ]);
    const rec = (await DBManager.get('settings', planKey(settings))) || {id:planKey(settings), schoolPlan:{}};
    rec.schoolPlan = rec.schoolPlan || {};
    const byShort = new Map(subjects.map(s => [String(s.shortName||s.name||''), s]));
    const counts = new Map();
    const weekMap = new Map(), monthMap = new Map();
    const asOf = today();
    for (const day of annual) {
      const d = String(day.date || '');
      const term = termOf(settings, d);
      for (const lesson of (day.subjects || [])) {
        const short = String(lesson.name || '');
        if (!counts.has(short)) counts.set(short,{scheduled:0,completed:0,t1:0,t2:0,other:0});
        const c = counts.get(short); c.scheduled++;
        if (d && d <= asOf) c.completed++;
        if (term === 1) c.t1++; else if (term === 2) c.t2++; else c.other++;
        if (d) {
          const wk = mondayOf(d), mo = d.slice(0,7);
          if (!weekMap.has(wk)) weekMap.set(wk,new Map());
          if (!monthMap.has(mo)) monthMap.set(mo,new Map());
          weekMap.get(wk).set(short,(weekMap.get(wk).get(short)||0)+1);
          monthMap.get(mo).set(short,(monthMap.get(mo).get(short)||0)+1);
        }
      }
    }
    const active = subjects.filter(s => {
      const short = String(s.shortName||s.name||''), name = String(s.name||short);
      return counts.has(short) || rec.schoolPlan[name] != null || rec.schoolPlan[short] != null;
    });
    return {settings, subjects, active, annual, rec, byShort, counts, weekMap, monthMap, asOf};
  }

  function ensurePanel() {
    let panel = document.getElementById('instruction-hours-panel');
    if (panel) return panel;
    const host = document.querySelector('#annual-plan .container-fluid');
    if (!host) return null;
    panel = document.createElement('div');
    panel.id = 'instruction-hours-panel';
    panel.className = 'mb-4';
    const row = host.querySelector(':scope > .row');
    if (row) host.insertBefore(panel,row); else host.appendChild(panel);
    return panel;
  }

  function relabelLegacyHours() {
    const ths = document.querySelectorAll('#subject-list-body');
    if (!ths.length) return;
    const table = ths[0].closest('table');
    if (table) {
      const heads = table.querySelectorAll('thead th');
      if (heads[2]) { heads[2].textContent = '주당 참고시수'; heads[2].title = '연간 편성시수는 연간활동관리의 교육과정 편성·이수 시수에서 관리합니다.'; }
    }
    const label = document.querySelector('label[for="subHours"]');
    if (label) label.textContent = '주당 참고시수';
  }

  function rowData(ctx) {
    return ctx.active.map(s => {
      const short = String(s.shortName||s.name||''), name = String(s.name||short);
      const c = ctx.counts.get(short) || {scheduled:0,completed:0,t1:0,t2:0,other:0};
      const raw = ctx.rec.schoolPlan[name] ?? ctx.rec.schoolPlan[short];
      const plan = raw === undefined || raw === null || raw === '' ? null : num(raw);
      return {name, short, ...c, plan, diff: plan == null ? null : c.scheduled-plan, group:groupOf(name,ctx.settings.grade)};
    });
  }

  function nationalRows(ctx, rows) {
    const ref = NATIONAL[bandOf(ctx.settings.grade)];
    const sums = {};
    rows.forEach(r => {
      sums[r.group] ||= {plan:0,hasPlan:false,scheduled:0,completed:0};
      if (r.plan != null) { sums[r.group].plan += r.plan; sums[r.group].hasPlan = true; }
      sums[r.group].scheduled += r.scheduled; sums[r.group].completed += r.completed;
    });
    const arr = Object.entries(ref).filter(([k])=>k!=='총 수업시간').map(([group,national]) => ({
      group,national,plan:sums[group]?.hasPlan ? sums[group].plan : null,
      scheduled:sums[group]?.scheduled||0,completed:sums[group]?.completed||0
    }));
    arr.push({group:'합계',national:ref['총 수업시간'],plan:rows.some(r=>r.plan!=null)?rows.reduce((a,r)=>a+(r.plan||0),0):null,
      scheduled:rows.reduce((a,r)=>a+r.scheduled,0),completed:rows.reduce((a,r)=>a+r.completed,0)});
    return arr;
  }

  function subTable(ctx, map, mode) {
    const rows = rowData(ctx); const shorts = rows.map(r=>r.short); const names = rows.map(r=>r.name);
    if (!rows.length || !map.size) return '<div class="text-muted small p-3">연간 시간표가 생성되면 자동 집계됩니다.</div>';
    const keys = [...map.keys()].sort();
    let html = '<table class="table table-sm table-bordered align-middle"><thead><tr><th>'+(mode==='week'?'주/기간':'월')+'</th>';
    names.forEach(n=>html+=`<th>${esc(n)}</th>`); html+='<th>합계</th></tr></thead><tbody>';
    keys.forEach(k => {
      const m=map.get(k); const vals=shorts.map(s=>m.get(s)||0); const total=vals.reduce((a,b)=>a+b,0);
      const label = mode==='week' ? `${esc(k)}<br><small>${mondayOf(k)}~${addDays(mondayOf(k),4)}</small>` : monthLabel(k);
      html+=`<tr><td>${label}</td>${vals.map(v=>`<td class="text-center">${v}</td>`).join('')}<td class="text-center fw-bold">${total}</td></tr>`;
    });
    return html+'</tbody></table>';
  }

  function render(ctx) {
    const panel = ensurePanel(); if (!panel) return;
    relabelLegacyHours();
    const rows = rowData(ctx), national = nationalRows(ctx,rows);
    const planned = rows.reduce((a,r)=>a+r.scheduled,0), completed=rows.reduce((a,r)=>a+r.completed,0);
    const school = rows.some(r=>r.plan!=null) ? rows.reduce((a,r)=>a+(r.plan||0),0) : null;
    const grade = Number(ctx.settings.grade)||0, band=bandOf(grade);
    panel.innerHTML = `
      <div class="ih-head d-flex justify-content-between gap-3 flex-wrap align-items-start">
        <div><div class="ih-title"><i class="fas fa-hourglass-half me-2"></i>교육과정 편성·계획·이수 시수</div>
        <div class="ih-desc mt-1">국가 기준은 <b>${band}학년군 2년간 기준</b>으로 참고하고, 아래에는 학교가 정한 <b>${grade||'-'}학년 편성시수</b>를 입력합니다. 연간 시간표가 바뀌면 계획·주간·월간 시수도 자동으로 다시 계산됩니다.</div></div>
        <div class="ih-actions"><button class="btn btn-sm btn-outline-secondary" id="ih-copy-plan"><i class="fas fa-copy me-1"></i>현재 계획시수로 편성값 채우기</button>
        <button class="btn btn-sm btn-primary" id="ih-save"><i class="fas fa-save me-1"></i>학교 편성시수 저장</button></div>
      </div>
      <div class="ih-summary">
        <div class="ih-chip"><small>학교 편성시수 합계</small><strong>${school==null?'-':school+'시간'}</strong></div>
        <div class="ih-chip"><small>연간 시간표 계획</small><strong>${planned}시간</strong></div>
        <div class="ih-chip"><small>${esc(ctx.asOf)} 현재 이수</small><strong>${completed}시간</strong></div>
        <div class="ih-chip"><small>잔여 예정</small><strong>${Math.max(planned-completed,0)}시간</strong></div>
      </div>
      <div class="ih-table-wrap">
        <table class="table table-sm table-bordered align-middle"><thead><tr><th>과목</th><th>학교 편성시수</th><th>연간 계획</th><th>1학기</th><th>2학기</th><th>현재 이수</th><th>잔여</th><th>편성 대비 계획</th></tr></thead><tbody>
        ${rows.length?rows.map((r,i)=>`<tr><td><b>${esc(r.name)}</b><div class="small text-muted">${esc(r.group)}</div></td>
        <td><input class="form-control form-control-sm ih-plan-input" type="number" min="0" step="1" data-ih-index="${i}" value="${r.plan==null?'':r.plan}" placeholder="입력"></td>
        <td class="text-center fw-bold">${r.scheduled}</td><td class="text-center">${r.t1}</td><td class="text-center">${r.t2}</td><td class="text-center">${r.completed}</td><td class="text-center">${Math.max(r.scheduled-r.completed,0)}</td>
        <td class="text-center ${r.diff==null?'ih-muted':(r.diff===0?'ih-ok':'ih-warn')}">${r.diff==null?'-':(r.diff>0?'+':'')+r.diff}</td></tr>`).join(''):'<tr><td colspan="8" class="text-center text-muted py-3">주간 시간표를 저장하고 연간 시간표를 생성하면 과목별 시수가 표시됩니다.</td></tr>'}
        </tbody></table>
      </div>
      <details><summary>국가수준 교육과정 시간 배당 기준과 비교</summary><div class="ih-subtable"><table class="table table-sm table-bordered"><thead><tr><th>교과(군)</th><th>국가 ${band}학년군 기준(2년)</th><th>학교 당해학년 편성합</th><th>연간 계획합</th><th>현재 이수합</th></tr></thead><tbody>
      ${national.map(r=>`<tr><td>${esc(r.group)}</td><td class="text-center">${r.national}</td><td class="text-center">${r.plan==null?'-':r.plan}</td><td class="text-center">${r.scheduled}</td><td class="text-center">${r.completed}</td></tr>`).join('')}</tbody></table></div></details>
      <details><summary>주간 과목별 시수</summary><div class="ih-subtable">${subTable(ctx,ctx.weekMap,'week')}</div></details>
      <details><summary>월간 과목별 시수</summary><div class="ih-subtable">${subTable(ctx,ctx.monthMap,'month')}</div></details>
      <div class="ih-foot">※ 국가수준 표는 학년군 2년간 기준입니다. 학교의 당해 학년 편성시수는 학교 교육과정 편성표에 맞게 입력하세요. 실제 수업 운영이 변경되면 연간 시간표의 과목·일자·교시를 수정하면 계획 및 이수 집계와 경영록 출력에 함께 반영됩니다.</div>`;

    panel.querySelector('#ih-save')?.addEventListener('click',()=>savePlan(ctx,false));
    panel.querySelector('#ih-copy-plan')?.addEventListener('click',()=>savePlan(ctx,true));
  }

  async function savePlan(ctx, copyPlanned) {
    const rows=rowData(ctx); const plan={};
    const inputs=[...document.querySelectorAll('#instruction-hours-panel .ih-plan-input')];
    rows.forEach((r,i)=>{
      let v=copyPlanned?r.scheduled:(inputs[i]?.value ?? '');
      if (String(v).trim()!=='') plan[r.name]=Math.max(0,num(v));
    });
    const rec={id:planKey(ctx.settings),schoolYear:Number(ctx.settings.schoolYear)||0,grade:Number(ctx.settings.grade)||0,schoolPlan:plan,updatedAt:new Date().toISOString()};
    await DBManager.put('settings',rec);
    if (typeof showToast==='function') showToast(copyPlanned?'현재 연간 계획시수를 학교 편성값으로 채웠습니다. 학교 교육과정 편성표와 확인해 주세요.':'학교 편성시수를 저장했습니다.','success');
    scheduleRefresh(20);
  }

  async function refresh() {
    if (refreshing || !isUnlocked() || !activeAnnualPage()) return;
    refreshing=true;
    try { lastContext=await loadContext(); render(lastContext); }
    catch(e) { console.error('[instruction-hours]',e); }
    finally { refreshing=false; if(queued){queued=false;scheduleRefresh(50);} }
  }
  function scheduleRefresh(ms=120) {
    if (refreshing) { queued=true; return; }
    clearTimeout(scheduleRefresh.t); scheduleRefresh.t=setTimeout(refresh,ms);
  }

  document.addEventListener('DOMContentLoaded',()=>{
    relabelLegacyHours();
    const menu=document.getElementById('menu-list');
    menu?.addEventListener('click',(e)=>{ if(e.target.closest('[data-target="annual-plan"]')) scheduleRefresh(220); });
    const list=document.getElementById('annual-list-body');
    if(list) new MutationObserver(()=>scheduleRefresh(180)).observe(list,{childList:true,subtree:true});
    const login=document.getElementById('login-overlay');
    if(login) new MutationObserver(()=>{ if(isUnlocked()) scheduleRefresh(250); }).observe(login,{attributes:true,attributeFilter:['style','class']});
  });
})();
