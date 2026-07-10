const $ = (selector) => document.querySelector(selector);
const storageKey = 'rota-certa-data-v5';
const clientDataVersion = 'clients-20260710-utf8';
const baseState = {
  clients: [], visits: [], appointments: [], fuelLogs: [], monthlyHistory: [], activeTrip: null,
  settings: { goal: 130000, commissionRate: 7, fuelPrice: 6.70, kmPerLiter: 16 }
};

let state = JSON.parse(localStorage.getItem(storageKey)) || JSON.parse(localStorage.getItem('rota-certa-data-v4')) || JSON.parse(localStorage.getItem('rota-certa-data-v3')) || JSON.parse(localStorage.getItem('rota-certa-data-v2')) || baseState;
state.clients ||= [];
state.visits ||= [];
state.appointments ||= [];
state.fuelLogs ||= [];
state.monthlyHistory ||= [];
state.settings = { ...baseState.settings, ...state.settings };
let routeCity = 'Todos';
let agendaCity = 'Todos';

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
let today = new Date(); today.setHours(0, 0, 0, 0);
const refreshToday = () => { today = new Date(); today.setHours(0, 0, 0, 0); };
const iso = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const dateFrom = (value) => { const [year, month, day] = String(value).split('-').map(Number); return new Date(year, month - 1, day); };
const addDays = (date, days) => { const next = new Date(date); next.setDate(next.getDate() + Number(days)); return iso(next); };
const diffDays = (date) => Math.max(0, Math.floor((today - dateFrom(date)) / 86400000));
const save = () => localStorage.setItem(storageKey, JSON.stringify(state));
const client = (id) => state.clients.find((item) => item.id === id);
const appointment = (id) => state.appointments.find((item) => item.id === id);
const empty = (text) => `<div class="empty">${text}</div>`;
const safe = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const normalizeText = (value = '') => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const monthKey = (date = today) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const keyFromDate = (date) => String(date || '').slice(0, 7);
const previousMonthKey = (key = monthKey()) => { const [year, month] = key.split('-').map(Number); return `${month === 1 ? year - 1 : year}-${String(month === 1 ? 12 : month - 1).padStart(2, '0')}`; };
const nextMonthKey = (key = monthKey()) => { const [year, month] = key.split('-').map(Number); return `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}`; };
const monthDate = (key) => { const [year, month] = key.split('-').map(Number); return new Date(year, month - 1, 1); };
const monthName = (key) => monthDate(key).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

function seedRows() { return Array.isArray(window.clientSeed) ? window.clientSeed : []; }

function mapClient(row) {
  return { ...row, id: `base-${row.code}`, phone: row.phone || '', frequency: Number(row.frequency || 15), active: row.active ?? (!row.inactive && !row.suspended) };
}

function loadSeedClients(rows) {
  const existingBase = new Map(state.clients.filter((item) => String(item.id || '').startsWith('base-')).map((item) => [item.id, item]));
  const manualClients = state.clients.filter((item) => !String(item.id || '').startsWith('base-'));
  const imported = rows.map((row) => {
    const fresh = mapClient(row);
    const old = existingBase.get(fresh.id);
    return old ? { ...fresh, frequency: old.frequency || fresh.frequency, active: old.active ?? fresh.active, phone: old.phone || fresh.phone } : fresh;
  });
  state.clients = [...imported, ...manualClients];
  state.clientDataVersion = clientDataVersion;
  migrateAppointments();
  save();
}

async function importClients() {
  if (state.clientDataVersion === clientDataVersion && state.clients.some((item) => String(item.id || '').startsWith('base-'))) return;
  try {
    const rows = seedRows().length ? seedRows() : await fetch('clients.json?v=20260710-utf8', { cache: 'no-store' }).then((response) => response.json());
    loadSeedClients(rows);
    render();
  } catch { render(); }
}

function lastVisit(item) {
  return state.visits.filter((visit) => visit.clientId === item.id).sort((a, b) => b.date.localeCompare(a.date))[0];
}

function currentMonthVisits() {
  return visitsForMonth(monthKey());
}

function visitsForMonth(key) {
  return state.visits.filter((visit) => keyFromDate(visit.date) === key);
}

function commissionForVisit(visit) {
  return Number(visit.value || 0) * Number(visit.commissionRate ?? state.settings.commissionRate ?? 0) / 100;
}

function paidCommissionInMonth(key) {
  return state.visits.filter((visit) => Number(visit.value) > 0 && keyFromDate(visit.paidAt) === key).reduce((sum, visit) => sum + commissionForVisit(visit), 0);
}

function invoiceDueDate(visit) {
  return visit.dueDate || addDays(dateFrom(visit.date), Number(visit.boletoDays || 30));
}

function summarizeMonth(key, snapshot = {}) {
  const visits = visitsForMonth(key);
  const sales = visits.reduce((sum, visit) => sum + Number(visit.value || 0), 0);
  const logs = state.fuelLogs.filter((log) => keyFromDate(log.date) === key);
  const km = logs.reduce((sum, log) => sum + logDistance(log), 0);
  return {
    month: key,
    goal: Number(snapshot.goal ?? state.settings.goal ?? 0),
    commissionRate: Number(snapshot.commissionRate ?? state.settings.commissionRate ?? 0),
    sales,
    visits: visits.length,
    orders: visits.filter((visit) => Number(visit.value) > 0).length,
    km,
    fuelCost: km / Number(state.settings.kmPerLiter || 16) * Number(state.settings.fuelPrice || 0),
    commissionGenerated: paidCommissionInMonth(key),
    paymentDate: `15/${nextMonthKey(key).split('-').reverse().join('/')}`
  };
}

