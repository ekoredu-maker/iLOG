// app.js - v10.0 (Python 연동 / 출판사별 지도계획 / 서식 출력 개선)
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
let incidentsUnlocked = false;

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
let PERIODS = 6;
let EVAL_SCALE = ['상', '중', '하'];
const ATT_STATUSES = [['출석', 'success'], ['결석', 'danger'], ['지각', 'warning'], ['조퇴', 'primary'], ['결과', 'secondary']];
const ATT_REASONS = ['질병', '미인정', '기타', '인정'];

// ------------------------------------------------------------------ 공통 도구
function escapeHtml(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const h = escapeHtml;

function showToast(msg, type = 'primary') {
    const el = document.getElementById('liveToast');
    const body = document.getElementById('toast-msg');
    if (el && body && window.bootstrap) {
        el.className = `toast align-items-center text-white bg-${type} border-0`;
        body.textContent = msg;
        bootstrap.Toast.getOrCreateInstance(el, { delay: type === 'danger' ? 6000 : 3000 }).show();
    } else {
        alert(msg);
    }
}
function showError(e) {
    console.error(e);
    const msg = (e && e.message) ? e.message : String(e);
    if (msg.includes('잠겨 있습니다')) { showLoginOverlay(); return; }
    showToast('오류: ' + msg, 'danger');
}
// 버튼 연결 + 오류 처리 (오류가 나도 화면이 멈추지 않도록)
function on(id, handler, evt = 'click') {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(evt, async (e) => {
        if (el.tagName === 'A') e.preventDefault();
        try { await handler(e); } catch (err) { showError(err); }
    });
}
function modal(id) { return bootstrap.Modal.getOrCreateInstance(document.getElementById(id)); }
function hideModal(id) { const m = bootstrap.Modal.getInstance(document.getElementById(id)); if (m) m.hide(); }
function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }
function setBusy(busy) { document.body.style.cursor = busy ? 'wait' : ''; }

window.addEventListener('unhandledrejection', (e) => showError(e.reason || e));

// 자리를 비운 채 30분이 지나면 자동 잠금 (학교 공용 PC 대비)
const IDLE_LOCK_MS = 30 * 60 * 1000;
let lastActivity = Date.now();
['mousemove', 'keydown', 'mousedown', 'wheel', 'touchstart'].forEach(ev => window.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true }));
setInterval(() => {
    if (!isLocked && Date.now() - lastActivity > IDLE_LOCK_MS) {
        document.querySelectorAll('.modal.show').forEach(m => { const i = bootstrap.Modal.getInstance(m); if (i) i.hide(); });
        lockSystem().catch(() => {});
        showToast('30분 동안 사용하지 않아 자동으로 잠갔습니다.', 'secondary');
    }
}, 30 * 1000);

// ---------------------------------------------------------------- 초기화
document.addEventListener('DOMContentLoaded', () => {
    on('login-btn', tryLogin);
    on('forgot-pw-link', () => modal('recoverModal').show());
    on('recover-btn', doRecover);
    on('first-pw-btn', doFirstPasswordChange);
    on('rc-copy-btn', copyRecoveryCode);
    on('rc-ack', (e) => { document.getElementById('rc-close-btn').disabled = !e.target.checked; }, 'change');
    on('new-rc-btn', issueNewRecoveryCode);
    on('neis-att-btn', () => deliverFile('neis_attendance_xlsx'));
    on('neis-att-btn2', () => deliverFile('neis_attendance_xlsx'));
    on('choose-backup-dir-btn', chooseBackupDir);
    // 서식 출력
    on('wk-date', () => loadWeekly(val('wk-date')), 'change');
    on('wk-prev', () => loadWeekly(shiftDate(wkStart, -7)));
    on('wk-next', () => loadWeekly(shiftDate(wkStart, 7)));
    on('wk-save', async () => { await saveWeekly(); showToast('저장했습니다.', 'success'); });
    on('wk-hwpx', async () => { await saveWeekly(); await deliverForm({ kind: 'weekly', weekStart: wkStart }); });
    on('wk-print', async () => { await saveWeekly(); await openReport('form', { kind: 'weekly', weekStart: wkStart }); });
    on('tab-form-card', loadCards);
    on('card-term', loadCards, 'change');
    on('card-save', async () => { await saveCards(); showToast('의견을 저장했습니다.', 'success'); });
    on('card-hwpx', async () => { await saveCards(); await deliverForm({ kind: 'report_card', term: Number(val('card-term')), parentReply: document.getElementById('card-reply').checked }); });
    on('card-print', async () => { await saveCards(); await openReport('form', { kind: 'report_card', term: Number(val('card-term')), parentReply: document.getElementById('card-reply').checked }); });
    on('tab-form-absence', loadAbsenceTab);
    on('abs-student', loadAbsenceDates, 'change');
    on('abs-hwpx', () => absenceForm('hwpx'));
    on('abs-print', () => absenceForm('print'));
    on('tab-form-exp', () => loadExpFormTab());
    on('exp-form-edit', () => val('exp-form-sel') ? openExpEdit(val('exp-form-sel')) : showToast('체험학습을 먼저 등록하세요.', 'warning'));
    document.querySelectorAll('[data-expform]').forEach(b => b.addEventListener('click', () => expForm(b.dataset.expform, b.dataset.fmt).catch(showError)));
    on('tab-form-tpl', loadTemplates);
    on('exp-edit-status', () => { document.getElementById('exp-deny-wrap').style.display = val('exp-edit-status') === 'denied' ? '' : 'none'; }, 'change');
    on('clear-backup-dir-btn', async () => { await api.clear_backup_dir(); await loadDataManage(); });
    document.getElementById('login-password').addEventListener('keyup', (e) => { if (e.key === 'Enter') tryLogin().catch(showError); });
    on('lock-btn', lockSystem);

    document.addEventListener('click', () => { document.getElementById('context-menu').style.display = 'none'; });
    on('ctx-edit', () => { if (ctxTarget) return openContentEdit(ctxTarget.date, ctxTarget.period); });
    on('ctx-delete', async () => {
        if (ctxTarget && confirm(`${ctxTarget.date} ${ctxTarget.period}교시 수업을 삭제하시겠습니까?`)) {
            await deleteSubjectFromAnnual(ctxTarget.date, ctxTarget.period);
        }
    });
    on('ctx-eval', async () => {
        if (!ctxTarget) return;
        const day = await AnnualScheduleRepo.get(ctxTarget.date);
        const sub = day && (day.subjects || []).find(s => s.period === ctxTarget.period);
        await goToEvalWithSubject(sub ? sub.name : '', ctxTarget.date);
    });

    document.getElementById('menu-list').addEventListener('click', (e) => {
        const link = e.target.closest('.nav-link');
        if (!link) return;
        e.preventDefault();
        if (isLocked) return;
        navigate(link.getAttribute('data-target'), link);
    });

    on('save-settings-btn', saveSettings);
    on('change-pwd-btn', changePassword);
    on('add-subject-btn', addSubject);
    on('update-subject-btn', updateSubject);
    on('add-default-subject-btn', () => addDefaultSubjects(false));
    on('clear-timetable-btn', clearTimetable);
    on('save-timetable-btn', saveTimetable);
    on('tab-timetable', loadTimetable);
    on('add-event-btn', addSchoolEvent);
    on('batch-event-btn', addBatchEvents);
    on('school-event-excel-btn', uploadSchoolEventsFromExcel);
    on('school-event-template-btn', () => deliverFile('template_school_events'));

    on('generate-annual-btn', generateAnnualSchedule);
    on('subject-template-btn', () => deliverFile('template_subject_plan'));
    on('subject-plan-upload-btn', uploadSubjectPlan);
    on('print-subject-plan-btn', () => openReport('subject_plan'));
    on('excel-subject-plan-btn', () => deliverFile('subject_plan_xlsx'));
    on('open-curriculum-btn', openCurriculumLibrary);

    on('add-student-btn', addStudent);
    on('batch-register-btn', registerBatchStudents);
    on('batch-excel-btn', importStudentsFromExcel);
    on('student-template-btn', () => deliverFile('template_students'));
    on('add-exp-btn', addExperiential);
    on('save-exp-edit-btn', saveExpEdit);
    on('add-counsel-btn', addCounseling);
    on('add-incident-btn', addIncident);
    on('add-eval-plan-btn', addEvalPlan);
    on('save-grades-btn', saveGrades);
    on('export-grades-btn', () => curEval && deliverFile('eval_xlsx', { planId: curEval }));
    on('add-task-btn', addTask);
    on('backup-btn', exportData);
    on('restore-btn', importData);
    on('reset-btn', resetSystem);
    on('open-backup-folder-btn', () => Bridge.isDesktop() ? api.open_folder('backups') : showToast('자동 백업 폴더: ' + document.getElementById('data-dir').textContent));
    on('save-attendance-btn', saveAttendance);
    on('mark-all-present-btn', markAllPresent);
    on('print-all-report-btn', () => openReport('class_book', { incidents: document.getElementById('report-include-incidents').checked }));
    on('excel-all-report-btn', () => deliverFile('class_book_xlsx', { incidents: document.getElementById('report-include-incidents').checked }));
    on('print-student-report-btn', () => curStatSid ? openReport('student_report', { studentId: curStatSid }) : showToast('학생을 먼저 선택하세요.', 'warning'));
    on('pw-modal-ok', confirmPasswordModal);
    document.getElementById('pw-modal-input').addEventListener('keyup', (e) => { if (e.key === 'Enter') confirmPasswordModal().catch(showError); });

    // 지도계획 라이브러리
    on('cur-grade', () => loadCurriculumLibrary(), 'change');
    on('cur-import-btn', importCurriculumPack);
    on('cur-template-btn', () => deliverFile('template_curriculum_pack'));

    on('eventSameDay', (e) => {
        const endInput = document.getElementById('eventEndDate');
        if (e.target.checked) { endInput.value = val('eventStartDate'); endInput.disabled = true; } else { endInput.disabled = false; }
    }, 'change');
    on('eventStartDate', () => {
        if (document.getElementById('eventSameDay').checked) document.getElementById('eventEndDate').value = val('eventStartDate');
    }, 'change');

    initApp().catch(showError);
});

function navigate(targetId, link) {
    link = link || document.querySelector(`#menu-list .nav-link[data-target="${targetId}"]`);
    document.querySelector('.sidebar').classList.remove('show');
    if (targetId === 'scheduler-modal-trigger') { openSchedulerModal(); return; }
    document.querySelectorAll('#menu-list .nav-link').forEach(l => l.classList.remove('active'));
    if (link) link.classList.add('active');
    document.querySelectorAll('.page-section').forEach(p => p.classList.remove('active'));
    document.getElementById(targetId).classList.add('active');
    document.getElementById('header-title').textContent = link ? link.textContent.trim() : '';
    const loaders = {
        dashboard: loadDashboard, curriculum: loadCurriculumMain, 'annual-plan': loadAnnualManage, students: loadStudents,
        tasks: loadTasks, experiential: loadExperiential, evaluation: loadEvaluation, stats: loadStats, incidents: loadIncidents,
        'data-manage': loadDataManage, forms: loadFormsPage
    };
    if (loaders[targetId]) return Promise.resolve(loaders[targetId]()).catch(showError);
}

async function initApp() {
    const tick = () => {
        document.getElementById('clock').textContent = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });
    };
    tick(); setInterval(tick, 1000 * 15);
    await DBManager.open();
    const st = await api.status();
    document.getElementById('login-hint').textContent = st.initialized ? '' : '처음 사용: 초기 비밀번호 1234 (로그인 후 바로 변경)';
    document.getElementById('forgot-pw-link').style.display = st.hasRecovery ? '' : 'none';
    showLoginOverlay();
}

