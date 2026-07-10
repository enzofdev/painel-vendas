const $ = (s) => document.querySelector(s);
const storageKey = 'rota-certa-data-v5';
const clientDataVersion = 'clients-20260710-utf8';
const baseState = { clients: [], visits: [], fuelLogs: [], settings: { goal: 130000, commissionRate: 7, fuelPrice: 6.70, kmPerLiter: 16 } };
let state = JSON.parse(localStorage.getItem(storageKey)) || JSON.parse(localStorage.getItem('rota-certa-data-v4')) || JSON.parse(localStorage.getItem('rota-certa-data-v3')) || JSON.parse(localStorage.getItem('rota-certa-data-v2')) || baseState;
state.fuelLogs ||= [];
state.visits ||= [];
state.clients ||= [];
state.settings = { ...baseState.settings, ...state.settings };
let routeCity = 'Todos';

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const today = new Date(); today.setHours(0, 0, 0, 0);
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const dateFrom = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (date, days) => { const d = new Date(date); d.setDate(d.getDate() + Number(days)); return iso(d); };
const diffDays = (d) => Math.max(0, Math.floor((today - dateFrom(d)) / 86400000));
const save = () => localStorage.setItem(storageKey, JSON.stringify(state));
const client = (id) => state.clients.find(c => c.id === id);
const empty = (text) => `<div class="empty">${text}</div>`;
const safe = (v = '') => String(v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const normalizeText = (v = '') => String(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function seedRows() {
  return Array.isArray(window.clientSeed) ? window.clientSeed : [];
}

function mapClient(r) {
  return {
    ...r,
    id: `base-${r.code}`,
    phone: r.phone || '',
    frequency: Number(r.frequency || 15),
    active: r.active ?? (!r.inactive && !r.suspended)
  };
}

function loadSeedClients(rows) {
  const existingBase = new Map(state.clients.filter(c => String(c.id || '').startsWith('base-')).map(c => [c.id, c]));
  const manualClients = state.clients.filter(c => !String(c.id || '').startsWith('base-'));
  const imported = rows.map(r => {
    const fresh = mapClient(r);
    const old = existingBase.get(fresh.id);
    return old ? { ...fresh, frequency: old.frequency || fresh.frequency, active: old.active ?? fresh.active, phone: old.phone || fresh.phone } : fresh;
  });
  state.clients = [...imported, ...manualClients];
  state.clientDataVersion = clientDataVersion;
  save();
}

async function importClients() {
  if (state.clientDataVersion === clientDataVersion && state.clients.some(c => String(c.id || '').startsWith('base-'))) return;
  try {
    const rows = seedRows().length ? seedRows() : await fetch('clients.json?v=20260710-utf8', { cache: 'no-store' }).then(r => r.json());
    loadSeedClients(rows);
    render();
  } catch {
    render();
  }
}

function currentMonthVisits() {
  return state.visits.filter(v => { const d = dateFrom(v.date); return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear(); });
}

function lastVisit(c) {
  return state.visits.filter(v => v.clientId === c.id).sort((a, b) => b.date.localeCompare(a.date))[0];
}

function visitCard(v) {
  const c = client(v.clientId);
  const d = dateFrom(v.returnDate);
  const late = d < today;
  return `<article class="agenda-card"><div class="date-box"><strong>${String(d.getDate()).padStart(2, '0')}</strong>${d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</div><div class="card-main"><strong>${safe(c?.name || 'Cliente')}</strong><small>${safe(c?.city || '')} · ${v.value > 0 ? money.format(v.value) : safe(v.noSaleReason || 'Sem pedido')}</small></div><span class="tag ${late ? 'late' : ''}">${late ? 'Atrasado' : 'Retorno'}</span></article>`;
}

function routeCard(c) {
  const l = lastVisit(c);
  const days = l ? diffDays(l.date) : '—';
  const due = l && l.returnDate <= iso(today);
  return `<article class="client-card"><div class="route-pin">⌖</div><div class="card-main"><strong>${safe(c.name)}</strong><small>${safe(c.street || '')}, ${safe(c.number || '')} · ${safe(c.neighborhood || c.city || '')}</small></div><div class="days"><strong>${days}</strong><small>dias${due ? ' · atrasado' : ''}</small></div></article>`;
}

function clientCard(c) {
  const l = lastVisit(c);
  const status = c.active === false ? '<span class="tag inactive">Inativo</span>' : '<span class="tag">Ativo</span>';
  return `<article class="client-card manageable ${c.active === false ? 'is-inactive' : ''}">
    <div class="date-box"><strong>${safe(c.frequency || 15)}</strong>dias</div>
    <div class="card-main"><strong>${safe(c.name)}</strong><small>${safe(c.city || '')} · ${safe(c.neighborhood || c.street || 'Sem endereço')}${l ? ` · ${diffDays(l.date)} dias sem visita` : ' · sem visitas'}</small></div>
    <div class="client-actions">${status}<button data-edit="${c.id}">Editar</button><button data-toggle="${c.id}">${c.active === false ? 'Ativar' : 'Inativar'}</button><button class="danger-text" data-remove="${c.id}">Excluir</button></div>
  </article>`;
}

function render() {
  $('#todayLabel').textContent = today.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const monthVisits = currentMonthVisits();
  const sales = monthVisits.reduce((sum, v) => sum + Number(v.value || 0), 0);
  const positive = new Set(monthVisits.filter(v => Number(v.value) > 0).map(v => v.clientId)).size;
  const scheduled = state.visits.filter(v => v.returnDate >= iso(today)).sort((a, b) => a.returnDate.localeCompare(b.returnDate));
  const overdue = state.visits.filter(v => v.returnDate < iso(today)).sort((a, b) => a.returnDate.localeCompare(b.returnDate));

  $('#monthSales').textContent = money.format(sales);
  $('#monthVisits').textContent = monthVisits.length;
  $('#positiveClients').textContent = positive;
  $('#todayReturns').textContent = state.visits.filter(v => v.returnDate === iso(today)).length;

  const goal = Number(state.settings.goal || 0), pct = goal ? Math.min(100, sales / goal * 100) : 0;
  $('#goalText').textContent = goal ? `${money.format(sales)} de ${money.format(goal)}` : 'Defina a meta do mês';
  $('#goalGap').textContent = goal ? (sales >= goal ? 'Meta atingida' : `Faltam ${money.format(goal - sales)} para bater a meta`) : 'Acompanhe sua evolução diária';
  $('#goalProgress').style.width = `${pct}%`;

  $('#homeAgenda').innerHTML = scheduled.length ? scheduled.slice(0, 4).map(visitCard).join('') : empty('Nenhum retorno agendado.');
  $('#overdueList').innerHTML = overdue.length ? overdue.map(visitCard).join('') : empty('Nenhum cliente atrasado.');
  $('#agendaList').innerHTML = scheduled.length || overdue.length ? [...overdue, ...scheduled].map(visitCard).join('') : empty('Sua agenda aparecerá após registrar visitas.');

  const citySales = {};
  monthVisits.forEach(v => { const city = client(v.clientId)?.city || 'Outros'; citySales[city] = (citySales[city] || 0) + Number(v.value || 0); });
  const max = Math.max(...Object.values(citySales), 1);
  $('#cityChart').innerHTML = Object.entries(citySales).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([city, value]) => `<div class="bar-row"><span>${safe(city)}</span><i><b style="width:${value / max * 100}%"></b></i><strong>${money.format(value)}</strong></div>`).join('') || '<p class="muted">Registre pedidos para ver o gráfico por cidade.</p>';

  renderClients();
  renderReports(sales, monthVisits);
  renderRoutes();
}

function renderClients() {
  const q = $('#clientSearch').value.toLowerCase();
  const filter = $('#clientStatusFilter').value;
  const clients = state.clients.filter(c => {
    const matchesText = `${c.name} ${c.city} ${c.neighborhood} ${c.street}`.toLowerCase().includes(q);
    const matchesStatus = filter === 'all' || (filter === 'active' ? c.active !== false : c.active === false);
    return matchesText && matchesStatus;
  });
  $('#clientsList').innerHTML = clients.length ? clients.map(clientCard).join('') : empty('Nenhum cliente encontrado.');
  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openClient(b.dataset.edit));
  document.querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => toggleClient(b.dataset.toggle));
  document.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => removeClient(b.dataset.remove));
}