function migrateFinance() {
  let changed = false;
  state.visits.forEach((visit) => {
    if (Number(visit.value || 0) <= 0) return;
    if (!visit.boletoDays) { visit.boletoDays = 30; changed = true; }
    if (!visit.dueDate) { visit.dueDate = addDays(dateFrom(visit.date), Number(visit.boletoDays)); changed = true; }
    if (visit.paidAt === undefined) { visit.paidAt = ''; changed = true; }
    if (visit.commissionRate === undefined) { visit.commissionRate = Number(state.settings.commissionRate || 7); changed = true; }
  });
  if (!state.activeMonthKey) { state.activeMonthKey = monthKey(); changed = true; }
  if (state.activeMonthKey !== monthKey()) {
    const previous = state.activeMonthKey;
    const existing = state.monthlyHistory.find((item) => item.month === previous);
    if (!existing) state.monthlyHistory.push(summarizeMonth(previous, { goal: state.settings.goal, commissionRate: state.settings.commissionRate }));
    state.activeMonthKey = monthKey();
    changed = true;
  }
  if (changed) save();
}

function appointmentForClient(clientId) {
  return state.appointments.filter((item) => item.clientId === clientId).sort((a, b) => a.date.localeCompare(b.date))[0];
}

function migrateAppointments() {
  const found = new Set(state.appointments.map((item) => item.clientId));
  state.clients.filter((item) => item.active !== false).forEach((item) => {
    if (found.has(item.id)) return;
    const last = lastVisit(item);
    const date = last?.returnDate || (last ? addDays(dateFrom(last.date), item.frequency || 15) : iso(today));
    state.appointments.push({ id: crypto.randomUUID(), clientId: item.id, date, notes: 'Agenda inicial' });
  });
  state.scheduleVersion = 1;
  save();
}

function scheduleClient(clientId, date, notes = '') {
  state.appointments = state.appointments.filter((item) => item.clientId !== clientId);
  state.appointments.push({ id: crypto.randomUUID(), clientId, date, notes });
}

function activeAppointments() {
  return state.appointments.filter((item) => client(item.clientId)?.active !== false).sort((a, b) => a.date.localeCompare(b.date));
}

function appointmentCard(item, actions = true) {
  const currentClient = client(item.clientId);
  if (!currentClient) return '';
  const date = dateFrom(item.date);
  const late = date < today;
  const description = `${safe(currentClient.city || 'Sem cidade')} · ${safe(currentClient.neighborhood || currentClient.street || 'Sem endereço')}`;
  return `<article class="agenda-card ${late ? 'is-late' : ''}">
    <div class="date-box"><strong>${String(date.getDate()).padStart(2, '0')}</strong>${date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</div>
    <div class="card-main"><strong>${safe(currentClient.name)}</strong><small>${description}${item.notes ? ` · ${safe(item.notes)}` : ''}</small></div>
    <div class="appointment-side"><span class="tag ${late ? 'late' : ''}">${late ? 'Atrasado' : 'Agendado'}</span>${actions ? `<div class="appointment-actions"><button class="complete-button" data-complete="${safe(item.id)}">Concluir</button><button class="reschedule-button" data-reschedule="${safe(item.id)}">Reagendar</button></div>` : ''}</div>
  </article>`;
}

function routeCard(currentClient) {
  const next = appointmentForClient(currentClient.id);
  const last = lastVisit(currentClient);
  const days = last ? diffDays(last.date) : '—';
  const late = next && next.date < iso(today);
  return `<article class="client-card route-card"><div class="route-pin">⌖</div><div class="card-main"><strong>${safe(currentClient.name)}</strong><small>${safe(currentClient.street || '')}, ${safe(currentClient.number || '')} · ${safe(currentClient.neighborhood || currentClient.city || '')}</small><small class="route-date">${next ? `Visita: ${dateFrom(next.date).toLocaleDateString('pt-BR')}` : 'Sem visita agendada'}</small></div><div class="days"><strong>${days}</strong><small>dias${late ? ' · atrasado' : ''}</small></div>${next ? `<div class="route-actions"><button class="complete-button" data-complete="${safe(next.id)}">Concluir</button></div>` : ''}</article>`;
}

function clientCard(currentClient) {
  const last = lastVisit(currentClient);
  const next = appointmentForClient(currentClient.id);
  const status = currentClient.active === false ? '<span class="tag inactive">Inativo</span>' : '<span class="tag">Ativo</span>';
  return `<article class="client-card manageable ${currentClient.active === false ? 'is-inactive' : ''}"><div class="date-box"><strong>${safe(currentClient.frequency || 15)}</strong>dias</div><div class="card-main"><strong>${safe(currentClient.name)}</strong><small>${safe(currentClient.city || '')} · ${safe(currentClient.neighborhood || currentClient.street || 'Sem endereço')}${last ? ` · ${diffDays(last.date)} dias sem visita` : ' · sem visitas'}</small>${next ? `<small class="next-visit">Próxima: ${dateFrom(next.date).toLocaleDateString('pt-BR')}</small>` : ''}</div><div class="client-actions">${status}<button data-edit="${safe(currentClient.id)}">Editar</button><button data-toggle="${safe(currentClient.id)}">${currentClient.active === false ? 'Ativar' : 'Inativar'}</button><button class="danger-text" data-remove="${safe(currentClient.id)}">Excluir</button></div></article>`;
}