// 로그인(잠금 해제) 후 데이터 불러오기
async function onUnlocked(result) {
    isLocked = false;
    incidentsUnlocked = false;
    document.getElementById('login-overlay').style.display = 'none';
    const subs = await SubjectRepo.getAll();
    if (subs.length === 0) await addDefaultSubjects(true);
    await loadSettingsToForm();
    await applySettings();
    await navigate('dashboard');
    if (result && typeof result.backup === 'string' && result.backup.startsWith('자동 백업 실패')) showToast(result.backup, 'warning');
}

async function applySettings() {
    const s = await SettingsRepo.get();
    const p = parseInt(s.periodsPerDay, 10);
    const np = p >= 4 && p <= 8 ? p : 6;
    if (np !== PERIODS) { PERIODS = np; document.getElementById('timetable-grid').innerHTML = ''; }
    EVAL_SCALE = parseScale(s.evalScale);
}
function parseScale(str) {
    const arr = String(str || '').split(/[,·/]/).map(x => x.trim()).filter(Boolean);
    return arr.length >= 2 ? arr : ['상', '중', '하'];
}

// ---------------------------------------------------------------- 로그인
async function tryLogin() {
    const input = document.getElementById('login-password');
    const msg = document.getElementById('login-msg');
    const pw = String(input.value || '').trim();
    let r;
    try {
        r = await api.unlock(pw);
    } catch (e) {
        console.error(e);
        msg.textContent = '데이터 저장소에 연결할 수 없습니다: ' + (e.message || e);
        msg.style.display = 'block';
        return;
    }
    if (!r.ok) { msg.textContent = '비밀번호가 맞지 않습니다.'; msg.style.display = 'block'; return; }
    msg.style.display = 'none';
    input.value = '';
    if (r.status.mustChangePassword) {
        firstPwCurrent = pw;
        document.getElementById('first-pw-new').value = ''; document.getElementById('first-pw-new2').value = '';
        document.getElementById('first-pw-msg').style.display = 'none';
        modal('firstPwModal').show();
        return;
    }
    await onUnlocked(r);
}
function showLoginOverlay() {
    isLocked = true; incidentsUnlocked = false;
    document.getElementById('login-overlay').style.display = 'flex';
    document.getElementById('login-password').value = '';
    setTimeout(() => document.getElementById('login-password').focus(), 50);
}
async function lockSystem() {
    try { await api.lock(); } finally { showLoginOverlay(); }
}

// 첫 로그인: 비밀번호 변경 강제 → 복구 코드 안내
let firstPwCurrent = '';
async function doFirstPasswordChange() {
    const a = val('first-pw-new').trim(), b = val('first-pw-new2').trim();
    const m = document.getElementById('first-pw-msg');
    const fail = (t) => { m.textContent = t; m.style.display = 'block'; };
    if (a.length < 4) return fail('4자리 이상 입력하세요.');
    if (a === '1234') return fail('초기 비밀번호(1234)는 쓸 수 없습니다.');
    if (a !== b) return fail('두 비밀번호가 다릅니다.');
    const r = await api.change_password(firstPwCurrent, a);
    firstPwCurrent = '';
    hideModal('firstPwModal');
    if (r.recoveryCode) await showRecoveryCode(r.recoveryCode);
    await onUnlocked();
}
async function doRecover() {
    const code = val('recover-code').trim(), a = val('recover-new').trim(), b = val('recover-new2').trim();
    const m = document.getElementById('recover-msg');
    const fail = (t) => { m.textContent = t; m.style.display = 'block'; };
    if (!code) return fail('복구 코드를 입력하세요.');
    if (a.length < 4 || a === '1234') return fail('새 비밀번호는 4자리 이상이며 1234가 아니어야 합니다.');
    if (a !== b) return fail('두 비밀번호가 다릅니다.');
    let r;
    try { r = await api.recover(code, a); } catch (e) { return fail(e.message || String(e)); }
    hideModal('recoverModal');
    ['recover-code', 'recover-new', 'recover-new2'].forEach(id => document.getElementById(id).value = '');
    await showRecoveryCode(r.recoveryCode, true);
    await onUnlocked();
}
function showRecoveryCode(code, renewed) {
    document.getElementById('rc-code').textContent = code;
    document.getElementById('rc-renewed').style.display = renewed ? '' : 'none';
    document.getElementById('rc-ack').checked = false;
    document.getElementById('rc-close-btn').disabled = true;
    const el = document.getElementById('recoveryCodeModal');
    return new Promise((resolve) => {
        el.addEventListener('hidden.bs.modal', () => resolve(), { once: true });
        modal('recoveryCodeModal').show();
    });
}
async function copyRecoveryCode() {
    const code = document.getElementById('rc-code').textContent;
    try { await navigator.clipboard.writeText(code); showToast('복사했습니다. 안전한 곳에 붙여넣어 보관하세요.', 'success'); }
    catch (e) { showToast('복사할 수 없습니다. 코드를 직접 적어 두세요.', 'warning'); }
}
async function changePassword() {
    const cur = val('curr-pwd'), newP = val('new-pwd').trim();
    if (newP.length < 4) return showToast('새 비밀번호는 4자리 이상이어야 합니다.', 'warning');
    if (newP !== val('new-pwd2').trim()) return showToast('새 비밀번호 확인이 다릅니다.', 'warning');
    const r = await SettingsRepo.changePassword(cur, newP);
    ['curr-pwd', 'new-pwd', 'new-pwd2'].forEach(id => document.getElementById(id).value = '');
    showToast('비밀번호가 변경되었습니다.', 'success');
    if (r && r.recoveryCode) await showRecoveryCode(r.recoveryCode);
}
async function issueNewRecoveryCode() {
    const cur = val('curr-pwd');
    if (!cur) return showToast('[현재 비밀번호]를 입력한 뒤 눌러 주세요.', 'warning');
    if (!confirm('새 복구 코드를 만들면 예전 복구 코드는 더 이상 쓸 수 없습니다. 진행할까요?')) return;
    const r = await api.new_recovery_code(cur);
    document.getElementById('curr-pwd').value = '';
    await showRecoveryCode(r.recoveryCode, true);
}

// 비밀번호 확인 창 (사안관리 등)
let pwModalResolve = null;
let pwModalVerify = true;
function askSecret(title) { pwModalVerify = false; return askPassword(title, true); }
function askPassword(title, raw) {
    if (!raw) pwModalVerify = true;
    document.getElementById('pw-modal-title').textContent = title || '비밀번호 확인';
    document.getElementById('pw-modal-input').value = '';
    document.getElementById('pw-modal-msg').style.display = 'none';
    const el = document.getElementById('passwordModal');
    return new Promise((resolve) => {
        pwModalResolve = resolve;
        el.addEventListener('hidden.bs.modal', () => { if (pwModalResolve) { pwModalResolve(false); pwModalResolve = null; } }, { once: true });
        modal('passwordModal').show();
        setTimeout(() => document.getElementById('pw-modal-input').focus(), 300);
    });
}
async function confirmPasswordModal() {
    if (!pwModalVerify) {
        const v = val('pw-modal-input').trim();
        if (!v) return;
        const r = pwModalResolve; pwModalResolve = null;
        hideModal('passwordModal');
        if (r) r(v);
        return;
    }
    const ok = await SettingsRepo.verifyPassword(val('pw-modal-input'));
    if (!ok) { const m = document.getElementById('pw-modal-msg'); m.textContent = '비밀번호가 맞지 않습니다.'; m.style.display = 'block'; return; }
    const r = pwModalResolve; pwModalResolve = null;
    hideModal('passwordModal');
    if (r) r(true);
}

function stringToColor(str) { let hash = 0; str = String(str || ''); for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash); return `hsl(${Math.abs(hash % 360)}, 70%, 80%)`; }
function dayName(dateStr) { return ['일', '월', '화', '수', '목', '금', '토'][new Date(dateStr + 'T00:00:00').getDay()]; }

// ---------------------------------------------------------------- 대시보드
async function loadDashboard() {
    const todayStr = DBManager.getTodayStr();
    document.getElementById('today-display').textContent = todayStr;
    const links = await DBManager.getCustomLinks();
    const container = document.getElementById('quick-links-container');
    container.querySelectorAll('.custom-added').forEach(el => el.remove());
    links.forEach(l => {
        const btn = document.createElement('a');
        btn.href = l.url; btn.target = '_blank'; btn.rel = 'noopener';
        btn.className = 'btn btn-light border quick-link custom-added';
        btn.innerHTML = `<i class="fas fa-link me-2 text-secondary"></i>${h(l.name)} <i class="fas fa-times ms-2 text-danger" title="삭제"></i>`;
        btn.querySelector('.fa-times').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); removeCustomLink(l.linkId || l.id).catch(showError); });
        container.insertBefore(btn, container.lastElementChild);
    });

    const dailySchedule = await AnnualScheduleRepo.get(todayStr);
    let subjects = [];
    const events = await SchoolEventRepo.getAll();
    const holiday = events.find(e => e.isHoliday && todayStr >= e.startDate && todayStr <= (e.endDate || e.startDate));
    const con = document.getElementById('today-schedule-container');

    if (holiday) {
        con.innerHTML = `<div class="col-12 text-center py-5"><h4 class="text-danger fw-bold mb-2"><i class="fas fa-umbrella-beach me-2"></i>${h(holiday.title)}</h4><span class="badge bg-secondary">휴업일</span></div>`;
        document.getElementById('unprocessed-count').textContent = '휴업';
    } else {
        if (!dailySchedule || !dailySchedule.subjects) {
            const dayIndex = new Date(todayStr + 'T00:00:00').getDay();
            const dayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][dayIndex];
            const weekly = await TimetableRepo.getWeekly();
            if (weekly && dayIndex !== 0 && dayIndex !== 6) {
                for (let p = 1; p <= PERIODS; p++) { if (weekly[`${dayKey}-${p}`]) subjects.push({ period: p, name: weekly[`${dayKey}-${p}`].name }); }
            }
        } else { subjects = dailySchedule.subjects; }

        if (subjects.length === 0) {
            con.innerHTML = '<div class="col-12 text-center py-5 text-muted">오늘은 수업이 없습니다.</div>';
            document.getElementById('unprocessed-count').textContent = '0교시';
        } else {
            const atts = await AttendanceRepo.getByDate(todayStr);
            let done = 0;
            con.innerHTML = '';
            subjects.forEach(s => {
                const isDone = atts.some(a => a.period === s.period);
                if (isDone) done++;
                const col = document.createElement('div');
                col.className = 'col-md-2 col-4';
                col.innerHTML = `<div class="card h-100 shadow-sm border-0 text-center p-3 position-relative cursor-pointer" style="background-color:${stringToColor(s.name)};">${isDone ? '<span class="badge bg-success position-absolute top-0 end-0 m-2">완료</span>' : ''}<span class="badge bg-light text-dark mb-2">${s.period}교시</span><h5 class="fw-bold mb-0">${h(s.name)}</h5>${s.content ? `<div class="small text-truncate mt-1">${h(s.content)}</div>` : ''}</div>`;
                col.addEventListener('click', () => openAttendanceModalForDate(todayStr, s.period, s.name).catch(showError));
                con.appendChild(col);
            });
            document.getElementById('unprocessed-count').textContent = (subjects.length - done) + '교시';
        }
    }
    const tasks = await TaskRepo.getAll();
    document.getElementById('today-task-count').textContent = tasks.filter(t => t.status === 'todo' && t.dueDate === todayStr).length + '건';
}

function addCustomLink() { modal('addLinkModal').show(); }
async function saveCustomLink() {
    const n = val('link-name').trim();
    let u = val('link-url').trim();
    if (!n || !u) return showToast('이름과 주소를 입력하세요.', 'warning');
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    await DBManager.addCustomLink(n, u);
    hideModal('addLinkModal');
    document.getElementById('link-name').value = ''; document.getElementById('link-url').value = '';
    await loadDashboard();
}
async function removeCustomLink(id) { if (confirm('이 바로가기를 삭제할까요?')) { await DBManager.deleteCustomLink(id); await loadDashboard(); } }

