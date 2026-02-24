// app.js - v9.7 Fixed (Logic & UX Enhanced)
// Copyright 2026@박주가리교감

let isLocked = true; 
let calendarInstance = null;
let currentEditDate = null;
let currentEditPeriod = null;
let attCtx = null;
let curSid = null;
let curEval = null;
let editingSubId = null; 
let editingExpId = null; 
let ctxTarget = null; 

const DAYS = ['mon','tue','wed','thu','fri'];

function showToast(msg, type='primary') {
    const el = document.getElementById('liveToast');
    const body = document.getElementById('toast-msg');
    if(el && body) {
        el.className = `toast align-items-center text-white bg-${type} border-0`;
        body.textContent = msg;
        const toast = new bootstrap.Toast(el);
        toast.show();
    } else {
        alert(msg); 
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('login-btn').addEventListener('click', tryLogin);
    document.getElementById('login-password').addEventListener('keyup', (e) => { if(e.key==='Enter') tryLogin(); });
    document.getElementById('lock-btn').addEventListener('click', lockSystem);

    document.addEventListener('click', () => {
        document.getElementById('context-menu').style.display = 'none';
    });
    
    document.getElementById('ctx-edit').addEventListener('click', () => {
        if(ctxTarget) openContentEdit(ctxTarget.date, ctxTarget.period);
    });
    document.getElementById('ctx-delete').addEventListener('click', async () => {
        if(ctxTarget && confirm(`${ctxTarget.date} ${ctxTarget.period}교시 내용을 삭제하시겠습니까?`)) {
            await deleteSubjectFromAnnual(ctxTarget.date, ctxTarget.period);
        }
    });
    document.getElementById('ctx-eval').addEventListener('click', () => {
        if(ctxTarget) {
            document.getElementById('eval-title').value = `${ctxTarget.date} 평가`;
            document.getElementById('eval-date').value = ctxTarget.date;
            document.querySelector('[data-target="evaluation"]').click();
            setTimeout(async () => {
                const day = await AnnualScheduleRepo.get(ctxTarget.date);
                const sub = day.subjects.find(s => s.period === ctxTarget.period);
                if(sub) {
                    const sel = document.getElementById('eval-subject-select');
                    for(let i=0; i<sel.options.length; i++) {
                        if(sel.options[i].dataset.name === sub.name) {
                            sel.selectedIndex = i;
                            break;
                        }
                    }
                }
                new bootstrap.Modal(document.getElementById('addEvalModal')).show();
            }, 300);
        }
    });

    document.getElementById('menu-list').addEventListener('click', (e) => {
        const link = e.target.closest('.nav-link');
        if (!link) return;
        e.preventDefault();
        if(isLocked) return;
        document.querySelector('.sidebar').classList.remove('show');
        document.querySelectorAll('#menu-list .nav-link').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        const targetId = link.getAttribute('data-target');
        if (targetId === 'scheduler-modal-trigger') { openSchedulerModal(); return; }
        document.querySelectorAll('.page-section').forEach(p => p.classList.remove('active'));
        document.getElementById(targetId).classList.add('active');
        document.getElementById('header-title').textContent = link.textContent.trim();
        if (targetId === 'dashboard') loadDashboard();
        else if (targetId === 'curriculum') loadCurriculumMain();
        else if (targetId === 'annual-plan') loadAnnualManage();
        else if (targetId === 'students') loadStudents();
        else if (targetId === 'tasks') loadTasks();
        else if (targetId === 'experiential') loadExperiential();
        else if (targetId === 'evaluation') loadEvaluation();
        else if (targetId === 'stats') loadStats();
        else if (targetId === 'incidents') loadIncidents();
    });

    document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
    document.getElementById('change-pwd-btn').addEventListener('click', changePassword);
    document.getElementById('add-subject-btn').addEventListener('click', addSubject);
    document.getElementById('update-subject-btn').addEventListener('click', updateSubject);
    document.getElementById('add-default-subject-btn').addEventListener('click', addDefaultSubjects);
    document.getElementById('clear-timetable-btn').addEventListener('click', clearTimetable);
    document.getElementById('save-timetable-btn').addEventListener('click', saveTimetable);
    document.getElementById('tab-timetable').addEventListener('click', loadTimetable);
    document.getElementById('add-event-btn').addEventListener('click', addSchoolEvent);
    document.getElementById('batch-event-btn').addEventListener('click', addBatchEvents);
    const seBtn = document.getElementById('school-event-excel-btn');
    if(seBtn) seBtn.addEventListener('click', uploadSchoolEventsFromExcel);

    document.getElementById('generate-annual-btn').addEventListener('click', generateAnnualSchedule);
    document.getElementById('print-subject-plan-btn').addEventListener('click', printSubjectPlan);
    document.getElementById('add-student-btn').addEventListener('click', addStudent);
    document.getElementById('batch-register-btn').addEventListener('click', registerBatchStudents);
    document.getElementById('batch-excel-btn').addEventListener('click', importStudentsFromExcel);
    document.getElementById('add-exp-btn').addEventListener('click', addExperiential);
    document.getElementById('save-exp-edit-btn').addEventListener('click', saveExpEdit);
    document.getElementById('add-counsel-btn').addEventListener('click', addCounseling);
    document.getElementById('add-incident-btn').addEventListener('click', addIncident);
    document.getElementById('add-eval-plan-btn').addEventListener('click', addEvalPlan);
    document.getElementById('save-grades-btn').addEventListener('click', saveGrades);
    document.getElementById('export-grades-btn').addEventListener('click', downloadEvalCsv);
    document.getElementById('add-task-btn').addEventListener('click', addTask);
    document.getElementById('backup-btn').addEventListener('click', exportData);
    document.getElementById('restore-btn').addEventListener('click', importData);
    document.getElementById('reset-btn').addEventListener('click', resetSystem);
    document.getElementById('save-attendance-btn').addEventListener('click', saveAttendance);
    document.getElementById('mark-all-present-btn').addEventListener('click', markAllPresent);
    document.getElementById('print-all-report-btn').addEventListener('click', generateTotalReport);

    document.getElementById('eventSameDay').addEventListener('change', (e) => {
        const endInput = document.getElementById('eventEndDate');
        const startInput = document.getElementById('eventStartDate');
        if(e.target.checked) {
            endInput.value = startInput.value;
            endInput.disabled = true;
        } else {
            endInput.disabled = false;
        }
    });
    document.getElementById('eventStartDate').addEventListener('change', () => {
        if(document.getElementById('eventSameDay').checked) {
            document.getElementById('eventEndDate').value = document.getElementById('eventStartDate').value;
        }
    });

    initApp();
});

async function initApp() {
    setInterval(() => {
        const now = new Date();
        document.getElementById('clock').textContent = now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });
    }, 1000);

    try {
        await DBManager.open(); // 초기 로드시 DB 열기 시도
        const subs = await SubjectRepo.getAll();
        if(subs.length === 0) await addDefaultSubjects();
        await loadSettingsToForm();
        loadDashboard();
    } catch (error) {
        console.error("Init Error:", error);
    }
}

// [핵심수정] tryLogin 함수에서 DB 오픈 상태를 확인하도록 변경
async function tryLogin() {
    const input = document.getElementById('login-password');
    const msg = document.getElementById('login-msg');
    try {
        // DB가 열려있지 않다면 다시 열기를 시도하고 대기함
        await DBManager.open(); 
        
        const rawPw = await SettingsRepo.getPassword();
        const pw = String(rawPw ?? '').trim();
        const inPw = String(input?.value ?? '').trim();

        if (inPw === pw) {
            isLocked = false;
            document.getElementById('login-overlay').style.display = 'none';
            if (msg) { msg.textContent = ''; msg.style.display = 'none'; }
            if (input) input.value = '';
        } else {
            if (msg) {
                msg.textContent = '비밀번호 오류';
                msg.style.display = 'block';
            }
        }
    } catch (e) {
        console.error("Login Error Details:", e);
        if (msg) {
            msg.textContent = 'DB 오류 (저장소 접근 권한 또는 초기화 문제)';
            msg.style.display = 'block';
        }
    }
}

function lockSystem() { isLocked = true; document.getElementById('login-overlay').style.display = 'flex'; document.getElementById('login-password').value = ''; }
async function changePassword() {
    const cur = document.getElementById('curr-pwd').value;
    const newP = document.getElementById('new-pwd').value;
    const realPw = await SettingsRepo.getPassword();
    if (cur !== realPw) return alert('현재 비밀번호 불일치');
    if (newP.length < 4) return alert('4자리 이상 권장');
    await SettingsRepo.savePassword(newP);
    alert('변경 완료');
    location.reload();
}
function stringToColor(str) { let hash = 0; for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash); return `hsl(${Math.abs(hash % 360)}, 70%, 80%)`; }