function bindAppointmentActions() {
  document.querySelectorAll('[data-complete]').forEach((button) => { button.onclick = () => openVisit(button.dataset.complete); });
  document.querySelectorAll('[data-reschedule]').forEach((button) => { button.onclick = () => openReschedule(button.dataset.reschedule); });
}

function render() {
  $('#todayLabel').textContent = today.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const monthVisits = currentMonthVisits();
  const sales = monthVisits.reduce((sum, visit) => sum + Number(visit.value || 0), 0);
  const positive = new Set(monthVisits.filter((visit) => Number(visit.value) > 0).map((visit) => visit.clientId)).size;
  const appointments = activeAppointments();
  const scheduled = appointments.filter((item) => item.date >= iso(today));
  const overdue = appointments.filter((item) => item.date < iso(today));

  $('#monthSales').textContent = money.format(sales);
  $('#monthVisits').textContent = monthVisits.length;
  $('#positiveClients').textContent = positive;
  $('#todayReturns').textContent = appointments.filter((item) => item.date === iso(today)).length;
  const goal = Number(state.settings.goal || 0);
  const percentage = goal ? Math.min(100, sales / goal * 100) : 0;
  $('#goalText').textContent = goal ? `${money.format(sales)} de ${money.format(goal)}` : 'Defina sua meta do mês';
  $('#goalGap').textContent = goal ? (sales >= goal ? 'Meta atingida' : `Faltam ${money.format(goal - sales)} para bater a meta`) : 'Acompanhe sua evolução diária';
  $('#goalProgress').style.width = `${percentage}%`;
  $('#homeAgenda').innerHTML = scheduled.length ? scheduled.slice(0, 4).map((item) => appointmentCard(item, false)).join('') : empty('Nenhuma visita agendada.');
  $('#overdueList').innerHTML = overdue.length ? overdue.slice(0, 6).map((item) => appointmentCard(item, false)).join('') : empty('Nenhum cliente atrasado.');

  const citySales = {};
  monthVisits.forEach((visit) => { const city = client(visit.clientId)?.city || 'Outros'; citySales[city] = (citySales[city] || 0) + Number(visit.value || 0); });
  const maximum = Math.max(...Object.values(citySales), 1);
  $('#cityChart').innerHTML = Object.entries(citySales).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([city, value]) => `<div class="bar-row"><span>${safe(city)}</span><i><b style="width:${value / maximum * 100}%"></b></i><strong>${money.format(value)}</strong></div>`).join('') || '<p class="muted">Registre pedidos para ver o gráfico por cidade.</p>';
  renderAgenda(appointments);
  renderClients();
  renderReports(sales, monthVisits);
  renderRoutes();
  renderHistory();
}

function renderAgenda(appointments = activeAppointments()) {
  const cities = ['Todos', ...new Set(appointments.map((item) => client(item.clientId)?.city || 'Sem cidade').sort())];
  if (!cities.includes(agendaCity)) agendaCity = 'Todos';
  $('#agendaCityFilters').innerHTML = cities.map((city) => `<button class="${city === agendaCity ? 'selected' : ''}" data-agenda-city="${safe(city)}">${safe(city)}</button>`).join('');
  const visible = appointments.filter((item) => agendaCity === 'Todos' || (client(item.clientId)?.city || 'Sem cidade') === agendaCity);
  const grouped = visible.reduce((groups, item) => { const city = client(item.clientId)?.city || 'Sem cidade'; (groups[city] ||= []).push(item); return groups; }, {});
  $('#agendaList').innerHTML = visible.length ? Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([city, items]) => `<section class="agenda-city-group"><h3>${safe(city)}</h3><div class="card-list">${items.map((item) => appointmentCard(item)).join('')}</div></section>`).join('') : empty('Nenhum cliente para esta cidade.');
  document.querySelectorAll('[data-agenda-city]').forEach((button) => { button.onclick = () => { agendaCity = button.dataset.agendaCity; renderAgenda(); }; });
  bindAppointmentActions();
}

function renderClients() {
  const query = normalizeText($('#clientSearch').value);
  const filter = $('#clientStatusFilter').value;
  const visible = state.clients.filter((item) => {
    const matchesText = normalizeText(`${item.name} ${item.city} ${item.neighborhood} ${item.street}`).includes(query);
    const matchesStatus = filter === 'all' || (filter === 'active' ? item.active !== false : item.active === false);
    return matchesText && matchesStatus;
  });
  $('#clientsList').innerHTML = visible.length ? visible.map(clientCard).join('') : empty('Nenhum cliente encontrado.');
  document.querySelectorAll('[data-edit]').forEach((button) => { button.onclick = () => openClient(button.dataset.edit); });
  document.querySelectorAll('[data-toggle]').forEach((button) => { button.onclick = () => toggleClient(button.dataset.toggle); });
  document.querySelectorAll('[data-remove]').forEach((button) => { button.onclick = () => removeClient(button.dataset.remove); });
}

