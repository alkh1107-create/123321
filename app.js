// ============================================================
// Купон — фронтенд-логика.
// Никаких фреймворков: обычный fetch к FastAPI backend (см. config.js),
// ручное переключение между тремя экранами (список / создание / детали).
// ============================================================

const API = window.API_BASE_URL;

const state = {
  portfolios: [],
  currentPortfolioId: null,
  lastRecommendationId: null,
  draftBonds: [],       // бумаги, добавляемые при создании портфеля
  draftHistoryFile: null,
};

// ---------------- Утилиты ----------------

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

function showToast(message, kind = "ok") {
  const stack = $("#toast-stack");
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

function fmtNum(v, digits = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return Number(v).toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtPct(v, digits = 2) {
  if (v === null || v === undefined) return "—";
  return `${fmtNum(v, digits)}%`;
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function riskLabel(risk) {
  return { conservative: "Консервативный", moderate: "Умеренный", aggressive: "Агрессивный" }[risk] || risk;
}

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || JSON.stringify(body);
    } catch (_) { /* noop */ }
    throw new Error(detail);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res;
}

// ---------------- Навигация между экранами ----------------

function showScreen(id) {
  $$(".screen").forEach(s => s.hidden = true);
  $(`#${id}`).hidden = false;
}

// ---------------- Проверка соединения ----------------

async function checkConnection() {
  const pill = $("#conn-status");
  try {
    await api("/api/health");
    pill.classList.add("ok");
    pill.classList.remove("err");
    pill.innerHTML = `<span class="dot"></span> backend подключён`;
    return true;
  } catch (e) {
    pill.classList.add("err");
    pill.classList.remove("ok");
    pill.innerHTML = `<span class="dot"></span> нет связи с backend (${API})`;
    return false;
  }
}

// ---------------- Экран: список портфелей ----------------

async function loadPortfolioList() {
  const grid = $("#portfolio-grid");
  const empty = $("#empty-state");
  try {
    const portfolios = await api("/api/portfolios");
    state.portfolios = portfolios;
    grid.innerHTML = "";
    if (portfolios.length === 0) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    for (const p of portfolios) {
      const card = document.createElement("div");
      card.className = "portfolio-card";
      card.innerHTML = `
        <div class="portfolio-card-top">
          <h3 class="portfolio-card-name">${escapeHtml(p.name)}</h3>
          <span class="portfolio-card-risk risk-${p.risk_profile}">${riskLabel(p.risk_profile)}</span>
        </div>
        <div class="portfolio-card-meta">
          <div class="portfolio-card-meta-row"><span class="label">Бумаг</span><span class="value">${p.bonds.length}</span></div>
          <div class="portfolio-card-meta-row"><span class="label">Бюджет</span><span class="value">${p.budget_rub ? fmtNum(p.budget_rub, 0) + " ₽" : "—"}</span></div>
          <div class="portfolio-card-meta-row"><span class="label">Обновлён</span><span class="value">${p.last_run_at ? fmtDate(p.last_run_at) : "ещё не запускался"}</span></div>
        </div>
        ${p.is_active ? '<div class="portfolio-card-active-badge"><span class="dot"></span> автообновление активно</div>' : ''}
      `;
      card.addEventListener("click", () => openPortfolioDetail(p.id));
      grid.appendChild(card);
    }
  } catch (e) {
    showToast(`Не удалось загрузить портфели: ${e.message}`, "err");
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// ---------------- Экран: создание портфеля ----------------

function resetCreateForm() {
  $("#f-name").value = "Мой портфель";
  $("#f-budget").value = "";
  $("#f-horizon").value = "";
  $("#f-risk").value = "moderate";
  $("#f-max-positions").value = "8";
  $("#f-notes").value = "";
  $("#f-isin").value = "";
  $("#f-bond-name").value = "";
  state.draftBonds = [];
  state.draftHistoryFile = null;
  $("#file-drop-label").textContent = "Выбрать файл bonds_history.xlsx";
  renderDraftBonds();
}

function renderDraftBonds() {
  const list = $("#bond-draft-list");
  list.innerHTML = "";
  state.draftBonds.forEach((b, idx) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${escapeHtml(b.name || b.isin)} <span class="bd-isin">${escapeHtml(b.isin)}</span></span>`;
    const btn = document.createElement("button");
    btn.textContent = "×";
    btn.addEventListener("click", () => {
      state.draftBonds.splice(idx, 1);
      renderDraftBonds();
    });
    li.appendChild(btn);
    list.appendChild(li);
  });
}

function addDraftBond() {
  const isinInput = $("#f-isin");
  const nameInput = $("#f-bond-name");
  const isin = isinInput.value.trim().toUpperCase();
  const name = nameInput.value.trim();
  if (!isin) {
    showToast("Введите ISIN бумаги", "err");
    return;
  }
  if (state.draftBonds.some(b => b.isin === isin)) {
    showToast("Такой ISIN уже добавлен", "err");
    return;
  }
  state.draftBonds.push({ isin, name: name || undefined });
  isinInput.value = "";
  nameInput.value = "";
  isinInput.focus();
  renderDraftBonds();
}

async function submitNewPortfolio() {
  if (state.draftBonds.length === 0) {
    showToast("Добавьте хотя бы одну бумагу", "err");
    return;
  }
  const payload = {
    name: $("#f-name").value.trim() || "Мой портфель",
    budget_rub: $("#f-budget").value ? Number($("#f-budget").value) : null,
    risk_profile: $("#f-risk").value,
    horizon_days: $("#f-horizon").value ? Number($("#f-horizon").value) : null,
    max_positions: Number($("#f-max-positions").value) || 8,
    notes: $("#f-notes").value.trim() || null,
    bonds: state.draftBonds,
    is_active: true,
  };

  const btn = $("#btn-create-portfolio");
  btn.disabled = true;
  btn.textContent = "Создаём…";
  try {
    const portfolio = await api("/api/portfolios", { method: "POST", body: JSON.stringify(payload) });

    if (state.draftHistoryFile) {
      try {
        const formData = new FormData();
        formData.append("file", state.draftHistoryFile);
        await fetch(`${API}/api/portfolios/${portfolio.id}/history/import`, { method: "POST", body: formData })
          .then(r => { if (!r.ok) throw new Error("не удалось импортировать историю"); });
        showToast("История успешно импортирована", "ok");
      } catch (e) {
        showToast(`Портфель создан, но история не импортировалась: ${e.message}`, "err");
      }
    }

    showToast("Портфель создан. Запускаем первый расчёт…", "ok");
    await openPortfolioDetail(portfolio.id);
    await runNow(false); // первый прогон без ИИ-совета не запускаем автоматически — см. runNow(true) по кнопке
  } catch (e) {
    showToast(`Не удалось создать портфель: ${e.message}`, "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "Создать и запустить";
  }
}

// ---------------- Экран: детали портфеля ----------------

async function openPortfolioDetail(id) {
  state.currentPortfolioId = id;
  state.lastRecommendationId = null;
  showScreen("screen-detail");
  await refreshPortfolioDetail();
}

async function refreshPortfolioDetail() {
  const id = state.currentPortfolioId;
  if (!id) return;

  try {
    const p = await api(`/api/portfolios/${id}`);
    $("#d-title").textContent = p.name;
    $("#d-sub").textContent = `${riskLabel(p.risk_profile)} · ${p.bonds.length} бумаг` +
      (p.budget_rub ? ` · бюджет ${fmtNum(p.budget_rub, 0)} ₽` : "");
    $("#kpi-last-run").textContent = p.last_run_at ? fmtDate(p.last_run_at) : "ещё не запускался";

    renderBondsTable(p.bonds);
    await loadPositionsEditor(p);
  } catch (e) {
    showToast(`Не удалось загрузить портфель: ${e.message}`, "err");
    return;
  }

  await Promise.all([
    loadLatestHistoryAndSignals(id),
    loadLatestRecommendation(id),
    loadHistoryTimeline(id),
  ]);
}

async function loadPositionsEditor(portfolio) {
  try {
    const positions = await api(`/api/portfolios/${portfolio.id}/positions`);
    const rec = await api(`/api/portfolios/${portfolio.id}/recommendations/latest`).catch(() => null);
    state.lastRecommendationId = rec?.id ?? null;
    const targets = Object.fromEntries((rec?.allocations_json || []).map(a => [a.isin, a]));
    $("#position-budget").value = portfolio.budget_rub ?? "";
    $("#position-cash").value = portfolio.cash_balance_rub ?? "";
    $("#position-commission").value = portfolio.commission_rate === null || portfolio.commission_rate === undefined
      ? "" : Number(portfolio.commission_rate) * 100;
    $("#portfolio-notes").value = portfolio.notes ?? "";
    $("#positions-editor").innerHTML = positions.map(p => `
      <div class="position-edit-row">
        <div class="position-edit-name">${escapeHtml(p.name)}</div>
        <label><span>Факт, шт.</span><input type="number" min="0" step="1" data-position-isin="${escapeHtml(p.isin)}" data-position-field="quantity" value="${p.quantity || 0}"></label>
        <label><span>Средняя цена, ₽/шт.</span><input type="number" min="0" step="0.01" data-position-isin="${escapeHtml(p.isin)}" data-position-field="average_price_rub" value="${p.average_price_rub ?? ""}" placeholder="не задана"></label>
        <label><span>Цель, лоты</span><input type="number" min="0" step="1" data-target-isin="${escapeHtml(p.isin)}" value="${targets[p.isin]?.target_lots ?? 0}" ${rec ? "" : "disabled"}></label>
      </div>`).join("") || `<p class="muted">Добавьте облигации для учёта позиций.</p>`;
  } catch (e) {
    showToast(`Не удалось загрузить позиции: ${e.message}`, "err");
  }
}

async function savePositions() {
  const id = state.currentPortfolioId;
  if (!id) return;
  const btn = $("#btn-save-positions");
  btn.disabled = true;
  try {
    const budgetText = $("#position-budget").value;
    const budget = budgetText ? Number(budgetText) : null;
    await api(`/api/portfolios/${id}/budget`, { method: "PATCH", body: JSON.stringify({ budget_rub: budget }) });
    const cashText = $("#position-cash").value;
    await api(`/api/portfolios/${id}/cash`, { method: "PATCH", body: JSON.stringify({ cash_balance_rub: cashText === "" ? null : Number(cashText) }) });
    const commissionText = $("#position-commission").value;
    await api(`/api/portfolios/${id}`, { method: "PATCH", body: JSON.stringify({
      notes: $("#portfolio-notes").value || null,
      commission_rate: commissionText === "" ? null : Number(commissionText) / 100,
    }) });
    const positions = [...document.querySelectorAll("[data-position-field='quantity']")].map(input => {
      const isin = input.dataset.positionIsin;
      const price = document.querySelector(`[data-position-isin="${isin}"][data-position-field="average_price_rub"]`).value;
      return { isin, quantity: Number(input.value) || 0, average_price_rub: price ? Number(price) : null };
    });
    await api(`/api/portfolios/${id}/positions`, { method: "PUT", body: JSON.stringify({ positions }) });
    const targetInputs = [...document.querySelectorAll("[data-target-isin]")];
    if (state.lastRecommendationId && targetInputs.length) {
      const targets = targetInputs.map(input => ({ isin: input.dataset.targetIsin, lots: Number(input.value) || 0 }));
      await api(`/api/portfolios/${id}/recommendations/latest/targets`, {
        method: "PUT", body: JSON.stringify({ targets }),
      });
    }
    showToast("Бюджет, фактические позиции и целевые лоты сохранены", "ok");
    await refreshPortfolioDetail();
  } catch (e) {
    showToast(`Не удалось сохранить капитал и позиции: ${e.message}`, "err");
  } finally {
    btn.disabled = false;
  }
}

function renderBondsTable(bonds, latestSnapshotByIsin = {}) {
  const tbody = $("#bonds-table-body");
  tbody.innerHTML = "";
  for (const b of bonds) {
    const snap = latestSnapshotByIsin[b.isin];
    const tr = document.createElement("tr");
    const displayYield = snap?.yield_buy_simple_pct ?? snap?.moex_yield_pct ?? snap?.yield_sell_simple_pct;
    const yieldTag = snap?.yield_buy_simple_pct !== null && snap?.yield_buy_simple_pct !== undefined
      ? `расчёт · после НДФЛ${snap.moex_yield_pct !== null && snap.moex_yield_pct !== undefined ? `<small class="yield-reference">MOEX ${fmtPct(snap.moex_yield_pct)}</small>` : ""}`
      : (snap?.moex_yield_pct !== null && snap?.moex_yield_pct !== undefined ? "только MOEX" : "расчёт");
    tr.innerHTML = `
      <td>${escapeHtml(b.name)}</td>
      <td class="mono">${escapeHtml(b.isin)}</td>
      <td class="num yield-cell">${snap ? fmtPct(displayYield) : "—"}</td>
      <td>${snap ? `<span class="src-tag src-fallback">${yieldTag}</span>` : "—"}</td>
      <td class="num mono">${snap ? fmtNum(snap.buy_total_rub ?? snap.buy_price_rub, 2) + " ₽" : "—"}</td>
      <td>${snap ? `<span class="${snap.had_live_quotes ? 'live-yes' : 'live-no'}">${snap.had_live_quotes ? '● live' : '○ last'}</span>` : "—"}</td>
      <td></td>
    `;
    const removeBtn = document.createElement("button");
    removeBtn.className = "row-remove-btn";
    removeBtn.textContent = "×";
    removeBtn.title = "Убрать из портфеля";
    removeBtn.addEventListener("click", () => removeBondFromPortfolio(b.id));
    tr.lastElementChild.appendChild(removeBtn);
    tbody.appendChild(tr);
  }
}

async function removeBondFromPortfolio(holdingId) {
  const id = state.currentPortfolioId;
  try {
    await api(`/api/portfolios/${id}/bonds/${holdingId}`, { method: "DELETE" });
    showToast("Бумага удалена из портфеля", "ok");
    await refreshPortfolioDetail();
  } catch (e) {
    showToast(`Не удалось удалить бумагу: ${e.message}`, "err");
  }
}

async function loadLatestHistoryAndSignals(portfolioId) {
  try {
    const history = await api(`/api/portfolios/${portfolioId}/history?limit=1`);
    if (history.length === 0) {
      $("#kpi-usd").textContent = "—";
      $("#kpi-bonds").textContent = "—";
      $("#kpi-live").textContent = "—";
      $("#matrix-wrap").innerHTML = `<p class="muted">Пока нет данных. Запустите расчёт.</p>`;
      $("#signals-table-body").innerHTML = "";
      return;
    }
    const latest = history[0];
    $("#kpi-usd").textContent = latest.usd_rub ? fmtNum(latest.usd_rub, 4) : "—";
    $("#kpi-bonds").textContent = latest.num_bonds ?? "—";
    $("#kpi-live").textContent = latest.live_quotes_share !== null && latest.live_quotes_share !== undefined
      ? fmtPct(latest.live_quotes_share * 100, 0) : "—";

    const byIsin = {};
    for (const b of latest.bonds) byIsin[b.isin] = b;
    const p = state.portfolios.find(x => x.id === portfolioId) || (await api(`/api/portfolios/${portfolioId}`));
    renderBondsTable(p.bonds, byIsin);

    const signals = await api(`/api/portfolios/${portfolioId}/runs/${latest.run_id}/signals`);
    renderMatrix(latest.bonds, signals);
    await renderSignalsTable(portfolioId, latest.run_id);

    if (latest.status === "error") {
      showRunBanner(latest.message || "Ошибка при получении данных с MOEX", "err");
    } else if (latest.status === "partial") {
      showRunBanner(latest.message || "Часть бумаг не удалось получить", "warn");
    } else {
      hideRunBanner();
    }
  } catch (e) {
    showToast(`Не удалось загрузить историю: ${e.message}`, "err");
  }
}

function showRunBanner(msg, kind) {
  const el = $("#run-banner");
  el.hidden = false;
  el.className = `run-banner ${kind}`;
  el.textContent = msg;
}
function hideRunBanner() {
  $("#run-banner").hidden = true;
}

function renderMatrix(bonds, relations) {
  const wrap = $("#matrix-wrap");
  const names = bonds.map(b => b.name);
  if (names.length === 0) {
    wrap.innerHTML = `<p class="muted">Нет данных по бумагам.</p>`;
    return;
  }

  const relMap = {};
  for (const r of relations) relMap[`${r.seller}||${r.buyer}`] = r.relation;

  let html = `<table class="matrix-table"><thead><tr><th></th>`;
  for (const n of names) html += `<th>${escapeHtml(truncate(n, 10))}</th>`;
  html += `</tr></thead><tbody>`;

  for (const seller of names) {
    html += `<tr><th class="row-head">${escapeHtml(truncate(seller, 14))}</th>`;
    for (const buyer of names) {
      const val = relMap[`${seller}||${buyer}`];
      const isDiag = seller === buyer;
      const bg = isDiag ? "" : heatColor(val);
      html += `<td class="${isDiag ? 'diag' : ''}" style="${bg ? `background:${bg}` : ''}">
        <span class="matrix-cell-value">${val !== undefined ? val.toFixed(3) : '—'}</span>
      </td>`;
    }
    html += `</tr>`;
  }
  html += `</tbody></table>`;
  wrap.innerHTML = html;
}

function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

function heatColor(val) {
  if (val === undefined || val === null || val === 0) return "";
  // val около 1.0 = нейтрально; выше 1.025 = зелёная подсветка (сигнал), ниже 0.975 = красноватая
  if (val >= 1.05) return "rgba(94,234,212,0.35)";
  if (val >= 1.025) return "rgba(94,234,212,0.18)";
  if (val <= 0.95) return "rgba(240,119,107,0.22)";
  if (val <= 0.975) return "rgba(240,119,107,0.10)";
  return "";
}

async function renderSignalsTable(portfolioId, runId) {
  // Сигналы (со статусами) пересчитываются на лету пайплайном при запуске;
  // для отображения последнего прогона показываем relation-таблицу отсортированной
  // по отклонению от 1.0, чтобы самые примечательные пары были видны сверху.
  const relations = await api(`/api/portfolios/${portfolioId}/runs/${runId}/signals`);
  const tbody = $("#signals-table-body");
  tbody.innerHTML = "";

  const notable = relations
    .filter(r => r.seller !== r.buyer && r.quotes_live)
    .filter(r => r.gain_pct !== null && r.gain_pct >= (r.min_gain_pct || 1.0))
    .sort((a, b) => (b.gain_pct || 0) - (a.gain_pct || 0))
    .slice(0, 15);

  if (notable.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">Нет обменов с расчётной выгодой выше минимального порога за выбранный горизонт.</td></tr>`;
    return;
  }

  for (const r of notable) {
    const tr = document.createElement("tr");
    const statusClass = r.gain_pct >= (r.min_gain_pct || 1.0) ? "status-signal" : "status-neutral";
    const statusText = r.gain_pct >= (r.min_gain_pct || 1.0) ? "выше порога" : "обычный";
    tr.innerHTML = `
      <td>${escapeHtml(r.seller)}</td>
      <td>${escapeHtml(r.buyer)}</td>
      <td class="num mono">${r.relation.toFixed(3)}</td>
      <td class="num mono">${fmtPct(r.gain_pct, 2)} / ${r.comparison_days} дн.</td>
      <td class="num mono">—</td>
      <td><span class="status-tag ${statusClass}">${statusText}</span></td>
      <td class="muted">Чистая разница доходностей за горизонт удержания старой бумаги. Порог учитывает заданную брокерскую комиссию.</td>
    `;
    tbody.appendChild(tr);
  }
}

async function loadLatestRecommendation(portfolioId) {
  try {
    const rec = await api(`/api/portfolios/${portfolioId}/recommendations/latest`);
    if (!rec) {
      state.lastRecommendationId = null;
      $("#rec-summary").textContent = "Рекомендаций пока нет — запустите расчёт.";
      $("#rec-model-badge").textContent = "—";
      $("#portfolio-risk-summary").textContent = "";
      $("#alloc-list").innerHTML = "";
      $("#rebalance-plan").innerHTML = "";
      $("#warnings-list").innerHTML = "";
      return;
    }
    state.lastRecommendationId = rec.id;
    $("#rec-summary").textContent = rec.summary || "—";
    $("#rec-model-badge").textContent = rec.model_used || "—";
    $("#kpi-expected-yield").textContent = rec.expected_yield_pct !== null && rec.expected_yield_pct !== undefined
      ? fmtPct(rec.expected_yield_pct) : "—";
    const risk = rec.rebalance_json?.risk_summary;
    if (risk) {
      const profileNames = { conservative: "консервативный", moderate: "умеренный", aggressive: "агрессивный" };
      const durationStress = risk.estimated_portfolio_price_change_pct_per_1pp_rate_move === null || risk.estimated_portfolio_price_change_pct_per_1pp_rate_move === undefined
        ? "чувствительность к ставке не оценена"
        : `оценка при росте рыночных доходностей на 1 п.п.: ${fmtPct(risk.estimated_portfolio_price_change_pct_per_1pp_rate_move, 2)} по цене`;
      const spread = risk.weighted_bid_ask_spread_pct === null || risk.weighted_bid_ask_spread_pct === undefined
        ? "спред BID–OFFER недоступен" : `средний спред BID–OFFER ${fmtPct(risk.weighted_bid_ask_spread_pct, 3)}`;
      const dispersion = risk.weighted_yield_history_dispersion_pct === null || risk.weighted_yield_history_dispersion_pct === undefined
        ? "нет истории для оценки разброса доходностей" : `разброс исторических доходностей ${fmtPct(risk.weighted_yield_history_dispersion_pct, 2)} (не волатильность полной доходности)`;
      const duration = risk.weighted_duration_years === null || risk.weighted_duration_years === undefined
        ? "дюрация недоступна" : `взвешенная дюрация ${fmtNum(risk.weighted_duration_years, 2)} лет`;
      const horizonMismatch = risk.weighted_horizon_mismatch_years === null || risk.weighted_horizon_mismatch_years === undefined || risk.weighted_horizon_mismatch_years === 0
        ? "" : `средний разрыв дюрации с горизонтом ${fmtNum(risk.weighted_horizon_mismatch_years, 2)} лет`;
      const issuer = risk.max_known_issuer_exposure_pct === null || risk.max_known_issuer_exposure_pct === undefined
        ? "концентрацию эмитента MOEX не удалось проверить" : `максимальная доля известного эмитента ${fmtPct(risk.max_known_issuer_exposure_pct, 1)}`;
      const ratingCoverage = risk.unknown_rating_positions === undefined
        ? "" : `рейтинг MOEX есть у ${Math.max(0, (risk.selected_bonds || 0) - risk.unknown_rating_positions)} из ${risk.selected_bonds || 0} выпусков`;
      const caps = risk.effective_max_position_pct === undefined
        ? "" : `лимит одной бумаги ${fmtPct(risk.effective_max_position_pct, 1)}, лимит эмитента ${fmtPct(risk.effective_max_issuer_pct, 1)}`;
      $("#portfolio-risk-summary").textContent = `Риск-профиль: ${profileNames[risk.risk_profile] || "умеренный"}. Итоговые доли рассчитаны с учетом чистой доходности, дюрации относительно горизонта, BID–OFFER-спреда, истории и доступной оценки рейтинга, затем округлены до лотов. ${caps}; ${duration}; ${horizonMismatch}; ${durationStress}; ${spread}; ${dispersion}; ${issuer}. ${ratingCoverage}. Стресс-оценка линейная и не является прогнозом.`;
    } else {
      $("#portfolio-risk-summary").textContent = "";
    }

    const allocList = $("#alloc-list");
    allocList.innerHTML = "";
    const allocations = rec.allocations_json || [];
    for (const a of allocations) {
      const row = document.createElement("div");
      row.className = "alloc-row";
      const metrics = a.risk_metrics || {};
      const riskParts = [];
      if (metrics.duration_years !== null && metrics.duration_years !== undefined) riskParts.push(`дюрация ${fmtNum(metrics.duration_years, 2)} г.`);
      if (metrics.bid_ask_spread_pct !== null && metrics.bid_ask_spread_pct !== undefined) riskParts.push(`BID–OFFER ${fmtPct(metrics.bid_ask_spread_pct, 3)}`);
      if (metrics.yield_history_dispersion_pct !== null && metrics.yield_history_dispersion_pct !== undefined) riskParts.push(`разброс доходностей ${fmtPct(metrics.yield_history_dispersion_pct, 2)}`);
      if (metrics.credit_rating) riskParts.push(`рейтинг ${metrics.credit_rating}`);
      row.innerHTML = `
        <div>
          <div class="alloc-name">${escapeHtml(a.name || a.isin)}</div>
          <div class="alloc-rationale">${escapeHtml(a.rationale || "")}</div>
          ${riskParts.length ? `<div class="alloc-risk">${riskParts.map(escapeHtml).join(" · ")}</div>` : ""}
        </div>
        <div class="alloc-weight">${fmtPct(a.weight_pct, 1)}</div>
        <div class="alloc-amount">${a.target_lots !== undefined ? `${a.target_lots} лот. · ${a.target_shares} шт. · ${fmtNum(a.target_amount_rub, 0)} ₽` : (a.amount_rub ? fmtNum(a.amount_rub, 0) + " ₽" : "")}</div>
        <div class="alloc-bar-track"><div class="alloc-bar-fill" style="width:${Math.min(100, a.weight_pct || 0)}%"></div></div>
      `;
      allocList.appendChild(row);
    }
    renderRebalancePlan(rec.rebalance_json);
    $("#warnings-list").innerHTML = (rec.rebalance_json?.warnings || []).map(w => `<div class="warning-item">⚠ ${escapeHtml(w)}</div>`).join("");
  } catch (e) {
    $("#rec-summary").textContent = "Рекомендаций пока нет — нажмите «Обновить сейчас».";
    $("#rec-model-badge").textContent = "—";
    $("#alloc-list").innerHTML = "";
    $("#rebalance-plan").innerHTML = "";
  }
}

async function checkForNewRecommendation() {
  const id = state.currentPortfolioId;
  if (!id || $("#screen-detail").hidden || document.hidden) return;
  try {
    const rec = await api(`/api/portfolios/${id}/recommendations/latest`);
    if (state.lastRecommendationId !== null && rec.id !== state.lastRecommendationId) {
      state.lastRecommendationId = rec.id;
      showToast("Появился новый план после внутридневной проверки рынка", "ok");
      await refreshPortfolioDetail();
    }
  } catch (_) {
    // Пустой портфель может ещё не иметь рекомендации.
  }
}

function renderRebalancePlan(plan) {
  const wrap = $("#rebalance-plan");
  if (!plan) { wrap.innerHTML = ""; return; }
  const orderText = plan.orders?.length ? plan.orders.map(o => {
    const side = o.side === "SELL" ? "Продать" : "Купить";
    const cash = Math.abs(o.estimated_cash_rub || 0);
    const pnl = o.estimated_pnl_rub === null || o.estimated_pnl_rub === undefined ? "" : ` · оценка P/L ${fmtNum(o.estimated_pnl_rub, 0)} ₽`;
    return `<div class="order-row ${o.side.toLowerCase()}"><strong>${side}</strong> ${escapeHtml(o.name)} — ${o.lots} лот. (${o.shares} шт.) · ${fmtNum(cash, 0)} ₽${pnl}${o.quote_live ? "" : " · LAST, цена ориентировочная"}</div>`;
  }).join("") : `<p class="muted">Сделок по целевым долям не требуется.</p>`;
  const gain = plan.best_switch_gain_pct === null || plan.best_switch_gain_pct === undefined
    ? "" : ` · максимальная выгода обмена ${fmtPct(plan.best_switch_gain_pct, 2)}`;
  const cashReason = plan.cash_left_reason ? `<p class="card-hint">${escapeHtml(plan.cash_left_reason)}</p>` : "";
  wrap.innerHTML = `<h4>План сделок (вручную)</h4>${orderText}<div class="cash-left">Останется свободно: <strong>${fmtNum(plan.cash_left_rub, 0)} ₽</strong>${gain}</div>${cashReason}<p class="card-hint">Оценка по текущим котировкам; заявки не отправляются брокеру.</p>`;
}

async function importHistoryForCurrentPortfolio(file) {
  const id = state.currentPortfolioId;
  if (!id || !file) return;
  try {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`${API}/api/portfolios/${id}/history/import`, { method: "POST", body: formData });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.detail || "не удалось импортировать файл");
    }
    const summary = await response.json();
    showToast(`Импортировано снимков: ${summary.runs_imported}; исторических доходностей: ${summary.bond_yield_rows_imported}`, "ok");
    await refreshPortfolioDetail();
  } catch (e) {
    showToast(`Не удалось импортировать историю: ${e.message}`, "err");
  } finally {
    $("#f-import-history").value = "";
  }
}