async function loadDashboard() {
    const todayStr = DBManager.getTodayStr(); document.getElementById('today-display').textContent = todayStr;
    const links = await DBManager.getCustomLinks();
    const container = document.getElementById('quick-links-container');
    const customs = container.querySelectorAll('.custom-added');
    customs.forEach(el => el.remove());
    links.forEach(l => {
        const btn = document.createElement('a');
        btn.href = l.url;
        btn.target = '_blank';
        btn.className = 'btn btn-light border quick-link custom-added';
        const linkId = l.linkId || l.id; 
        btn.innerHTML = `<i class="fas fa-link me-2 text-secondary"></i>${l.name} <i class="fas fa-times ms-2 text-danger" style="cursor:pointer;" onclick="event.preventDefault();removeCustomLink('${linkId}')"></i>`;
        container.insertBefore(btn, container.lastElementChild);
    });

    let dailySchedule = await AnnualScheduleRepo.get(todayStr);
    let subjects = [];
    const events = await SchoolEventRepo.getAll();
    const holiday = events.find(e => e.isHoliday && todayStr >= e.startDate && todayStr <= e.endDate);
    const con = document.getElementById('today-schedule-container');

    if(holiday) {
        con.innerHTML = `<div class="col-12 text-center py-5"><h4 class="text-danger fw-bold mb-2"><i class="fas fa-umbrella-beach me-2"></i>${holiday.title}</h4><span class="badge bg-secondary">휴업일</span></div>`;
        document.getElementById('unprocessed-count').textContent = '휴업';
    } else {
        if (!dailySchedule || !dailySchedule.subjects) {
            const dayIndex = new Date(todayStr).getDay();
            const dayKey = ['sun','mon','tue','wed','thu','fri','sat'][dayIndex];
            const weekly = await TimetableRepo.getWeekly();
            if(weekly && dayIndex !== 0 && dayIndex !== 6) { for(let p=1; p<=6; p++) { if(weekly[`${dayKey}-${p}`]) subjects.push({period:p, name:weekly[`${dayKey}-${p}`].name}); } }
        } else { subjects = dailySchedule.subjects; }
        
        if(subjects.length === 0) { con.innerHTML = '<div class="col-12 text-center py-5">수업 없음</div>'; document.getElementById('unprocessed-count').textContent = '0교시'; } 
        else {
            const atts = await AttendanceRepo.getByDate(todayStr);
            let html='', totalClass=0, processedClass=0;
            subjects.forEach(s => {
                totalClass++; const isDone = atts.some(a => a.period === s.period); if(isDone) processedClass++;
                const badge = isDone ? '<span class="badge bg-success position-absolute top-0 end-0 m-2">완료</span>' : '';
                const color = stringToColor(s.name);
                html += `<div class="col-md-2 col-4" onclick="openAttendanceModalForDate('${todayStr}', ${s.period}, '${s.name}')"><div class="card h-100 shadow-sm border-0 text-center p-3 position-relative cursor-pointer" style="background-color:${color};">${badge}<span class="badge bg-light text-dark mb-2">${s.period}교시</span><h5 class="fw-bold mb-0">${s.name}</h5></div></div>`;
            });
            con.innerHTML = html; document.getElementById('unprocessed-count').textContent = (totalClass - processedClass)+'교시';
        }
    }
    const tasks = await TaskRepo.getAll();
    document.getElementById('today-task-count').textContent = tasks.filter(t => t.status==='todo' && t.dueDate===todayStr).length + '건';
}

function escapeHtml(str){ return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

function addCustomLink() { new bootstrap.Modal(document.getElementById('addLinkModal')).show(); }
async function saveCustomLink() {
    const n = document.getElementById('link-name').value;
    let u = document.getElementById('link-url').value;
    if(!n || !u) return alert('입력 확인');
    if(!u.startsWith('http')) u = 'https://' + u;
    await DBManager.addCustomLink(n, u);
    bootstrap.Modal.getInstance(document.getElementById('addLinkModal')).hide();
    document.getElementById('link-name').value=''; document.getElementById('link-url').value='';
    loadDashboard();
}
async function removeCustomLink(id) { if(confirm('삭제?')) { await DBManager.deleteCustomLink(id); loadDashboard(); } }

async function loadAnnualManage() {
    filterAnnualBySemester(1);
    const subs = await SubjectRepo.getAll();
    const list = await AnnualScheduleRepo.getAll();
    let statsHtml = '<ul class="list-group list-group-horizontal overflow-auto mb-3">';
    subs.forEach(s => {
        let count = 0;
        list.forEach(day => count += day.subjects.filter(sub => sub.name === s.shortName).length);
        const color = count < s.hours ? 'text-danger' : (count > s.hours ? 'text-primary' : 'text-success');
        statsHtml += `<li class="list-group-item small"><span class="fw-bold">${s.shortName}</span> <span class="${color}">${count}/${s.hours}</span></li>`;
    });
    statsHtml += '</ul>';
    document.getElementById('annual-stats').innerHTML = statsHtml;
    const sel = document.getElementById('upload-subject-select');
    sel.innerHTML = subs.map(s => `<option value="${s.shortName}">${s.name}</option>`).join('');
}

async function addSchoolEvent() {
    const s = document.getElementById('eventStartDate').value;
    let e = document.getElementById('eventEndDate').value;
    const t = document.getElementById('eventTitle').value;
    const h = document.getElementById('eventHoliday').checked;
    const isSameDay = document.getElementById('eventSameDay').checked; 

    if(!s || !t) return alert('시작일과 행사명 입력 필수');
    if(isSameDay || !e) e = s; 
    
    await SchoolEventRepo.add(s, e, t, h);
    document.getElementById('eventTitle').value = ''; 
    document.getElementById('eventSameDay').checked = false;
    document.getElementById('eventEndDate').disabled = false;
    loadAnnualManage();
    showToast('일정이 등록되었습니다.');
}

async function addBatchEvents() {
    const txt = document.getElementById('eventBatchText').value;
    if(!txt) return;
    const lines = txt.split('\n');
    const list = [];
    for(let l of lines) {
        const [d, t, h] = l.split(',');
        if(d && t) {
            let sDate = d.trim(), eDate = d.trim();
            if(d.includes('~')) { const parts = d.split('~'); sDate = parts[0].trim(); eDate = parts[1].trim(); }
            list.push({startDate: sDate, endDate: eDate, title: t.trim(), isHoliday: (h||'').trim().toUpperCase() === 'O'});
        }
    }
    await SchoolEventRepo.saveBatch(list);
    showToast(`${list.length}건 등록 완료`);
    loadAnnualManage();
}

function normalizeDateValue(v) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number' && isFinite(v)) {
        const utc_days = Math.floor(v - 25569);
        const utc_value = utc_days * 86400;
        const date_info = new Date(utc_value * 1000);
        const y = date_info.getFullYear();
        const m = String(date_info.getMonth() + 1).padStart(2, '0');
        const d = String(date_info.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    let s = String(v).trim();
    if (!s) return '';
    s = s.replace(/\./g, '-').replace(/\//g, '-');
    s = s.replace(/\s+/g, '');
    const m2 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m2) {
        const y=m2[1], mo=String(Number(m2[2])).padStart(2,'0'), da=String(Number(m2[3])).padStart(2,'0');
        return `${y}-${mo}-${da}`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return s; 
}

function parseHolidayFlag(v) {
    const s = String(v ?? '').trim().toUpperCase();
    return s === 'O' || s === 'Y' || s === 'TRUE' || s === '1' || s === '휴업';
}

async function uploadSchoolEventsFromExcel() {
    const input = document.getElementById('school-event-excel-file');
    const file = input?.files?.[0];
    if (!file) return alert('엑셀 파일을 선택하세요.');

    document.body.style.cursor = 'wait'; 
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const wb = XLSX.read(data, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
            if (!rows || rows.length < 2) throw new Error('엑셀 내용이 비어있습니다.');

            const header = (rows[0] || []).map(x => String(x ?? '').trim().replace(/\s+/g,''));
            const idxDate = header.findIndex(h => ['날짜','시작일','일자','일정일'].includes(h));
            const idxTitle = header.findIndex(h => ['행사명','행사','내용','일정'].includes(h));
            const idxHoliday = header.findIndex(h => ['휴업','휴업여부','휴업일','휴업(O)'].includes(h));

            if (idxDate < 0 || idxTitle < 0) {
                throw new Error('헤더를 찾지 못했습니다. 1행을 [날짜, 행사명, 휴업(선택)] 형태로 맞춰주세요.');
            }

            let count = 0;
            for (let i=1; i<rows.length; i++) {
                const r = rows[i] || [];
                const dateCell = r[idxDate];
                const titleCell = r[idxTitle];
                const holCell = idxHoliday >= 0 ? r[idxHoliday] : '';
                const title = String(titleCell ?? '').trim();
                if (!dateCell || !title) continue;
                const dateStrRaw = normalizeDateValue(dateCell);
                if (!dateStrRaw) continue;
                let startDate = dateStrRaw;
                let endDate = dateStrRaw;
                if (typeof dateStrRaw === 'string' && dateStrRaw.includes('~')) {
                    const [a,b] = dateStrRaw.split('~').map(x => normalizeDateValue(x));
                    if (a) startDate = a;
                    if (b) endDate = b || a;
                }
                await SchoolEventRepo.add(startDate, endDate, title, parseHolidayFlag(holCell));
                count++;
            }
            showToast(`${count}건 업로드 완료`);
            input.value = '';
            loadAnnualManage(); 
        } catch (err) {
            console.error(err);
            alert('엑셀 업로드 실패: ' + err.message);
        } finally {
            document.body.style.cursor = 'default';
        }
    };
    reader.readAsArrayBuffer(file);
}

async function generateAnnualSchedule() {
    if(!confirm('기존 연간 시간표를 덮어씁니다.\n(휴업일은 자동으로 수업이 삭제됩니다)')) return;
    try {
        const settings = await SettingsRepo.get();
        if(!settings.term1Start || !settings.term1End) return alert('학기 기간 설정 필요');
        const basic = await TimetableRepo.getWeekly();
        if(!basic) return alert('기초 시간표 없음');
        
        const events = await SchoolEventRepo.getAll();
        const isHoliday = (dStr) => events.some(e => e.isHoliday && dStr >= e.startDate && dStr <= e.endDate);

        const getDates = (s, e) => { let dates = [], cur = new Date(s), end = new Date(e); while(cur <= end) { dates.push(new Date(cur)); cur.setDate(cur.getDate()+1); } return dates; };
        const term2Dates = (settings.term2Start && settings.term2End) ? getDates(settings.term2Start, settings.term2End) : [];
        const allDates = [...getDates(settings.term1Start, settings.term1End), ...term2Dates];
        
        let totalCreated = 0;
        for (let d of allDates) {
            const dateStr = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
            if(isHoliday(dateStr)) {
                await AnnualScheduleRepo.delete(dateStr); 
                continue; 
            }
            const dayIdx = d.getDay();
            if(dayIdx === 0 || dayIdx === 6) continue;
            const dayKey = ['sun','mon','tue','wed','thu','fri','sat'][dayIdx];
            let dailySubs = [];
            for(let p=1; p<=6; p++) {
                const basicSub = basic[`${dayKey}-${p}`];
                if(basicSub) { dailySubs.push({period: p, name: basicSub.name, unit: '', objective: '', content: '', crossTags: [], crossNote: ''}); }
            }
            if(dailySubs.length > 0) { await AnnualScheduleRepo.save(dateStr, dailySubs); totalCreated++; }
        }
        showToast(`${totalCreated}일 생성 완료`);
        loadAnnualManage();
    } catch(e) { alert('오류: ' + e.message); }
}

function downloadSubjectTemplate() {
    const wb = XLSX.utils.book_new();
    const ws_data = [
        ["날짜", "차시", "지도 단원", "학습목표", "지도내용(학습주제)"],
        ["2026-03-02", 1, "1.우리학교", "학교를 알아요", "학교 탐방하기"],
        ["2026-03-03", 2, "1.우리학교", "친구와 인사해요", "친구 얼굴 그리기"]
    ];
    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    XLSX.utils.book_append_sheet(wb, ws, "서식");
    XLSX.writeFile(wb, "지도계획_작성서식.xlsx");
}

async function uploadSubjectPlan() {
    const file = document.getElementById('subject-plan-file').files[0];
    const subName = document.getElementById('upload-subject-select').value;
    if(!file) return alert('파일을 선택하세요');

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(firstSheet, {header: 1, raw: false, dateNF: 'yyyy-mm-dd'});
            if(!rows || rows.length < 2) return alert('엑셀 내용이 비어있습니다');

            let count = 0;
            for(let i=1; i<rows.length; i++) {
                const cols = rows[i] || [];
                const dateStr = String(cols[0] || '').trim();
                const periodStr = String(cols[1] || '').trim();
                const unit = String(cols[2] || '').trim();
                const objective = String(cols[3] || '').trim();
                let content = String(cols[4] || '').trim();
                
                if(!dateStr || !periodStr) continue;
                const period = parseInt(periodStr, 10);
                if(isNaN(period)) continue;
                if(!content) content = unit || objective;

                const day = await AnnualScheduleRepo.get(dateStr);
                if(!day || !day.subjects) continue;

                const idx = day.subjects.findIndex(s => s.period === period && s.name === subName);
                if(idx >= 0) {
                    const t = day.subjects[idx];
                    t.unit = unit;
                    t.objective = objective;
                    t.content = content;
                    if(!Array.isArray(t.crossTags)) t.crossTags = [];
                    if(typeof t.crossNote !== 'string') t.crossNote = '';
                    day.subjects[idx] = t;
                    await AnnualScheduleRepo.save(dateStr, day.subjects);
                    count++;
                }
            }
            showToast(`${count}건이 반영되었습니다.`);
            loadAnnualManage();
        } catch (err) {
            console.error(err);
            alert('엑셀 파일 읽기 실패: ' + err.message);
        }
    };
    reader.readAsArrayBuffer(file);
}