function renderReports(sales, monthVisits) {
  $('#reportMonth').textContent = today.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  $('#reportSales').textContent = money.format(sales);
  $('#reportCommission').textContent = money.format(sales * Number(state.settings.commissionRate || 0) / 100);
  $('#reportOrders').textContent = monthVisits.filter(v => v.value > 0).length;
  $('#reportTicket').textContent = money.format(sales / (monthVisits.filter(v => v.value > 0).length || 1));
  const withLast = state.clients.filter(c => c.active !== false).map(c => ({ c, l: lastVisit(c) }));
  [30, 60, 90].forEach(n => { $(`#no${n}`).textContent = withLast.filter(x => !x.l || diffDays(x.l.date) >= n).length; });
  const ranking = {};
  monthVisits.filter(v => v.value > 0).forEach(v => ranking[v.clientId] = (ranking[v.clientId] || 0) + Number(v.value));
  $('#salesByClient').innerHTML = Object.entries(ranking).sort((a, b) => b[1] - a[1]).map(([id, v], i) => `<article class="sale-card"><b class="rank">${i + 1}</b><div class="card-main"><strong>${safe(client(id)?.name || 'Cliente')}</strong><small>${safe(client(id)?.city || '')}</small></div><strong>${money.format(v)}</strong></article>`).join('') || empty('O ranking aparecerá após os primeiros pedidos.');
}