async function loadHistoryTimeline(portfolioId) {
  try {
    const history = await api(`/api/portfolios/${portfolioId}/history?limit=20`);
    const wrap = $("#history-timeline");
    wrap.innerHTML = "";
    if (history.length === 0) {
      wrap.innerHTML = `<p class="muted">История пуста — запустите первый расчёт.</p>`;
      return;
    }
    for (const h of history) {
      const statusClass = { ok: "hs-ok", partial: "hs-partial", error: "hs-error", imported: "hs-imported" }[h.status] || "hs-ok";
      const item = document.createElement("div");
      item.className = "history-item";
      item.innerHTML = `
        <span class="history-date">${fmtDate(h.run_at)}</span>
        <span class="history-meta"><span class="history-status-dot ${statusClass}"></span>${h.num_bonds} бумаг · живых котировок ${h.live_quotes_share !== null ? fmtPct(h.live_quotes_share * 100, 0) : "—"}</span>
        <span class="mono" style="color:var(--text-faint); font-size:11px;">${h.usd_rub ? "USD/RUB " + fmtNum(h.usd_rub, 2) : ""}</span>
      `;
      wrap.appendChild(item);
    }
  } catch (e) {
    showToast(`Не удалось загрузить историю обновлений: ${e.message}`, "err");
  }
}