async function filterAnnualBySemester(term) {
    const settings = await SettingsRepo.get();
    const start = term === 1 ? settings.term1Start : settings.term2Start;
    const end = term === 1 ? settings.term1End : settings.term2End;
    if(!start || !end) return document.getElementById('annual-list-body').innerHTML = '<tr><td colspan="2" class="text-center p-3">학기 기간 미설정</td></tr>';
    
    const list = await AnnualScheduleRepo.getAll();
    const filtered = list.filter(d => d.date >= start && d.date <= end).sort((a,b)=>a.date.localeCompare(b.date));
    const events = await SchoolEventRepo.getAll();

    const tbody = document.getElementById('annual-list-body');
    tbody.innerHTML = '';
    const days = ['일','월','화','수','목','금','토'];

    filtered.forEach(d => {
        const dayName = days[new Date(d.date).getDay()];
        const dayEvt = events.find(e => d.date >= e.startDate && d.date <= e.endDate);
        const evtHtml = dayEvt ? `<div class="small fw-bold ${dayEvt.isHoliday?'text-danger':'text-primary'}"><i class="fas fa-flag me-1"></i>${dayEvt.title}</div>` : '';
        
        let subjectsHtml = '<div class="d-flex flex-wrap gap-2">';
        d.subjects.forEach(s => {
            const color = stringToColor(s.name);
            subjectsHtml += `
            <div class="border rounded p-1 px-2 cursor-pointer shadow-sm" style="min-width:100px; background-color: #fff;" 
                 oncontextmenu="handleContextMenu(event, '${d.date}', ${s.period});"
                 onclick="openContentEdit('${d.date}', ${s.period})">
                <span class="badge text-dark me-1" style="background-color:${color}">${s.period}교시 ${s.name}</span>
                <div class="small text-muted text-truncate" style="max-width:150px;">${(s.unit||s.objective||s.content) ? s.content : '<span class="text-black-50">내용 입력</span>'}</div>
            </div>`;
        });
        subjectsHtml += '</div>';
        tbody.innerHTML += `<tr><td class="text-center align-middle bg-light"><div class="fw-bold">${d.date}</div><div class="text-muted small">(${dayName})</div>${evtHtml}</td><td class="align-middle">${subjectsHtml}</td></tr>`;
    });
    if(filtered.length === 0) tbody.innerHTML = '<tr><td colspan="2" class="text-center p-5">데이터 없음</td></tr>';
}

function handleContextMenu(e, date, period) {
    e.preventDefault(); e.stopPropagation();
    ctxTarget = { date, period };
    const menu = document.getElementById('context-menu');
    menu.style.display = 'block';
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';
}

async function deleteSubjectFromAnnual(date, period) {
    const day = await AnnualScheduleRepo.get(date);
    if(day) {
        day.subjects = day.subjects.filter(s => s.period !== period);
        if(day.subjects.length === 0) await AnnualScheduleRepo.delete(date);
        else await AnnualScheduleRepo.save(date, day.subjects);
        loadAnnualManage();
    }
}

async function openContentEdit(date, period) {
    currentEditDate = date; currentEditPeriod = period;
    const day = await AnnualScheduleRepo.get(date);
    const sub = day.subjects.find(s => s.period === period);
    const allSubs = await SubjectRepo.getAll();
    const sel = document.getElementById('edit-content-subject');
    sel.innerHTML = allSubs.map(s => `<option value="${s.shortName}" ${s.shortName===sub.name?'selected':''}>${s.name}</option>`).join('');

    document.getElementById('edit-unit').value = sub.unit || '';
    document.getElementById('edit-objective').value = sub.objective || '';
    document.getElementById('edit-content-text').value = sub.content || '';

    const tags = Array.isArray(sub.crossTags) ? sub.crossTags : [];
    const setChk = (id, label) => { const el = document.getElementById(id); if(el) el.checked = tags.includes(label); };
    setChk('cross-safe','안전'); setChk('cross-info','정보'); setChk('cross-play','놀이'); setChk('cross-etc','기타');
    const noteEl = document.getElementById('cross-note');
    if(noteEl) noteEl.value = sub.crossNote || '';
    document.getElementById('edit-content-title').textContent = `${date} ${period}교시 수정`;
    new bootstrap.Modal(document.getElementById('editContentModal')).show();
}