// ------------------------------------------------------------ 연간 활동 관리
let currentTerm = 1;
async function loadAnnualManage() {
    await filterAnnualBySemester(currentTerm);
    const subs = await SubjectRepo.getAll();
    const list = await AnnualScheduleRepo.getAll();
    let statsHtml = '<ul class="list-group list-group-horizontal overflow-auto mb-0">';
    subs.forEach(s => {
        let count = 0;
        list.forEach(day => count += (day.subjects || []).filter(sub => sub.name === s.shortName).length);
        const color = !s.hours ? 'text-muted' : (count < s.hours ? 'text-danger' : (count > s.hours ? 'text-primary' : 'text-success'));
        statsHtml += `<li class="list-group-item small text-nowrap"><span class="fw-bold">${h(s.shortName)}</span> <span class="${color}">${count}/${s.hours || '-'}</span></li>`;
    });
    statsHtml += '</ul>';
    document.getElementById('annual-stats').innerHTML = statsHtml;
    document.getElementById('upload-subject-select').innerHTML = subs.map(s => `<option value="${h(s.shortName)}">${h(s.name)}</option>`).join('');
    await loadEventList();
}

async function loadEventList() {
    const tbody = document.getElementById('event-list-body');
    if (!tbody) return;
    const events = (await SchoolEventRepo.getAll()).sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
    document.getElementById('event-count').textContent = events.length + '건';
    tbody.innerHTML = events.length ? '' : '<tr><td colspan="3" class="text-center text-muted small">등록된 일정 없음</td></tr>';
    events.forEach(e => {
        const tr = document.createElement('tr');
        const period = e.endDate && e.endDate !== e.startDate ? `${e.startDate}~${e.endDate.slice(5)}` : e.startDate;
        tr.innerHTML = `<td class="small text-nowrap">${h(period)}</td><td class="small ${e.isHoliday ? 'text-danger fw-bold' : ''}">${h(e.title)}${e.isHoliday ? ' (휴업)' : ''}</td><td><button class="btn btn-sm btn-link text-danger p-0">삭제</button></td>`;
        tr.querySelector('button').addEventListener('click', async () => {
            try { if (confirm(`'${e.title}' 일정을 삭제할까요?`)) { await SchoolEventRepo.delete(e.eventId); await loadEventList(); } } catch (err) { showError(err); }
        });
        tbody.appendChild(tr);
    });
}

async function addSchoolEvent() {
    const s = val('eventStartDate');
    let e = val('eventEndDate');
    const t = val('eventTitle').trim();
    const hol = document.getElementById('eventHoliday').checked;
    if (!s || !t) return showToast('시작일과 행사명을 입력하세요.', 'warning');
    if (document.getElementById('eventSameDay').checked || !e) e = s;
    if (e < s) return showToast('종료일이 시작일보다 빠릅니다.', 'warning');
    await SchoolEventRepo.add(s, e, t, hol);
    document.getElementById('eventTitle').value = '';
    document.getElementById('eventSameDay').checked = false;
    document.getElementById('eventEndDate').disabled = false;
    await loadAnnualManage();
    showToast('일정이 등록되었습니다.' + (hol ? ' 휴업일은 [연간 시간표 생성]을 다시 해야 시간표에 반영됩니다.' : ''));
}

async function addBatchEvents() {
    const txt = val('eventBatchText').trim();
    if (!txt) return;
    const rows = txt.split('\n').map(l => l.split(',').map(x => x.trim())).filter(r => r[0] && r[1]);
    const r = await api.import_school_events_rows(rows, false);
    document.getElementById('eventBatchText').value = '';
    showToast(`${r.added}건 등록` + (r.duplicates ? `, 중복 ${r.duplicates}건 제외` : '') + (r.badDates.length ? ` / 날짜 오류: ${r.badDates.join(', ')}` : ''), r.badDates.length ? 'warning' : 'success');
    await loadAnnualManage();
}

async function uploadSchoolEventsFromExcel() {
    const input = document.getElementById('school-event-excel-file');
    const file = input?.files?.[0];
    if (!file) return showToast('엑셀 파일을 선택하세요.', 'warning');
    setBusy(true);
    try {
        const r = await api.import_school_events(await readFileAsBase64(file), file.name);
        showToast(`${r.added}건 업로드 완료` + (r.duplicates ? `, 중복 ${r.duplicates}건 제외` : '') + (r.badDates.length ? ` / 날짜를 읽지 못함: ${r.badDates.join(', ')}` : ''), r.badDates.length ? 'warning' : 'success');
        input.value = '';
        await loadAnnualManage();
    } finally { setBusy(false); }
}

async function generateAnnualSchedule() {
    if (!confirm('학기 기간과 주간 기초 시간표로 연간 시간표를 다시 만듭니다.\n\n· 휴업일은 수업이 빠집니다.\n· 같은 날짜·교시·과목에 이미 입력한 지도내용은 그대로 유지됩니다.\n\n진행할까요?')) return;
    setBusy(true);
    try {
        const r = await api.generate_annual(true);
        showToast(`${r.days}일 생성 (휴업 ${r.holidays}일 제외, 기존 지도내용 ${r.keptContent}칸 유지)`, 'success');
        await loadAnnualManage();
    } finally { setBusy(false); }
}

async function uploadSubjectPlan() {
    const file = document.getElementById('subject-plan-file').files[0];
    const subName = val('upload-subject-select');
    if (!file) return showToast('파일을 선택하세요.', 'warning');
    setBusy(true);
    try {
        const r = await api.import_subject_plan(await readFileAsBase64(file), file.name, subName);
        let msg = `${r.applied}건 반영`;
        if (r.missingCount) msg += ` / 시간표에 해당 수업이 없어 ${r.missingCount}건 제외 (예: ${r.missing.slice(0, 3).join(', ')})`;
        if (r.bad.length) msg += ` / 읽지 못한 행: ${r.bad.slice(0, 3).join(', ')}`;
        showToast(msg, r.missingCount || r.bad.length ? 'warning' : 'success');
        document.getElementById('subject-plan-file').value = '';
        await loadAnnualManage();
    } finally { setBusy(false); }
}

