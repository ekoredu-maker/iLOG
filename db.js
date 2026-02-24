// db.js - v22 (Connection Stability Enhanced)
// Copyright 2026@박주가리교감

const DB_NAME = 'SchoolManagerDB';
const DB_VERSION = 20; 
const STORE_NAMES = ['settings', 'students', 'attendance', 'subjects', 'timetable_weekly', 'tasks', 'counseling', 'experiential', 'eval_plans', 'eval_scores', 'school_events', 'annual_schedule', 'incidents', 'custom_links'];

const DBManager = {
    db: null,
    
    getTodayStr: function() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }); },
    
    // [핵심수정] DB 오픈 프로세스 안정화
    open: function() {
        return new Promise((resolve, reject) => {
            // 이미 열려있고 유효한지 체크
            if (this.db) {
                try {
                    // 간단한 트랜잭션 시도로 연결 유효성 검사
                    this.db.transaction(['settings'], 'readonly');
                    resolve(this.db);
                    return;
                } catch(e) {
                    this.db = null; // 연결이 죽었다면 초기화
                }
            }
            
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const tx = request.transaction;
                STORE_NAMES.forEach(store => {
                    let objStore;
                    if (!db.objectStoreNames.contains(store)) {
                        let kp = 'id';
                        if(store === 'students') kp = 'studentId';
                        else if(store === 'attendance') kp = 'attendanceId';
                        else if(store === 'subjects') kp = 'subjectId';
                        else if(store === 'annual_schedule') kp = 'date';
                        else if(store === 'school_events') kp = 'eventId';
                        else if(store === 'incidents') kp = 'incidentId';
                        else if(store === 'tasks') kp = 'taskId';
                        else if(store === 'counseling') kp = 'logId';
                        else if(store === 'experiential') kp = 'expId';
                        else if(store === 'eval_plans') kp = 'planId';
                        else if(store === 'eval_scores') kp = 'scoreId';
                        else if(store === 'custom_links') kp = 'linkId';
                        objStore = db.createObjectStore(store, { keyPath: kp });
                    } else {
                        objStore = tx.objectStore(store);
                    }
                    try {
                        if(store === 'attendance') {
                            if(!objStore.indexNames.contains('date')) objStore.createIndex('date', 'date', { unique: false });
                            if(!objStore.indexNames.contains('studentId')) objStore.createIndex('studentId', 'studentId', { unique: false });
                        }
                        if(store === 'eval_scores') {
                            if(!objStore.indexNames.contains('planId')) objStore.createIndex('planId', 'planId', { unique: false });
                            if(!objStore.indexNames.contains('studentId')) objStore.createIndex('studentId', 'studentId', { unique: false });
                        }
                        if(store === 'counseling' && !objStore.indexNames.contains('studentId')) objStore.createIndex('studentId', 'studentId', { unique: false });
                    } catch(e) {}
                });
            };
            request.onsuccess = (event) => { this.db = event.target.result; resolve(this.db); };
            request.onerror = (event) => { reject(event.target.error); };
        });
    },

    put: async function(storeName, data) { const db=await this.open(); return new Promise((r,j)=>{const tx=db.transaction([storeName],'readwrite'); tx.objectStore(storeName).put(data); tx.oncomplete=()=>r(true); tx.onerror=()=>j(tx.error);}); },
    get: async function(storeName, key) { const db=await this.open(); return new Promise((r,j)=>{const tx=db.transaction([storeName],'readonly'); const req=tx.objectStore(storeName).get(key); req.onsuccess=()=>r(req.result); req.onerror=()=>j(req.error);}); },
    getAll: async function(storeName) { const db=await this.open(); return new Promise((r,j)=>{const tx=db.transaction([storeName],'readonly'); const req=tx.objectStore(storeName).getAll(); req.onsuccess=()=>r(req.result); req.onerror=()=>j(req.error);}); },
    delete: async function(storeName, key) { const db=await this.open(); return new Promise((r,j)=>{const tx=db.transaction([storeName],'readwrite'); tx.objectStore(storeName).delete(key); tx.oncomplete=()=>r(true); tx.onerror=()=>j(tx.error);}); },

    addCustomLink: async function(n, u) { return this.put('custom_links', {linkId: 'lnk_'+Date.now(), name: n, url: u}); },
    getCustomLinks: async function() { return this.getAll('custom_links'); },
    deleteCustomLink: async function(id) { return this.delete('custom_links', id); },

    deleteStudentCascade: async function(id) {
        const db = await this.open();
        return new Promise((r,j) => {
            const tx = db.transaction(['students','attendance','counseling','eval_scores','experiential','incidents'], 'readwrite');
            tx.objectStore('students').delete(id);
            const delIdx = (s) => { if(tx.objectStore(s).indexNames.contains('studentId')) tx.objectStore(s).index('studentId').openCursor(IDBKeyRange.only(id)).onsuccess=(e)=>{const c=e.target.result; if(c){c.delete();c.continue();}}; };
            ['attendance','counseling','eval_scores','experiential','incidents'].forEach(s => delIdx(s));
            tx.oncomplete = () => r(true);
        });
    },
    deleteEvalPlanCascade: async function(id) {
        const db = await this.open();
        return new Promise((r,j) => {
            const tx = db.transaction(['eval_plans','eval_scores'], 'readwrite');
            tx.objectStore('eval_plans').delete(id);
            const s = tx.objectStore('eval_scores');
            if(s.indexNames.contains('planId')) s.index('planId').openCursor(IDBKeyRange.only(id)).onsuccess=(e)=>{const c=e.target.result; if(c){c.delete();c.continue();}};
            tx.oncomplete = () => r(true);
        });
    },
    exportAll: async function() { const db = await this.open(); const data = {}; for (const name of STORE_NAMES) { data[name] = await new Promise(r => { const req = db.transaction([name], 'readonly').objectStore(name).getAll(); req.onsuccess = () => r(req.result); }); } return data; },
    importAll: async function(json) { const db = await this.open(); const tx = db.transaction(STORE_NAMES, 'readwrite'); STORE_NAMES.forEach(name => { if(json[name]) { const store = tx.objectStore(name); store.clear(); json[name].forEach(item => store.put(item)); } }); return new Promise(r => tx.oncomplete = () => r(true)); },
    clearAll: async function() { const db = await this.open(); const tx = db.transaction(STORE_NAMES, 'readwrite'); STORE_NAMES.forEach(name => tx.objectStore(name).clear()); return new Promise(r => tx.oncomplete = () => r(true)); }
};