async function saveContentEdit() {
    const newName = document.getElementById('edit-content-subject').value;
    const unit = document.getElementById('edit-unit').value;
    const objective = document.getElementById('edit-objective').value;
    const newContent = document.getElementById('edit-content-text').value;
    const tags = [];
    const pushIf = (id,label)=>{ const el=document.getElementById(id); if(el && el.checked) tags.push(label); };
    pushIf('cross-safe','안전'); pushIf('cross-info','정보'); pushIf('cross-play','놀이'); pushIf('cross-etc','기타');
    const crossNote = document.getElementById('cross-note') ? document.getElementById('cross-note').value : '';

    const day = await AnnualScheduleRepo.get(currentEditDate);
    const idx = day.subjects.findIndex(s => s.period === currentEditPeriod);
    if(idx >= 0) {
        const t = day.subjects[idx];
        t.name = newName; t.unit = unit; t.objective = objective; t.content = newContent; t.crossTags = tags; t.crossNote = crossNote;
        day.subjects[idx] = t;
        await AnnualScheduleRepo.save(currentEditDate, day.subjects);
        bootstrap.Modal.getInstance(document.getElementById('editContentModal')).hide();
        loadAnnualManage();
    }
}

async function printSubjectPlan() {
    const subs = await SubjectRepo.getAll();
    const annual = await AnnualScheduleRepo.getAll();
    annual.sort((a,b)=>a.date.localeCompare(b.date));

    let html = `<div class="p-4"><h3>과목별 지도 계획</h3>` + `<div class="text-muted small">출력 형식: 날짜 · 차시 · 지도단원 · 학습목표 · 지도내용 · 범교과</div><hr>`;

    for (const s of subs) {
        const rows = [];
        for (const d of annual) {
            const subjects = Array.isArray(d.subjects) ? d.subjects : [];
            for (const t of subjects) {
                if (t.name !== s.shortName) continue;
                const tags = Array.isArray(t.crossTags) ? t.crossTags : [];
                const note = (t.crossNote || '').trim();
                let cross = tags.length ? `[${tags.join(',')}]` : '';
                if (note) cross = (cross ? cross + ' ' : '') + note;
                rows.push({ date: d.date, period: (t.period ?? ''), unit: t.unit || '', objective: t.objective || '', content: t.content || '', cross });
            }
        }
        rows.sort((a,b) => a.date.localeCompare(b.date) || (Number(a.period||99) - Number(b.period||99)));
        html += `<h4 class="mt-4 fw-bold">■ ${s.name}</h4>` + `<table class="table table-bordered table-sm align-middle">` + `<thead class="table-light"><tr>` + `<th style="width:110px">날짜</th>` + `<th style="width:70px" class="text-center">차시</th>` + `<th style="width:180px">지도단원</th>` + `<th style="width:220px">학습목표</th>` + `<th>지도내용</th>` + `<th style="width:140px">범교과</th>` + `</tr></thead><tbody>`;
        if (rows.length === 0) { html += `<tr><td colspan="6" class="text-center text-muted py-3">계획 없음</td></tr>`; } 
        else { for (const r of rows) { html += `<tr>` + `<td class="text-center">${r.date}</td>` + `<td class="text-center">${r.period}</td>` + `<td>${r.unit}</td>` + `<td>${r.objective}</td>` + `<td>${r.content}</td>` + `<td class="small">${r.cross}</td>` + `</tr>`; } }
        html += `</tbody></table>`;
    }
    html += `</div>`;
    document.getElementById('print-preview-area').innerHTML = html;
    new bootstrap.Modal(document.getElementById('printPreviewModal')).show();
}

function loadCurriculumMain() { loadSubjects(); loadTimetable(); }
async function loadSubjects() {
    const list = await SubjectRepo.getAll();
    document.getElementById('subject-count').textContent = list.length + '개';
    document.getElementById('subject-list-body').innerHTML = list.length
        ? list.map(s => `<tr><td>${s.name}</td><td>${s.shortName}</td><td>${s.hours}</td><td><button class="btn btn-sm btn-outline-primary me-1" onclick="openEditSubject('${s.subjectId}')">수정</button><button class="btn btn-sm btn-outline-danger" onclick="deleteSubject('${s.subjectId}')">삭제</button></td></tr>`).join('')
        : '<tr><td colspan="4" class="text-center">없음</td></tr>';
}

async function openEditSubject(id) {
    const list = await SubjectRepo.getAll();
    const s = list.find(x => x.subjectId === id);
    if (!s) return;
    editingSubId = id;
    document.getElementById('editSubName').value = s.name || '';
    document.getElementById('editSubShort').value = s.shortName || '';
    document.getElementById('editSubHours').value = s.hours ?? 0;
    new bootstrap.Modal(document.getElementById('editSubjectModal')).show();
}

async function addSubject() { const n=document.getElementById('subName').value; if(!n) return alert('과목명 입력'); await SubjectRepo.add(n, document.getElementById('subShortName').value, Number(document.getElementById('subHours').value)||0); document.getElementById('subName').value=''; loadSubjects(); }
async function deleteSubject(id) { if(confirm('삭제?')) { await SubjectRepo.delete(id); loadSubjects(); } }
async function addDefaultSubjects() {
    if(!confirm('기존 과목이 초기화되고 기본 과목으로 설정됩니다.')) return;
    const subs = await SubjectRepo.getAll();
    for(const s of subs) await SubjectRepo.delete(s.subjectId);
    const ds = [ {n:'국어',s:'국',h:0}, {n:'수학',s:'수',h:0}, {n:'사회',s:'사',h:0}, {n:'과학',s:'과',h:0}, {n:'영어',s:'영',h:0}, {n:'도덕',s:'도',h:0}, {n:'음악',s:'음',h:0}, {n:'미술',s:'미',h:0}, {n:'체육',s:'체',h:0}, {n:'실과',s:'실',h:0}, {n:'창의적체험활동',s:'창체',h:0}, {n:'학교자율시간',s:'자율',h:0}, {n:'바른생활',s:'바생',h:0}, {n:'슬기로운생활',s:'슬생',h:0}, {n:'즐거운생활',s:'즐생',h:0} ]; 
    for(const d of ds) await SubjectRepo.add(d.n, d.s, d.h); 
    loadSubjects();
}
async function updateSubject() { if(!editingSubId) return; await SubjectRepo.update(editingSubId, document.getElementById('editSubName').value, document.getElementById('editSubShort').value, document.getElementById('editSubHours').value); bootstrap.Modal.getInstance(document.getElementById('editSubjectModal')).hide(); loadSubjects(); }

async function loadTimetable() {
    const subs = await SubjectRepo.getAll();
    document.getElementById('draggable-subjects').innerHTML = subs.map(s => `<div class="draggable-item btn text-white text-start w-100 mb-2" style="background-color:${stringToColor(s.name)}" draggable="true" data-id="${s.subjectId}" data-name="${s.shortName}"><span class="badge bg-dark bg-opacity-25 me-2">${s.shortName}</span>${s.name}</div>`).join('');
    document.querySelectorAll('.draggable-item').forEach(el => el.addEventListener('dragstart', (e)=>{e.dataTransfer.setData("sid",e.target.dataset.id);e.dataTransfer.setData("sname",e.target.dataset.name);}));
    const grid = document.getElementById('timetable-grid');
    if(!grid.innerHTML.trim()) { for(let p=1; p<=6; p++) { let row = `<tr><td class="table-light fw-bold">${p}교시</td>`; DAYS.forEach(d => row += `<td id="${d}-${p}" class="droppable" style="height:60px;background:white;cursor:pointer"></td>`); grid.innerHTML += row + '</tr>'; } }
    document.querySelectorAll('.droppable').forEach(el => { el.addEventListener('dragover', (e)=>e.preventDefault()); el.addEventListener('drop', (e)=>{e.preventDefault(); const c=e.target.closest('td'); const id=e.dataTransfer.getData("sid"); const nm=e.dataTransfer.getData("sname"); if(id&&c){c.innerHTML=`<span class="badge fs-6 text-white" style="background-color:${stringToColor(nm)}">${nm}</span>`;c.dataset.sid=id;c.dataset.sname=nm;}}); el.addEventListener('click', function(){if(this.dataset.sid){this.innerHTML='';delete this.dataset.sid;delete this.dataset.sname;}}); });
    const saved = await TimetableRepo.getWeekly(); if(saved) Object.entries(saved).forEach(([k,v]) => { const c = document.getElementById(k); if(c) { c.innerHTML = `<span class="badge fs-6 text-white" style="background-color:${stringToColor(v.name)}">${v.name}</span>`; c.dataset.sid=v.id; c.dataset.sname=v.name; } });
}
async function saveTimetable() { const d={}; document.querySelectorAll('#timetable-grid td[id]').forEach(c=>{ if(c.dataset.sid) d[c.id]={id:c.dataset.sid, name:c.dataset.sname}; }); await TimetableRepo.saveWeekly(d); showToast('저장 완료'); }
function clearTimetable() { if(confirm('초기화?')) document.querySelectorAll('#timetable-grid td[id]').forEach(c=>{c.innerHTML=''; delete c.dataset.sid;}); }