async function filterAnnualBySemester(term) {
    currentTerm = term;
    document.querySelectorAll('[data-term-btn]').forEach(b => b.classList.toggle('active', Number(b.dataset.termBtn) === term));
    const settings = await SettingsRepo.get();
    const start = term === 1 ? settings.term1Start : settings.term2Start;
    const end = term === 1 ? settings.term1End : settings.term2End;
    const tbody = document.getElementById('annual-list-body');
    if (!start || !end) { tbody.innerHTML = '<tr><td colspan="2" class="text-center p-3">[기본설정]에서 학기 기간을 먼저 저장해 주세요.</td></tr>'; return; }

    const list = await AnnualScheduleRepo.getAll();
    const filtered = list.filter(d => d.date >= start && d.date <= end).sort((a, b) => a.date.localeCompare(b.date));
    const events = await SchoolEventRepo.getAll();
    tbody.innerHTML = '';
    const frag = document.createDocumentFragment();
    filtered.forEach(d => {
        const dayEvts = events.filter(e => d.date >= e.startDate && d.date <= (e.endDate || e.startDate));
        const evtHtml = dayEvts.map(e => `<div class="small fw-bold ${e.isHoliday ? 'text-danger' : 'text-primary'}"><i class="fas fa-flag me-1"></i>${h(e.title)}</div>`).join('');
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="text-center align-middle bg-light"><div class="fw-bold">${h(d.date)}</div><div class="text-muted small">(${dayName(d.date)})</div>${evtHtml}</td><td class="align-middle"><div class="d-flex flex-wrap gap-2"></div></td>`;
        const wrap = tr.querySelector('.d-flex');
        (d.subjects || []).forEach(s => {
            const text = s.content || s.objective || s.unit;
            const box = document.createElement('div');
            box.className = 'border rounded p-1 px-2 cursor-pointer shadow-sm bg-white';
            box.style.minWidth = '110px';
            box.title = [s.unit, s.objective, s.content].filter(Boolean).join('\n');
            box.innerHTML = `<span class="badge text-dark me-1" style="background-color:${stringToColor(s.name)}">${s.period}교시 ${h(s.name)}${s.lessonSeq ? ` · ${s.lessonSeq}차시` : ''}</span><div class="small text-muted text-truncate" style="max-width:170px;">${text ? h(text) : '<span class="text-black-50">내용 입력</span>'}</div>`;
            box.addEventListener('click', () => openContentEdit(d.date, s.period).catch(showError));
            box.addEventListener('contextmenu', (e) => handleContextMenu(e, d.date, s.period));
            wrap.appendChild(box);
        });
        frag.appendChild(tr);
    });
    tbody.appendChild(frag);
    if (filtered.length === 0) tbody.innerHTML = '<tr><td colspan="2" class="text-center p-5 text-muted">연간 시간표가 없습니다. 왼쪽 [자동 생성]을 눌러 만들어 주세요.</td></tr>';
}

function handleContextMenu(e, date, period) {
    e.preventDefault(); e.stopPropagation();
    ctxTarget = { date, period };
    const menu = document.getElementById('context-menu');
    menu.style.display = 'block';
    const x = Math.min(e.clientX, window.innerWidth - 170), y = Math.min(e.clientY, window.innerHeight - 130);
    menu.style.left = x + 'px'; menu.style.top = y + 'px';
}

async function deleteSubjectFromAnnual(date, period) {
    const day = await AnnualScheduleRepo.get(date);
    if (day) {
        day.subjects = (day.subjects || []).filter(s => s.period !== period);
        if (day.subjects.length === 0) await AnnualScheduleRepo.delete(date);
        else await AnnualScheduleRepo.save(date, day.subjects);
        await loadAnnualManage();
    }
}

async function openContentEdit(date, period) {
    const day = await AnnualScheduleRepo.get(date);
    const sub = day && (day.subjects || []).find(s => s.period === period);
    if (!sub) return showToast('해당 수업을 찾을 수 없습니다.', 'warning');
    currentEditDate = date; currentEditPeriod = period;
    const allSubs = await SubjectRepo.getAll();
    const sel = document.getElementById('edit-content-subject');
    sel.innerHTML = allSubs.map(s => `<option value="${h(s.shortName)}" ${s.shortName === sub.name ? 'selected' : ''}>${h(s.name)}</option>`).join('');
    document.getElementById('edit-unit').value = sub.unit || '';
    document.getElementById('edit-objective').value = sub.objective || '';
    document.getElementById('edit-content-text').value = sub.content || '';
    const tags = Array.isArray(sub.crossTags) ? sub.crossTags : [];
    const setChk = (id, label) => { const el = document.getElementById(id); if (el) el.checked = tags.includes(label); };
    setChk('cross-safe', '안전'); setChk('cross-info', '정보'); setChk('cross-play', '놀이'); setChk('cross-etc', '기타');
    document.getElementById('cross-note').value = sub.crossNote || '';
    document.getElementById('edit-content-title').textContent = `${date}(${dayName(date)}) ${period}교시 수정`;
    modal('editContentModal').show();
}

async function saveContentEdit() {
    const tags = [];
    const pushIf = (id, label) => { const el = document.getElementById(id); if (el && el.checked) tags.push(label); };
    pushIf('cross-safe', '안전'); pushIf('cross-info', '정보'); pushIf('cross-play', '놀이'); pushIf('cross-etc', '기타');
    const day = await AnnualScheduleRepo.get(currentEditDate);
    const idx = day ? day.subjects.findIndex(s => s.period === currentEditPeriod) : -1;
    if (idx < 0) return showToast('수업을 찾을 수 없습니다.', 'warning');
    Object.assign(day.subjects[idx], {
        name: val('edit-content-subject'), unit: val('edit-unit'), objective: val('edit-objective'),
        content: val('edit-content-text'), crossTags: tags, crossNote: val('cross-note')
    });
    await AnnualScheduleRepo.save(currentEditDate, day.subjects);
    hideModal('editContentModal');
    await loadAnnualManage();
}

// ------------------------------------------------------ 출판사별 지도계획 라이브러리
async function openCurriculumLibrary() {
    const st = await SettingsRepo.get();
    const sel = document.getElementById('cur-grade');
    if (st.grade && !sel.dataset.touched) sel.value = String(st.grade);
    sel.dataset.touched = '1';
    modal('curriculumModal').show();
    await loadCurriculumLibrary();
}

async function loadCurriculumLibrary() {
    const grade = Number(val('cur-grade')) || null;
    const [packs, subs, choices] = await Promise.all([api.curriculum_list(grade), SubjectRepo.getAll(), api.curriculum_choices()]);
    const body = document.getElementById('cur-subject-body');
    body.innerHTML = '';
    const bySubject = {};
    packs.forEach(p => (bySubject[p.subject] = bySubject[p.subject] || []).push(p));
    const shown = new Set();
    subs.forEach(s => {
        const list = bySubject[s.name] || bySubject[s.shortName] || [];
        if (!list.length) return;
        shown.add(list[0].subject);
        body.appendChild(curriculumRow(s, list, choices[s.shortName]));
    });
    if (!body.children.length) {
        body.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-4">${grade || ''}학년 지도계획 데이터가 없습니다.<br>출판사 지도계획을 [작성 서식]에 맞춰 엑셀로 만든 뒤 [가져오기] 하세요.</td></tr>`;
    }
    const unmatched = Object.keys(bySubject).filter(n => !shown.has(n));
    document.getElementById('cur-unmatched').innerHTML = unmatched.length
        ? `<i class="fas fa-exclamation-circle me-1"></i>과목 목록에 없는 과목의 데이터: <b>${unmatched.map(h).join(', ')}</b> — [교육과정운영]에서 같은 이름의 과목을 추가하면 연결됩니다.` : '';

    const pl = document.getElementById('cur-pack-body');
    pl.innerHTML = packs.length ? '' : '<tr><td colspan="6" class="text-center text-muted small">없음</td></tr>';
    packs.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${p.grade}</td><td>${h(p.subject)}</td><td>${h(p.publisher)}</td><td class="small">${h(p.curriculum || '')}</td><td>${p.lessonCount}차시${p.term1 || p.term2 ? ` <span class="text-muted small">(1학기 ${p.term1}/2학기 ${p.term2})</span>` : ''}</td><td>${p.builtin ? '<span class="badge bg-secondary">기본 탑재</span>' : '<button class="btn btn-sm btn-outline-danger">삭제</button>'}</td>`;
        const del = tr.querySelector('button');
        if (del) del.addEventListener('click', async () => {
            try { if (confirm(`${p.grade}학년 ${p.subject} (${p.publisher}) 데이터를 삭제할까요?\n이미 시간표에 적용한 내용은 지워지지 않습니다.`)) { await api.curriculum_delete(p.packId); await loadCurriculumLibrary(); } } catch (e) { showError(e); }
        });
        pl.appendChild(tr);
    });
}

function curriculumRow(subject, packs, chosen) {
    const tr = document.createElement('tr');
    const opts = packs.map(p => `<option value="${h(p.packId)}" ${p.packId === chosen ? 'selected' : ''}>${h(p.publisher)}${p.curriculum ? ' · ' + h(p.curriculum) : ''} (${p.lessonCount}차시)</option>`).join('');
    tr.innerHTML = `<td class="fw-bold">${h(subject.name)}</td>
        <td><select class="form-select form-select-sm">${packs.some(p => p.packId === chosen) ? '' : '<option value="">출판사 선택</option>'}${opts}</select></td>
        <td class="small preview text-muted">-</td>
        <td class="text-nowrap"><button class="btn btn-sm btn-primary" disabled>적용</button></td>`;
    const sel = tr.querySelector('select'), btn = tr.querySelector('button'), pv = tr.querySelector('.preview');
    const refresh = async () => {
        if (!sel.value) { btn.disabled = true; pv.textContent = '-'; return; }
        const r = await api.curriculum_preview(sel.value, subject.shortName);
        pv.innerHTML = r.terms.map(t => {
            const warn = t.leftLessons > 0 ? `<span class="text-danger">차시 ${t.leftLessons}개 남음</span>` : (t.emptySlots > 0 ? `<span class="text-primary">빈 칸 ${t.emptySlots}개</span>` : '<span class="text-success">딱 맞음</span>');
            return `<div>${t.term}: 수업 ${t.slots}칸 / 지도계획 ${t.lessons}차시 · ${warn}</div>`;
        }).join('');
        btn.disabled = r.terms.every(t => t.slots === 0);
        if (btn.disabled) pv.innerHTML += '<div class="text-danger">연간 시간표에 이 과목 수업이 없습니다.</div>';
    };
    sel.addEventListener('change', () => refresh().catch(showError));
    btn.addEventListener('click', async () => {
        try {
            const keep = document.getElementById('cur-keep-existing').checked;
            const pub = sel.options[sel.selectedIndex].text;
            if (!confirm(`${subject.name} 과목에 [${pub}] 지도계획을 적용합니다.\n연간 시간표의 ${subject.name} 수업에 날짜·교시 순서대로 차시 내용이 들어갑니다.\n${keep ? '이미 내용을 입력한 칸은 그대로 둡니다.' : '이미 입력한 내용도 덮어씁니다.'}`)) return;
            const r = await api.curriculum_apply(sel.value, subject.shortName, !keep);
            showToast(`${subject.name}: ${r.applied}칸 적용` + (r.skipped ? `, 기존 내용 ${r.skipped}칸 유지` : ''), 'success');
            await refresh();
            if (document.getElementById('annual-plan').classList.contains('active')) await loadAnnualManage();
        } catch (e) { showError(e); }
    });
    if (sel.value) refresh().catch(showError);
    return tr;
}

async function importCurriculumPack() {
    const input = document.getElementById('cur-file');
    const file = input.files[0];
    if (!file) return showToast('엑셀(.xlsx) 또는 JSON 파일을 선택하세요.', 'warning');
    setBusy(true);
    try {
        const r = await api.curriculum_import(await readFileAsBase64(file), file.name);
        showToast(`${r.length}개 지도계획을 가져왔습니다: ` + r.map(p => `${p.grade}학년 ${p.subject}(${p.publisher}) ${p.lessonCount}차시`).join(', '), 'success');
        input.value = '';
        await loadCurriculumLibrary();
    } finally { setBusy(false); }
}

// ---------------------------------------------------------- 교육과정(기초)
async function loadCurriculumMain() { await loadSubjects(); await loadTimetable(); }
async function loadSubjects() {
    const list = await SubjectRepo.getAll();
    document.getElementById('subject-count').textContent = list.length + '개';
    const tbody = document.getElementById('subject-list-body');
    tbody.innerHTML = list.length ? '' : '<tr><td colspan="4" class="text-center">없음</td></tr>';
    list.forEach(s => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${h(s.name)}</td><td>${h(s.shortName)}</td><td>${h(s.hours)}</td><td><button class="btn btn-sm btn-outline-primary me-1">수정</button><button class="btn btn-sm btn-outline-danger">삭제</button></td>`;
        const [eb, db] = tr.querySelectorAll('button');
        eb.addEventListener('click', () => openEditSubject(s.subjectId).catch(showError));
        db.addEventListener('click', () => deleteSubject(s.subjectId).catch(showError));
        tbody.appendChild(tr);
    });
}
async function openEditSubject(id) {
    const s = (await SubjectRepo.getAll()).find(x => x.subjectId === id);
    if (!s) return;
    editingSubId = id;
    document.getElementById('editSubName').value = s.name || '';
    document.getElementById('editSubShort').value = s.shortName || '';
    document.getElementById('editSubHours').value = s.hours ?? 0;
    modal('editSubjectModal').show();
}
async function addSubject() {
    const n = val('subName').trim();
    if (!n) return showToast('과목명을 입력하세요.', 'warning');
    const short = val('subShortName').trim() || n;
    const subs = await SubjectRepo.getAll();
    if (subs.some(s => s.shortName === short)) return showToast(`단축명 '${short}'이(가) 이미 있습니다.`, 'warning');
    await SubjectRepo.add(n, short, Number(val('subHours')) || 0);
    document.getElementById('subName').value = ''; document.getElementById('subShortName').value = '';
    await loadSubjects();
}
async function deleteSubject(id) { if (confirm('과목을 삭제할까요? (이미 만든 연간 시간표의 수업은 남아 있습니다)')) { await SubjectRepo.delete(id); await loadSubjects(); } }
async function addDefaultSubjects(silent) {
    if (!silent && !confirm('기존 과목이 모두 지워지고 기본 과목으로 바뀝니다. 진행할까요?')) return;
    const subs = await SubjectRepo.getAll();
    for (const s of subs) await SubjectRepo.delete(s.subjectId);
    const ds = [['국어', '국'], ['수학', '수'], ['사회', '사'], ['과학', '과'], ['영어', '영'], ['도덕', '도'], ['음악', '음'], ['미술', '미'], ['체육', '체'], ['실과', '실'], ['창의적체험활동', '창체'], ['학교자율시간', '자율'], ['바른생활', '바생'], ['슬기로운생활', '슬생'], ['즐거운생활', '즐생']];
    await DBManager.putMany('subjects', ds.map(([n, s]) => ({ subjectId: uid('sub'), name: n, shortName: s, hours: 0 })));
    if (!silent) await loadSubjects();
}
async function updateSubject() {
    if (!editingSubId) return;
    await SubjectRepo.update(editingSubId, val('editSubName'), val('editSubShort'), val('editSubHours'));
    hideModal('editSubjectModal');
    await loadSubjects();
}

async function loadTimetable() {
    const subs = await SubjectRepo.getAll();
    const pal = document.getElementById('draggable-subjects');
    pal.innerHTML = '';
    subs.forEach(s => {
        const el = document.createElement('div');
        el.className = 'draggable-item btn text-dark text-start w-100 mb-2';
        el.style.backgroundColor = stringToColor(s.name);
        el.draggable = true;
        el.innerHTML = `<span class="badge bg-dark bg-opacity-25 me-2">${h(s.shortName)}</span>${h(s.name)}`;
        el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('sid', s.subjectId); e.dataTransfer.setData('sname', s.shortName); });
        pal.appendChild(el);
    });
    const grid = document.getElementById('timetable-grid');
    if (!grid.innerHTML.trim()) {
        for (let p = 1; p <= PERIODS; p++) {
            let row = `<tr><td class="table-light fw-bold">${p}교시</td>`;
            DAYS.forEach(d => row += `<td id="${d}-${p}" class="droppable" style="height:60px;background:white;cursor:pointer" title="클릭하면 비웁니다"></td>`);
            grid.innerHTML += row + '</tr>';
        }
        grid.querySelectorAll('.droppable').forEach(el => {
            el.addEventListener('dragover', (e) => e.preventDefault());
            el.addEventListener('drop', (e) => { e.preventDefault(); const id = e.dataTransfer.getData('sid'), nm = e.dataTransfer.getData('sname'); if (id) setCell(el, id, nm); });
            el.addEventListener('click', () => { el.innerHTML = ''; delete el.dataset.sid; delete el.dataset.sname; });
        });
    }
    grid.querySelectorAll('td[id]').forEach(c => { c.innerHTML = ''; delete c.dataset.sid; delete c.dataset.sname; });
    const saved = await TimetableRepo.getWeekly();
    if (saved) Object.entries(saved).forEach(([k, v]) => { const c = document.getElementById(k); if (c && v) setCell(c, v.id, v.name); });
}
function setCell(c, id, nm) { c.innerHTML = `<span class="badge fs-6 text-dark" style="background-color:${stringToColor(nm)}">${h(nm)}</span>`; c.dataset.sid = id; c.dataset.sname = nm; }
async function saveTimetable() {
    const d = {};
    document.querySelectorAll('#timetable-grid td[id]').forEach(c => { if (c.dataset.sid) d[c.id] = { id: c.dataset.sid, name: c.dataset.sname }; });
    await TimetableRepo.saveWeekly(d);
    showToast('저장 완료. 연간 시간표에 반영하려면 [연간활동관리 → 자동 생성]을 눌러 주세요.', 'success');
}
function clearTimetable() { if (confirm('화면의 시간표를 비울까요? (저장을 눌러야 반영됩니다)')) document.querySelectorAll('#timetable-grid td[id]').forEach(c => { c.innerHTML = ''; delete c.dataset.sid; delete c.dataset.sname; }); }

