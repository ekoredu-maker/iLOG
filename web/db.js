// db.js - v10 (Python/SQLite 연동)
// Copyright 2026@박주가리교감
// 기존 Repo 이름과 함수는 그대로 두고, 실제 저장은 파이썬(SQLite)이 맡는다.

const Bridge = (() => {
    let readyPromise = null;
    const isDesktop = () => !!(window.pywebview && window.pywebview.api);

    function ready() {
        if (readyPromise) return readyPromise;
        readyPromise = new Promise((resolve) => {
            if (isDesktop()) return resolve('desktop');
            // pywebview 는 페이지 로드 후 api 를 주입한다(느린 PC 는 수 초 걸릴 수 있음).
            // 개발 서버(/api)가 실제로 응답할 때만 브라우저 모드로 판단한다.
            let done = false;
            const finish = (mode) => { if (!done) { done = true; resolve(mode); } };
            window.addEventListener('pywebviewready', () => finish('desktop'));
            (function poll() {
                if (isDesktop()) return finish('desktop');
                if (!done) setTimeout(poll, 50);
            })();
            setTimeout(() => {
                if (done) return;
                fetch('/api/app_info', { method: 'POST', body: '[]' })
                    .then(r => { if (r.ok) finish('browser'); })
                    .catch(() => { /* 데스크톱: 계속 기다림 */ });
            }, 300);
        });
        return readyPromise;
    }

    async function call(method, ...args) {
        const mode = await ready();
        if (mode === 'desktop') {
            try {
                return await window.pywebview.api[method](...args);
            } catch (e) {
                throw new Error((e && (e.message || e.toString())) || String(e));
            }
        }
        const res = await fetch('/api/' + method, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args)
        });
        let body;
        try { body = await res.json(); } catch (_) { throw new Error('서버 응답 오류 (' + res.status + ')'); }
        if (body.error) throw new Error(body.error);
        return body.ok;
    }

    return { call, ready, isDesktop };
})();

const api = new Proxy({}, { get: (_, method) => (...args) => Bridge.call(method, ...args) });

function uid(prefix) {
    const r = (window.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
        : (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
    return `${prefix}_${r}`;
}

// 파일을 base64 로 읽기 (엑셀 등을 파이썬으로 넘길 때)
function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] || '');
        r.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'));
        r.readAsDataURL(file);
    });
}
function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'));
        r.readAsText(file, 'utf-8');
    });
}

// 파이썬이 만든 파일 받기: 데스크톱은 저장 위치 선택 창, 브라우저는 다운로드
async function deliverFile(kind, params) {
    const f = await api.build_file(kind, params || {});
    deliverFile.lastReport = f.report || null;
    if (Bridge.isDesktop()) {
        const path = await api.save_file(f.filename, f.b64, kind !== 'backup');
        return path;   // 취소 시 null
    }
    const bin = atob(f.b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: f.mime }));
    a.download = f.filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return f.filename;
}

// 인쇄용 문서 열기: 데스크톱은 기본 브라우저(Edge 등), 개발 모드는 새 탭
async function openReport(kind, params) {
    const r = await api.build_html(kind, params || {});
    if (Bridge.isDesktop()) return api.open_html(r.filename, r.html);
    const w = window.open(URL.createObjectURL(new Blob([r.html], { type: 'text/html' })), '_blank');
    if (!w) throw new Error('팝업이 차단되었습니다. 팝업 허용 후 다시 시도해 주세요.');
    return r.filename;
}

const DBManager = {
    getTodayStr: function () { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }); },
    open: async function () { await Bridge.ready(); return true; },
    put: (store, data) => api.db_put(store, data),
    putMany: (store, list) => api.db_put_many(store, list),
    get: (store, key) => api.db_get(store, key),
    getAll: (store) => api.db_get_all(store),
    query: (store, field, value) => api.db_query(store, field, value),
    delete: (store, key) => api.db_delete(store, key),

    addCustomLink: (n, u) => api.db_put('custom_links', { linkId: uid('lnk'), name: n, url: u }),
    getCustomLinks: () => api.db_get_all('custom_links'),
    deleteCustomLink: (id) => api.db_delete('custom_links', id),

    deleteStudentCascade: (id) => api.delete_student_cascade(id),
    deleteEvalPlanCascade: (id) => api.delete_eval_plan_cascade(id),
    importAll: (jsonText) => api.import_backup(jsonText),
    clearAll: () => api.clear_all()
};