async function openAttendanceModalForDate(date, period, subName) {
    if(document.getElementById('attendanceDateSelectModal').classList.contains('show')) bootstrap.Modal.getInstance(document.getElementById('attendanceDateSelectModal')).hide();
    attCtx = { date: date, period: period };
    document.getElementById('attendance-info').textContent = `${date} ${period}교시 (${subName})`;
    new bootstrap.Modal(document.getElementById('attendanceModal')).show();
    const stds = await StudentRepo.getAll();
    const recs = await AttendanceRepo.getByDate(date);
    const curs = recs.filter(r => r.period === period);
    const tbody = document.getElementById('attendance-list-body');
    tbody.innerHTML = '';
    stds.forEach(s => {
        const r = curs.find(x => x.studentId === s.studentId);
        const st = r ? r.status : '출석';
        const nm = `att_${s.studentId}`;
        tbody.innerHTML += `<tr><td class="text-start ps-3">${s.number}. ${s.name}</td><td><div class="btn-group w-100" role="group"><input type="radio" class="btn-check" name="${nm}" id="${nm}1" value="출석" ${st==='출석'?'checked':''}><label class="btn btn-outline-success btn-sm" for="${nm}1">출석</label><input type="radio" class="btn-check" name="${nm}" id="${nm}2" value="결석" ${st==='결석'?'checked':''}><label class="btn btn-outline-danger btn-sm" for="${nm}2">결석</label><input type="radio" class="btn-check" name="${nm}" id="${nm}3" value="지각" ${st==='지각'?'checked':''}><label class="btn btn-outline-warning btn-sm" for="${nm}3">지각</label><input type="radio" class="btn-check" name="${nm}" id="${nm}4" value="조퇴" ${st==='조퇴'?'checked':''}><label class="btn btn-outline-primary btn-sm" for="${nm}4">조퇴</label></div></td><td><input type="text" class="form-control form-control-sm" id="note_${s.studentId}" value="${r?r.note:''}" placeholder="사유"></td></tr>`;
    });
}

async function saveAttendance() {
    const stds = await StudentRepo.getAll();
    const currentPeriod = attCtx.period;
    const date = attCtx.date;
    const list = [];
    const dailySched = await AnnualScheduleRepo.get(date);
    const validPeriods = dailySched ? dailySched.subjects.map(s => s.period) : [1,2,3,4,5,6]; 

    for (const s of stds) {
        const rad = document.querySelector(`input[name="att_${s.studentId}"]:checked`);
        if (!rad) continue;
        const status = rad.value;
        const note = document.getElementById(`note_${s.studentId}`).value;
        if (status === '결석') { for(let p=1; p<=6; p++) { if(validPeriods.includes(p)) list.push({ attendanceId: `${date}_${p}_${s.studentId}`, date: date, period: p, studentId: s.studentId, status: '결석', note: note }); } } 
        else if (status === '조퇴') { for(let p=currentPeriod; p<=6; p++) { if(validPeriods.includes(p)) list.push({ attendanceId: `${date}_${p}_${s.studentId}`, date: date, period: p, studentId: s.studentId, status: '조퇴', note: note }); } } 
        else if (status === '지각') { for(let p=1; p<currentPeriod; p++) { if(validPeriods.includes(p)) list.push({ attendanceId: `${date}_${p}_${s.studentId}`, date: date, period: p, studentId: s.studentId, status: '지각', note: '이전 교시 연동' }); } list.push({ attendanceId: `${date}_${currentPeriod}_${s.studentId}`, date: date, period: currentPeriod, studentId: s.studentId, status: '지각', note: note }); } 
        else { list.push({ attendanceId: `${date}_${currentPeriod}_${s.studentId}`, date: date, period: currentPeriod, studentId: s.studentId, status: '출석', note: note }); }
    }
    await AttendanceRepo.saveBatch(list);
    showToast('저장 및 연동 처리 완료');
    bootstrap.Modal.getInstance(document.getElementById('attendanceModal')).hide();
    loadDashboard();
}

async function loadStudents() { const list = await StudentRepo.getAll(); document.getElementById('student-count').textContent = list.length + '명'; document.getElementById('student-list-body').innerHTML = list.map(s => `<tr onclick="openStudentDetail('${s.studentId}')"><td>${s.number}</td><td>${s.name}</td><td>${s.gender}</td><td>${s.guardianPhone||''}</td><td>${s.note||''}</td><td><button class="btn btn-sm btn-outline-danger" onclick="event.stopPropagation(); deleteStudent('${s.studentId}')">삭제</button></td></tr>`).join(''); }
async function addStudent() {
    const no = parseInt(document.getElementById('stdNum').value);
    const nm = document.getElementById('stdName').value;
    if (isNaN(no)) return;
    await StudentRepo.add({ number: no, name: nm, gender: document.querySelector('input[name=stdGender]:checked').value, guardianPhone: document.getElementById('stdPhone').value, note: document.getElementById('stdNote').value });
    loadStudents();
}
async function deleteStudent(id) { if(confirm('삭제?')) { await StudentRepo.delete(id); loadStudents(); } }
async function registerBatchStudents() {
    const txt = document.getElementById('batch-input').value; if (!txt) return;
    const lines = txt.split('\n');
    for (let l of lines) { const [no, nm, g, p] = l.split(/\t/); if (no && nm) { await StudentRepo.add({ number: parseInt(no), name: nm.trim(), gender: (g || '남').trim(), guardianPhone: (p || '').trim() }); } }
    showToast('등록 완료'); bootstrap.Modal.getInstance(document.getElementById('batchStudentModal')).hide(); loadStudents();
}

async function importStudentsFromExcel() {
    const file = document.getElementById('batch-excel-file')?.files?.[0]; if(!file) return alert('엑셀 파일을 선택하세요');
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result); const wb = XLSX.read(data, { type: 'array' }); const ws = wb.Sheets[wb.SheetNames[0]]; const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }); if(!rows || rows.length < 2) return alert('엑셀 내용이 비어있습니다');
            const header = rows[0].map(x => String(x||'').trim());
            const idx = (names) => { for(const n of names){ const i = header.findIndex(h => h === n); if(i >= 0) return i; } return -1; };
            const iNo = idx(['번호','No','학번']), iName = idx(['이름','성명','Name']), iGender = idx(['성별','성']), iPhone = idx(['전화번호','보호자연락처','연락처','휴대폰']), iNote = idx(['비고','메모','특이사항']);
            if(iNo < 0 || iName < 0) return alert('헤더에 “번호, 이름”이 필요합니다');
            let count=0; for(let r=1; r<rows.length; r++){ const row = rows[r]; if(!row || row.length===0) continue; const noStr = String(row[iNo]||'').trim(), nm = String(row[iName]||'').trim(); if(!noStr || !nm) continue; const no = parseInt(noStr, 10); if(Number.isNaN(no)) continue; const gender = iGender>=0 ? String(row[iGender]||'').trim() : '', phone = iPhone>=0 ? String(row[iPhone]||'').trim() : '', note = iNote>=0 ? String(row[iNote]||'').trim() : ''; await StudentRepo.add({ number: no, name: nm, gender: (gender||'남'), guardianPhone: phone, note: note }); count++; }
            showToast(count + '명 등록 완료'); document.getElementById('batch-excel-file').value = ''; loadStudents();
        } catch(err){ console.error(err); alert('엑셀 읽기 실패: ' + err.message); }
    };
    reader.readAsArrayBuffer(file);
}