async function runNow(callAdvisor = true) {
  const id = state.currentPortfolioId;
  if (!id) return;
  const btn = $("#btn-run-now");
  btn.disabled = true;
  btn.textContent = "Считаем…";
  try {
    const result = await api(`/api/portfolios/${id}/run?call_advisor=${callAdvisor}`, { method: "POST" });
    if (result.status === "error") {
      showRunBanner(result.message, "err");
      showToast("Расчёт завершился с ошибкой — см. баннер выше", "err");
    } else if (result.status === "partial") {
      showRunBanner(result.message || "Часть бумаг не получена", "warn");
      showToast("Расчёт завершён частично", "ok");
    } else {
      hideRunBanner();
      showToast("Расчёт успешно завершён", "ok");
    }
    if (result.advisor_error) {
      showToast(`ИИ-советник недоступен: ${result.advisor_error}`, "err");
    }
    await refreshPortfolioDetail();
  } catch (e) {
    showToast(`Ошибка запуска расчёта: ${e.message}`, "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "Пересчитать ребалансировку";
  }
}

async function exportHistory() {
  const id = state.currentPortfolioId;
  if (!id) return;
  try {
    const res = await fetch(`${API}/api/portfolios/${id}/history/export`);
    if (!res.ok) throw new Error("сервер вернул ошибку");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bonds_history_portfolio_${id}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Файл истории скачан", "ok");
  } catch (e) {
    showToast(`Не удалось экспортировать историю: ${e.message}`, "err");
  }
}

// ---------------- Модалка: добавить бумагу в существующий портфель ----------------

function openAddBondModal() {
  $("#modal-isin").value = "";
  $("#modal-bond-name").value = "";
  $("#modal-add-bond").hidden = false;
  $("#modal-isin").focus();
}
function closeAddBondModal() {
  $("#modal-add-bond").hidden = true;
}
async function confirmAddBond() {
  const isin = $("#modal-isin").value.trim().toUpperCase();
  const name = $("#modal-bond-name").value.trim();
  if (!isin) {
    showToast("Введите ISIN", "err");
    return;
  }
  try {
    await api(`/api/portfolios/${state.currentPortfolioId}/bonds`, {
      method: "POST",
      body: JSON.stringify({ isin, name: name || undefined }),
    });
    closeAddBondModal();
    showToast("Бумага добавлена. Запустите расчёт, чтобы обновить доходности.", "ok");
    await refreshPortfolioDetail();
  } catch (e) {
    showToast(`Не удалось добавить бумагу: ${e.message}`, "err");
  }
}

// ---------------- Модалка: методология ----------------

async function openMethodologyModal() {
  $("#modal-methodology").hidden = false;
  try {
    const data = await api("/api/methodology");
    $("#methodology-text").textContent = data.yield_methodology;
  } catch (e) {
    $("#methodology-text").textContent = "Не удалось загрузить описание методологии — backend недоступен.";
  }
}

// ---------------- Инициализация событий ----------------

function initEvents() {
  $("#btn-new-portfolio").addEventListener("click", () => { resetCreateForm(); showScreen("screen-create"); });
  $("#btn-new-portfolio-empty").addEventListener("click", () => { resetCreateForm(); showScreen("screen-create"); });
  $("#btn-back-from-create").addEventListener("click", () => { showScreen("screen-list"); loadPortfolioList(); });
  $("#btn-back-from-detail").addEventListener("click", () => { showScreen("screen-list"); loadPortfolioList(); });

  $("#btn-add-bond-draft").addEventListener("click", addDraftBond);
  $("#f-isin").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addDraftBond(); } });

  $("#file-drop").addEventListener("click", () => $("#f-history-file").click());
  $("#f-history-file").addEventListener("change", e => {
    const file = e.target.files[0];
    if (file) {
      state.draftHistoryFile = file;
      $("#file-drop-label").textContent = file.name;
    }
  });

  $("#btn-create-portfolio").addEventListener("click", submitNewPortfolio);

  $("#btn-run-now").addEventListener("click", () => runNow(true));
  $("#btn-save-positions").addEventListener("click", savePositions);
  $("#btn-export-history").addEventListener("click", exportHistory);
  $("#btn-import-history").addEventListener("click", () => $("#f-import-history").click());
  $("#f-import-history").addEventListener("change", e => importHistoryForCurrentPortfolio(e.target.files[0]));

  $("#btn-add-bond-detail").addEventListener("click", openAddBondModal);
  $("#modal-cancel").addEventListener("click", closeAddBondModal);
  $("#modal-confirm").addEventListener("click", confirmAddBond);
  $("#modal-isin").addEventListener("keydown", e => { if (e.key === "Enter") confirmAddBond(); });

  $("#btn-methodology").addEventListener("click", openMethodologyModal);
  $("#methodology-close").addEventListener("click", () => { $("#modal-methodology").hidden = true; });
}

// ---------------- Старт ----------------

async function init() {
  initEvents();
  await checkConnection();
  setInterval(checkForNewRecommendation, 5 * 60 * 1000);
  showScreen("screen-list");
  await loadPortfolioList();
}

document.addEventListener("DOMContentLoaded", init);
