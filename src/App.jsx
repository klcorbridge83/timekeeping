import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase'

const ENTRY_TYPES = ['Clock In', 'Lunch Out', 'Lunch In', 'Clock Out']
const PAY_TYPES = ['Regular', 'Holiday', 'PTO']
const PAY_COLORS = {
  Regular: { bg: '#E6F1FB', color: '#0C447C' },
  Holiday: { bg: '#EAF3DE', color: '#27500A' },
  PTO:     { bg: '#FAEEDA', color: '#633806' },
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmtDT = iso => {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const fmtDate = iso => iso ? new Date(iso).toISOString().split('T')[0] : ''

const toISO = (dateStr, timeStr) =>
  dateStr && timeStr ? new Date(`${dateStr}T${timeStr}`).toISOString() : null

const weekStart = dateStr => {
  const d = new Date(dateStr + 'T00:00:00')
  const diff = d.getDay() === 0 ? -6 : 1 - d.getDay()
  d.setDate(d.getDate() + diff)
  return d.toISOString().split('T')[0]
}

const semiMonthPeriods = (year, month) => {
  const m = String(month).padStart(2, '0')
  return [
    { label: `${year}-${m} 1–15`,    start: `${year}-${m}-01`, end: `${year}-${m}-15` },
    { label: `${year}-${m} 16–EOM`,  start: `${year}-${m}-16`, end: `${year}-${m}-${new Date(year, month, 0).getDate()}` },
  ]
}

// ── Styles ───────────────────────────────────────────────────────────────────

const S = {
  wrap:       { fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", padding: '1rem', maxWidth: 740, margin: '0 auto' },
  card:       { background: '#fff', border: '0.5px solid #e0dfd8', borderRadius: 12, padding: '1rem 1.25rem', marginBottom: 12 },
  input:      { width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: '0.5px solid #ccc', fontSize: 14, background: '#fff', color: '#1a1a18' },
  btn:        { background: '#fff', border: '0.5px solid #ccc', borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontSize: 14, color: '#1a1a18' },
  btnPrimary: { background: '#185FA5', border: 'none', borderRadius: 8, padding: '10px 22px', cursor: 'pointer', fontSize: 14, color: '#fff', fontWeight: 500 },
  btnDanger:  { background: '#FCEBEB', border: '0.5px solid #F7C1C1', borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontSize: 13, color: '#A32D2D' },
  btnSmall:   { background: '#f5f5f4', border: '0.5px solid #e0dfd8', borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontSize: 13, color: '#1a1a18' },
  label:      { fontSize: 13, color: '#666', marginBottom: 4, display: 'block' },
  tab:        a => ({ padding: '8px 14px', cursor: 'pointer', border: 'none', borderBottom: a ? '2px solid #185FA5' : '2px solid transparent', fontSize: 13, fontWeight: a ? 500 : 400, color: a ? '#185FA5' : '#888', background: 'none' }),
  badge:      c => ({ display: 'inline-block', fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 500, background: c === 'in' ? '#EAF3DE' : c === 'lunch' ? '#FAEEDA' : '#f1efea', color: c === 'in' ? '#3B6D11' : c === 'lunch' ? '#854F0B' : '#5F5E5A' }),
  payBadge:   pt => ({ display: 'inline-block', fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 500, background: PAY_COLORS[pt]?.bg || '#f1efea', color: PAY_COLORS[pt]?.color || '#5F5E5A' }),
  metric:     { background: '#f5f5f4', borderRadius: 8, padding: '1rem', textAlign: 'center' },
  otBanner:   { background: '#FCEBEB', border: '0.5px solid #F09595', borderRadius: 8, padding: '10px 14px', marginBottom: 12 },
  toast:      ok => ({ padding: '10px 16px', borderRadius: 8, background: ok ? '#EAF3DE' : '#FCEBEB', color: ok ? '#3B6D11' : '#A32D2D', fontSize: 14, marginBottom: 12 }),
}

// ── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [view, setView]               = useState('home')
  const [employees, setEmployees]     = useState([])
  const [entries, setEntries]         = useState([])
  const [loading, setLoading]         = useState(true)
  const [currentEmp, setCurrentEmp]   = useState(null)
  const [pinInput, setPinInput]       = useState('')
  const [pinError, setPinError]       = useState('')
  const [adminPw, setAdminPw]         = useState('')
  const [adminError, setAdminError]   = useState('')
  const [adminTab, setAdminTab]       = useState('dashboard')
  const [newEmp, setNewEmp]           = useState({ name: '', pin: '', dept: '' })
  const [empError, setEmpError]       = useState('')
  const [editEntry, setEditEntry]     = useState(null)
  const [toast, setToast]             = useState(null)
  const [adminPwStored, setAdminPwStored] = useState('admin1234')
  const [pwChange, setPwChange]       = useState({ current: '', newPw: '', confirm: '' })
  const [pwError, setPwError]         = useState('')
  const [pwSuccess, setPwSuccess]     = useState('')
  const [useCustom, setUseCustom]     = useState(false)
  const [customRange, setCustomRange] = useState({ start: '', end: '' })

  const nowYear = new Date().getFullYear()
  const nowMonth = new Date().getMonth() + 1
  const allPeriods = []
  for (let m = 1; m <= 12; m++) allPeriods.push(...semiMonthPeriods(nowYear, m))
  const todayStr = fmtDate(new Date().toISOString())
  const defaultPeriod = allPeriods.find(p => p.start <= todayStr && p.end >= todayStr) || allPeriods[0]
  const [reportPeriod, setReportPeriod] = useState(defaultPeriod)

  // ── Load data ──────────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [{ data: emps }, { data: ents }, { data: settings }] = await Promise.all([
      supabase.from('employees').select('*').order('name'),
      supabase.from('time_entries').select('*').order('time', { ascending: false }),
      supabase.from('app_settings').select('*'),
    ])
    if (emps) setEmployees(emps)
    if (ents) setEntries(ents)
    if (settings) {
      const pw = settings.find(s => s.key === 'admin_password')
      if (pw) setAdminPwStored(pw.value)
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  // ── Toast helper ───────────────────────────────────────────────────────────

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  // ── Status helpers ─────────────────────────────────────────────────────────

  const getStatus = empId => {
    const punches = entries
      .filter(e => e.emp_id === empId && !e.pay_type)
      .sort((a, b) => new Date(b.time) - new Date(a.time))
    if (!punches.length) return 'out'
    const last = punches[0].type
    if (last === 'Clock In' || last === 'Lunch In') return 'in'
    if (last === 'Lunch Out') return 'lunch'
    return 'out'
  }

  const computeHours = (empId, start, end) => {
    const s = new Date(start + 'T00:00:00')
    const e = new Date(end + 'T23:59:59')

    const manualEntries = entries.filter(en => en.emp_id === empId && en.pay_type && new Date(en.time) >= s && new Date(en.time) <= e)
    let manualReg = 0, manualHol = 0, manualPTO = 0
    manualEntries.forEach(en => {
      const ms = en.duration_ms || 0
      if (en.pay_type === 'Holiday') manualHol += ms
      else if (en.pay_type === 'PTO') manualPTO += ms
      else manualReg += ms
    })

    const punches = entries
      .filter(en => en.emp_id === empId && !en.pay_type && new Date(en.time) >= s && new Date(en.time) <= e)
      .sort((a, b) => new Date(a.time) - new Date(b.time))

    let total = 0, lunchMs = 0, clockIn = null, lunchOut = null
    for (const en of punches) {
      if (en.type === 'Clock In')  clockIn  = new Date(en.time)
      if (en.type === 'Lunch Out') lunchOut = new Date(en.time)
      if (en.type === 'Lunch In'  && lunchOut) { lunchMs += new Date(en.time) - lunchOut; lunchOut = null }
      if (en.type === 'Clock Out' && clockIn)  { total   += new Date(en.time) - clockIn;  clockIn  = null }
    }
    const clockWork = Math.max(0, total - lunchMs)
    return { regular: clockWork + manualReg, holiday: manualHol, pto: manualPTO, total: clockWork + manualReg + manualHol + manualPTO }
  }

  const getWeeklyHours = empId => {
    const ws = weekStart(todayStr)
    const we = new Date(ws + 'T00:00:00')
    we.setDate(we.getDate() + 6)
    const { regular } = computeHours(empId, ws, fmtDate(we.toISOString()))
    return regular / 3600000
  }

  // ── Employee actions ───────────────────────────────────────────────────────

  const handlePinLogin = () => {
    const emp = employees.find(e => e.pin === pinInput)
    if (!emp) { setPinError('No employee found with that PIN.'); return }
    setCurrentEmp(emp); setPinInput(''); setPinError(''); setView('employee')
  }

  const handleClock = async type => {
    const { error } = await supabase.from('time_entries').insert({ emp_id: currentEmp.id, type, time: new Date().toISOString() })
    if (error) { showToast('Error saving entry', false); return }
    await loadAll()
    showToast(`${type} recorded for ${currentEmp.name}`)
  }

  // ── Admin — employees ──────────────────────────────────────────────────────

  const addEmployee = async () => {
    if (!newEmp.name.trim())               { setEmpError('Name is required.'); return }
    if (!newEmp.pin.trim() || newEmp.pin.length < 4) { setEmpError('PIN must be at least 4 digits.'); return }
    if (employees.find(e => e.pin === newEmp.pin))   { setEmpError('PIN already in use.'); return }
    const { error } = await supabase.from('employees').insert({ name: newEmp.name.trim(), pin: newEmp.pin.trim(), dept: newEmp.dept.trim() })
    if (error) { setEmpError('Error adding employee.'); return }
    setNewEmp({ name: '', pin: '', dept: '' }); setEmpError('')
    await loadAll(); showToast(`${newEmp.name.trim()} added`)
  }

  const removeEmployee = async id => {
    await supabase.from('employees').delete().eq('id', id)
    await loadAll(); showToast('Employee removed', false)
  }

  // ── Admin — entries ────────────────────────────────────────────────────────

  const saveEditEntry = async () => {
    const time = toISO(editEntry.date, editEntry.timeVal)
    if (!time) return

    if (editEntry.payType) {
      const duration_ms = parseFloat(editEntry.hours || 0) * 3600000
      const payload = { emp_id: editEntry.empId, pay_type: editEntry.payType, duration_ms, note: editEntry.note || '', time }
      if (editEntry.isNew) await supabase.from('time_entries').insert(payload)
      else await supabase.from('time_entries').update({ pay_type: editEntry.payType, duration_ms, note: editEntry.note || '', time }).eq('id', editEntry.id)
    } else {
      const payload = { emp_id: editEntry.empId, type: editEntry.type, time }
      if (editEntry.isNew) await supabase.from('time_entries').insert(payload)
      else await supabase.from('time_entries').update({ type: editEntry.type, time }).eq('id', editEntry.id)
    }
    setEditEntry(null); await loadAll(); showToast(editEntry.isNew ? 'Entry added' : 'Entry updated')
  }

  const deleteEntry = async id => {
    await supabase.from('time_entries').delete().eq('id', id)
    await loadAll(); showToast('Entry deleted', false)
  }

  // ── Admin — password ───────────────────────────────────────────────────────

  const handlePwChange = async () => {
    setPwError(''); setPwSuccess('')
    if (pwChange.current !== adminPwStored)  { setPwError('Current password is incorrect.'); return }
    if (pwChange.newPw.length < 6)           { setPwError('New password must be at least 6 characters.'); return }
    if (pwChange.newPw !== pwChange.confirm) { setPwError('New passwords do not match.'); return }
    await supabase.from('app_settings').upsert({ key: 'admin_password', value: pwChange.newPw })
    setAdminPwStored(pwChange.newPw)
    setPwChange({ current: '', newPw: '', confirm: '' })
    setPwSuccess('Password updated successfully.')
  }

  // ── Derived report data ────────────────────────────────────────────────────

  const reportRange = useCustom ? customRange : reportPeriod
  const reportData = employees.map(emp => {
    const { regular, holiday, pto, total } = computeHours(emp.id, reportRange.start || '2000-01-01', reportRange.end || '2100-01-01')
    return { ...emp, regular: regular / 3600000, holiday: holiday / 3600000, pto: pto / 3600000, total: total / 3600000, weeklyHrs: getWeeklyHours(emp.id) }
  }).sort((a, b) => b.total - a.total)

  const totals = reportData.reduce((acc, r) => ({ regular: acc.regular + r.regular, holiday: acc.holiday + r.holiday, pto: acc.pto + r.pto, total: acc.total + r.total }), { regular: 0, holiday: 0, pto: 0, total: 0 })

  const otEmployees = employees.filter(e => getWeeklyHours(e.id) > 40)
  const clocked     = employees.filter(e => ['in', 'lunch'].includes(getStatus(e.id)))

  // ── Employee actions map ───────────────────────────────────────────────────

  const status  = currentEmp ? getStatus(currentEmp.id) : null
  const actions = { out: ['Clock In'], in: ['Lunch Out', 'Clock Out'], lunch: ['Lunch In'] }[status] || []

  // ── Loading screen ─────────────────────────────────────────────────────────

  if (loading) return (
    <div style={{ ...S.wrap, textAlign: 'center', paddingTop: '3rem' }}>
      <i className="ti ti-clock" style={{ fontSize: 40, color: '#185FA5' }} />
      <p style={{ marginTop: 16, color: '#666' }}>Loading timekeeping data…</p>
    </div>
  )

  // ── Home ───────────────────────────────────────────────────────────────────

  if (view === 'home') return (
    <div style={S.wrap}>
      <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: 4 }}>Timekeeping</h1>
      <p style={{ color: '#666', marginBottom: 28, fontSize: 14 }}>Clock in/out or access admin tools</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        {[['ti-user-check', 'Employee', 'Clock in / out', 'pin'], ['ti-settings', 'Admin', 'Manage & reports', 'admin-login']].map(([icon, title, sub, v]) => (
          <div key={v} style={{ ...S.card, cursor: 'pointer', textAlign: 'center', padding: '2rem' }} onClick={() => setView(v)}>
            <i className={`ti ${icon}`} style={{ fontSize: 32, color: '#185FA5' }} />
            <p style={{ fontWeight: 500, marginTop: 12, marginBottom: 4 }}>{title}</p>
            <p style={{ fontSize: 13, color: '#666' }}>{sub}</p>
          </div>
        ))}
      </div>
      {toast && <div style={S.toast(toast.ok)}>{toast.msg}</div>}
    </div>
  )

  // ── PIN login ──────────────────────────────────────────────────────────────

  if (view === 'pin') return (
    <div style={S.wrap}>
      <button style={{ ...S.btnSmall, marginBottom: 20 }} onClick={() => { setView('home'); setPinInput(''); setPinError('') }}><i className="ti ti-arrow-left" /> Back</button>
      <h2 style={{ fontSize: 20, fontWeight: 500, marginBottom: 20 }}>Enter your PIN</h2>
      <input style={{ ...S.input, fontSize: 24, letterSpacing: 8, maxWidth: 200, marginBottom: 12 }} type="password" inputMode="numeric" maxLength={8} value={pinInput} onChange={e => { setPinInput(e.target.value); setPinError('') }} placeholder="••••" onKeyDown={e => e.key === 'Enter' && handlePinLogin()} />
      {pinError && <p style={{ color: '#A32D2D', fontSize: 13, marginBottom: 12 }}>{pinError}</p>}
      <button style={S.btnPrimary} onClick={handlePinLogin}>Continue</button>
    </div>
  )

  // ── Employee dashboard ─────────────────────────────────────────────────────

  if (view === 'employee' && currentEmp) {
    const st = getStatus(currentEmp.id)
    const wh = getWeeklyHours(currentEmp.id)
    const recent = entries.filter(e => e.emp_id === currentEmp.id).slice(0, 10)
    return (
      <div style={S.wrap}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <p style={{ fontWeight: 500, fontSize: 17 }}>{currentEmp.name}</p>
            <span style={S.badge(st)}>{st === 'in' ? 'Clocked in' : st === 'lunch' ? 'On lunch' : 'Clocked out'}</span>
          </div>
          <button style={S.btnSmall} onClick={() => { setCurrentEmp(null); setView('home') }}>Sign out</button>
        </div>
        {wh > 40 && (
          <div style={S.otBanner}>
            <i className="ti ti-alert-triangle" style={{ color: '#A32D2D', marginRight: 8 }} />
            <span style={{ fontSize: 13, color: '#A32D2D', fontWeight: 500 }}>Overtime — {wh.toFixed(1)} hrs this week (over 40)</span>
          </div>
        )}
        {toast && <div style={S.toast(toast.ok)}>{toast.msg}</div>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
          {actions.map(a => (
            <button key={a} style={S.btnPrimary} onClick={() => handleClock(a)}>
              <i className={`ti ${a.includes('In') ? 'ti-clock' : 'ti-clock-off'}`} style={{ marginRight: 6 }} />{a}
            </button>
          ))}
          {!actions.length && <p style={{ color: '#666', fontSize: 14 }}>No actions available.</p>}
        </div>
        <p style={{ fontWeight: 500, marginBottom: 10 }}>Recent entries</p>
        {!recent.length && <p style={{ color: '#666', fontSize: 14 }}>No entries yet.</p>}
        {recent.map(en => (
          <div key={en.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '0.5px solid #e0dfd8', fontSize: 14, alignItems: 'center' }}>
            <span style={{ color: '#666' }}>{en.pay_type || en.type}</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {en.pay_type && <span style={S.payBadge(en.pay_type)}>{(en.duration_ms / 3600000).toFixed(1)} hrs</span>}
              <span style={{ fontSize: 13 }}>{fmtDT(en.time)}</span>
            </div>
          </div>
        ))}
      </div>
    )
  }

  // ── Admin login ────────────────────────────────────────────────────────────

  if (view === 'admin-login') return (
    <div style={S.wrap}>
      <button style={{ ...S.btnSmall, marginBottom: 20 }} onClick={() => { setView('home'); setAdminPw(''); setAdminError('') }}><i className="ti ti-arrow-left" /> Back</button>
      <h2 style={{ fontSize: 20, fontWeight: 500, marginBottom: 20 }}>Admin login</h2>
      <label style={S.label}>Password</label>
      <input style={{ ...S.input, maxWidth: 260, marginBottom: 12 }} type="password" value={adminPw} onChange={e => { setAdminPw(e.target.value); setAdminError('') }} onKeyDown={e => { if (e.key === 'Enter') { if (adminPw === adminPwStored) { setView('admin'); setAdminPw('') } else setAdminError('Incorrect password.') } }} placeholder="Enter admin password" />
      {adminError && <p style={{ color: '#A32D2D', fontSize: 13, marginBottom: 12 }}>{adminError}</p>}
      <button style={S.btnPrimary} onClick={() => { if (adminPw === adminPwStored) { setView('admin'); setAdminPw('') } else setAdminError('Incorrect password.') }}>Login</button>
    </div>
  )

  // ── Admin panel ────────────────────────────────────────────────────────────

  if (view === 'admin') return (
    <div style={S.wrap}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h2 style={{ fontSize: 20, fontWeight: 500 }}>Admin</h2>
        <button style={S.btnSmall} onClick={() => setView('home')}>Sign out</button>
      </div>

      {otEmployees.length > 0 && (
        <div style={S.otBanner}>
          <p style={{ fontSize: 13, fontWeight: 500, color: '#A32D2D', marginBottom: 4 }}><i className="ti ti-alert-triangle" style={{ marginRight: 6 }} />Overtime this week</p>
          {otEmployees.map(e => <p key={e.id} style={{ fontSize: 13, color: '#791F1F' }}>{e.name} — {getWeeklyHours(e.id).toFixed(1)} hrs</p>)}
        </div>
      )}

      <div style={{ display: 'flex', gap: 0, borderBottom: '0.5px solid #e0dfd8', marginBottom: 20, flexWrap: 'wrap' }}>
        {['dashboard', 'employees', 'entries', 'reports', 'password'].map(t => (
          <button key={t} style={S.tab(adminTab === t)} onClick={() => { setAdminTab(t); setPwError(''); setPwSuccess('') }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* ── Dashboard ── */}
      {adminTab === 'dashboard' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 20 }}>
            {[['Total employees', employees.length], ['Clocked in', employees.filter(e => getStatus(e.id) === 'in').length], ['On lunch', employees.filter(e => getStatus(e.id) === 'lunch').length]].map(([label, val]) => (
              <div key={label} style={S.metric}><p style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>{label}</p><p style={{ fontSize: 24, fontWeight: 500 }}>{val}</p></div>
            ))}
          </div>
          <p style={{ fontWeight: 500, marginBottom: 10 }}>Currently active</p>
          {!clocked.length && <p style={{ color: '#666', fontSize: 14 }}>No one is currently clocked in.</p>}
          {clocked.map(emp => (
            <div key={emp.id} style={{ ...S.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p style={{ fontWeight: 500, fontSize: 14 }}>{emp.name}</p>
                {emp.dept && <p style={{ fontSize: 12, color: '#666' }}>{emp.dept}</p>}
                <p style={{ fontSize: 12, color: getWeeklyHours(emp.id) > 40 ? '#A32D2D' : '#666' }}>{getWeeklyHours(emp.id).toFixed(1)} hrs this week{getWeeklyHours(emp.id) > 40 ? ' ⚠ OT' : ''}</p>
              </div>
              <span style={S.badge(getStatus(emp.id))}>{getStatus(emp.id) === 'in' ? 'Clocked in' : 'On lunch'}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Employees ── */}
      {adminTab === 'employees' && (
        <div>
          <p style={{ fontWeight: 500, marginBottom: 12 }}>Add employee</p>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 8, marginBottom: 8, alignItems: 'end' }}>
            <div><label style={S.label}>Name</label><input style={S.input} value={newEmp.name} onChange={e => setNewEmp(p => ({ ...p, name: e.target.value }))} placeholder="Full name" /></div>
            <div><label style={S.label}>PIN</label><input style={S.input} value={newEmp.pin} onChange={e => setNewEmp(p => ({ ...p, pin: e.target.value.replace(/\D/g, '') }))} placeholder="4+ digits" maxLength={8} /></div>
            <div><label style={S.label}>Department</label><input style={S.input} value={newEmp.dept} onChange={e => setNewEmp(p => ({ ...p, dept: e.target.value }))} placeholder="Optional" /></div>
            <button style={{ ...S.btnPrimary, alignSelf: 'flex-end' }} onClick={addEmployee}>Add</button>
          </div>
          {empError && <p style={{ color: '#A32D2D', fontSize: 13, marginBottom: 8 }}>{empError}</p>}
          {toast && <div style={S.toast(toast.ok)}>{toast.msg}</div>}
          <p style={{ fontWeight: 500, marginTop: 20, marginBottom: 10 }}>All employees ({employees.length})</p>
          {!employees.length && <p style={{ color: '#666', fontSize: 14 }}>No employees yet.</p>}
          {employees.map(emp => (
            <div key={emp.id} style={{ ...S.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p style={{ fontWeight: 500, fontSize: 14 }}>{emp.name}</p>
                <p style={{ fontSize: 12, color: '#666' }}>PIN: {emp.pin}{emp.dept ? ` · ${emp.dept}` : ''}</p>
                {getWeeklyHours(emp.id) > 40 && <p style={{ fontSize: 12, color: '#A32D2D' }}>{getWeeklyHours(emp.id).toFixed(1)} hrs this week ⚠</p>}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={S.badge(getStatus(emp.id))}>{getStatus(emp.id) === 'in' ? 'In' : getStatus(emp.id) === 'lunch' ? 'Lunch' : 'Out'}</span>
                <button style={S.btnDanger} onClick={() => removeEmployee(emp.id)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Entries ── */}
      {adminTab === 'entries' && (
        <div>
          {editEntry && (
            <div style={{ ...S.card, background: '#EEF5FC', border: '0.5px solid #B5D4F4', marginBottom: 16 }}>
              <p style={{ fontWeight: 500, marginBottom: 12, color: '#185FA5' }}>{editEntry.isNew ? 'Add entry' : 'Edit entry'} — {employees.find(e => e.id === editEntry.empId)?.name}</p>
              <div style={{ marginBottom: 10 }}>
                <label style={S.label}>Entry category</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button style={{ ...S.btnSmall, background: !editEntry.payType ? '#185FA5' : undefined, color: !editEntry.payType ? '#fff' : undefined, border: !editEntry.payType ? 'none' : undefined }} onClick={() => setEditEntry(p => ({ ...p, payType: null }))}>Clock punch</button>
                  {PAY_TYPES.map(pt => (
                    <button key={pt} style={{ ...S.btnSmall, background: editEntry.payType === pt ? PAY_COLORS[pt].bg : undefined, color: editEntry.payType === pt ? PAY_COLORS[pt].color : undefined }} onClick={() => setEditEntry(p => ({ ...p, payType: pt }))}>{pt}</button>
                  ))}
                </div>
              </div>
              {!editEntry.payType ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                  <div><label style={S.label}>Type</label>
                    <select style={S.input} value={editEntry.type || 'Clock In'} onChange={e => setEditEntry(p => ({ ...p, type: e.target.value }))}>
                      {ENTRY_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div><label style={S.label}>Date</label><input type="date" style={S.input} value={editEntry.date} onChange={e => setEditEntry(p => ({ ...p, date: e.target.value }))} /></div>
                  <div><label style={S.label}>Time</label><input type="time" style={S.input} value={editEntry.timeVal} onChange={e => setEditEntry(p => ({ ...p, timeVal: e.target.value }))} /></div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                  <div><label style={S.label}>Date</label><input type="date" style={S.input} value={editEntry.date} onChange={e => setEditEntry(p => ({ ...p, date: e.target.value }))} /></div>
                  <div><label style={S.label}>Hours</label><input type="number" min="0" max="24" step="0.25" style={S.input} value={editEntry.hours || ''} onChange={e => setEditEntry(p => ({ ...p, hours: e.target.value }))} placeholder="e.g. 8" /></div>
                  <div><label style={S.label}>Start time</label><input type="time" style={S.input} value={editEntry.timeVal} onChange={e => setEditEntry(p => ({ ...p, timeVal: e.target.value }))} /></div>
                  <div><label style={S.label}>Note</label><input style={S.input} value={editEntry.note || ''} onChange={e => setEditEntry(p => ({ ...p, note: e.target.value }))} placeholder="e.g. Memorial Day" /></div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={S.btnPrimary} onClick={saveEditEntry}>Save</button>
                <button style={S.btn} onClick={() => setEditEntry(null)}>Cancel</button>
              </div>
            </div>
          )}
          {employees.map(emp => {
            const empEntries = entries.filter(e => e.emp_id === emp.id).sort((a, b) => new Date(b.time) - new Date(a.time))
            return (
              <div key={emp.id} style={{ ...S.card, marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div>
                    <p style={{ fontWeight: 500 }}>{emp.name}</p>
                    {emp.dept && <p style={{ fontSize: 12, color: '#666' }}>{emp.dept}</p>}
                  </div>
                  <button style={S.btnSmall} onClick={() => setEditEntry({ id: null, empId: emp.id, type: 'Clock In', payType: null, date: fmtDate(new Date().toISOString()), timeVal: '09:00', hours: '', note: '', isNew: true })}>
                    <i className="ti ti-plus" /> Add entry
                  </button>
                </div>
                {!empEntries.length && <p style={{ color: '#666', fontSize: 13 }}>No entries.</p>}
                {empEntries.slice(0, 30).map(en => (
                  <div key={en.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '0.5px solid #e0dfd8', fontSize: 13, gap: 8 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
                      {en.pay_type ? <span style={S.payBadge(en.pay_type)}>{en.pay_type}</span> : <span style={{ color: '#666', minWidth: 80 }}>{en.type}</span>}
                      {en.pay_type && <span>{(en.duration_ms / 3600000).toFixed(2)} hrs</span>}
                      {en.note && <span style={{ color: '#aaa', fontSize: 12 }}>{en.note}</span>}
                    </div>
                    <span style={{ color: '#888', whiteSpace: 'nowrap' }}>{fmtDT(en.time)}</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button style={S.btnSmall} onClick={() => setEditEntry({ ...en, empId: en.emp_id, payType: en.pay_type, date: fmtDate(en.time), timeVal: new Date(en.time).toTimeString().slice(0, 5), hours: en.duration_ms ? (en.duration_ms / 3600000).toFixed(2) : '', isNew: false })}>Edit</button>
                      <button style={S.btnDanger} onClick={() => deleteEntry(en.id)}>Del</button>
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Reports ── */}
      {adminTab === 'reports' && (
        <div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 20 }}>
            <div>
              <label style={S.label}>Semi-monthly period</label>
              <select style={S.input} value={reportPeriod.label} disabled={useCustom} onChange={e => { const p = allPeriods.find(x => x.label === e.target.value); if (p) { setReportPeriod(p); setUseCustom(false) } }}>
                {allPeriods.map(p => <option key={p.label}>{p.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" id="custom" checked={useCustom} onChange={e => setUseCustom(e.target.checked)} />
              <label htmlFor="custom" style={{ fontSize: 13, color: '#666' }}>Custom range</label>
            </div>
            {useCustom && <>
              <div><label style={S.label}>From</label><input type="date" style={S.input} value={customRange.start} onChange={e => setCustomRange(p => ({ ...p, start: e.target.value }))} /></div>
              <div><label style={S.label}>To</label><input type="date" style={S.input} value={customRange.end} onChange={e => setCustomRange(p => ({ ...p, end: e.target.value }))} /></div>
            </>}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <p style={{ fontWeight: 500 }}>Hours — {useCustom ? `${customRange.start} to ${customRange.end}` : reportPeriod.label}</p>
            <button style={S.btnSmall} onClick={() => {
              const rows = [['Name', 'Department', 'Regular Hrs', 'Holiday Hrs', 'PTO Hrs', 'Total Hrs', 'Weekly OT?']]
              reportData.forEach(r => rows.push([r.name, r.dept || '', r.regular.toFixed(2), r.holiday.toFixed(2), r.pto.toFixed(2), r.total.toFixed(2), r.weeklyHrs > 40 ? 'YES' : '']))
              const csv = rows.map(r => r.join(',')).join('\n')
              const a = document.createElement('a'); a.href = 'data:text/csv,' + encodeURIComponent(csv); a.download = 'timereport.csv'; a.click()
            }}><i className="ti ti-download" /> Export CSV</button>
          </div>
          <div style={{ ...S.card, background: '#f5f5f4', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 8, fontSize: 13, fontWeight: 500 }}>
            <span>Totals</span>
            <span style={{ textAlign: 'right', color: PAY_COLORS.Regular.color }}>Reg: {totals.regular.toFixed(2)}h</span>
            <span style={{ textAlign: 'right', color: PAY_COLORS.Holiday.color }}>Hol: {totals.holiday.toFixed(2)}h</span>
            <span style={{ textAlign: 'right', color: PAY_COLORS.PTO.color }}>PTO: {totals.pto.toFixed(2)}h</span>
            <span style={{ textAlign: 'right' }}>Total: {totals.total.toFixed(2)}h</span>
          </div>
          {reportData.map(emp => {
            const maxH = Math.max(...reportData.map(r => r.total), 1)
            return (
              <div key={emp.id} style={S.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 4 }}>
                  <div>
                    <span style={{ fontWeight: 500, fontSize: 14 }}>{emp.name}</span>
                    {emp.dept && <span style={{ fontSize: 12, color: '#666', marginLeft: 8 }}>{emp.dept}</span>}
                    {emp.weeklyHrs > 40 && <span style={{ fontSize: 12, color: '#A32D2D', marginLeft: 8 }}>⚠ {emp.weeklyHrs.toFixed(1)} hrs this week</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 13 }}>
                    {emp.regular > 0 && <span style={{ color: PAY_COLORS.Regular.color }}>Reg {emp.regular.toFixed(2)}</span>}
                    {emp.holiday > 0 && <span style={{ color: PAY_COLORS.Holiday.color }}>Hol {emp.holiday.toFixed(2)}</span>}
                    {emp.pto > 0 && <span style={{ color: PAY_COLORS.PTO.color }}>PTO {emp.pto.toFixed(2)}</span>}
                    <span style={{ fontWeight: 500 }}>{emp.total.toFixed(2)} hrs</span>
                  </div>
                </div>
                <div style={{ height: 6, background: '#e8e8e4', borderRadius: 4 }}>
                  <div style={{ height: 6, width: `${(emp.total / maxH) * 100}%`, background: '#185FA5', borderRadius: 4 }} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Password ── */}
      {adminTab === 'password' && (
        <div style={{ maxWidth: 360 }}>
          <p style={{ fontWeight: 500, marginBottom: 16 }}>Change admin password</p>
          {[['Current password', 'current', 'Current password'], ['New password', 'newPw', 'At least 6 characters'], ['Confirm new password', 'confirm', 'Repeat new password']].map(([label, key, ph]) => (
            <div key={key} style={{ marginBottom: 12 }}>
              <label style={S.label}>{label}</label>
              <input type="password" style={S.input} value={pwChange[key]} onChange={e => { setPwChange(p => ({ ...p, [key]: e.target.value })); setPwError(''); setPwSuccess('') }} placeholder={ph} />
            </div>
          ))}
          {pwError   && <p style={{ color: '#A32D2D', fontSize: 13, marginBottom: 10 }}>{pwError}</p>}
          {pwSuccess && <p style={{ color: '#3B6D11', fontSize: 13, marginBottom: 10 }}>{pwSuccess}</p>}
          <button style={S.btnPrimary} onClick={handlePwChange}>Update password</button>
        </div>
      )}
    </div>
  )

  return null
}