async function openStudentDetail(sid) { curSid = sid; const stds = await StudentRepo.getAll(); const s = stds.find(x => x.studentId === sid); if(s) { document.getElementById('detail-name').textContent = s.name; document.getElementById('detail-number').textContent = `${s.number}번`; } loadCounseling(); loadStudentAttendanceHistory(); new bootstrap.Modal(document.getElementById('studentDetailModal')).show(); }
async function loadCounseling() { const logs = await CounselingRepo.getByStudentId(curSid); document.getElementById('counsel-list').innerHTML = logs.map(l => `<div class="list-group-item d-flex justify-content-between"><div><span class="badge bg-secondary me-2">${l.type}</span><small>${l.date}</small><br>${l.content}</div><button class="btn btn-sm text-danger" onclick="deleteCounseling('${l.logId}')">x</button></div>`).join('') || '<div class="text-center text-muted">기록 없음</div>'; }
async function addCounseling() { const c = document.getElementById('counsel-content').value; if(!c) return; await CounselingRepo.add(curSid, document.getElementById('counsel-date').value || DBManager.getTodayStr(), document.getElementById('counsel-type').value, c); document.getElementById('counsel-content').value = ''; loadCounseling(); }
async function deleteCounseling(id) { if(confirm('삭제?')) { await CounselingRepo.delete(id); loadCounseling(); } }
async function loadIncidents() { if(isLocked) return; const savedPw = await SettingsRepo.getPassword(); const inputPw = prompt("보안을 위해 비밀번호를 입력하세요"); if(inputPw !== savedPw) { alert("비밀번호 불일치"); return document.querySelector('[data-target="dashboard"]').click(); } const list = await IncidentRepo.getAll(), stds = await StudentRepo.getAll(); document.getElementById('incident-list-body').innerHTML = list.map(i => { const s = stds.find(x => x.studentId === i.studentId); const measures = i.measures ? i.measures.join(', ') : '-'; return `<tr><td>${i.date}</td><td>${s?s.name:'미상'}</td><td>${i.content}</td><td>${measures}</td><td><button class="btn btn-sm btn-outline-danger" onclick="deleteIncident('${i.incidentId}')">삭제</button></td></tr>`; }).join(''); document.getElementById('incident-student').innerHTML = stds.map(s => `<option value="${s.studentId}">${s.number}.${s.name}</option>`).join(''); }
async function addIncident() { const sid = document.getElementById('incident-student').value, d = document.getElementById('incident-date').value, c = document.getElementById('incident-content').value, m = []; if(document.getElementById('inc-m1').checked) m.push('상담'); if(document.getElementById('inc-m2').checked) m.push('조언'); if(document.getElementById('inc-m3').checked) m.push('지도'); if(document.getElementById('inc-m4').checked) m.push('훈육'); if(document.getElementById('inc-m5') && document.getElementById('inc-m5').checked) m.push('훈계'); if(!sid || !d) return alert('입력 확인'); await IncidentRepo.add(sid, d, c, m); document.getElementById('incident-content').value = ''; showToast('저장되었습니다.'); location.reload(); }
async function deleteIncident(id) { if(confirm('삭제?')) { await IncidentRepo.delete(id); location.reload(); } }
async function loadExperiential() { const list = await ExperientialRepo.getAll(); const tbody = document.getElementById('exp-list-body'); const sel = document.getElementById('exp-student'); if(!sel.options.length) { const s = await StudentRepo.getAll(); sel.innerHTML = s.map(x => `<option value="${x.studentId}" data-name="${x.name}">${x.name}</option>`).join(''); } tbody.innerHTML = list.map(e => `<tr><td>${e.studentName}</td><td>${e.startDate}~${e.endDate}</td><td>${e.type}</td><td><input type="checkbox" ${e.docs&&e.docs.app?'checked':''} onclick="updateExpDoc('${e.expId}','app',this.checked)">신청서 <input type="checkbox" ${e.docs&&e.docs.report?'checked':''} onclick="updateExpDoc('${e.expId}','report',this.checked)">보고서</td><td><span class="badge ${e.status==='approved'?'bg-success':'bg-warning'}">${e.status==='approved'?'승인':'신청'}</span></td><td><button class="btn btn-sm btn-outline-primary me-1" onclick="openExpEdit('${e.expId}')">수정</button><button class="btn btn-sm btn-outline-danger" onclick="deleteExp('${e.expId}')">삭제</button></td></tr>`).join(''); }
async function addExperiential() {
    const sel = document.getElementById('exp-student');
    await ExperientialRepo.add({ studentId: sel.value, studentName: sel.options[sel.selectedIndex].dataset.name, type: document.getElementById('exp-type').value, startDate: document.getElementById('exp-start').value, endDate: document.getElementById('exp-end').value, reason: document.getElementById('exp-reason')?.value || '' });
    if (document.getElementById('exp-reason')) document.getElementById('exp-reason').value = ''; loadExperiential();
}
async function updateExpDoc(id, type, val) { const list = await ExperientialRepo.getAll(), item = list.find(x => x.expId === id); if(item) { if(!item.docs) item.docs = {app:false, report:false}; item.docs[type] = val; await ExperientialRepo.updateDocs(id, item.docs); } }
async function deleteExp(id) { if(confirm('삭제?')) { await ExperientialRepo.delete(id); loadExperiential(); } }

async function openExpEdit(expId) {
    editingExpId = expId; const list = await ExperientialRepo.getAll(), item = list.find(x => x.expId === expId); if(!item) return;
    document.getElementById('exp-edit-student').value = item.studentName || ''; document.getElementById('exp-edit-type').value = item.type || ''; document.getElementById('exp-edit-start').value = item.startDate || ''; document.getElementById('exp-edit-end').value = item.endDate || ''; document.getElementById('exp-edit-reason').value = item.reason || ''; document.getElementById('exp-edit-status').value = item.status || 'requested';
    new bootstrap.Modal(document.getElementById('editExpModal')).show();
}

async function saveExpEdit() { if(!editingExpId) return; const patch = { type: document.getElementById('exp-edit-type').value, startDate: document.getElementById('exp-edit-start').value, endDate: document.getElementById('exp-edit-end').value, reason: document.getElementById('exp-edit-reason').value, status: document.getElementById('exp-edit-status').value }; await ExperientialRepo.update(editingExpId, patch); editingExpId = null; bootstrap.Modal.getInstance(document.getElementById('editExpModal')).hide(); loadExperiential(); }
function openAddTaskFromModal() { const d = document.getElementById('action-date').textContent; document.getElementById('taskDueDate').value = d; document.querySelector('[data-target="tasks"]').click(); bootstrap.Modal.getInstance(document.getElementById('fullSchedulerModal')).hide(); bootstrap.Modal.getInstance(document.getElementById('dateActionModal')).hide(); }

async function loadEvaluation() { const plans = await EvaluationRepo.getPlans(); const div = document.getElementById('eval-plan-list'); div.innerHTML = plans.length ? '' : '<div class="text-center py-3 text-muted">등록된 평가 계획이 없습니다.</div>'; const subs = await SubjectRepo.getAll(); document.getElementById('eval-subject-select').innerHTML = subs.map(s => `<option value="${s.subjectId}" data-name="${s.name}">${s.name}</option>`).join(''); plans.forEach(p => div.innerHTML += `<button class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" onclick="openGrading('${p.planId}', '${p.title}')"><div><span class="fw-bold text-primary">[${p.subjectName}]</span> ${p.title}</div><span class="btn btn-sm btn-outline-danger" onclick="event.stopPropagation(); deleteEvalPlan('${p.planId}')">삭제</span></button>`); }

async function addEvalPlan() {
    const sel = document.getElementById('eval-subject-select'); if(sel.selectedIndex < 0) return alert('과목이 선택되지 않았습니다.');
    const data = { subjectId: sel.value, subjectName: sel.options[sel.selectedIndex].dataset.name, title: document.getElementById('eval-title').value, date: document.getElementById('eval-date').value || DBManager.getTodayStr(), domain: document.getElementById('eval-domain').value, element: document.getElementById('eval-element').value, standard: document.getElementById('eval-standard').value, method: document.getElementById('eval-method').value };
    if(!data.title) return alert('평가명을 입력하세요'); await EvaluationRepo.addPlan(data); bootstrap.Modal.getInstance(document.getElementById('addEvalModal')).hide();
    ['eval-title','eval-domain','eval-element','eval-standard','eval-method'].forEach(id => document.getElementById(id).value = ''); loadEvaluation();
}

