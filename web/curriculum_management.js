(() => {
  'use strict';

  const NATIONAL = {
    '1-2': {'국어':482,'수학':256,'바른 생활':144,'슬기로운 생활':224,'즐거운 생활':400,'창의적 체험활동':238,'총 수업시간':1744},
    '3-4': {'국어':408,'사회/도덕':272,'수학':272,'과학/실과':204,'체육':204,'예술(음악/미술)':272,'영어':136,'창의적 체험활동':204,'총 수업시간':1972},
    '5-6': {'국어':408,'사회/도덕':272,'수학':272,'과학/실과':340,'체육':204,'예술(음악/미술)':272,'영어':204,'창의적 체험활동':204,'총 수업시간':2176}
  };
  const DONE = new Set(['done','makeup','substitute']);
  const FIELDS = [
    ['classVision','학급 교육 비전','우리 학급이 지향하는 교육의 큰 방향'],
    ['classGoals','학급 교육 목표','학급에서 기르고자 하는 역량과 학생의 모습'],
    ['focus','학급 운영 중점','올해 특히 중점적으로 운영할 교육활동'],
    ['studentProfile','학생·학급 실태 및 교육적 요구','학급 특성, 강점, 지원이 필요한 점'],
    ['curriculumPrinciples','교육과정 재구성·운영 원칙','교과 재구성, 학생 맞춤, 지역 연계 등'],
    ['creativeActivities','창의적 체험활동 운영','자율·자치, 동아리, 진로 등의 운영 방향'],
    ['schoolAutonomy','학교자율시간 운영','학교자율시간 활동·과목 및 운영 계획'],
    ['crossCurricular','범교과 연계 계획','안전·인성·민주시민·환경 등 연계 방법'],
    ['assessmentPolicy','교수·학습 및 평가 운영 방침','성취기준-수업-평가의 연계 원칙'],
    ['reflection','학기·학년도 운영 성찰','운영 결과, 성과, 보완할 점'],
    ['changes','교육과정 변경·보완 기록','학사일정·시간표·지도계획 변경 사유와 내용']
  ];

  let busy = false;
  let lastSignature = '';
  let lastModel = null;
  const esc = (v) => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const norm = (v) => String(v ?? '').replace(/\s+/g,'').trim();
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : 0; };
  const today = () => (window.DBManager?.getTodayStr ? DBManager.getTodayStr() : new Date().toISOString().slice(0,10));
  const bandOf = (g) => Number(g)<=2 ? '1-2' : (Number(g)<=4 ? '3-4' : '5-6');
  const hoursKey = (s) => `instruction_hours_${Number(s.schoolYear)||new Date().getFullYear()}_${Number(s.grade)||0}`;
  const recordKey = (s) => `class_curriculum_${Number(s.schoolYear)||new Date().getFullYear()}_${Number(s.grade)||0}_${String(s.classNo||'0')}`;
  const executionKey = (s) => `lesson_execution_${Number(s.schoolYear)||new Date().getFullYear()}_${Number(s.grade)||0}_${String(s.classNo||'0')}`;
  const slotKey = (d,p) => `${d}#${p}`;

  function unlocked() {
    const o = document.getElementById('login-overlay');
    return o && getComputedStyle(o).display === 'none';
  }
  function onAnnualPage() { return !!document.querySelector('#annual-plan.page-section.active'); }
  function groupOf(name, grade) {
    const n = norm(name), band = bandOf(grade);
    if (n==='창의적체험활동' || n==='창체') return '창의적 체험활동';
    if (band==='1-2') return ({'국어':'국어','수학':'수학','바른생활':'바른 생활','슬기로운생활':'슬기로운 생활','즐거운생활':'즐거운 생활'})[n] || name;
    if (n==='국어') return '국어';
    if (n==='사회'||n==='도덕') return '사회/도덕';
    if (n==='수학') return '수학';
    if (n==='과학'||n==='실과') return '과학/실과';
    if (n==='체육') return '체육';
    if (n==='음악'||n==='미술') return '예술(음악/미술)';
    if (n==='영어') return '영어';
    return name;
  }
  function termOf(s,d) {
    if (s.term1Start && s.term1End && s.term1Start<=d && d<=s.term1End) return 1;
    if (s.term2Start && s.term2End && s.term2Start<=d && d<=s.term2End) return 2;
    return 0;
  }
  function mondayOf(ds) {
    const d=new Date(ds+'T00:00:00'); const dow=d.getDay()||7; d.setDate(d.getDate()-dow+1); return d.toISOString().slice(0,10);
  }
  function addDays(ds,n) { const d=new Date(ds+'T00:00:00'); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); }

  function subjectIndex(subjects) {
    const map=new Map();
    subjects.forEach(s => [s.subjectId,s.name,s.shortName].forEach(v => { const k=norm(v); if(k && !map.has(k)) map.set(k,s); }));
    return map;
  }
  function resolveSubject(obj, index) {
    return index.get(norm(obj?.subjectId)) || index.get(norm(obj?.name)) || index.get(norm(obj?.subjectName)) || index.get(norm(obj?.subjectShort));
  }
  function savedStatus(exec, d, lesson) {
    const item=exec.items?.[slotKey(d,lesson.period)] || {};
    if(item.subject && norm(item.subject)!==norm(lesson.name||lesson.subjectShort||lesson.subjectName)) return '';
    const st=String(item.status||'').toLowerCase();
    return (DONE.has(st)||st==='cancelled')?st:'';
  }

  async function loadModel() {
    const [settings, subjects, annual, evalPlans, assessments] = await Promise.all([
      SettingsRepo.get(), SubjectRepo.getAll(), AnnualScheduleRepo.getAll(),
      DBManager.getAll('eval_plans'), DBManager.getAll('assessment_plans')
    ]);
    const [hoursRec, record, executionRec] = await Promise.all([
      DBManager.get('settings', hoursKey(settings)), DBManager.get('settings', recordKey(settings)), DBManager.get('settings', executionKey(settings))
    ]);
    const schoolPlan=(hoursRec?.schoolPlan)||{};
    const execution={id:executionKey(settings),mode:executionRec?.mode==='actual'?'actual':'estimated',items:executionRec?.items||{},updatedAt:executionRec?.updatedAt||''};
    const idx=subjectIndex(subjects), asOf=today();
    const counts=new Map(subjects.map(s=>[s.subjectId,{scheduled:0,expected:0,completed:0,unconfirmed:0,cancelled:0,t1:0,t2:0,content:0,eval:0,assessment:0}]));
    const week=new Map(), month=new Map();
    annual.forEach(day => {
      const d=String(day.date||''), term=termOf(settings,d);
      (day.subjects||[]).forEach(lesson => {
        const s=resolveSubject(lesson,idx); if(!s) return;
        const c=counts.get(s.subjectId) || {scheduled:0,expected:0,completed:0,unconfirmed:0,cancelled:0,t1:0,t2:0,content:0,eval:0,assessment:0}; counts.set(s.subjectId,c);
        c.scheduled++; if(term===1)c.t1++; else if(term===2)c.t2++;
        if(['unit','objective','content','standard'].some(k=>String(lesson[k]||'').trim())) c.content++;
        const st=savedStatus(execution,d,lesson), past=d && d<=asOf;
        if(st==='cancelled') c.cancelled++;
        if(past && st!=='cancelled') c.expected++;
        if(execution.mode==='actual') {
          if(DONE.has(st)) c.completed++;
          else if(past && !st) c.unconfirmed++;
        } else if(past && st!=='cancelled') c.completed++;
        if(d) {
          const wk=mondayOf(d), mo=d.slice(0,7);
          if(!week.has(wk)) week.set(wk,new Map()); if(!month.has(mo)) month.set(mo,new Map());
          week.get(wk).set(s.subjectId,(week.get(wk).get(s.subjectId)||0)+1);
          month.get(mo).set(s.subjectId,(month.get(mo).get(s.subjectId)||0)+1);
        }
      });
    });
    evalPlans.forEach(p=>{ const s=resolveSubject(p,idx); if(s) counts.get(s.subjectId).eval++; });
    assessments.forEach(p=>{ const s=resolveSubject(p,idx); if(s) counts.get(s.subjectId).assessment++; });
    const rows=subjects.map(s=>{
      const c=counts.get(s.subjectId)||{scheduled:0,expected:0,completed:0,unconfirmed:0,cancelled:0,t1:0,t2:0,content:0,eval:0,assessment:0};
      const raw=schoolPlan[s.name] ?? schoolPlan[s.shortName]; const plan=(raw===undefined||raw===null||raw==='')?null:num(raw);
      return {...s,...c,plan,diff:plan==null?null:c.scheduled-plan,coverage:c.scheduled?Math.round(c.content/c.scheduled*100):0,group:groupOf(s.name,settings.grade)};
    });
    return {settings,subjects,annual,rows,week,month,schoolPlan,record:record||{id:recordKey(settings)},execution,asOf};
  }

  function ensurePanel() {
    let p=document.getElementById('curriculum-management-panel'); if(p) return p;
    const host=document.querySelector('#annual-plan .container-fluid'); if(!host) return null;
    p=document.createElement('div'); p.id='curriculum-management-panel'; p.className='mb-4';
    const legacy=document.getElementById('instruction-hours-panel');
    if(legacy) host.insertBefore(p,legacy); else host.prepend(p);
    return p;
  }

  function statusOf(r,mode) {
    if(!r.scheduled) return ['시간표 미배치','cm-warn'];
    if(!r.content) return ['지도내용 미입력','cm-warn'];
    if(!r.eval && !r.assessment) return ['평가계획 미연결','cm-warn'];
    if(mode==='actual' && r.unconfirmed) return [`이수확인 ${r.unconfirmed}`,'cm-warn'];
    if(r.plan!=null && r.diff!==0) return ['시수 확인','cm-check'];
    return ['연동','cm-ok'];
  }

  function periodTable(model,map,mode) {
    if(!map.size) return '<div class="text-muted small p-3">연간 시간표를 생성하면 자동 집계됩니다.</div>';
    const rows=model.rows, keys=[...map.keys()].sort();
    let h='<div class="table-responsive"><table class="table table-sm table-bordered cm-mini"><thead><tr><th>'+(mode==='week'?'주/기간':'월')+'</th>';
    rows.forEach(r=>h+=`<th>${esc(r.name)}</th>`); h+='<th>합계</th></tr></thead><tbody>';
    keys.forEach(k=>{
      const vals=rows.map(r=>map.get(k).get(r.subjectId)||0), total=vals.reduce((a,b)=>a+b,0);
      const label=mode==='week'?`${esc(k)}<br><small>${mondayOf(k)}~${addDays(mondayOf(k),4)}</small>`:`${Number(k.slice(0,4))}년 ${Number(k.slice(5))}월`;
      h+=`<tr><td>${label}</td>${vals.map(v=>`<td>${v}</td>`).join('')}<td><b>${total}</b></td></tr>`;
    });
    return h+'</tbody></table></div>';
  }

  function nationalTable(model) {
    const band=bandOf(model.settings.grade), ref=NATIONAL[band], sums={};
    model.rows.forEach(r=>{ const g=r.group; sums[g] ||= {plan:0,has:false,scheduled:0,completed:0,unconfirmed:0}; if(r.plan!=null){sums[g].plan+=r.plan;sums[g].has=true;} sums[g].scheduled+=r.scheduled; sums[g].completed+=r.completed; sums[g].unconfirmed+=r.unconfirmed; });
    const data=Object.entries(ref).filter(([k])=>k!=='총 수업시간').map(([g,n])=>[g,n,sums[g]?.has?sums[g].plan:'-',sums[g]?.scheduled||0,sums[g]?.completed||0,sums[g]?.unconfirmed||0]);
    data.push(['합계',ref['총 수업시간'],model.rows.some(r=>r.plan!=null)?model.rows.reduce((a,r)=>a+(r.plan||0),0):'-',model.rows.reduce((a,r)=>a+r.scheduled,0),model.rows.reduce((a,r)=>a+r.completed,0),model.rows.reduce((a,r)=>a+r.unconfirmed,0)]);
    return `<table class="table table-sm table-bordered cm-mini"><thead><tr><th>교과(군)</th><th>국가 ${band}학년군 기준(2년)</th><th>학교 편성합</th><th>연간 계획합</th><th>${model.execution.mode==='actual'?'실제 이수':'일정상 이수 추정'}</th><th>미확인</th></tr></thead><tbody>${data.map(r=>`<tr>${r.map((v,i)=>`<td class="${i?'text-center':''}">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  function render(model) {
    const panel=ensurePanel(); if(!panel) return;
    const legacy=document.getElementById('instruction-hours-panel'); if(legacy) legacy.style.display='none';
    const planned=model.rows.reduce((a,r)=>a+r.scheduled,0), completed=model.rows.reduce((a,r)=>a+r.completed,0), content=model.rows.reduce((a,r)=>a+r.content,0);
    const unconfirmed=model.rows.reduce((a,r)=>a+r.unconfirmed,0), cancelled=model.rows.reduce((a,r)=>a+r.cancelled,0);
    const assessments=model.rows.reduce((a,r)=>a+r.assessment,0), school=model.rows.some(r=>r.plan!=null)?model.rows.reduce((a,r)=>a+(r.plan||0),0):null;
    const modeLabel=model.execution.mode==='actual'?'실제 이수':'일정상 추정';
    panel.innerHTML=`
      <div class="cm-card">
        <div class="cm-head"><div><div class="cm-title"><i class="fas fa-book-open me-2"></i>학급교육과정 종합관리</div><div class="cm-desc">과목설정의 <b>모든 과목</b>을 기준으로 편성 → 연간계획 → 지도내용 → 평가 → 실제 이수를 연결합니다.</div></div>
        <div class="d-flex gap-2 flex-wrap"><button class="btn btn-sm btn-outline-secondary" id="cm-copy-hours">계획시수로 편성값 채우기</button><button class="btn btn-sm btn-outline-success" id="cm-confirm-past"><i class="fas fa-check-double me-1"></i>${model.execution.mode==='actual'?'과거 미확인 일괄 실시':'실제 이수 관리 시작'}</button><button class="btn btn-sm btn-outline-primary" id="cm-hwpx"><i class="fas fa-file-word me-1"></i>학급교육과정 HWPX</button><button class="btn btn-sm btn-primary" id="cm-save"><i class="fas fa-save me-1"></i>종합관리 저장</button></div></div>
        <div class="cm-chips"><div><small>학교 편성</small><b>${school==null?'-':school+'시간'}</b></div><div><small>연간 계획</small><b>${planned}시간</b></div><div><small>지도내용 입력</small><b>${content}/${planned||0}</b></div><div><small>${modeLabel}</small><b>${completed}시간</b></div><div><small>과거 미확인</small><b>${unconfirmed}시간</b></div><div><small>미실시</small><b>${cancelled}시간</b></div><div><small>수행평가 계획</small><b>${assessments}건</b></div></div>

        <details class="cm-section" open><summary>학급교육과정 기록</summary><div class="cm-fields">${FIELDS.map(([k,l,p])=>`<label><span>${l}</span><textarea class="form-control form-control-sm cm-record" data-key="${k}" rows="2" placeholder="${esc(p)}">${esc(model.record[k]||'')}</textarea></label>`).join('')}</div></details>

        <details class="cm-section" open><summary>과목별 편성·지도·평가·이수 연동</summary><div class="table-responsive"><table class="table table-sm table-bordered align-middle cm-main-table"><thead><tr><th>과목</th><th>학교 편성</th><th>연간 계획</th><th>1학기</th><th>2학기</th><th>지도내용</th><th>${modeLabel}</th><th>미확인</th><th>평가계획</th><th>수행평가</th><th>상태</th></tr></thead><tbody>${model.rows.map((r,i)=>{const [st,cl]=statusOf(r,model.execution.mode);return `<tr><td><b>${esc(r.name)}</b><small>${esc(r.shortName||'')} · ${esc(r.group)}</small></td><td><input class="form-control form-control-sm cm-hours" type="number" min="0" step="1" data-i="${i}" value="${r.plan==null?'':r.plan}"></td><td>${r.scheduled}</td><td>${r.t1}</td><td>${r.t2}</td><td>${r.content}/${r.scheduled} <small>${r.coverage}%</small></td><td>${r.completed}</td><td>${r.unconfirmed}</td><td>${r.eval}</td><td>${r.assessment}</td><td><span class="cm-status ${cl}">${st}</span></td></tr>`;}).join('')||'<tr><td colspan="11" class="text-center text-muted">과목설정에서 과목을 등록하세요.</td></tr>'}</tbody></table></div></details>

        <details class="cm-section"><summary>국가수준 시간 배당 기준 비교</summary><div class="table-responsive">${nationalTable(model)}</div></details>
        <details class="cm-section"><summary>주간 과목별 계획시수</summary>${periodTable(model,model.week,'week')}</details>
        <details class="cm-section"><summary>월간 과목별 계획시수</summary>${periodTable(model,model.month,'month')}</details>
        <div class="cm-note"><i class="fas fa-link me-1"></i>${model.execution.mode==='actual'?'수업 카드의 실시 상태를 실제 운영에 맞게 표시하면 이수 결과와 출력물이 함께 바뀝니다.':'현재 이수는 날짜 기준 추정입니다. [실제 이수 관리 시작]을 누르면 과거 수업을 일괄 실시로 확정한 뒤 결강·보강·대체만 수정할 수 있습니다.'}</div>
      </div>`;

    document.getElementById('cm-copy-hours')?.addEventListener('click',()=>{ panel.querySelectorAll('.cm-hours').forEach((el,i)=>{el.value=model.rows[i]?.scheduled||0;}); });
    document.getElementById('cm-save')?.addEventListener('click',()=>save(model,panel));
    document.getElementById('cm-confirm-past')?.addEventListener('click',()=>confirmPast(model));
    document.getElementById('cm-hwpx')?.addEventListener('click',()=>deliverFile('class_curriculum_hwpx'));
    decorateAnnual(model);
  }

  async function save(model,panel) {
    const schoolPlan={};
    panel.querySelectorAll('.cm-hours').forEach(el=>{ const r=model.rows[Number(el.dataset.i)]; if(r && el.value!=='') schoolPlan[r.name]=num(el.value); });
    const hourRec={id:hoursKey(model.settings),schoolYear:Number(model.settings.schoolYear)||new Date().getFullYear(),grade:Number(model.settings.grade)||0,schoolPlan};
    const record={id:recordKey(model.settings)}; panel.querySelectorAll('.cm-record').forEach(el=>record[el.dataset.key]=el.value.trim());
    await Promise.all([DBManager.put('settings',hourRec),DBManager.put('settings',record)]);
    if(window.showToast) showToast('학급교육과정 종합관리 내용을 저장했습니다.','success');
    lastSignature=''; await refresh(true);
  }

  async function confirmPast(model) {
    if(!confirm('오늘까지 배치된 수업 중 미확인 차시를 모두 “실시”로 확정할까요?\n결강·보강·대체 수업은 각 수업 카드에서 바로 수정할 수 있습니다.')) return;
    const rec={id:executionKey(model.settings),mode:'actual',items:{...(model.execution.items||{})},updatedAt:new Date().toISOString()};
    model.annual.forEach(day=>{
      const d=String(day.date||''); if(!d || d>model.asOf) return;
      (day.subjects||[]).forEach(lesson=>{
        const key=slotKey(d,lesson.period), old=rec.items[key];
        if(old && old.subject && norm(old.subject)!==norm(lesson.name)) delete rec.items[key];
        if(!rec.items[key]) rec.items[key]={status:'done',subject:lesson.name||'',updatedAt:new Date().toISOString()};
      });
    });
    await DBManager.put('settings',rec);
    if(window.showToast) showToast('오늘까지의 미확인 수업을 실시로 확정했습니다.','success');
    lastSignature=''; await refresh(true);
  }

  async function saveExecution(model,d,lesson,status) {
    const rec={id:executionKey(model.settings),mode:'actual',items:{...(model.execution.items||{})},updatedAt:new Date().toISOString()};
    const key=slotKey(d,lesson.period);
    if(status) rec.items[key]={status,subject:lesson.name||'',updatedAt:new Date().toISOString()};
    else delete rec.items[key];
    await DBManager.put('settings',rec);
    if(window.showToast) showToast('수업 실시 상태를 반영했습니다.','success');
    lastSignature=''; await refresh(true);
  }

  function decorateAnnual(model) {
    const tbody=document.getElementById('annual-list-body'); if(!tbody) return;
    const dayMap=new Map(model.annual.map(d=>[String(d.date||''),d]));
    tbody.querySelectorAll('tr').forEach(tr=>{
      const dateEl=tr.querySelector('td:first-child .fw-bold'); const d=String(dateEl?.textContent||'').trim();
      const day=dayMap.get(d); if(!day) return;
      const wrap=tr.querySelector('td:nth-child(2) > .d-flex'); if(!wrap) return;
      const boxes=[...wrap.children];
      (day.subjects||[]).forEach((lesson,i)=>{
        const box=boxes[i]; if(!box || box.querySelector('.cm-exec-select')) return;
        const st=savedStatus(model.execution,d,lesson), past=d<=model.asOf;
        const sel=document.createElement('select'); sel.className='form-select form-select-sm cm-exec-select mt-1';
        sel.innerHTML=`<option value="">${past?'미확인':'예정'}</option><option value="done">실시</option><option value="cancelled">미실시</option><option value="makeup">보강</option><option value="substitute">대체</option>`;
        sel.value=st; sel.title='실제 수업 실시 상태';
        sel.addEventListener('click',e=>e.stopPropagation());
        sel.addEventListener('contextmenu',e=>e.stopPropagation());
        sel.addEventListener('change',e=>{e.stopPropagation(); saveExecution(model,d,lesson,sel.value).catch(err=>window.showError?showError(err):console.error(err));});
        box.appendChild(sel);
      });
    });
  }

  async function refresh(force=false) {
    if(busy || !unlocked() || !onAnnualPage()) return;
    busy=true;
    try {
      const model=await loadModel(); lastModel=model;
      const sig=JSON.stringify({s:model.subjects.map(x=>[x.subjectId,x.name,x.shortName]),a:model.annual.map(x=>[x.date,(x.subjects||[]).map(y=>[y.period,y.name,y.unit,y.objective,y.content,y.standard])]),p:model.schoolPlan,r:model.record,x:model.execution,e:model.rows.map(x=>[x.eval,x.assessment,x.completed,x.unconfirmed,x.cancelled])});
      if(force || sig!==lastSignature){ lastSignature=sig; render(model); } else decorateAnnual(model);
    } catch(e) { console.warn('학급교육과정 종합관리 갱신 실패',e); }
    finally { busy=false; }
  }

  document.addEventListener('DOMContentLoaded',()=>{
    setTimeout(()=>refresh(true),700);
    document.addEventListener('click',e=>{ if(e.target?.closest?.('[data-page="annual-plan"],#tab-annual-plan,#generate-annual-btn,#save-timetable-btn')) setTimeout(()=>refresh(true),500); });
    const list=document.getElementById('annual-list-body'); if(list) new MutationObserver(()=>{ if(lastModel) decorateAnnual(lastModel); }).observe(list,{childList:true,subtree:true});
    setInterval(()=>refresh(false),3000);
  });
  window.addEventListener('pywebviewready',()=>setTimeout(()=>refresh(true),500));
})();