function renderRoutes() {
  const active = state.clients.filter(c => c.active !== false);
  const cities = ['Todos', ...new Set(active.map(c => c.city).filter(Boolean).sort())];
  if (!cities.includes(routeCity)) routeCity = 'Todos';
  $('#cityFilters').innerHTML = cities.map(c => `<button class="${c === routeCity ? 'selected' : ''}" data-city="${safe(c)}">${safe(c)}</button>`).join('');
  const visible = active.filter(c => routeCity === 'Todos' || c.city === routeCity).sort((a, b) => {
    const al = lastVisit(a), bl = lastVisit(b);
    return (bl ? diffDays(bl.date) : 999) - (al ? diffDays(al.date) : 999);
  });
  $('#routeList').innerHTML = visible.length ? visible.map(routeCard).join('') : empty('Selecione uma cidade para ver a rota.');
  const logs = state.fuelLogs.filter(l => { const d = dateFrom(l.date); return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear(); });
  const km = logs.reduce((sum, l) => sum + Number(l.km), 0), liters = km / Number(state.settings.kmPerLiter || 16), cost = liters * Number(state.settings.fuelPrice || 6.7);
  $('#monthKm').textContent = `${km.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km no mês`;
  $('#monthLiters').textContent = `${liters.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} L`;
  $('#monthFuel').textContent = money.format(cost);
  document.querySelectorAll('[data-city]').forEach(b => b.onclick = () => { routeCity = b.dataset.city; renderRoutes(); });
}

function openVisit() {
  if (!state.clients.some(c => c.active !== false)) return;
  $('#visitForm').reset();
  fillClientSelect();
  $('#visitDate').value = iso(today);
  $('#visitClient').dispatchEvent(new Event('change'));
  $('#visitDialog').showModal();
}

function fillClientSelect() {
  $('#visitClient').innerHTML = state.clients.filter(c => c.active !== false).sort((a, b) => a.name.localeCompare(b.name)).map(c => `<option value="${c.id}">${safe(c.name)} — ${safe(c.city || '')}</option>`).join('');
}