async function deleteEvalPlan(id) { if(confirm('삭제?')) { await EvaluationRepo.deletePlan(id); loadEvaluation(); } }
async function openGrading(pid, title) { curEval = pid; document.getElementById('grading-title').textContent = title; document.getElementById('save-grades-btn').disabled = false; document.getElementById('export-grades-btn').disabled = false; const stds = await StudentRepo.getAll(), scores = await EvaluationRepo.getScoresByPlanId(pid); document.getElementById('grading-table-body').innerHTML = stds.map(s => { const sc = scores.find(x => x.studentId === s.studentId) || {}; return `<tr><td>${s.number}. ${s.name}</td><td><select id="sv_${s.studentId}" class="form-select form-select-sm text-center"><option value="" ${sc.score===''?'selected':''}>-</option><option value="상" ${sc.score==='상'?'selected':''}>상</option><option value="중" ${sc.score==='중'?'selected':''}>중</option><option value="하" ${sc.score==='하'?'selected':''}>하</option></select></td><td><input type="text" id="sn_${s.studentId}" class="form-control form-control-sm" value="${sc.note||''}" placeholder="관찰 내용"></td></tr>`; }).join(''); }
async function saveGrades() { const stds = await StudentRepo.getAll(), list = stds.map(s => ({ scoreId: `${curEval}_${s.studentId}`, planId: curEval, studentId: s.studentId, score: document.getElementById(`sv_${s.studentId}`).value, note: document.getElementById(`sn_${s.studentId}`).value })); await EvaluationRepo.saveScores(list); showToast('저장 완료'); }
async function downloadEvalCsv() { const title = document.getElementById('grading-title').textContent, stds = await StudentRepo.getAll(), scores = await EvaluationRepo.getScoresByPlanId(curEval); let csv = "\uFEFF번호,이름,평가,관찰내용\n"; stds.forEach(s => { const sc = scores.find(x => x.studentId === s.studentId) || {}; csv += `${s.number},${s.name},${sc.score||''},${(sc.note||'').replace(/,/g, ' ').replace(/\n/g, ' ')}\n`; }); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download = title+'.csv'; a.click(); }
async function loadTasks() { const list = await TaskRepo.getAll(); document.getElementById('task-list-body').innerHTML = list.length ? list.map(t => `<tr class="${t.status==='done'?'table-light text-muted':''}"><td><input type="checkbox" class="form-check-input" ${t.status==='done'?'checked':''} onclick="toggleTask('${t.taskId}', this.checked)"></td><td class="${t.status==='done'?'text-decoration-line-through':''}">${t.title}</td><td>${t.dueDate||'-'}</td><td><span class="badge bg-secondary">${t.category}</span></td><td><button class="btn btn-sm btn-outline-danger" onclick="deleteTask('${t.taskId}')">삭제</button></td></tr>`).join('') : '<tr><td colspan="5" class="text-center py-3">할 일이 없습니다.</td></tr>'; }
async function addTask() { const t = document.getElementById('taskTitle').value; if(!t) return alert('내용 입력'); await TaskRepo.add(t, document.getElementById('taskDueDate').value, document.getElementById('taskCategory').value); document.getElementById('taskTitle').value = ''; loadTasks(); }
async function toggleTask(id, chk) { await TaskRepo.updateStatus(id, chk?'done':'todo'); loadTasks(); }
async function deleteTask(id) { if(confirm('삭제?')) { await TaskRepo.delete(id); loadTasks(); } }
async function exportData() {
    const d = await DBManager.exportAll(), fileName = `아이log_백업_${DBManager.getTodayStr()}.json`, jsonStr = JSON.stringify(d, null, 2);
    try {
        if (window.showSaveFilePicker) { const handle = await window.showSaveFilePicker({ suggestedName: fileName, types: [{ description: '아이_log 백업 파일 (.json)', accept: { 'application/json': ['.json'] } }] }); const writable = await handle.createWritable(); await writable.write(jsonStr); await writable.close(); showToast('백업 완료 (data 폴더 확인)'); } 
        else { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([jsonStr], {type:'application/json'})); a.download = fileName; a.click(); showToast('다운로드 폴더에 저장됨'); }
    } catch (err) { if (err.name !== 'AbortError') alert('실패: ' + err.message); }
}
async function importData() { const f = document.getElementById('importFile').files[0]; if(!f) return alert('파일 선택'); const r = new FileReader(); r.onload = async (e) => { if(confirm('복구?')) { await DBManager.importAll(JSON.parse(e.target.result)); showToast('완료'); location.reload(); } }; r.readAsText(f); }
async function resetSystem() { if(confirm('초기화?')) { await DBManager.clearAll(); showToast('완료'); location.reload(); } }
async function loadStats() {
    const stds = await StudentRepo.getAll(); document.getElementById('stats-student-list').innerHTML = stds.map(s => `<button class="list-group-item list-group-item-action" onclick="showStatDetail('${s.studentId}', '${s.name}')">${s.number}. ${s.name}</button>`).join('');
    const atts = await AttendanceRepo.getAll(), absentKey = new Set(); atts.forEach(a => { if(a.status === '결석') absentKey.add(`${a.studentId}_${a.date}`); }); document.getElementById('total-absent').textContent = absentKey.size + '일';
    document.getElementById('class-stats-view').style.display = 'block'; document.getElementById('individual-report-view').style.display = 'none';
}
async function showStatDetail(sid, name) { document.getElementById('class-stats-view').style.display = 'none'; document.getElementById('individual-report-view').style.display = 'block'; document.getElementById('report-title').textContent = name + ' 종합 기록'; const stats = await AttendanceRepo.getStudentStats(sid); document.getElementById('report-attendance').innerHTML = `출석 ${stats.present||0} / 결석 ${stats.absent||0} / 지각 ${stats.late||0} / 조퇴 ${stats.early||0}`; const plans = await EvaluationRepo.getPlans(), myScores = await EvaluationRepo.getScoresByStudentId(sid); let evalHtml = ''; for(const p of plans) { const s = myScores.find(x => x.planId === p.planId); if(s && (s.score || s.note)) evalHtml += `<div class="mb-2 border-bottom pb-1"><strong>[${p.subjectName}] ${p.title}</strong>: <span class="badge bg-light text-dark border">${s.score||'-'}</span> ${s.note||''}</div>`; } document.getElementById('report-evaluation').innerHTML = evalHtml || '기록 없음'; const logs = await CounselingRepo.getByStudentId(sid); document.getElementById('report-counseling').innerHTML = logs.map(l => `<div class="mb-1"><span class="text-muted small">[${l.date}]</span> ${l.content}</div>`).join('') || '기록 없음'; }
function markAllPresent() { document.querySelectorAll('input[value="출석"]').forEach(r => r.checked = true); }
function openAttendanceFromModal() { const date = document.getElementById('action-date').textContent; bootstrap.Modal.getInstance(document.getElementById('dateActionModal')).hide(); AnnualScheduleRepo.get(date).then(schedule => { const listDiv = document.getElementById('att-class-list'); document.getElementById('att-select-title').textContent = `${date} 출결 관리`; if(!schedule || !schedule.subjects.length) { listDiv.innerHTML = '<div class="text-center p-3">수업 정보가 없습니다.</div>'; } else { listDiv.innerHTML = schedule.subjects.map(s => `<button class="list-group-item list-group-item-action" onclick="openAttendanceModalForDate('${date}', ${s.period}, '${s.name}')"><span class="badge bg-secondary me-2">${s.period}교시</span> ${s.name}</button>`).join(''); } new bootstrap.Modal(document.getElementById('attendanceDateSelectModal')).show(); }); }
async function loadStudentAttendanceHistory() {
    if (!curSid) return; const stats = await AttendanceRepo.getStudentStats(curSid); if (document.getElementById('stat-absent')) document.getElementById('stat-absent').textContent = String(stats.absent || 0);
    const tbody = document.getElementById('std-att-history'); tbody.innerHTML = stats.result.length ? stats.result.sort((a, b) => b.date.localeCompare(a.date)).map(r => `<tr><td>${r.date}</td><td>${r.period}교시</td><td><span class="badge ${r.status === '결석' ? 'bg-danger' : (r.status === '출석' ? 'bg-success' : 'bg-warning')}">${r.status}</span></td><td>${r.note || ''}</td><td><button class="btn btn-sm btn-outline-danger" onclick="deleteAttendance('${r.attendanceId}')">삭제</button></td></tr>`).join('') : '<tr><td colspan="5" class="text-center">기록 없음</td></tr>';
}
async function deleteAttendance(aid) { if(confirm('삭제?')) { await DBManager.delete('attendance', aid); loadStudentAttendanceHistory(); } }
function openSchedulerModal() { new bootstrap.Modal(document.getElementById('fullSchedulerModal')).show(); setTimeout(loadScheduler, 200); }
async function loadScheduler() {
    const el = document.getElementById('full-calendar-el'); if(calendarInstance) calendarInstance.destroy();
    const tasks = await TaskRepo.getAll(); let events = tasks.filter(t => t.dueDate).map(t => ({ id: t.taskId, title: t.title, start: t.dueDate, color: t.status==='done'?'#198754':'#dc3545', extendedProps: {type: 'task'} }));
    const schoolEvents = await SchoolEventRepo.getAll(); schoolEvents.forEach(e => { let endD = e.endDate; if(e.endDate) { const nextDay = new Date(e.endDate); nextDay.setDate(nextDay.getDate() + 1); endD = nextDay.toISOString().split('T')[0]; } events.push({title: e.title, start: e.startDate, end: endD, color: e.isHoliday?'#dc3545':'#ffc107', display: 'block', extendedProps: {type: 'event'}}); });
    const annual = await AnnualScheduleRepo.getAll(); annual.forEach(a => { const summary = a.subjects.map(s=>s.name).join(','); events.push({title: summary, start: a.date, color: '#e7f5ff', textColor: '#000', display: 'background', extendedProps: {type: 'class', subjects: a.subjects}}); });
    calendarInstance = new FullCalendar.Calendar(el, { initialView: 'dayGridMonth', locale: 'ko', events: events, height: '100%', headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,listMonth' }, dateClick: function(info) { document.getElementById('action-date').textContent = info.dateStr; const daySchedule = annual.find(a => a.date === info.dateStr), subList = daySchedule ? daySchedule.subjects : []; document.getElementById('action-class-list').innerHTML = subList.length ? subList.map(s => `<button class="btn btn-sm btn-outline-primary m-1" onclick="linkEvalToSubject('${s.name}', '${info.dateStr}')">${s.name} 평가추가</button>`).join('') : '수업 없음'; new bootstrap.Modal(document.getElementById('dateActionModal')).show(); } }); calendarInstance.render();
}
function linkEvalToSubject(subName, date) { document.getElementById('eval-title').value = `${date} ${subName} 평가`; document.getElementById('eval-date').value = date; document.querySelector('[data-target="evaluation"]').click(); bootstrap.Modal.getInstance(document.getElementById('fullSchedulerModal')).hide(); bootstrap.Modal.getInstance(document.getElementById('dateActionModal')).hide(); setTimeout(() => { const sel = document.getElementById('eval-subject-select'); for(let i=0; i<sel.options.length; i++) { if(sel.options[i].dataset.name === subName) { sel.selectedIndex = i; break; } } }, 500); }
async function loadSettingsToForm() { try { const s = await SettingsRepo.get(); ['schoolName','schoolYear','grade','classNo','teacherName','term1Start','term1End','term2Start','term2End'].forEach(id => { if(document.getElementById(id)) document.getElementById(id).value = s[id] || ''; }); } catch(e) {} }
async function saveSettings() { try { const d = {}; ['schoolName','schoolYear','grade','classNo','teacherName','term1Start','term1End','term2Start','term2End'].forEach(id => d[id] = document.getElementById(id).value); await SettingsRepo.save(d); showToast('저장되었습니다.'); } catch(e) { alert('오류: ' + e.message); } }

async function generateTotalReport() {
    if(!confirm('데이터 양에 따라 시간이 걸릴 수 있습니다.\n생성하시겠습니까?')) return;
    document.body.style.cursor = 'wait'; showToast('종합 리포트를 생성 중입니다...', 'info');
    try {
        const settings = await SettingsRepo.get(), students = await StudentRepo.getAll(), timetable = await TimetableRepo.getWeekly(), subjects = await SubjectRepo.getAll(), annual = await AnnualScheduleRepo.getAll(), evalPlans = await EvaluationRepo.getPlans(), evalScores = await DBManager.getAll('eval_scores'), attendance = await AttendanceRepo.getAll(), counseling = await DBManager.getAll('counseling'), experiential = await ExperientialRepo.getAll();
        let html = `<html><head><title>종합 학급경영록</title><style>body { font-family: 'Malgun Gothic', sans-serif; padding: 20px; } h1, h2, h3 { text-align: center; } .section { margin-bottom: 50px; page-break-inside: avoid; } .page-break { page-break-before: always; } table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 12px; } th, td { border: 1px solid #333; padding: 6px; text-align: center; } th { background-color: #f0f0f0; font-weight: bold; } .text-left { text-align: left; } .header-box { border: 2px solid #333; padding: 20px; text-align: center; margin-bottom: 30px; }</style></head><body><div class="header-box"><h1>${settings.schoolYear || '2026'}학년도 학급 경영록</h1><h2>${settings.schoolName || 'OO초등학교'}</h2><h3>${settings.grade || ''}학년 ${settings.classNo || ''}반 (담임: ${settings.teacherName || ''})</h3><p>출력일: ${new Date().toLocaleDateString()}</p></div>`;
        html += `<div class="section"><h3>1. 학생 명렬표</h3><table><thead><tr><th>번호</th><th>이름</th><th>성별</th><th>전화번호</th><th>비고</th></tr></thead><tbody>`; students.forEach(s => html += `<tr><td>${s.number}</td><td>${s.name}</td><td>${s.gender}</td><td>${s.guardianPhone||''}</td><td>${s.note||''}</td></tr>`); html += `</tbody></table></div>`;
        html += `<div class="section"><h3>2. 기초 시간표</h3><table><thead><tr><th>교시</th><th>월</th><th>화</th><th>수</th><th>목</th><th>금</th></tr></thead><tbody>`; if(timetable) { for(let p=1; p<=6; p++) { html += `<tr><td>${p}</td>`; ['mon','tue','wed','thu','fri'].forEach(d => { const sub = timetable[`${d}-${p}`]; html += `<td>${sub ? sub.name : ''}</td>`; }); html += `</tr>`; } } html += `</tbody></table></div>`;
        const semStats = {}; subjects.forEach(s => semStats[s.shortName] = { name: s.name, target: s.hours, t1: 0, t2: 0 });
        annual.forEach(day => { const isTerm1 = day.date >= settings.term1Start && day.date <= settings.term1End, isTerm2 = day.date >= settings.term2Start && day.date <= settings.term2End; day.subjects.forEach(sub => { if (semStats[sub.name]) { if (isTerm1) semStats[sub.name].t1++; else if (isTerm2) semStats[sub.name].t2++; } }); });
        html += `<div class="section"><h3>3. 과목별 이수 시간 현황</h3><table><thead><tr><th>과목</th><th>기준 시수</th><th>1학기</th><th>2학기</th><th>계</th><th>증감</th></tr></thead><tbody>`;
        subjects.forEach(s => { const st = semStats[s.shortName]; if(!st) return; const total = st.t1 + st.t2, diff = total - st.target; html += `<tr><td>${s.name}</td><td>${s.hours}</td><td>${st.t1}</td><td>${st.t2}</td><td>${total}</td><td style="color:${diff<0?'red':(diff>0?'blue':'black')}">${diff>0?'+'+diff:diff}</td></tr>`; }); html += `</tbody></table></div>`;
        html += `<div class="page-break"></div><div class="section"><h3>4. 과목별 연간 지도 계획</h3>`; annual.sort((a,b)=>a.date.localeCompare(b.date)); subjects.forEach(sub => { html += `<h4>[${sub.name}]</h4><table><thead><tr><th width="100">날짜</th><th>차시</th><th>지도 내용</th></tr></thead><tbody>`; let count = 0; annual.forEach(d => { const targets = d.subjects.filter(s => s.name === sub.shortName); targets.forEach(t => { count++; html += `<tr><td>${d.date}</td><td>${count}</td><td class="text-left">${t.content||'-'}</td></tr>`; }); }); if(count === 0) html += `<tr><td colspan="3">계획 없음</td></tr>`; html += `</tbody></table>`; }); html += `</div>`;
        html += `<div class="page-break"></div><div class="section"><h3>5. 학생 평가 기록</h3>`; evalPlans.forEach(plan => { html += `<div style="margin-top:20px; border:1px solid #ccc; padding:10px;"><h4>[${plan.subjectName}] ${plan.title}</h4><ul style="list-style:none; padding:0; font-size:12px;"><li><strong>시기:</strong> ${plan.date}</li><li><strong>영역:</strong> ${plan.domain || '-'} / <strong>평가요소:</strong> ${plan.element || '-'}</li><li><strong>성취기준:</strong> ${plan.standard || '-'}</li><li><strong>평가방법:</strong> ${plan.method || '-'}</li></ul></div><table><thead><tr><th width="50">번호</th><th width="80">이름</th><th width="80">평가 결과</th><th>관찰 내용</th></tr></thead><tbody>`; students.forEach(s => { const sc = evalScores.find(x => x.planId === plan.planId && x.studentId === s.studentId) || {}; if(sc.score || sc.note) { html += `<tr><td>${s.number}</td><td>${s.name}</td><td>${sc.score||''}</td><td class="text-left">${sc.note||''}</td></tr>`; } }); html += `</tbody></table>`; }); html += `</div>`;
        html += `<div class="page-break"></div><div class="section"><h3>6. 학생 출결 상황</h3><table><thead><tr><th>날짜</th><th>교시</th><th>학생</th><th>구분</th><th>사유</th></tr></thead><tbody>`; attendance.sort((a,b)=>a.date.localeCompare(b.date)); attendance.forEach(a => { if(a.status !== '출석') { const s = students.find(x => x.studentId === a.studentId); html += `<tr><td>${a.date}</td><td>${a.period}</td><td>${s?s.name:'-'}</td><td>${a.status}</td><td class="text-left">${a.note||''}</td></tr>`; } }); html += `</tbody></table></div>`;
        html += `<div class="section"><h3>7. 학생 상담 일지</h3><table><thead><tr><th>날짜</th><th>학생</th><th>유형</th><th>상담 내용</th></tr></thead><tbody>`; counseling.sort((a,b)=>a.date.localeCompare(b.date)); counseling.forEach(c => { const s = students.find(x => x.studentId === c.studentId); html += `<tr><td>${c.date}</td><td>${s?s.name:'-'}</td><td>${c.type}</td><td class="text-left">${c.content}</td></tr>`; }); html += `</tbody></table></div>`;
        html += `<div class="section"><h3>8. 교외체험학습 현황</h3><table><thead><tr><th>학생</th><th>기간</th><th>종류</th><th>사유</th><th>제출서류</th></tr></thead><tbody>`; experiential.forEach(e => { const docs = []; if(e.docs && e.docs.app) docs.push('신청서'); if(e.docs && e.docs.report) docs.push('보고서'); html += `<tr><td>${e.studentName}</td><td>${e.startDate}~${e.endDate}</td><td>${e.type}</td><td class="text-left">${e.reason||''}</td><td>${docs.join(', ')}</td></tr>`; }); html += `</tbody></table></div>`;
        html += `</body></html>`;
        const win = window.open('', '_blank'); if(win) { win.document.write(html); win.document.close(); setTimeout(() => { win.focus(); win.print(); }, 500); } else { alert('팝업 차단을 해제해주세요.'); }
    } catch(e) { console.error(e); alert('리포트 생성 중 오류 발생: ' + e.message); } finally { document.body.style.cursor = 'default'; }
}