// ---------------------------------------------------------------- 출결
async function openAttendanceModalForDate(date, period, subName) {
    hideModal('attendanceDateSelectModal');
    attCtx = { date, period, prev: {} };
    document.getElementById('attendance-info').textContent = `${date}(${dayName(date)}) ${period}교시 (${subName})`;
    const stds = await StudentRepo.getAll();
    const recs = await AttendanceRepo.getByDate(date);
    const curs = recs.filter(r => r.period === period);
    const tbody = document.getElementById('attendance-list-body');
    tbody.innerHTML = stds.length ? '' : '<tr><td colspan="4" class="text-muted py-4">등록된 학생이 없습니다.</td></tr>';
    stds.forEach(s => {
        const r = curs.find(x => x.studentId === s.studentId);
        const st = r ? r.status : '출석';
        const reason = r && r.reason ? r.reason : '질병';
        attCtx.prev[s.studentId] = r ? { status: r.status, reason: r.reason || '' } : null;
        const nm = `att_${s.studentId}`;
        const radios = ATT_STATUSES.map(([v, c], i) =>
            `<input type="radio" class="btn-check" name="${nm}" id="${nm}${i}" value="${v}" ${st === v ? 'checked' : ''}><label class="btn btn-outline-${c} btn-sm" for="${nm}${i}">${v}</label>`).join('');
        const opts = ATT_REASONS.map(x => `<option value="${x}" ${x === reason ? 'selected' : ''}>${x === '인정' ? '출석인정' : x}</option>`).join('');
        const tag = r && r.source ? '<span class="badge bg-info text-dark ms-1">체험학습</span>' : (r && st !== '출석' && !r.reason ? '<span class="badge bg-warning text-dark ms-1" title="예전 기록: 사유를 골라 저장하세요">미분류</span>' : '');
        tbody.insertAdjacentHTML('beforeend', `<tr data-sid="${h(s.studentId)}"><td class="text-start ps-3 text-nowrap">${h(s.number)}. ${h(s.name)}${tag}</td>
            <td><div class="btn-group w-100" role="group">${radios}</div></td>
            <td style="width:110px"><select class="form-select form-select-sm" id="reason_${s.studentId}" ${st === '출석' ? 'disabled' : ''}>${opts}</select></td>
            <td><input type="text" class="form-control form-control-sm" id="note_${s.studentId}" value="${h(r && r.note !== '이전 교시 연동' ? r.note : '')}" placeholder="사유 메모"></td></tr>`);
        tbody.querySelectorAll(`input[name="${nm}"]`).forEach(radio => radio.addEventListener('change', () => {
            document.getElementById(`reason_${s.studentId}`).disabled = radio.value === '출석';
        }));
    });
    modal('attendanceModal').show();
}

async function saveAttendance() {
    const stds = await StudentRepo.getAll();
    const { date, period: cur } = attCtx;
    const dailySched = await AnnualScheduleRepo.get(date);
    const valid = dailySched ? dailySched.subjects.map(s => s.period) : Array.from({ length: PERIODS }, (_, i) => i + 1);
    const dayRecs = await AttendanceRepo.getByDate(date);
    const list = [], removeIds = [];
    const rec = (p, sid, status, reason, note) => {
        const r = { attendanceId: `${date}_${p}_${sid}`, date, period: p, studentId: sid, status, note };
        if (status !== '출석') r.reason = reason;
        return r;
    };
    for (const s of stds) {
        const rad = document.querySelector(`input[name="att_${s.studentId}"]:checked`);
        if (!rad) continue;
        const status = rad.value, note = val(`note_${s.studentId}`), reason = val(`reason_${s.studentId}`) || '질병';
        const prev = attCtx.prev[s.studentId];
        // 이전에 다른 교시로 자동 연동된 기록은 상태가 바뀌면 함께 정리
        if (prev && prev.status !== '출석' && prev.status !== status) {
            dayRecs.filter(r => r.studentId === s.studentId && r.period !== cur && r.status === prev.status).forEach(r => removeIds.push(r.attendanceId));
        }
        if (status === '결석') valid.forEach(p => list.push(rec(p, s.studentId, '결석', reason, note)));
        else if (status === '조퇴') valid.filter(p => p >= cur).forEach(p => list.push(rec(p, s.studentId, '조퇴', reason, note)));
        else if (status === '지각') { valid.filter(p => p < cur).forEach(p => list.push(rec(p, s.studentId, '지각', reason, '이전 교시 연동'))); list.push(rec(cur, s.studentId, '지각', reason, note)); }
        else if (status === '결과') list.push(rec(cur, s.studentId, '결과', reason, note));
        else list.push(rec(cur, s.studentId, '출석', '', note));
    }
    const keep = new Set(list.map(r => r.attendanceId));
    await AttendanceRepo.deleteMany(removeIds.filter(id => !keep.has(id)));
    await AttendanceRepo.saveBatch(list);
    showToast('출결 저장 완료', 'success');
    hideModal('attendanceModal');
    await loadDashboard();
}
function markAllPresent() {
    document.querySelectorAll('#attendance-list-body input[value="출석"]').forEach(r => { r.checked = true; r.dispatchEvent(new Event('change')); });
}

// ---------------------------------------------------------------- 학생
async function loadStudents() {
    const list = await StudentRepo.getAll();
    document.getElementById('student-count').textContent = list.length + '명';
    const tbody = document.getElementById('student-list-body');
    tbody.innerHTML = list.length ? '' : '<tr><td colspan="6" class="text-center text-muted py-4">학생을 등록해 주세요.</td></tr>';
    list.forEach(s => {
        const tr = document.createElement('tr');
        tr.className = 'cursor-pointer';
        tr.innerHTML = `<td>${h(s.number)}</td><td>${h(s.name)}</td><td>${h(s.gender)}</td><td>${h(s.guardianPhone || '')}</td><td>${h(s.note || '')}</td><td><button class="btn btn-sm btn-outline-danger">삭제</button></td>`;
        tr.addEventListener('click', () => openStudentDetail(s.studentId).catch(showError));
        tr.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); deleteStudent(s).catch(showError); });
        tbody.appendChild(tr);
    });
}
async function addStudent() {
    const no = parseInt(val('stdNum'), 10);
    const nm = val('stdName').trim();
    if (isNaN(no) || !nm) return showToast('번호와 이름을 입력하세요.', 'warning');
    const exist = (await StudentRepo.getAll()).find(s => Number(s.number) === no);
    if (exist && !confirm(`${no}번(${exist.name}) 학생이 이미 있습니다. 그래도 추가할까요?`)) return;
    await StudentRepo.add({ number: no, name: nm, gender: document.querySelector('input[name=stdGender]:checked').value, guardianPhone: val('stdPhone'), note: val('stdNote') });
    ['stdNum', 'stdName', 'stdPhone', 'stdNote'].forEach(id => document.getElementById(id).value = '');
    await loadStudents();
}
async function deleteStudent(s) {
    if (confirm(`${s.number}번 ${s.name} 학생을 삭제할까요?\n출결·상담·평가·체험학습·사안 기록도 함께 삭제됩니다.`)) { await StudentRepo.delete(s.studentId); await loadStudents(); }
}
async function registerBatchStudents() {
    const txt = val('batch-input').trim();
    if (!txt) return;
    const rows = txt.split('\n').map(l => l.split('\t'));
    const r = await api.import_students_rows(rows, false);
    showToast(`신규 ${r.added}명, 갱신 ${r.updated}명` + (r.skipped ? `, 건너뜀 ${r.skipped}줄` : ''), 'success');
    document.getElementById('batch-input').value = '';
    hideModal('batchStudentModal');
    await loadStudents();
}
async function importStudentsFromExcel() {
    const input = document.getElementById('batch-excel-file');
    const file = input?.files?.[0];
    if (!file) return showToast('엑셀 파일을 선택하세요.', 'warning');
    const r = await api.import_students(await readFileAsBase64(file), file.name);
    showToast(`신규 ${r.added}명, 갱신 ${r.updated}명` + (r.skipped ? `, 건너뜀 ${r.skipped}줄` : ''), 'success');
    input.value = '';
    hideModal('batchStudentModal');
    await loadStudents();
}

async function openStudentDetail(sid) {
    curSid = sid;
    const s = (await StudentRepo.getAll()).find(x => x.studentId === sid);
    if (s) { document.getElementById('detail-name').textContent = s.name; document.getElementById('detail-number').textContent = `${s.number}번`; }
    document.getElementById('counsel-date').value = DBManager.getTodayStr();
    await loadCounseling();
    await loadStudentAttendanceHistory();
    modal('studentDetailModal').show();
}
async function loadCounseling() {
    const logs = await CounselingRepo.getByStudentId(curSid);
    const box = document.getElementById('counsel-list');
    box.innerHTML = logs.length ? '' : '<div class="text-center text-muted py-3">기록 없음</div>';
    logs.forEach(l => {
        const div = document.createElement('div');
        div.className = 'list-group-item d-flex justify-content-between';
        div.innerHTML = `<div><span class="badge bg-secondary me-2">${h(l.type)}</span><small>${h(l.date)}</small><br><span style="white-space:pre-wrap">${h(l.content)}</span></div><button class="btn btn-sm text-danger">x</button>`;
        div.querySelector('button').addEventListener('click', () => deleteCounseling(l.logId).catch(showError));
        box.appendChild(div);
    });
}
async function addCounseling() {
    const c = val('counsel-content').trim();
    if (!c) return;
    await CounselingRepo.add(curSid, val('counsel-date') || DBManager.getTodayStr(), val('counsel-type'), c);
    document.getElementById('counsel-content').value = '';
    await loadCounseling();
}
async function deleteCounseling(id) { if (confirm('상담 기록을 삭제할까요?')) { await CounselingRepo.delete(id); await loadCounseling(); } }