function openClient(id = '') {
  const c = id ? client(id) : null;
  $('#clientForm').reset();
  $('#clientId').value = c?.id || '';
  $('#clientKicker').textContent = c ? 'EDITAR CLIENTE' : 'NOVO CLIENTE';
  $('#clientDialogTitle').textContent = c ? 'Alterar cliente' : 'Cadastrar cliente';
  $('#deleteClient').hidden = !c;
  $('#clientName').value = c?.name || '';
  $('#clientPhone').value = c?.phone || '';
  $('#clientStreet').value = c?.street || '';
  $('#clientNumber').value = c?.number || '';
  $('#clientNeighborhood').value = c?.neighborhood || '';
  $('#clientCity').value = c?.city || '';
  $('#clientFrequency').value = String(c?.frequency || 15);
  $('#clientActive').value = String(c?.active !== false);
  $('#clientDialog').showModal();
}

function clientFromForm(id) {
  return {
    id: id || crypto.randomUUID(),
    name: $('#clientName').value.trim(),
    phone: $('#clientPhone').value.trim(),
    street: $('#clientStreet').value.trim(),
    number: $('#clientNumber').value.trim(),
    neighborhood: $('#clientNeighborhood').value.trim(),
    city: $('#clientCity').value.trim(),
    frequency: Number($('#clientFrequency').value || 15),
    active: $('#clientActive').value === 'true'
  };
}

function toggleClient(id) {
  const c = client(id);
  if (!c) return;
  c.active = c.active === false;
  save();
  render();
}