function renderReports(sales, monthVisits) {
  $('#reportMonth').textContent = today.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  $('#reportSales').textContent = money.format(sales);
  $('#reportCommission').textContent = money.format(sales * Number(state.settings.commissionRate || 0) / 100);
  $('#reportOrders').textContent = monthVisits.filter((visit) => visit.value > 0).length;
  $('#reportTicket').textContent = money.format(sales / (monthVisits.filter((visit) => visit.value > 0).length || 1));
  const withLast = state.clients.filter((item) => item.active !== false).map((item) => ({ item, last: lastVisit(item) }));
  [30, 60, 90].forEach((days) => { $(`#no${days}`).textContent = withLast.filter(({ last }) => !last || diffDays(last.date) >= days).length; });
  const ranking = {};
  monthVisits.filter((visit) => visit.value > 0).forEach((visit) => { ranking[visit.clientId] = (ranking[visit.clientId] || 0) + Number(visit.value); });
  $('#salesByClient').innerHTML = Object.entries(ranking).sort((a, b) => b[1] - a[1]).map(([id, value], index) => `<article class="sale-card"><b class="rank">${index + 1}</b><div class="card-main"><strong>${safe(client(id)?.name || 'Cliente')}</strong><small>${safe(client(id)?.city || '')}</small></div><strong>${money.format(value)}</strong></article>`).join('') || empty('O ranking aparecerá após os primeiros pedidos.');
}

function invoiceCard(visit) {
  const dueDate = invoiceDueDate(visit);
  const overdue = dueDate < iso(today);
  const currentClient = client(visit.clientId);
  return `<article class="invoice-card ${overdue ? 'is-late' : ''}"><div class="invoice-icon">$</div><div class="card-main"><strong>${safe(currentClient?.name || 'Cliente')}</strong><small>Venda ${money.format(visit.value)} · vence ${dateFrom(dueDate).toLocaleDateString('pt-BR')}</small><small>${Number(visit.boletoDays || 30)} dias de boleto · comissão ${money.format(commissionForVisit(visit))}</small></div><div class="invoice-side"><span class="tag ${overdue ? 'late' : ''}">${overdue ? 'Vencido' : 'Aguardando'}</span><button class="complete-button" data-mark-paid="${safe(visit.id)}">Marcar pago</button></div></article>`;
}

function historyCard(summary, isCurrent) {
  const paymentMonth = nextMonthKey(summary.month);
  return `<article class="history-card ${isCurrent ? 'current' : ''}"><div><p>${isCurrent ? 'MÊS ATUAL' : 'MÊS FECHADO'}</p><strong>${safe(monthName(summary.month))}</strong><small>${money.format(summary.sales)} vendido de ${money.format(summary.goal)}</small></div><div class="history-values"><span>${summary.visits} visitas · ${summary.orders} pedidos</span><strong>${money.format(summary.commissionGenerated)}</strong><small>comissão para 15/${paymentMonth.split('-').reverse().join('/')}</small></div></article>`;
}

function renderHistory() {
  const currentKey = monthKey();
  const previousKey = previousMonthKey(currentKey);
  const commissionThisMonth = paidCommissionInMonth(previousKey);
  const commissionNextMonth = paidCommissionInMonth(currentKey);
  $('#commissionThisMonth').textContent = money.format(commissionThisMonth);
  $('#commissionThisMonthText').textContent = `Referente aos boletos pagos em ${monthName(previousKey)} · pagamento em 15/${currentKey.split('-').reverse().join('/')}`;
  $('#commissionNextMonth').textContent = money.format(commissionNextMonth);
  const unpaid = state.visits.filter((visit) => Number(visit.value) > 0 && !visit.paidAt).sort((a, b) => invoiceDueDate(a).localeCompare(invoiceDueDate(b)));
  $('#openInvoices').textContent = unpaid.length;
  $('#invoiceList').innerHTML = unpaid.length ? unpaid.map(invoiceCard).join('') : empty('Nenhum boleto pendente de confirmação.');
  document.querySelectorAll('[data-mark-paid]').forEach((button) => { button.onclick = () => openPayment(button.dataset.markPaid); });

  const snapshotByMonth = new Map(state.monthlyHistory.map((item) => [item.month, item]));
  const months = new Set([currentKey, ...state.monthlyHistory.map((item) => item.month), ...state.visits.map((visit) => keyFromDate(visit.date)), ...state.visits.filter((visit) => visit.paidAt).map((visit) => keyFromDate(visit.paidAt)), ...state.fuelLogs.map((log) => keyFromDate(log.date))]);
  $('#monthlyHistory').innerHTML = [...months].filter(Boolean).sort((a, b) => b.localeCompare(a)).map((key) => historyCard(summarizeMonth(key, snapshotByMonth.get(key)), key === currentKey)).join('');
}

function openPayment(id) {
  const visit = state.visits.find((item) => item.id === id);
  const currentClient = visit && client(visit.clientId);
  if (!visit || !currentClient) return;
  $('#paymentVisitId').value = visit.id;
  $('#paymentTitle').textContent = currentClient.name;
  $('#paymentDate').value = iso(today);
  $('#paymentCommissionHint').textContent = `Comissão desta venda: ${money.format(commissionForVisit(visit))}. Se o pagamento ocorrer até o último dia do mês, a comissão entra no dia 15 do mês seguinte.`;
  $('#paymentDialog').showModal();
}