async function loadStudentAttendanceHistory() {
    if (!curSid) return;
    const stats = await AttendanceRepo.getStudentStats(curSid);
    document.getElementById('stat-absent').textContent = String(stats.absent || 0);
    const tbody = document.getElementById('std-att-history');
    const rows = stats.records.filter(r => r.status !== '출석').sort((a, b) => b.date.localeCompare(a.date) || a.period - b.period);
    tbody.innerHTML = rows.length ? '' : '<tr><td colspan="5" class="text-center">결석·지각·조퇴 기록 없음</td></tr>';
    rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${h(r.date)}</td><td>${r.period}교시</td><td><span class="badge ${r.reason === '인정' ? 'bg-info text-dark' : (r.status === '결석' ? 'bg-danger' : 'bg-warning text-dark')}">${r.reason === '인정' ? '출석인정' : h(r.status) + (r.reason ? '(' + h(r.reason) + ')' : '(미분류)')}</span></td><td>${h(r.note || '')}</td><td class="text-nowrap"><button class="btn btn-sm btn-outline-primary me-1" title="결석신고서(한글)">신고서</button><button class="btn btn-sm btn-outline-danger">삭제</button></td>`;
        const [fbtn, dbtn] = tr.querySelectorAll('button');
        fbtn.addEventListener('click', () => deliverForm({ kind: 'absence', studentId: curSid, date: r.date }).catch(showError));
        dbtn.addEventListener('click', async () => { try { if (confirm('이 기록을 삭제할까요?')) { await DBManager.delete('attendance', r.attendanceId); await loadStudentAttendanceHistory(); } } catch (e) { showError(e); } });
        tbody.appendChild(tr);
    });
}

// ---------------------------------------------------------------- 사안
async function loadIncidents() {
    if (isLocked) return;
    if (!incidentsUnlocked) {
        const ok = await askPassword('학생 사안 관리 - 비밀번호 확인');
        if (!ok) return navigate('dashboard');
        incidentsUnlocked = true;
    }
    const list = (await IncidentRepo.getAll()).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const stds = await StudentRepo.getAll();
    const tbody = document.getElementById('incident-list-body');
    tbody.innerHTML = list.length ? '' : '<tr><td colspan="5" class="text-center text-muted">기록 없음</td></tr>';
    list.forEach(i => {
        const s = stds.find(x => x.studentId === i.studentId);
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="text-nowrap">${h(i.date)}</td><td class="text-nowrap">${h(s ? s.name : '미상')}</td><td style="white-space:pre-wrap">${h(i.content)}</td><td>${h((i.measures || []).join(', ') || '-')}</td><td><button class="btn btn-sm btn-outline-danger">삭제</button></td>`;
        tr.querySelector('button').addEventListener('click', async () => { try { if (confirm('사안 기록을 삭제할까요?')) { await IncidentRepo.delete(i.incidentId); await loadIncidents(); } } catch (e) { showError(e); } });
        tbody.appendChild(tr);
    });
    const sel = document.getElementById('incident-student');
    const keep = sel.value;
    sel.innerHTML = stds.map(s => `<option value="${h(s.studentId)}">${h(s.number)}. ${h(s.name)}</option>`).join('');
    if (keep) sel.value = keep;
    if (!val('incident-date')) document.getElementById('incident-date').value = DBManager.getTodayStr();
}
async function addIncident() {
    const sid = val('incident-student'), d = val('incident-date'), c = val('incident-content').trim();
    const m = [['inc-m1', '상담'], ['inc-m2', '조언'], ['inc-m3', '지도'], ['inc-m4', '훈육'], ['inc-m5', '훈계']].filter(([id]) => document.getElementById(id)?.checked).map(([, v]) => v);
    if (!sid || !d || !c) return showToast('학생, 날짜, 내용을 입력하세요.', 'warning');
    await IncidentRepo.add(sid, d, c, m);
    document.getElementById('incident-content').value = '';
    ['inc-m1', 'inc-m2', 'inc-m3', 'inc-m4', 'inc-m5'].forEach(id => { const el = document.getElementById(id); if (el) el.checked = false; });
    showToast('저장되었습니다.', 'success');
    await loadIncidents();
}