const SettingsRepo = {
    get: async () => (await DBManager.get('settings', 'global')) || {},
    save: async (d) => { const cur = await SettingsRepo.get(); await DBManager.put('settings', { ...cur, ...d, id: 'global' }); },
    verifyPassword: (p) => api.verify_password(p),
    changePassword: (cur, p) => api.change_password(cur, p)
};
const SubjectRepo = {
    getAll: () => DBManager.getAll('subjects'),
    add: (n, s, h) => DBManager.put('subjects', { subjectId: uid('sub'), name: n, shortName: s || n, hours: Number(h) || 0 }),
    update: (id, n, s, h) => DBManager.put('subjects', { subjectId: id, name: n, shortName: s || n, hours: Number(h) || 0 }),
    delete: (id) => DBManager.delete('subjects', id)
};
const TimetableRepo = {
    getWeekly: async () => (await DBManager.get('timetable_weekly', 'weekly'))?.grid,
    saveWeekly: (g) => DBManager.put('timetable_weekly', { id: 'weekly', grid: g })
};
const SchoolEventRepo = {
    getAll: () => DBManager.getAll('school_events'),
    add: (s, e, t, h) => DBManager.put('school_events', { eventId: uid('evt'), startDate: s, endDate: e || s, title: t, isHoliday: !!h }),
    delete: (id) => DBManager.delete('school_events', id)
};
const AnnualScheduleRepo = {
    get: (d) => DBManager.get('annual_schedule', d),
    save: (d, s) => DBManager.put('annual_schedule', { date: d, subjects: s }),
    delete: (d) => DBManager.delete('annual_schedule', d),
    getAll: () => DBManager.getAll('annual_schedule')
};
const StudentRepo = {
    getAll: async () => (await DBManager.getAll('students')).sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0)),
    add: (d) => DBManager.put('students', { studentId: uid('std'), ...d }),
    update: (d) => DBManager.put('students', d),
    delete: (id) => DBManager.deleteStudentCascade(id)
};
const IncidentRepo = {
    getAll: () => DBManager.getAll('incidents'),
    add: (sid, d, c, m) => DBManager.put('incidents', { incidentId: uid('inc'), studentId: sid, date: d, content: c, measures: m || [] }),
    delete: (id) => DBManager.delete('incidents', id)
};
const AttendanceRepo = {
    getByDate: (d) => DBManager.query('attendance', 'date', d),
    getStudentStats: async (sid) => {
        const rs = await DBManager.query('attendance', 'studentId', sid);
        // 나이스 기준: 결석(인정 제외)한 날은 지각·조퇴·결과를 세지 않음, 결석이 모두 '인정'이면 출석인정
        const byDate = new Map();
        for (const rec of rs) {
            if (!rec.date) continue;
            if (!byDate.has(rec.date)) byDate.set(rec.date, []);
            byDate.get(rec.date).push(rec);
        }
        let absent = 0, late = 0, early = 0, result = 0, recognized = 0;
        for (const recs of byDate.values()) {
            const abs = recs.filter(r => r.status === '결석');
            if (abs.some(r => r.reason !== '인정')) { absent++; continue; }
            if (abs.length) { recognized++; continue; }
            if (recs.some(r => r.status === '지각')) late++;
            if (recs.some(r => r.status === '조퇴')) early++;
            if (recs.some(r => r.status === '결과')) result++;
        }
        return { absent, late, early, result, recognized, records: rs };
    },
    saveBatch: (l) => DBManager.putMany('attendance', l),
    deleteMany: (ids) => ids.length ? api.db_delete_many('attendance', ids) : Promise.resolve(0),
    getAll: () => DBManager.getAll('attendance')
};
const TaskRepo = {
    getAll: () => DBManager.getAll('tasks'),
    add: (t, d, c) => DBManager.put('tasks', { taskId: uid('task'), title: t, dueDate: d, category: c, status: 'todo' }),
    updateStatus: async (i, s) => { const t = await DBManager.get('tasks', i); if (t) { t.status = s; await DBManager.put('tasks', t); } },
    delete: (i) => DBManager.delete('tasks', i)
};
const ExperientialRepo = {
    getAll: () => DBManager.getAll('experiential'),
    add: (d) => DBManager.put('experiential', { expId: uid('exp'), ...d, status: 'requested', docs: { app: false, report: false } }),
    update: async (id, patch) => { const r = await DBManager.get('experiential', id); if (r) { Object.assign(r, patch); await DBManager.put('experiential', r); } },
    updateDocs: async (i, d) => { const r = await DBManager.get('experiential', i); if (r) { r.docs = d; await DBManager.put('experiential', r); } },
    delete: (i) => DBManager.delete('experiential', i)
};
const EvaluationRepo = {
    getPlans: () => DBManager.getAll('eval_plans'),
    getPlan: (id) => DBManager.get('eval_plans', id),
    addPlan: (data) => DBManager.put('eval_plans', {
        planId: uid('plan'), subjectId: data.subjectId, subjectName: data.subjectName, title: data.title, date: data.date,
        domain: data.domain || '', element: data.element || '', standard: data.standard || '', method: data.method || ''
    }),
    deletePlan: (i) => DBManager.deleteEvalPlanCascade(i),
    getScoresByPlanId: (p) => DBManager.query('eval_scores', 'planId', p),
    getScoresByStudentId: (s) => DBManager.query('eval_scores', 'studentId', s),
    saveScores: (l) => DBManager.putMany('eval_scores', l)
};
const CounselingRepo = {
    getByStudentId: async (s) => (await DBManager.query('counseling', 'studentId', s)).sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    add: (s, d, t, c) => DBManager.put('counseling', { logId: uid('log'), studentId: s, date: d, type: t, content: c }),
    delete: (i) => DBManager.delete('counseling', i)
};