function logDistance(log) { return Number(log.km ?? (Number(log.endKm) - Number(log.startKm)) ?? 0); }
function renderRoutes() {
  const active = state.clients.filter((item) => item.active !== false);
  const cities = ['Todos', ...new Set(active.map((item) => item.city).filter(Boolean).sort())];
  if (!cities.includes(routeCity)) routeCity = 'Todos';
  $('#cityFilters').innerHTML = cities.map((city) => `<button class="${city === routeCity ? 'selected' : ''}" data-city="${safe(city)}">${safe(city)}</button>`).join('');
  const visible = active.filter((item) => routeCity === 'Todos' || item.city === routeCity).sort((a, b) => (appointmentForClient(a.id)?.date || '9999-12-31').localeCompare(appointmentForClient(b.id)?.date || '9999-12-31'));
  $('#routeList').innerHTML = visible.length ? visible.map(routeCard).join('') : empty('Selecione uma cidade para ver a rota.');
  const logs = state.fuelLogs.filter((log) => { const date = dateFrom(log.date); return date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear(); });
  const km = logs.reduce((sum, log) => sum + logDistance(log), 0);
  const liters = km / Number(state.settings.kmPerLiter || 16);
  $('#monthKm').textContent = `${km.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km no mês`;
  $('#monthLiters').textContent = `${liters.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} L`;
  $('#monthFuel').textContent = money.format(liters * Number(state.settings.fuelPrice || 6.7));
  document.querySelectorAll('[data-city]').forEach((button) => { button.onclick = () => { routeCity = button.dataset.city; renderRoutes(); }; });
  bindAppointmentActions();
}

function fillClientSelect(selectedId = '') {
  const query = normalizeText($('#visitClientSearch')?.value || '');
  const matching = state.clients.filter((item) => item.active !== false && (!query || normalizeText([item.name, item.city, item.neighborhood, item.street].join(' ')).includes(query))).sort((a, b) => a.name.localeCompare(b.name));
  $('#visitClient').innerHTML = matching.length ? matching.map((item) => `<option value="${safe(item.id)}">${safe(item.name)} — ${safe(item.city || '')}</option>`).join('') : '<option value="">Nenhum cliente encontrado</option>';
  $('#visitClient').disabled = !matching.length;
  if (matching.length) $('#visitClient').value = matching.some((item) => item.id === selectedId) ? selectedId : matching[0].id;
}

function setVisitReturn() {
  const currentClient = client($('#visitClient').value);
  if (currentClient && !$('#visitReturn').value) $('#visitReturn').value = addDays(dateFrom($('#visitDate').value || iso(today)), currentClient.frequency || 15);
}

function openVisit(appointmentId = '') {
  if (!state.clients.some((item) => item.active !== false)) return;
  const currentAppointment = appointmentId ? appointment(appointmentId) : null;
  const currentClient = currentAppointment ? client(currentAppointment.clientId) : null;
  $('#visitForm').reset();
  $('#visitAppointmentId').value = currentAppointment?.id || '';
  $('#visitKicker').textContent = currentAppointment ? 'CONCLUIR VISITA' : 'REGISTRAR VISITA';
  $('#visitTitle').textContent = currentAppointment ? 'Registrar resultado' : 'Nova visita';
  $('#visitSearchField').hidden = Boolean(currentAppointment);
  $('#visitClientSearch').value = '';
  fillClientSelect(currentClient?.id);
  $('#visitClient').disabled = Boolean(currentAppointment);
  $('#visitDate').value = iso(today);
  $('#visitReturn').value = currentAppointment ? addDays(today, currentClient.frequency || 15) : '';
  setVisitReturn();
  $('#visitDialog').showModal();
}

function openReschedule(id) {
  const current = appointment(id);
  const currentClient = current && client(current.clientId);
  if (!current || !currentClient) return;
  $('#rescheduleAppointmentId').value = current.id;
  $('#rescheduleTitle').textContent = currentClient.name;
  $('#rescheduleDate').value = current.date;
  $('#rescheduleNotes').value = current.notes || '';
  $('#rescheduleDialog').showModal();
}

function openClient(id = '') {
  const currentClient = id ? client(id) : null;
  $('#clientForm').reset();
  $('#clientId').value = currentClient?.id || '';
  $('#clientKicker').textContent = currentClient ? 'EDITAR CLIENTE' : 'NOVO CLIENTE';
  $('#clientDialogTitle').textContent = currentClient ? 'Alterar cliente' : 'Cadastrar cliente';
  $('#deleteClient').hidden = !currentClient;
  $('#clientName').value = currentClient?.name || '';
  $('#clientPhone').value = currentClient?.phone || '';
  $('#clientStreet').value = currentClient?.street || '';
  $('#clientNumber').value = currentClient?.number || '';
  $('#clientNeighborhood').value = currentClient?.neighborhood || '';
  $('#clientCity').value = currentClient?.city || '';
  $('#clientFrequency').value = String(currentClient?.frequency || 15);
  $('#clientActive').value = String(currentClient?.active !== false);
  $('#clientDialog').showModal();
}