// ---------------------------------------------------------- 교외체험학습
async function loadExperiential() {
    const list = (await ExperientialRepo.getAll()).sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
    const sel = document.getElementById('exp-student');
    const keep = sel.value;
    const stds = await StudentRepo.getAll();
    sel.innerHTML = stds.map(x => `<option value="${h(x.studentId)}" data-name="${h(x.name)}">${h(x.number)}. ${h(x.name)}</option>`).join('');
    if (keep) sel.value = keep;
    const tbody = document.getElementById('exp-list-body');
    tbody.innerHTML = list.length ? '' : '<tr><td colspan="6" class="text-center text-muted">신청 내역 없음</td></tr>';
    list.forEach(e => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${h(e.studentName)}</td><td class="text-nowrap">${h(e.startDate)}~${h(e.endDate)}</td><td>${h(e.type)}</td>
            <td class="text-nowrap"><label class="me-2"><input type="checkbox" data-doc="app" ${e.docs && e.docs.app ? 'checked' : ''}> 신청서</label><label><input type="checkbox" data-doc="report" ${e.docs && e.docs.report ? 'checked' : ''}> 보고서</label></td>
            <td><span class="badge cursor-pointer ${e.status === 'approved' ? 'bg-success' : (e.status === 'denied' ? 'bg-secondary' : 'bg-warning text-dark')}" title="클릭하여 승인/신청 전환">${e.status === 'approved' ? '승인' : (e.status === 'denied' ? '불허' : '신청')}</span></td>
            <td class="text-nowrap"><button class="btn btn-sm btn-outline-primary me-1">수정</button><button class="btn btn-sm btn-outline-danger me-1">삭제</button><button class="btn btn-sm btn-outline-success" title="신청서·보고서·통보서">서식</button></td>`;
        tr.querySelectorAll('input[data-doc]').forEach(cb => cb.addEventListener('change', async () => {
            try { const docs = { ...(e.docs || { app: false, report: false }), [cb.dataset.doc]: cb.checked }; e.docs = docs; await ExperientialRepo.updateDocs(e.expId, docs); } catch (err) { showError(err); }
        }));
        const [eb, db, fb] = tr.querySelectorAll('button');
        fb.addEventListener('click', () => goToExpForms(e.expId).catch(showError));
        eb.addEventListener('click', () => openExpEdit(e.expId).catch(showError));
        db.addEventListener('click', async () => { try { if (confirm('삭제할까요? 자동으로 넣은 출석인정 기록도 함께 지워집니다.')) { await api.delete_experiential(e.expId); await loadExperiential(); } } catch (err) { showError(err); } });
        tr.querySelector('.badge.cursor-pointer').addEventListener('click', async () => {
            try { await saveExperientialRecord({ ...e, status: e.status === 'approved' ? 'requested' : 'approved' }); } catch (err) { showError(err); }
        });
        tbody.appendChild(tr);
    });
}
async function addExperiential() {
    const sel = document.getElementById('exp-student');
    if (sel.selectedIndex < 0) return showToast('학생을 먼저 등록하세요.', 'warning');
    const s = val('exp-start'), e = val('exp-end') || val('exp-start');
    if (!s) return showToast('시작일을 입력하세요.', 'warning');
    if (e < s) return showToast('종료일이 시작일보다 빠릅니다.', 'warning');
    await saveExperientialRecord({ studentId: sel.value, studentName: sel.options[sel.selectedIndex].dataset.name, type: val('exp-type'), startDate: s, endDate: e, reason: val('exp-reason'), status: document.getElementById('exp-approved').checked ? 'approved' : 'requested', docs: { app: false, report: false } });
    document.getElementById('exp-reason').value = '';
}
const EXP_DETAIL_FIELDS = ['destination', 'lodging', 'guardianName', 'guardianRelation', 'guardianPhone', 'escortName', 'escortRelation', 'escortPhone', 'plan', 'denyReason'];
async function saveExperientialRecord(exp) {
    const r = await api.save_experiential(exp);
    if (exp.status === 'approved') showToast(r.days ? `출결에 출석인정 ${r.days}일을 반영했습니다.` : '승인되었습니다. (기간 중 수업일이 없어 출결 반영 없음)', 'success');
    else if (r.removed) showToast('승인을 취소하여 자동 반영된 출석인정 기록을 지웠습니다.', 'info');
    if (document.getElementById('experiential').classList.contains('active')) await loadExperiential();
    if (document.getElementById('forms').classList.contains('active')) await loadExpFormTab();
}
async function openExpEdit(expId) {
    editingExpId = expId;
    const item = await DBManager.get('experiential', expId);
    if (!item) return;
    document.getElementById('exp-edit-student').value = item.studentName || '';
    const typeSel = document.getElementById('exp-edit-type');
    if (item.type && ![...typeSel.options].some(o => o.value === item.type)) typeSel.add(new Option(item.type, item.type));
    typeSel.value = item.type || '기타';
    document.getElementById('exp-edit-start').value = item.startDate || '';
    document.getElementById('exp-edit-end').value = item.endDate || '';
    document.getElementById('exp-edit-reason').value = item.reason || '';
    document.getElementById('exp-edit-status').value = item.status || 'requested';
    EXP_DETAIL_FIELDS.forEach(k => { document.getElementById('exp-edit-' + k).value = item[k] || ''; });
    document.getElementById('exp-edit-overseas').checked = !!item.overseas;
    document.getElementById('exp-deny-wrap').style.display = item.status === 'denied' ? '' : 'none';
    modal('editExpModal').show();
}
async function saveExpEdit() {
    if (!editingExpId) return;
    const item = await DBManager.get('experiential', editingExpId);
    if (!item) return;
    if (val('exp-edit-end') && val('exp-edit-end') < val('exp-edit-start')) return showToast('종료일이 시작일보다 빠릅니다.', 'warning');
    Object.assign(item, { type: val('exp-edit-type'), startDate: val('exp-edit-start'), endDate: val('exp-edit-end') || val('exp-edit-start'), reason: val('exp-edit-reason'), purpose: val('exp-edit-reason'), status: val('exp-edit-status'), overseas: document.getElementById('exp-edit-overseas').checked });
    EXP_DETAIL_FIELDS.forEach(k => { item[k] = val('exp-edit-' + k); });
    editingExpId = null;
    hideModal('editExpModal');
    await saveExperientialRecord(item);
}

// ---------------------------------------------------------------- 평가
async function loadEvaluation() {
    const plans = (await EvaluationRepo.getPlans()).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const div = document.getElementById('eval-plan-list');
    div.innerHTML = plans.length ? '' : '<div class="text-center py-3 text-muted">등록된 평가 계획이 없습니다.</div>';
    const subs = await SubjectRepo.getAll();
    const sel = document.getElementById('eval-subject-select');
    const keep = sel.value;
    sel.innerHTML = subs.map(s => `<option value="${h(s.subjectId)}" data-name="${h(s.name)}" data-short="${h(s.shortName)}">${h(s.name)}</option>`).join('');
    if (keep) sel.value = keep;
    plans.forEach(p => {
        const b = document.createElement('div');
        b.className = 'list-group-item list-group-item-action d-flex justify-content-between align-items-center cursor-pointer' + (p.planId === curEval ? ' active' : '');
        b.innerHTML = `<div><span class="fw-bold ${p.planId === curEval ? '' : 'text-primary'}">[${h(p.subjectName)}]</span> ${h(p.title)}<div class="small opacity-75">${h(p.date || '')}</div></div><button class="btn btn-sm btn-outline-danger">삭제</button>`;
        b.addEventListener('click', () => openGrading(p.planId).catch(showError));
        b.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); deleteEvalPlan(p.planId).catch(showError); });
        div.appendChild(b);
    });
}
async function goToEvalWithSubject(shortOrName, date) {
    await navigate('evaluation');
    document.getElementById('eval-title').value = `${date} 평가`;
    document.getElementById('eval-date').value = date;
    const sel = document.getElementById('eval-subject-select');
    for (let i = 0; i < sel.options.length; i++) {
        const o = sel.options[i];
        if (o.dataset.short === shortOrName || o.dataset.name === shortOrName) { sel.selectedIndex = i; break; }
    }
    modal('addEvalModal').show();
}
async function addEvalPlan() {
    const sel = document.getElementById('eval-subject-select');
    if (sel.selectedIndex < 0) return showToast('과목이 선택되지 않았습니다.', 'warning');
    const data = { subjectId: sel.value, subjectName: sel.options[sel.selectedIndex].dataset.name, title: val('eval-title').trim(), date: val('eval-date') || DBManager.getTodayStr(), domain: val('eval-domain'), element: val('eval-element'), standard: val('eval-standard'), method: val('eval-method'), scale: EVAL_SCALE.slice() };
    if (!data.title) return showToast('평가명을 입력하세요.', 'warning');
    await EvaluationRepo.addPlan(data);
    hideModal('addEvalModal');
    ['eval-title', 'eval-domain', 'eval-element', 'eval-standard', 'eval-method'].forEach(id => document.getElementById(id).value = '');
    await loadEvaluation();
}
async function deleteEvalPlan(id) {
    if (confirm('평가 계획과 입력한 평가 결과를 모두 삭제할까요?')) {
        await EvaluationRepo.deletePlan(id);
        if (curEval === id) { curEval = null; document.getElementById('grading-table-body').innerHTML = ''; document.getElementById('grading-title').textContent = '선택 필요'; }
        await loadEvaluation();
    }
}
async function openGrading(pid) {
    curEval = pid;
    const plan = await EvaluationRepo.getPlan(pid);
    document.getElementById('grading-title').textContent = plan ? `[${plan.subjectName}] ${plan.title}` : '';
    document.getElementById('save-grades-btn').disabled = false;
    document.getElementById('export-grades-btn').disabled = false;
    const stds = await StudentRepo.getAll(), scores = await EvaluationRepo.getScoresByPlanId(pid);
    const scale = (plan && Array.isArray(plan.scale) && plan.scale.length) ? plan.scale : EVAL_SCALE;
    document.getElementById('grading-table-body').innerHTML = stds.map(s => {
        const sc = scores.find(x => x.studentId === s.studentId) || {};
        const opt = (v, t) => `<option value="${h(v)}" ${(sc.score || '') === v ? 'selected' : ''}>${h(t)}</option>`;
        const extra = sc.score && !scale.includes(sc.score) ? opt(sc.score, sc.score) : '';
        return `<tr><td class="text-nowrap">${h(s.number)}. ${h(s.name)}</td><td style="width:120px"><select id="sv_${s.studentId}" class="form-select form-select-sm text-center">${opt('', '-')}${scale.map(x => opt(x, x)).join('')}${extra}</select></td><td><input type="text" id="sn_${s.studentId}" class="form-control form-control-sm" value="${h(sc.note || '')}" placeholder="관찰 내용"></td></tr>`;
    }).join('') || '<tr><td colspan="3" class="text-center text-muted">학생을 먼저 등록하세요.</td></tr>';
    await loadEvaluation();
}
async function saveGrades() {
    if (!curEval) return;
    const stds = await StudentRepo.getAll();
    const list = stds.map(s => ({ scoreId: `${curEval}_${s.studentId}`, planId: curEval, studentId: s.studentId, score: val(`sv_${s.studentId}`), note: val(`sn_${s.studentId}`) }));
    await EvaluationRepo.saveScores(list);
    showToast('평가 결과 저장 완료', 'success');
}

// ---------------------------------------------------------------- 업무
async function loadTasks() {
    const list = (await TaskRepo.getAll()).sort((a, b) => (a.status === 'done') - (b.status === 'done') || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
    const tbody = document.getElementById('task-list-body');
    tbody.innerHTML = list.length ? '' : '<tr><td colspan="5" class="text-center py-3">할 일이 없습니다.</td></tr>';
    list.forEach(t => {
        const done = t.status === 'done';
        const tr = document.createElement('tr');
        if (done) tr.className = 'table-light text-muted';
        tr.innerHTML = `<td><input type="checkbox" class="form-check-input" ${done ? 'checked' : ''}></td><td class="${done ? 'text-decoration-line-through' : ''}">${h(t.title)}</td><td>${h(t.dueDate || '-')}</td><td><span class="badge bg-secondary">${h(t.category)}</span></td><td><button class="btn btn-sm btn-outline-danger">삭제</button></td>`;
        tr.querySelector('input').addEventListener('change', async (e) => { try { await TaskRepo.updateStatus(t.taskId, e.target.checked ? 'done' : 'todo'); await loadTasks(); } catch (err) { showError(err); } });
        tr.querySelector('button').addEventListener('click', async () => { try { if (confirm('삭제할까요?')) { await TaskRepo.delete(t.taskId); await loadTasks(); } } catch (err) { showError(err); } });
        tbody.appendChild(tr);
    });
}
async function addTask() {
    const t = val('taskTitle').trim();
    if (!t) return showToast('내용을 입력하세요.', 'warning');
    await TaskRepo.add(t, val('taskDueDate'), val('taskCategory'));
    document.getElementById('taskTitle').value = '';
    await loadTasks();
}

// ---------------------------------------------------------- 데이터 관리
async function loadDataManage() {
    try {
        const info = await api.app_info();
        document.getElementById('data-dir').textContent = info.dataDir;
        document.getElementById('app-version').textContent = 'v' + info.version;
        const b = await api.backup_settings();
        document.getElementById('extra-backup-dir').textContent = b.extraFolder || '(없음)';
        document.getElementById('clear-backup-dir-btn').style.display = b.extraFolder ? '' : 'none';
    } catch (e) { /* 표시용 */ }
}
async function chooseBackupDir() {
    if (!Bridge.isDesktop()) return showToast('데스크톱 프로그램에서만 설정할 수 있습니다.', 'warning');
    const p = await api.choose_backup_dir();
    if (p) showToast('자동 백업을 이 위치에도 저장합니다: ' + p, 'success');
    await loadDataManage();
}
async function exportData() {
    const r = await deliverFile('backup');
    if (r) showToast('백업 파일을 저장했습니다.', 'success');
}
async function importData() {
    const f = document.getElementById('importFile').files[0];
    if (!f) return showToast('백업 파일(.json)을 선택하세요.', 'warning');
    if (!confirm('지금 데이터가 백업 파일 내용으로 바뀝니다.\n(현재 데이터는 자동 백업 폴더에 먼저 저장됩니다)\n진행할까요?')) return;
    const text = await readFileAsText(f);
    let counts;
    try {
        counts = await DBManager.importAll(text);
    } catch (e) {
        if (!String(e.message || e).includes('백업 당시 비밀번호')) throw e;
        const secret = await askSecret('백업 당시 비밀번호 또는 복구 코드');
        if (!secret) return showToast('복구를 취소했습니다.');
        counts = await api.import_backup(text, secret);
    }
    const n = Object.values(counts).reduce((a, b) => a + b, 0);
    alert(`복구 완료: ${n}건\n(학생 ${counts.students || 0}명, 출결 ${counts.attendance || 0}건, 연간시간표 ${counts.annual_schedule || 0}일)\n\n화면을 다시 불러옵니다.`);
    location.reload();
}
async function resetSystem() {
    if (!confirm('모든 데이터를 삭제합니다. 정말 진행할까요?')) return;
    const typed = await askSecret("확인을 위해 '삭제'라고 입력하세요");
    if (typed !== '삭제') return showToast('취소되었습니다.');
    await DBManager.clearAll();
    alert('삭제되었습니다. (삭제 직전 데이터는 자동 백업 폴더에 저장되어 있습니다)');
    location.reload();
}

// ---------------------------------------------------------------- 통계
let curStatSid = null;
async function loadStats() {
    const stds = await StudentRepo.getAll();
    const box = document.getElementById('stats-student-list');
    box.innerHTML = '';
    stds.forEach(s => {
        const b = document.createElement('button');
        b.className = 'list-group-item list-group-item-action';
        b.textContent = `${s.number}. ${s.name}`;
        b.addEventListener('click', () => showStatDetail(s.studentId, s.name).catch(showError));
        box.appendChild(b);
    });
    const atts = await AttendanceRepo.getAll(), absentKey = new Set();
    atts.forEach(a => { if (a.status === '결석' && a.reason !== '인정') absentKey.add(`${a.studentId}_${a.date}`); });
    document.getElementById('total-absent').textContent = absentKey.size + '일';
    document.getElementById('class-stats-view').style.display = 'block';
    document.getElementById('individual-report-view').style.display = 'none';
    curStatSid = null;
}
async function showStatDetail(sid, name) {
    curStatSid = sid;
    document.getElementById('class-stats-view').style.display = 'none';
    document.getElementById('individual-report-view').style.display = 'block';
    document.getElementById('report-title').textContent = name + ' 종합 기록';
    const stats = await AttendanceRepo.getStudentStats(sid);
    document.getElementById('report-attendance').textContent = `결석 ${stats.absent || 0}일 / 지각 ${stats.late || 0}일 / 조퇴 ${stats.early || 0}일 / 결과 ${stats.result || 0}일 / 출석인정 ${stats.recognized || 0}일`;
    const plans = await EvaluationRepo.getPlans(), myScores = await EvaluationRepo.getScoresByStudentId(sid);
    let evalHtml = '';
    for (const p of plans) {
        const s = myScores.find(x => x.planId === p.planId);
        if (s && (s.score || s.note)) evalHtml += `<div class="mb-2 border-bottom pb-1"><strong>[${h(p.subjectName)}] ${h(p.title)}</strong>: <span class="badge bg-light text-dark border">${h(s.score || '-')}</span> ${h(s.note || '')}</div>`;
    }
    document.getElementById('report-evaluation').innerHTML = evalHtml || '기록 없음';
    const logs = await CounselingRepo.getByStudentId(sid);
    document.getElementById('report-counseling').innerHTML = logs.map(l => `<div class="mb-1"><span class="text-muted small">[${h(l.date)}]</span> ${h(l.content)}</div>`).join('') || '기록 없음';
}

// ---------------------------------------------------------- 통합 스케줄러
function openAttendanceFromModal() {
    const date = document.getElementById('action-date').textContent;
    hideModal('dateActionModal');
    AnnualScheduleRepo.get(date).then(schedule => {
        const listDiv = document.getElementById('att-class-list');
        document.getElementById('att-select-title').textContent = `${date} 출결 관리`;
        listDiv.innerHTML = '';
        if (!schedule || !(schedule.subjects || []).length) { listDiv.innerHTML = '<div class="text-center p-3">수업 정보가 없습니다.</div>'; }
        else schedule.subjects.forEach(s => {
            const b = document.createElement('button');
            b.className = 'list-group-item list-group-item-action';
            b.innerHTML = `<span class="badge bg-secondary me-2">${s.period}교시</span> ${h(s.name)}`;
            b.addEventListener('click', () => openAttendanceModalForDate(date, s.period, s.name).catch(showError));
            listDiv.appendChild(b);
        });
        modal('attendanceDateSelectModal').show();
    }).catch(showError);
}
function openAddTaskFromModal() {
    const d = document.getElementById('action-date').textContent;
    hideModal('fullSchedulerModal'); hideModal('dateActionModal');
    navigate('tasks');
    document.getElementById('taskDueDate').value = d;
    document.getElementById('taskTitle').focus();
}
function openSchedulerModal() { modal('fullSchedulerModal').show(); setTimeout(() => loadScheduler().catch(showError), 250); }
async function loadScheduler() {
    const el = document.getElementById('full-calendar-el');
    if (calendarInstance) calendarInstance.destroy();
    const tasks = await TaskRepo.getAll();
    const events = tasks.filter(t => t.dueDate).map(t => ({ id: t.taskId, title: t.title, start: t.dueDate, color: t.status === 'done' ? '#198754' : '#dc3545' }));
    const addDay = (d) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + 1); return x.toLocaleDateString('en-CA'); };
    (await SchoolEventRepo.getAll()).forEach(e => events.push({ title: e.title, start: e.startDate, end: e.endDate ? addDay(e.endDate) : undefined, color: e.isHoliday ? '#dc3545' : '#ffc107', textColor: e.isHoliday ? '#fff' : '#000', display: 'block' }));
    const annual = await AnnualScheduleRepo.getAll();
    annual.forEach(a => events.push({ start: a.date, color: '#e7f5ff', display: 'background' }));
    calendarInstance = new FullCalendar.Calendar(el, {
        initialView: 'dayGridMonth', locale: 'ko', events, height: '100%',
        headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,listMonth' },
        dateClick: (info) => {
            document.getElementById('action-date').textContent = info.dateStr;
            const day = annual.find(a => a.date === info.dateStr);
            const box = document.getElementById('action-class-list');
            box.innerHTML = '';
            (day ? day.subjects : []).forEach(s => {
                const b = document.createElement('button');
                b.className = 'btn btn-sm btn-outline-primary m-1';
                b.textContent = `${s.period}교시 ${s.name} 평가추가`;
                b.addEventListener('click', () => { hideModal('fullSchedulerModal'); hideModal('dateActionModal'); goToEvalWithSubject(s.name, info.dateStr).catch(showError); });
                box.appendChild(b);
            });
            if (!box.children.length) box.textContent = '수업 없음';
            modal('dateActionModal').show();
        }
    });
    calendarInstance.render();
}

// ---------------------------------------------------------------- 설정
const SETTING_FIELDS = ['schoolName', 'schoolYear', 'grade', 'classNo', 'teacherName', 'term1Start', 'term1End', 'term2Start', 'term2End', 'periodsPerDay', 'evalScale',
    'principalName', 'expDomesticDays', 'expOverseasDays', 'expApplyDays', 'expReportDays', 'absenceDays'];
async function loadSettingsToForm() {
    const s = await SettingsRepo.get();
    SETTING_FIELDS.forEach(id => { const el = document.getElementById(id); if (el) el.value = s[id] || ''; });
    if (!s.periodsPerDay) document.getElementById('periodsPerDay').value = '6';
    if (!s.evalScale) document.getElementById('evalScale').value = '상, 중, 하';
}
async function saveSettings() {
    const d = {};
    SETTING_FIELDS.forEach(id => d[id] = val(id));
    if (d.term1Start && d.term1End && d.term1End < d.term1Start) return showToast('1학기 종료일이 시작일보다 빠릅니다.', 'warning');
    if (d.term2Start && d.term2End && d.term2End < d.term2Start) return showToast('2학기 종료일이 시작일보다 빠릅니다.', 'warning');
    if (parseScale(d.evalScale).length < 2) return showToast('평가 척도는 쉼표로 구분해 2개 이상 입력하세요. 예) 잘함, 보통, 노력요함', 'warning');
    await SettingsRepo.save(d);
    await applySettings();
    showToast('저장되었습니다.', 'success');
}


// ================================================================ 서식 출력
const FORM_KINDS_LABEL = { exp_application: '교외체험학습 신청서', exp_report: '교외체험학습 결과보고서', exp_notice: '교외체험학습 승인 통보서', absence: '결석·지각·조퇴·결과 신고서' };
let wkStart = null;
let formTemplates = {};

function shiftDate(d, days) { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + days); return x.toLocaleDateString('en-CA'); }

async function deliverForm(params) {
    const path = await deliverFile('form_hwpx', params);
    const rep = deliverFile.lastReport;
    if (rep) {
        const n = rep.placeholders.length + rep.labels.length;
        let msg = `학교 양식에 ${n}곳을 채웠습니다.`;
        if (rep.unfilledPlaceholders.length) msg += ` 값이 없는 자리표시: ${rep.unfilledPlaceholders.join(', ')}`;
        showToast(msg, rep.unfilledPlaceholders.length || !n ? 'warning' : 'success');
    } else if (path) showToast('한글 파일을 만들었습니다.', 'success');
}

async function loadFormsPage() {
    await refreshTemplateFlags();
    if (!wkStart) await loadWeekly(DBManager.getTodayStr()); else await loadWeekly(wkStart);
}

async function refreshTemplateFlags() {
    const r = await api.form_templates();
    formTemplates = {};
    r.templates.forEach(t => formTemplates[t.kind] = t);
    const abs = document.getElementById('abs-use-tpl'), exp = document.getElementById('exp-use-tpl');
    abs.disabled = !formTemplates.absence; if (abs.disabled) abs.checked = false; else if (!abs.dataset.touched) abs.checked = true;
    const anyExp = ['exp_application', 'exp_report', 'exp_notice'].some(k => formTemplates[k]);
    exp.disabled = !anyExp; if (exp.disabled) exp.checked = false; else if (!exp.dataset.touched) exp.checked = true;
    abs.onchange = () => abs.dataset.touched = '1'; exp.onchange = () => exp.dataset.touched = '1';
    return r;
}

// ---- 주간학습안내
async function loadWeekly(dateStr) {
    const r = await api.weekly_get(dateStr || DBManager.getTodayStr());
    wkStart = r.weekStart;
    document.getElementById('wk-date').value = wkStart;
    const fri = shiftDate(wkStart, 4);
    document.getElementById('wk-label').textContent = `${wkStart.slice(5).replace('-', '/')}(월) ~ ${fri.slice(5).replace('-', '/')}(금)`;
    const n = r.notes || {};
    const keys = ['mon', 'tue', 'wed', 'thu', 'fri'];
    const row = (label, key, area) => `<tr><th class="table-light small">${label}</th>${keys.map(k => area
        ? `<td><textarea class="form-control form-control-sm" rows="2" data-wk="${key}" data-day="${k}">${h((n[key] || {})[k] || '')}</textarea></td>`
        : `<td><input class="form-control form-control-sm" data-wk="${key}" data-day="${k}" value="${h((n[key] || {})[k] || '')}"></td>`).join('')}</tr>`;
    document.getElementById('wk-body').innerHTML = row('아침 활동', 'morning', false) + row('준비물·알림', 'prep', true);
    document.getElementById('wk-general').value = n.general || '';
}
async function saveWeekly() {
    const notes = { weekStart: wkStart, morning: {}, prep: {}, general: val('wk-general') };
    document.querySelectorAll('[data-wk]').forEach(el => { notes[el.dataset.wk][el.dataset.day] = el.value; });
    await api.weekly_save(notes);
}

// ---- 가정통지표
async function loadCards() {
    const body = document.getElementById('card-body');
    let r;
    try { r = await api.report_card_list(Number(val('card-term'))); }
    catch (e) { body.innerHTML = `<tr><td colspan="3" class="text-center text-danger py-4">${h(e.message)}</td></tr>`; return; }
    document.getElementById('card-range').textContent = `(${r.range[0]} ~ ${r.range[1]})`;
    body.innerHTML = r.students.length ? '' : '<tr><td colspan="3" class="text-center text-muted py-4">학생이 없습니다.</td></tr>';
    r.students.forEach(s => {
        const tr = document.createElement('tr');
        const notes = s.notes.length ? `<details class="small mt-1"><summary class="text-primary">누가기록 ${s.notes.length}건 보기</summary><div class="text-muted">${s.notes.map(h).join('<br>')}</div></details>` : '';
        tr.innerHTML = `<td class="text-nowrap">${h(s.number)}. ${h(s.name)}${s.absent ? `<div class="small text-danger">결석 ${s.absent}일</div>` : ''}</td>
            <td class="text-center small">${h(s.evals)}</td>
            <td><textarea class="form-control form-control-sm" rows="3" data-card="${h(s.studentId)}">${h(s.comment)}</textarea>
                <div class="d-flex justify-content-between"><span class="small text-muted" data-count></span></div>${notes}</td>`;
        const ta = tr.querySelector('textarea'), cnt = tr.querySelector('[data-count]');
        const upd = () => { cnt.textContent = `${ta.value.length}자`; };
        ta.addEventListener('input', upd); upd();
        body.appendChild(tr);
    });
}
async function saveCards() {
    const items = [...document.querySelectorAll('[data-card]')].map(t => ({ studentId: t.dataset.card, comment: t.value }));
    if (items.length) await api.report_card_save(Number(val('card-term')), items);
}

// ---- 결석신고서
async function loadAbsenceTab() {
    await refreshTemplateFlags();
    const sel = document.getElementById('abs-student');
    const keep = sel.value;
    const stds = await StudentRepo.getAll();
    sel.innerHTML = stds.map(s => `<option value="${h(s.studentId)}">${h(s.number)}. ${h(s.name)}</option>`).join('');
    if (keep) sel.value = keep;
    await loadAbsenceDates();
}
async function loadAbsenceDates() {
    const sid = val('abs-student');
    const sel = document.getElementById('abs-date');
    if (!sid) { sel.innerHTML = ''; return; }
    const list = await api.absence_dates(sid);
    sel.innerHTML = list.length ? list.map(d => `<option value="${d.date}">${d.date}(${dayName(d.date)}) · ${h(d.label)}</option>`).join('') : '<option value="">기록 없음</option>';
}
async function absenceForm(fmt) {
    const params = { kind: 'absence', studentId: val('abs-student'), date: val('abs-date'), useTemplate: document.getElementById('abs-use-tpl').checked };
    if (!params.studentId || !params.date) return showToast('학생과 날짜를 고르세요.', 'warning');
    if (fmt === 'hwpx') return deliverForm(params);
    return openReport('form', params);
}

// ---- 교외체험학습
async function goToExpForms(expId) {
    await navigate('forms');
    bootstrap.Tab.getOrCreateInstance(document.getElementById('tab-form-exp')).show();
    await loadExpFormTab(expId);
}
async function loadExpFormTab(selectId) {
    await refreshTemplateFlags();
    const sel = document.getElementById('exp-form-sel');
    const keep = selectId || sel.value;
    const list = (await ExperientialRepo.getAll()).sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
    const st = { approved: '승인', denied: '불허' };
    sel.innerHTML = list.map(e => `<option value="${h(e.expId)}">${h(e.studentName)} · ${h(e.startDate)}~${h((e.endDate || '').slice(5))} · ${h(e.type)} · ${st[e.status] || '신청'}</option>`).join('');
    if (keep) sel.value = keep;
    const exp = list.find(e => e.expId === sel.value);
    const missing = exp ? ['destination', 'guardianName', 'plan'].filter(k => !exp[k]) : [];
    document.getElementById('exp-form-info').innerHTML = !exp ? '등록된 체험학습이 없습니다. [교외체험학습] 메뉴에서 먼저 등록하세요.'
        : (missing.length ? `<span class="text-warning-emphasis"><i class="fas fa-info-circle me-1"></i>목적지·보호자·계획 등 비어 있는 항목은 서식에 빈칸으로 나옵니다. [서식용 상세 입력]에서 채울 수 있습니다.</span>` : '');
    sel.onchange = () => loadExpFormTab().catch(showError);
}
async function expForm(kind, fmt) {
    const expId = val('exp-form-sel');
    if (!expId) return showToast('체험학습을 먼저 등록하세요.', 'warning');
    const params = { kind, expId, useTemplate: document.getElementById('exp-use-tpl').checked && !!formTemplates[kind] };
    if (fmt === 'hwpx') return deliverForm(params);
    return openReport('form', params);
}

// ---- 학교 양식 등록
async function loadTemplates() {
    const r = await refreshTemplateFlags();
    const body = document.getElementById('tpl-body');
    body.innerHTML = '';
    Object.entries(r.kinds).forEach(([kind, label]) => {
        const t = formTemplates[kind];
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="fw-bold">${h(label)}</td>
            <td class="small">${t ? `<i class="fas fa-file-alt text-primary me-1"></i>${h(t.filename)}<div class="text-muted">${h((t.uploadedAt || '').replace('T', ' '))}</div>` : '<span class="text-muted">없음 (프로그램 기본 서식 사용)</span>'}</td>
            <td><div class="input-group input-group-sm"><input type="file" class="form-control" accept=".hwp,.hwpx"><button class="btn btn-success">등록</button>${t ? '<button class="btn btn-outline-danger">삭제</button>' : ''}</div></td>`;
        const [upBtn, delBtn] = tr.querySelectorAll('button');
        upBtn.addEventListener('click', async () => {
            try {
                const f = tr.querySelector('input').files[0];
                if (!f) return showToast('한글 파일(.hwp/.hwpx)을 고르세요.', 'warning');
                const info = await api.form_template_upload(kind, await readFileAsBase64(f), f.name);
                showToast(`등록했습니다. 자리표시 ${info.placeholders.length}개, 표 ${info.tables}개를 찾았습니다.`, 'success');
                await loadTemplates();
            } catch (e) { showError(e); }
        });
        if (delBtn) delBtn.addEventListener('click', async () => {
            try { if (confirm(`${label} 학교 양식을 삭제할까요? (기본 서식으로 돌아갑니다)`)) { await api.form_template_delete(kind); await loadTemplates(); } } catch (e) { showError(e); }
        });
        body.appendChild(tr);
    });
    document.getElementById('tpl-guide').innerHTML =
        `<div class="mb-1"><b>교외체험학습(신청서·보고서·통보서):</b> ${r.guide.exp.map(x => `<code>{{${h(x)}}}</code>`).join(' ')}</div>` +
        `<div><b>결석신고서:</b> ${r.guide.absence.map(x => `<code>{{${h(x)}}}</code>`).join(' ')}</div>`;
}