const SettingsRepo = { get: async ()=>DBManager.get('settings','global')||{}, save: async (d)=>{d.id='global';await DBManager.put('settings',d);}, getPassword: async ()=>(await DBManager.get('settings','security'))?.password||'1234', savePassword: async (p)=>DBManager.put('settings',{id:'security',password:p}) };
const SubjectRepo = { getAll: async ()=>DBManager.getAll('subjects'), add: async (n,s,h)=>DBManager.put('subjects',{subjectId:'sub_'+Date.now(),name:n,shortName:s,hours:Number(h)}), update: async (id,n,s,h)=>DBManager.put('subjects',{subjectId:id,name:n,shortName:s,hours:Number(h)}), delete: async (id)=>DBManager.delete('subjects',id) };
const TimetableRepo = { getWeekly: async ()=>(await DBManager.get('timetable_weekly','weekly'))?.grid, saveWeekly: async (g)=>DBManager.put('timetable_weekly',{id:'weekly',grid:g}) };
const SchoolEventRepo = { getAll: async ()=>DBManager.getAll('school_events'), add: async (s,e,t,h)=>DBManager.put('school_events',{eventId:'evt_'+Date.now(),startDate:s,endDate:e,title:t,isHoliday:h}), saveBatch: async (l)=>{const db=await DBManager.open();const tx=db.transaction(['school_events'],'readwrite');const s=tx.objectStore('school_events');l.forEach(e=>s.put({eventId:'evt_'+Date.now()+'_'+Math.random(),...e}));return new Promise(r=>tx.oncomplete=()=>r(true));}, delete: async (id)=>DBManager.delete('school_events',id) };
const AnnualScheduleRepo = { get: async (d)=>DBManager.get('annual_schedule',d), save: async (d,s)=>DBManager.put('annual_schedule',{date:d,subjects:s}), delete: async (d)=>DBManager.delete('annual_schedule',d), getAll: async ()=>DBManager.getAll('annual_schedule') };
const StudentRepo = { getAll: async ()=>(await DBManager.getAll('students')).sort((a,b)=>a.number-b.number), add: async (d)=>DBManager.put('students',{studentId:'std_'+Date.now(),...d}), delete: async (id)=>DBManager.deleteStudentCascade(id) };
const IncidentRepo = { getAll: async ()=>DBManager.getAll('incidents'), add: async (sid,d,c,m)=>DBManager.put('incidents',{incidentId:'inc_'+Date.now(),studentId:sid,date:d,content:c,measures:m||[]}), delete: async (id)=>DBManager.delete('incidents',id) };
const AttendanceRepo = { 
    getByDate:async(d)=>{const db=await DBManager.open();return new Promise(r=>{const tx=db.transaction(['attendance'],'readonly');const s=tx.objectStore('attendance');if(s.indexNames.contains('date'))s.index('date').getAll(IDBKeyRange.only(d)).onsuccess=(e)=>r(e.target.result);else r([]);});}, 
    getStudentStats:async(sid)=>{const db=await DBManager.open();return new Promise(r=>{const tx=db.transaction(['attendance'],'readonly');const s=tx.objectStore('attendance');const finish=(rs)=>{ rs = rs || []; const byDate = new Map(); for(const rec of rs){ const d = rec.date; if(!d) continue; let agg = byDate.get(d); if(!agg){ agg = { absent:false, late:false, early:false, present:false }; byDate.set(d, agg); } if(rec.status === '결석') agg.absent = true; else if(rec.status === '지각') agg.late = true; else if(rec.status === '조퇴') agg.early = true; else if(rec.status === '출석') agg.present = true; } let absentDays=0, lateDays=0, earlyDays=0, presentDays=0; for(const agg of byDate.values()){ if(agg.absent) absentDays += 1; if(agg.late) lateDays += 1; if(agg.early) earlyDays += 1; if(!agg.absent && (agg.present || agg.late || agg.early)) presentDays += 1; } r({ absent: absentDays, late: lateDays, early: earlyDays, present: presentDays, result: rs }); }; if(s.indexNames.contains('studentId')) s.index('studentId').getAll(IDBKeyRange.only(sid)).onsuccess=(e)=>finish(e.target.result); else finish([]);});},
    saveBatch:async(l)=>{const db=await DBManager.open();return new Promise((r,j)=>{const tx=db.transaction(['attendance'],'readwrite');const s=tx.objectStore('attendance');l.forEach(i=>s.put(i));tx.oncomplete=()=>r(true);tx.onerror=()=>j(tx.error);});}, getAll:async()=>DBManager.getAll('attendance') 
};
const TaskRepo = { getAll:async()=>DBManager.getAll('tasks'), add:async(t,d,c)=>DBManager.put('tasks',{taskId:'task_'+Date.now(),title:t,dueDate:d,category:c,status:'todo'}), updateStatus:async(i,s)=>{const t=await DBManager.get('tasks',i);if(t){t.status=s;await DBManager.put('tasks',t);}}, delete:async(i)=>DBManager.delete('tasks',i) };
const ExperientialRepo = { getAll:async()=>DBManager.getAll('experiential'), add:async(d)=>DBManager.put('experiential',{expId:'exp_'+Date.now(),...d,status:'requested',docs:{app:false,report:false}}), update:async(id, patch)=>{const r=await DBManager.get('experiential',id); if(r){Object.assign(r, patch); await DBManager.put('experiential', r);} }, updateDocs:async(i,d)=>{const r=await DBManager.get('experiential',i);if(r){r.docs=d;await DBManager.put('experiential',r);}}, delete:async(i)=>DBManager.delete('experiential',i) };
const EvaluationRepo = { getPlans:async()=>DBManager.getAll('eval_plans'), addPlan:async(data)=>DBManager.put('eval_plans',{ planId:'plan_'+Date.now(), subjectId: data.subjectId, subjectName: data.subjectName, title: data.title, date: data.date, domain: data.domain || '', element: data.element || '', standard: data.standard || '', method: data.method || '' }), deletePlan:async(i)=>DBManager.deleteEvalPlanCascade(i), getScoresByPlanId:async(p)=>{const db=await DBManager.open();return new Promise(r=>{const tx=db.transaction(['eval_scores'],'readonly');const s=tx.objectStore('eval_scores');if(s.indexNames.contains('planId'))s.index('planId').getAll(IDBKeyRange.only(p)).onsuccess=(e)=>r(e.target.result);else r([]);});}, getScoresByStudentId:async(s)=>{const db=await DBManager.open();return new Promise(r=>{const tx=db.transaction(['eval_scores'],'readonly');const st=tx.objectStore('eval_scores');if(st.indexNames.contains('studentId'))st.index('studentId').getAll(IDBKeyRange.only(s)).onsuccess=(e)=>r(e.target.result);else r([]);});}, saveScores:async(l)=>{const db=await DBManager.open();return new Promise((r,j)=>{const tx=db.transaction(['eval_scores'],'readwrite');const s=tx.objectStore('eval_scores');l.forEach(i=>s.put(i));tx.oncomplete=()=>r(true);tx.onerror=()=>j(tx.error);});} };
const CounselingRepo = { getByStudentId:async(s)=>{const db=await DBManager.open();return new Promise(r=>{const tx=db.transaction(['counseling'],'readonly');const st=tx.objectStore('counseling');if(st.indexNames.contains('studentId'))st.index('studentId').getAll(IDBKeyRange.only(s)).onsuccess=(e)=>{const l=e.target.result||[];r(l.sort((a,b)=>(b.date||'').localeCompare(a.date||'')));};else r([]);});}, add:async(s,d,t,c)=>DBManager.put('counseling',{logId:'log_'+Date.now(),studentId:s,date:d,type:t,content:c}), delete:async(i)=>DBManager.delete('counseling',i) };