function clientFromForm(id) {
  return { id: id || crypto.randomUUID(), name: $('#clientName').value.trim(), phone: $('#clientPhone').value.trim(), street: $('#clientStreet').value.trim(), number: $('#clientNumber').value.trim(), neighborhood: $('#clientNeighborhood').value.trim(), city: $('#clientCity').value.trim(), frequency: Number($('#clientFrequency').value || 15), active: $('#clientActive').value === 'true' };
}

function toggleClient(id) {
  const currentClient = client(id);
  if (!currentClient) return;
  currentClient.active = currentClient.active === false;
  if (currentClient.active !== false && !appointmentForClient(id)) scheduleClient(id, iso(today), 'Cliente reativado');
  save(); render();
}

function removeClient(id) {
  const currentClient = client(id);
  if (!currentClient || !confirm(`Excluir ${currentClient.name}? As visitas e os agendamentos desse cliente também serão removidos.`)) return;
  state.clients = state.clients.filter((item) => item.id !== id);
  state.visits = state.visits.filter((visit) => visit.clientId !== id);
  state.appointments = state.appointments.filter((item) => item.clientId !== id);
  save(); render();
}

function lastOdometer() {
  return state.fuelLogs.filter((log) => Number.isFinite(Number(log.endKm))).sort((a, b) => `${b.date}${b.id}`.localeCompare(`${a.date}${a.id}`))[0]?.endKm;
}
function updateFuelPreview() {
  const start = Number($('#fuelStartKm').value);
  const end = Number($('#fuelEndKm').value);
  $('#fuelDistancePreview').textContent = Number.isFinite(start) && Number.isFinite(end) && end >= start ? `Distância calculada: ${(end - start).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km.` : 'Informe os dois valores para calcular a distância.';
}

function addChatMessage(text, type = 'bot') {
  const box = $('#chatMessages');
  if (!box) return;
  box.insertAdjacentHTML('beforeend', `<div class="chat-bubble ${type}">${safe(text)}</div>`);
  box.scrollTop = box.scrollHeight;
}