function removeClient(id) {
  const c = client(id);
  if (!c) return;
  if (!confirm(`Excluir ${c.name}? As visitas desse cliente também serão removidas dos relatórios.`)) return;
  state.clients = state.clients.filter(item => item.id !== id);
  state.visits = state.visits.filter(v => v.clientId !== id);
  save();
  render();
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

function parseReturnDays(text, c) {
  const normalized = normalizeText(text);
  const match = normalized.match(/(?:retornar|retorno|voltar|passar|agenda(?:r)?)(?:\s+em|\s+daqui\s+a|\s+a cada)?\s*(\d{1,3})\s*dias?/) || normalized.match(/(\d{1,3})\s+em\s+(\d{1,3})/);
  if (match) return Number(match[1]);
  return Number(c?.frequency || 15);
}

function parseTargetDate(text, c) {
  const normalized = normalizeText(text);
  const explicit = normalized.match(/(?:dia|para o dia|pro dia|no dia)\s*(\d{1,2})(?:[\/\-](\d{1,2}))?/);
  if (explicit) {
    const day = Number(explicit[1]);
    const month = explicit[2] ? Number(explicit[2]) : today.getMonth() + 1;
    let date = new Date(today.getFullYear(), month - 1, day);
    if (date < today && !explicit[2]) date = new Date(today.getFullYear(), today.getMonth() + 1, day);
    return iso(date);
  }
  if (normalized.includes('amanha')) return addDays(today, 1);
  return addDays(today, parseReturnDays(text, c));
}

function parseKm(text) {
  const normalized = normalizeText(text);
  const match = normalized.match(/(\d+(?:[.,]\d+)?)\s*(?:km|quilometros|quilometro)/) || normalized.match(/(?:rodei|andou|rodados?|quilometragem)\s*(?:de|foi)?\s*(\d+(?:[.,]\d+)?)/);
  return match ? Number(match[1].replace(',', '.')) : 0;
}

function parseNoSaleReason(text, value) {
  if (value > 0) return '';
  const normalized = normalizeText(text);
  const match = normalized.match(/(?:nao comprou|sem compra|nao vendeu|sem pedido)(?:\s+porque|\s+por motivo de|\s+motivo)?\s*(.*)$/);
  return match?.[1]?.trim() || 'Sem compra informada por voz';
}

function findClientBySpeech(text) {
  const normalized = normalizeText(text);
  const commandWords = new Set(['visitei','visita','vendeu','venda','pedido','retornar','retorno','voltar','reagendar','remarcar','agenda','agendar','hoje','ontem','amanha','reais','real','sem','compra','comprou','cliente','no','na','o','a','de','da','do','em','para','pro','dias','dia','faz','favor','porfavor','por','quero','preciso','isso']);
  const words = normalized.split(/\W+/).filter(w => w.length > 2 && !commandWords.has(w));
  const candidates = state.clients.filter(c => c.active !== false).map(c => {
    const haystack = normalizeText([c.name, c.city, c.neighborhood, c.street].join(' '));
    const score = words.reduce((sum, word) => sum + (haystack.includes(word) ? Math.min(word.length, 12) : 0), 0);
    return { c, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
  return candidates[0]?.score >= 4 ? candidates[0].c : null;
}

function handleAssistantCommand(text) {
  const spoken = text.trim();
  if (!spoken) return;
  addChatMessage(spoken, 'user');
  const normalized = normalizeText(spoken);

  const km = parseKm(spoken);
  if (km > 0 && /(km|quilometro|quilometragem|rodei|rodados?|andou)/.test(normalized)) {
    state.fuelLogs.push({ id: crypto.randomUUID(), date: iso(today), km, notes: spoken });
    save();
    render();
    addChatMessage('Registrei ' + km.toLocaleString('pt-BR') + ' km rodados hoje. O custo de combust?vel do m?s j? foi atualizado.', 'bot');
    switchTo('routesScreen');
    return;
  }

  const isReschedule = /(reagendar|remarcar|mudar|alterar|trocar|passar|agendar|agenda)/.test(normalized) && /(dia|amanha|\d+\s*dias?|\d{1,2}[\/\-]\d{1,2})/.test(normalized);
  if (isReschedule) {
    const c = findClientBySpeech(spoken);
    if (!c) {
      addChatMessage('N?o consegui identificar qual cliente voc? quer reagendar. Fale o nome do cliente junto com a data.', 'bot');
      return;
    }
    const returnDate = parseTargetDate(spoken, c);
    const existing = state.visits.filter(v => v.clientId === c.id).sort((a, b) => b.date.localeCompare(a.date))[0];
    if (existing) {
      existing.returnDate = returnDate;
      existing.notes = (existing.notes || '') + ' | Reagendado por voz: ' + spoken;
    } else {
      state.visits.push({ id: crypto.randomUUID(), clientId: c.id, date: iso(today), value: 0, notes: 'Reagendado por voz: ' + spoken, noSaleReason: 'Reagendamento sem visita registrada', returnDate });
    }
    save();
    render();
    addChatMessage(c.name + ' reagendado para ' + dateFrom(returnDate).toLocaleDateString('pt-BR') + '.', 'bot');
    switchTo('agendaScreen');
    return;
  }

  if (normalized.includes('retornos de hoje') || normalized === 'agenda' || normalized.includes('agenda de hoje')) {
    const todayCount = state.visits.filter(v => v.returnDate === iso(today)).length;
    addChatMessage('Voc? tem ' + todayCount + ' retorno(s) para hoje.', 'bot');
    switchTo('agendaScreen');
    return;
  }

  const c = findClientBySpeech(spoken);
  if (!c) {
    addChatMessage('N?o consegui identificar o cliente com seguran?a. Tente falar o nome mais completo ou digite o nome do cliente.', 'bot');
    return;
  }
  const value = parseMoney(spoken);
  const noSaleReason = parseNoSaleReason(spoken, value);
  const visit = {
    id: crypto.randomUUID(),
    clientId: c.id,
    date: iso(today),
    value,
    notes: spoken,
    noSaleReason,
    returnDate: parseTargetDate(spoken, c)
  };
  state.visits.push(visit);
  save();
  render();
  addChatMessage(c.name + ': visita registrada com ' + (value > 0 ? money.format(value) : 'sem pedido') + ' e retorno para ' + dateFrom(visit.returnDate).toLocaleDateString('pt-BR') + '.', 'bot');
}

function setupVoiceAssistant() {
  if (!$('#chatForm')) return;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = 'pt-BR';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onstart = () => { $('#voiceStatus').textContent = 'Ouvindo... fale a visita'; $('#voiceButton').classList.add('listening'); };
    recognition.onend = () => { $('#voiceButton').classList.remove('listening'); if ($('#voiceStatus').textContent === 'Ouvindo... fale a visita') $('#voiceStatus').textContent = 'Toque no microfone e fale'; };
    recognition.onerror = () => { $('#voiceStatus').textContent = 'Não consegui ouvir. Tente novamente ou digite o comando.'; };
    recognition.onresult = (event) => {
      const text = event.results[0][0].transcript;
      $('#chatText').value = text;
      $('#voiceStatus').textContent = 'Comando recebido';
      handleAssistantCommand(text);
    };
  } else {
    $('#voiceStatus').textContent = 'Este navegador não liberou reconhecimento de voz. Use o Chrome ou digite o comando.';
    $('#voiceButton').disabled = true;
  }
  $('#voiceButton').onclick = () => recognition?.start();
  $('#chatForm').onsubmit = e => {
    e.preventDefault();
    const text = $('#chatText').value;
    $('#chatText').value = '';
    handleAssistantCommand(text);
  };
  addChatMessage('Pode falar ou digitar uma visita. Eu registro cliente, venda, motivo de não compra e retorno automaticamente.', 'bot');
}

function switchTo(id) {
  document.querySelectorAll('.screen').forEach(e => e.classList.toggle('active', e.id === id));
  document.querySelectorAll('.nav-item').forEach(e => e.classList.toggle('active', e.dataset.go === id));
  window.scrollTo(0, 0);
}

document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => switchTo(b.dataset.go));
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => $('#' + b.dataset.close).close());
$('#addQuick').onclick = openVisit;
$('#newClient').onclick = () => openClient();
$('#editGoal').onclick = () => { $('#monthlyGoal').value = state.settings.goal || ''; $('#commissionRate').value = state.settings.commissionRate || ''; $('#fuelPrice').value = state.settings.fuelPrice || ''; $('#kmPerLiter').value = state.settings.kmPerLiter || ''; $('#settingsDialog').showModal(); };
$('#addFuelLog').onclick = () => { $('#fuelForm').reset(); $('#fuelDate').value = iso(today); $('#fuelDialog').showModal(); };
$('#clientSearch').oninput = renderClients;
$('#clientStatusFilter').onchange = renderClients;

$('#settingsForm').onsubmit = e => { e.preventDefault(); state.settings = { goal: Number($('#monthlyGoal').value || 0), commissionRate: Number($('#commissionRate').value || 0), fuelPrice: Number($('#fuelPrice').value || 0), kmPerLiter: Number($('#kmPerLiter').value || 1) }; save(); $('#settingsDialog').close(); render(); };
$('#fuelForm').onsubmit = e => { e.preventDefault(); state.fuelLogs.push({ id: crypto.randomUUID(), date: $('#fuelDate').value, km: Number($('#fuelKm').value), notes: $('#fuelNotes').value.trim() }); save(); $('#fuelDialog').close(); render(); };
$('#clientForm').onsubmit = e => {
  e.preventDefault();
  const id = $('#clientId').value;
  const next = clientFromForm(id);
  if (id) state.clients = state.clients.map(c => c.id === id ? { ...c, ...next } : c);
  else state.clients.push(next);
  save();
  $('#clientDialog').close();
  render();
};
$('#deleteClient').onclick = () => { const id = $('#clientId').value; $('#clientDialog').close(); removeClient(id); };
$('#visitForm').onsubmit = e => { e.preventDefault(); state.visits.push({ id: crypto.randomUUID(), clientId: $('#visitClient').value, date: $('#visitDate').value, value: Number($('#visitValue').value || 0), notes: $('#visitNotes').value.trim(), noSaleReason: $('#visitNoSale').value.trim(), returnDate: $('#visitReturn').value }); save(); $('#visitDialog').close(); render(); };
$('#visitClient').onchange = () => { const c = client($('#visitClient').value); if (c && !$('#visitReturn').value) $('#visitReturn').value = addDays(dateFrom($('#visitDate').value || iso(today)), c.frequency || 15); };
$('#visitDate').onchange = () => { $('#visitReturn').value = ''; $('#visitClient').dispatchEvent(new Event('change')); };

if (seedRows().length && state.clientDataVersion !== clientDataVersion) loadSeedClients(seedRows());
render();
setupVoiceAssistant();
importClients();