function parseMoney(text) {
  const normalized = normalizeText(text);
  const match = normalized.match(/(?:vendeu|pedido|valor|compra|comprou|deu)\s*(?:de|foi|r\$)?\s*(\d+(?:[.,]\d{1,2})?)/) || normalized.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:reais|real|r\$)/);
  return match ? Number(match[1].replace('.', '').replace(',', '.')) : 0;
}
function parseReturnDays(text, currentClient) {
  const normalized = normalizeText(text);
  const match = normalized.match(/(?:retornar|retorno|voltar|passar|agenda(?:r)?)(?:\s+em|\s+daqui\s+a|\s+a\s+cada)?\s*(\d{1,3})\s*dias?/) || normalized.match(/(\d{1,3})\s+em\s+(\d{1,3})/);
  return match ? Number(match[1]) : Number(currentClient?.frequency || 15);
}
function parseTargetDate(text, currentClient) {
  const normalized = normalizeText(text);
  const explicit = normalized.match(/(?:dia|para o dia|pro dia|no dia)\s*(\d{1,2})(?:[\/-](\d{1,2}))?/);
  if (explicit) { const day = Number(explicit[1]); const month = explicit[2] ? Number(explicit[2]) : today.getMonth() + 1; let date = new Date(today.getFullYear(), month - 1, day); if (date < today && !explicit[2]) date = new Date(today.getFullYear(), today.getMonth() + 1, day); return iso(date); }
  if (normalized.includes('amanha')) return addDays(today, 1);
  return addDays(today, parseReturnDays(text, currentClient));
}
function parseKm(text) { const match = normalizeText(text).match(/(\d+(?:[.,]\d+)?)\s*(?:km|quilometros|quilometro)/); return match ? Number(match[1].replace(',', '.')) : 0; }
function parseBoletoDays(text) { const match = normalizeText(text).match(/(?:boleto|prazo)\s*(?:de)?\s*(9|16|30)\s*dias?/); return match ? Number(match[1]) : 30; }
function parseNoSaleReason(text, value) { if (value > 0) return ''; const match = normalizeText(text).match(/(?:nao comprou|sem compra|nao vendeu|sem pedido)(?:\s+porque|\s+por motivo de|\s+motivo)?\s*(.*)$/); return match?.[1]?.trim() || 'Sem compra informada por voz'; }
function findClientBySpeech(text) {
  const words = normalizeText(text).split(/\W+/).filter((word) => word.length > 2 && !['visitei', 'visita', 'vendeu', 'venda', 'pedido', 'retornar', 'retorno', 'voltar', 'reagendar', 'remarcar', 'agenda', 'agendar', 'hoje', 'amanha', 'reais', 'real', 'sem', 'compra', 'comprou', 'cliente', 'para', 'dias', 'dia', 'quero', 'preciso'].includes(word));
  const candidates = state.clients.filter((item) => item.active !== false).map((item) => ({ item, score: words.reduce((sum, word) => sum + (normalizeText([item.name, item.city, item.neighborhood, item.street].join(' ')).includes(word) ? Math.min(word.length, 12) : 0), 0) })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
  return candidates[0]?.score >= 4 ? candidates[0].item : null;
}

function handleAssistantCommand(text) {
  const spoken = text.trim(); if (!spoken) return;
  addChatMessage(spoken, 'user');
  const normalized = normalizeText(spoken);
  const odometer = parseKm(spoken);
  if (odometer > 0 && /(cheguei|chegada|voltei|finalizei)/.test(normalized)) {
    if (!state.activeTrip?.startKm) { addChatMessage('Ainda não tenho o KM de saída. Diga, por exemplo: “saí com 10235 km”.', 'bot'); return; }
    if (odometer < state.activeTrip.startKm) { addChatMessage('O KM de chegada não pode ser menor que o de saída.', 'bot'); return; }
    const distance = odometer - state.activeTrip.startKm;
    state.fuelLogs.push({ id: crypto.randomUUID(), date: state.activeTrip.date, startKm: state.activeTrip.startKm, endKm: odometer, km: distance, notes: 'Registrado por voz' }); state.activeTrip = null; save(); render();
    addChatMessage(`Percurso registrado: ${distance.toLocaleString('pt-BR')} km.`, 'bot'); switchTo('routesScreen'); return;
  }
  if (odometer > 0 && /(sai|saindo|partida|inicio.*rota)/.test(normalized)) {
    state.activeTrip = { date: iso(today), startKm: odometer }; save();
    addChatMessage(`Anotei ${odometer.toLocaleString('pt-BR')} km na saída. Quando chegar, diga o KM final.`, 'bot'); return;
  }
  if (odometer > 0 && /(rodei|rodados?|quilometragem)/.test(normalized)) {
    state.fuelLogs.push({ id: crypto.randomUUID(), date: iso(today), km: odometer, notes: spoken }); save(); render();
    addChatMessage(`Registrei ${odometer.toLocaleString('pt-BR')} km rodados hoje.`, 'bot'); switchTo('routesScreen'); return;
  }
  const isReschedule = /(reagendar|remarcar|mudar|alterar|trocar|passar|agendar|agenda)/.test(normalized) && /(dia|amanha|\d+\s*dias?|\d{1,2}[\/-]\d{1,2})/.test(normalized);
  if (isReschedule) {
    const currentClient = findClientBySpeech(spoken);
    if (!currentClient) { addChatMessage('Não consegui identificar o cliente. Fale o nome junto com a nova data.', 'bot'); return; }
    scheduleClient(currentClient.id, parseTargetDate(spoken, currentClient), `Reagendado por voz: ${spoken}`); save(); render();
    addChatMessage(`${currentClient.name} reagendado para ${dateFrom(appointmentForClient(currentClient.id).date).toLocaleDateString('pt-BR')}.`, 'bot'); switchTo('agendaScreen'); return;
  }
  if (normalized.includes('retornos de hoje') || normalized === 'agenda' || normalized.includes('agenda de hoje')) { const count = activeAppointments().filter((item) => item.date === iso(today)).length; addChatMessage(`Você tem ${count} visita(s) para hoje.`, 'bot'); switchTo('agendaScreen'); return; }
  const currentClient = findClientBySpeech(spoken);
  if (!currentClient) { addChatMessage('Não consegui identificar o cliente com segurança. Tente falar o nome mais completo.', 'bot'); return; }
  const value = parseMoney(spoken);
  const boletoDays = parseBoletoDays(spoken);
  state.visits.push({ id: crypto.randomUUID(), clientId: currentClient.id, date: iso(today), value, boletoDays, dueDate: value > 0 ? addDays(today, boletoDays) : '', paidAt: '', commissionRate: Number(state.settings.commissionRate || 0), notes: spoken, noSaleReason: parseNoSaleReason(spoken, value) });
  const returnDate = parseTargetDate(spoken, currentClient); scheduleClient(currentClient.id, returnDate, 'Agendado por voz'); save(); render();
  addChatMessage(`${currentClient.name}: visita registrada com ${value > 0 ? money.format(value) : 'sem pedido'} e próxima visita em ${dateFrom(returnDate).toLocaleDateString('pt-BR')}.`, 'bot');
}

function setupVoiceAssistant() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  if (SpeechRecognition) {
    recognition = new SpeechRecognition(); recognition.lang = 'pt-BR'; recognition.interimResults = false; recognition.continuous = false;
    recognition.onstart = () => { $('#voiceStatus').textContent = 'Ouvindo...'; $('#voiceButton').classList.add('listening'); };
    recognition.onend = () => { $('#voiceButton').classList.remove('listening'); if ($('#voiceStatus').textContent === 'Ouvindo...') $('#voiceStatus').textContent = 'Toque no microfone e fale'; };
    recognition.onerror = () => { $('#voiceStatus').textContent = 'Não consegui ouvir. Tente novamente ou digite o comando.'; };
    recognition.onresult = (event) => { const text = event.results[0][0].transcript; $('#chatText').value = text; $('#voiceStatus').textContent = 'Comando recebido'; handleAssistantCommand(text); };
  } else { $('#voiceStatus').textContent = 'Este navegador não liberou reconhecimento de voz. Use o Chrome ou digite o comando.'; $('#voiceButton').disabled = true; }
  $('#voiceButton').onclick = () => recognition?.start();
  $('#chatForm').onsubmit = (event) => { event.preventDefault(); const text = $('#chatText').value; $('#chatText').value = ''; handleAssistantCommand(text); };
  addChatMessage('Pode falar ou digitar uma visita, reagendamento ou KM de saída e chegada.', 'bot');
}

function switchTo(id) { document.querySelectorAll('.screen').forEach((element) => element.classList.toggle('active', element.id === id)); document.querySelectorAll('.nav-item').forEach((element) => element.classList.toggle('active', element.dataset.go === id)); window.scrollTo(0, 0); }

document.querySelectorAll('[data-go]').forEach((button) => { button.onclick = () => switchTo(button.dataset.go); });
document.querySelectorAll('[data-close]').forEach((button) => { button.onclick = () => $(`#${button.dataset.close}`).close(); });
$('#addQuick').onclick = () => $('#quickDialog').showModal();
$('#quickVisit').onclick = () => { $('#quickDialog').close(); openVisit(); };
$('#quickClient').onclick = () => { $('#quickDialog').close(); openClient(); };
$('#newClient').onclick = () => openClient();
$('#editGoal').onclick = () => { $('#monthlyGoal').value = state.settings.goal || ''; $('#commissionRate').value = state.settings.commissionRate || ''; $('#fuelPrice').value = state.settings.fuelPrice || ''; $('#kmPerLiter').value = state.settings.kmPerLiter || ''; $('#settingsDialog').showModal(); };
$('#addFuelLog').onclick = () => { $('#fuelForm').reset(); $('#fuelDate').value = iso(today); const last = lastOdometer(); if (last !== undefined) $('#fuelStartKm').value = last; updateFuelPreview(); $('#fuelDialog').showModal(); };
$('#clientSearch').oninput = renderClients;
$('#clientStatusFilter').onchange = renderClients;
$('#visitClientSearch').oninput = () => { const selected = $('#visitClient').value; fillClientSelect(selected); setVisitReturn(); };
$('#visitClient').onchange = () => { $('#visitReturn').value = ''; setVisitReturn(); };
$('#visitDate').onchange = () => { $('#visitReturn').value = ''; setVisitReturn(); };
$('#fuelStartKm').oninput = updateFuelPreview; $('#fuelEndKm').oninput = updateFuelPreview;

$('#settingsForm').onsubmit = (event) => { event.preventDefault(); state.settings = { goal: Number($('#monthlyGoal').value || 0), commissionRate: Number($('#commissionRate').value || 0), fuelPrice: Number($('#fuelPrice').value || 0), kmPerLiter: Number($('#kmPerLiter').value || 1) }; save(); $('#settingsDialog').close(); render(); };
$('#fuelForm').onsubmit = (event) => { event.preventDefault(); const startKm = Number($('#fuelStartKm').value); const endKm = Number($('#fuelEndKm').value); if (endKm < startKm) { $('#fuelDistancePreview').textContent = 'O KM de chegada deve ser maior ou igual ao KM de saída.'; return; } state.fuelLogs.push({ id: crypto.randomUUID(), date: $('#fuelDate').value, startKm, endKm, km: endKm - startKm, notes: $('#fuelNotes').value.trim() }); save(); $('#fuelDialog').close(); render(); };
$('#rescheduleForm').onsubmit = (event) => { event.preventDefault(); const current = appointment($('#rescheduleAppointmentId').value); if (current) { current.date = $('#rescheduleDate').value; current.notes = $('#rescheduleNotes').value.trim(); save(); render(); } $('#rescheduleDialog').close(); };
$('#clientForm').onsubmit = (event) => { event.preventDefault(); const id = $('#clientId').value; const next = clientFromForm(id); if (id) state.clients = state.clients.map((item) => item.id === id ? { ...item, ...next } : item); else { state.clients.push(next); if (next.active) scheduleClient(next.id, iso(today), 'Primeira visita'); } save(); $('#clientDialog').close(); render(); };
$('#deleteClient').onclick = () => { const id = $('#clientId').value; $('#clientDialog').close(); removeClient(id); };
$('#visitForm').onsubmit = (event) => {
  event.preventDefault();
  const clientId = $('#visitClient').value;
  if (!clientId) return;
  const value = Number($('#visitValue').value || 0);
  const boletoDays = Number($('#visitBoletoDays').value || 30);
  const visitDate = $('#visitDate').value;
  state.visits.push({ id: crypto.randomUUID(), clientId, date: visitDate, value, boletoDays, dueDate: value > 0 ? addDays(dateFrom(visitDate), boletoDays) : '', paidAt: '', commissionRate: Number(state.settings.commissionRate || 0), notes: $('#visitNotes').value.trim(), noSaleReason: $('#visitNoSale').value.trim() });
  scheduleClient(clientId, $('#visitReturn').value, 'Próxima visita programada');
  save(); $('#visitDialog').close(); render();
};
$('#paymentForm').onsubmit = (event) => {
  event.preventDefault();
  const visit = state.visits.find((item) => item.id === $('#paymentVisitId').value);
  if (visit) { visit.paidAt = $('#paymentDate').value; save(); render(); }
  $('#paymentDialog').close();
};

if (seedRows().length && state.clientDataVersion !== clientDataVersion) loadSeedClients(seedRows());
migrateAppointments();
migrateFinance();
render();
setupVoiceAssistant();
importClients();
let renderedDate = iso(today);
setInterval(() => {
  refreshToday();
  if (iso(today) !== renderedDate) { migrateFinance(); render(); renderedDate = iso(today); }
}, 60000);
