'use strict';

const $ = (id) => document.getElementById(id);
const state = {
  cases: [], id: null, mode: 'development', detail: null, request: 0,
  dirty: false, saving: false, loading: false, view: 'primary', blink: null,
  status: { active: null, queued: [], errors: {} }, polling: false,
};
const statuses = { unreviewed: 'Unreviewed', 'looks-good': 'Looks good', 'needs-work': 'Needs work' };

function text(value) {
  if (value == null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}
function notice(message = '') {
  $('notice').textContent = message;
  $('notice').hidden = !message;
}
async function api(path, body) {
  const response = await fetch(path, body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${response.status}: ${message.slice(0, 500) || response.statusText}`);
  }
  return response.status === 204 ? {} : response.json();
}
function casePath(id = state.id) { return `/api/cases/${encodeURIComponent(id)}`; }
function reviewOf(item) { return item.review || { status: 'unreviewed', note: '' }; }
function caseLabel(item = state.cases.find((entry) => entry.id === state.id)) {
  return [item?.reviewId, item?.id || state.id].filter(Boolean).join(' · ');
}
function hasLimitations(item) { return Array.isArray(item.limitations) ? item.limitations.length > 0 : Boolean(item.limitations); }
function resolveCase(value) {
  return state.cases.find((item) => [item.id, item.reviewId].some((id) => id?.toLowerCase() === value?.toLowerCase()));
}
function updateURL() {
  const url = new URL(location.href);
  if (state.id) url.searchParams.set('case', state.id);
  url.searchParams.set('mode', state.mode);
  history.replaceState(null, '', url);
}
function filteredCases() {
  const query = $('search').value.trim().toLowerCase();
  const filter = $('filter').value;
  return state.cases.filter((item) => {
    if (filter === 'feedback' && !item.feedbackReason) return false;
    if (filter === 'limitations' && !hasLimitations(item)) return false;
    if (!['feedback', 'limitations', 'all'].includes(filter) && reviewOf(item).status !== filter) return false;
    return !query || [item.id, item.reviewId, item.provenance, item.inputKind, item.selection, item.panel, item.feedbackReason, item.recommendation]
      .some((value) => text(value).toLowerCase().includes(query));
  });
}
function renderList() {
  const items = filteredCases();
  const flagged = state.cases.filter((item) => item.feedbackReason).length;
  $('filter').querySelector('[value="feedback"]').textContent = `Historical screenshot mismatches (${flagged})`;
  $('filter').querySelector('[value="limitations"]').textContent = `Coverage limitations (${state.cases.filter(hasLimitations).length})`;
  $('filter').querySelector('[value="all"]').textContent = `All cases (${state.cases.length})`;
  $('case-count').textContent = `${items.length} shown · ${state.cases.filter((item) => reviewOf(item).status === 'unreviewed').length} unreviewed total`;
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const button = document.createElement('button');
    button.className = 'case-item';
    button.dataset.status = reviewOf(item).status;
    button.setAttribute('aria-current', String(item.id === state.id));
    const name = document.createElement('span');
    name.className = 'case-name';
    const shortId = document.createElement('strong');
    shortId.className = 'review-id';
    shortId.textContent = item.reviewId || '';
    const canonicalId = document.createElement('span');
    canonicalId.textContent = item.id;
    name.append(shortId, canonicalId);
    const subtitle = document.createElement('span');
    subtitle.className = 'case-subtitle';
    const kind = document.createElement('span');
    kind.textContent = [item.inputKind, typeof item.panel === 'string' ? item.panel : null].filter(Boolean).join(' · ');
    const status = document.createElement('span');
    status.className = 'case-status';
    status.textContent = statuses[reviewOf(item).status] || 'Unreviewed';
    subtitle.append(kind, status);
    button.append(name, subtitle);
    if (item.feedbackReason) {
      const flag = document.createElement('span');
      flag.className = 'feedback-dot';
      flag.style.fontSize = '10px';
      flag.textContent = '● Historical screenshot mismatch';
      button.append(flag);
    }
    if (hasLimitations(item)) {
      const limitation = document.createElement('span');
      limitation.className = 'case-subtitle';
      limitation.textContent = 'Coverage limitation';
      button.append(limitation);
    }
    button.addEventListener('click', () => selectCase(item.id));
    fragment.append(button);
  }
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'list-empty';
    empty.textContent = 'No matching cases. Try another filter or search.';
    fragment.append(empty);
  }
  $('case-list').replaceChildren(fragment);
  updateNavigation();
}
function unreviewedNeighbor(direction) {
  const items = filteredCases();
  const index = items.findIndex((item) => item.id === state.id);
  if (!items.length) return null;
  for (let step = 1; step <= items.length; step++) {
    const nextIndex = index < 0 ? (direction > 0 ? step - 1 : items.length - step) : (index + direction * step + items.length) % items.length;
    const item = items[nextIndex];
    if (item.id !== state.id && reviewOf(item).status === 'unreviewed') return item.id;
  }
  return null;
}
function updateNavigation() {
  $('previous').disabled = !unreviewedNeighbor(-1);
  $('next').disabled = !unreviewedNeighbor(1);
}
function discardDraft() {
  if (state.saving) { notice('Please wait for feedback to finish saving.'); return false; }
  return !state.dirty || window.confirm('You have unsaved feedback. Discard it and continue?');
}
async function selectCase(id, { refresh = false } = {}) {
  if (!refresh && id === state.id) return;
  if (!refresh && !discardDraft()) return;
  const preserveDraft = refresh && (state.dirty || state.saving);
  const request = ++state.request;
  const mode = state.mode;
  state.id = id;
  updateURL();
  if (!refresh) {
    state.dirty = false;
    state.detail = null;
    $('detail').hidden = true;
    $('empty-state').hidden = false;
    $('empty-state').firstElementChild.textContent = 'Loading case…';
    $('empty-state').lastElementChild.textContent = id;
    $('save-status').textContent = '';
    stopBlink();
  }
  state.loading = true;
  renderList();
  try {
    const detail = await api(`${casePath(id)}?mode=${encodeURIComponent(mode)}`);
    if (request !== state.request) return;
    state.detail = detail;
    state.loading = false;
    renderDetail(preserveDraft || (refresh && (state.dirty || state.saving)));
  } catch (error) {
    if (request !== state.request) return;
    state.loading = false;
    notice(`Unable to load ${id}: ${error.message}. Select the case again to retry.`);
    if (!refresh) {
      $('empty-state').firstElementChild.textContent = 'Case unavailable';
      $('empty-state').lastElementChild.textContent = 'Try another case or reload the page.';
      // Permit clicking the same case to retry.
      state.id = null;
      renderList();
    }
  }
}
function addSourceOption(value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  $('source-file').append(option);
}
function renderSource() {
  const detail = state.detail;
  const selected = $('source-file').value;
  let source = '', context = '';
  if (selected === 'synthetic') {
    source = text(detail.synthetic);
    context = 'Synthetic input — no source function exists. This is the raw scenario JSON, not Ballerina source.';
  } else if (selected === 'function') {
    source = detail.function.text;
    context = `Selected source function${detail.function.file ? ` · ${detail.function.file}` : ''}`;
  } else {
    const file = selected.slice(5);
    source = detail.files?.[file] || '';
    context = detail.function ? `Full project file · ${file}` : `Full project source fallback · ${file}. ${detail.sourceError || 'No isolated function was provided.'}`;
  }
  $('source-code').textContent = source || 'No source or synthetic input is available for this case.';
  $('source-context').textContent = `${caseLabel()} · ${context || 'Source unavailable'}`;
}
function renderDetail(preserveDraft = false) {
  const detail = state.detail;
  const item = detail.case || state.cases.find((entry) => entry.id === state.id) || {};
  $('empty-state').hidden = true;
  $('detail').hidden = false;
  $('case-title').textContent = caseLabel(item);
  const origin = Array.isArray(item.provenance) ? item.provenance[0]?.file : text(item.provenance);
  const panel = item.panel && typeof item.panel === 'object' ? `${item.panel.mode} ${item.panel.width}×${item.panel.height}` : text(item.panel);
  $('case-meta').textContent = [item.inputKind, origin, panel, item.viewport ? `Viewport ${item.viewport.width}×${item.viewport.height}` : ''].filter(Boolean).join(' / ');
  $('case-meta').title = text(item.provenance);
  $('feedback-reason').textContent = item.feedbackReason ? `Historical screenshot mismatch: ${item.feedbackReason}\nThe preview below is SVG, not the original failed screenshot pair. This historical flag is not a current SVG regression verdict.` : '';
  $('feedback-reason').hidden = !item.feedbackReason;
  const limitations = Array.isArray(item.limitations) ? item.limitations.map(text).join('\n') : text(item.limitations);
  $('limitations').textContent = limitations ? `Limitations: ${limitations}` : '';
  $('limitations').hidden = !limitations;
  $('recommendation').textContent = item.recommendation ? `Recommendation: ${text(item.recommendation)}` : '';
  $('recommendation').hidden = !item.recommendation;
  const previousSource = $('source-file').value;
  $('source-file').replaceChildren();
  if (detail.synthetic != null) addSourceOption('synthetic', 'Synthetic input (JSON)');
  if (detail.function?.text) addSourceOption('function', 'Selected function');
  for (const file of Object.keys(detail.files || {})) addSourceOption(`file:${file}`, file);
  if ([...$('source-file').options].some((option) => option.value === previousSource)) $('source-file').value = previousSource;
  renderSource();
  if (!preserveDraft) {
    const review = detail.review || reviewOf(item);
    $('review-status').value = statuses[review.status] ? review.status : 'unreviewed';
    $('note').value = review.note || '';
  }
  renderCapture();
}
function safeLocalURL(value) {
  if (!value) return null;
  try {
    const url = new URL(value, location.href);
    return url.origin === location.origin && ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}
function stopBlink() {
  if (state.blink) clearInterval(state.blink);
  state.blink = null;
}
function captureKey(id = state.id, mode = state.mode) { return `${id}/${mode}`; }
function isPending(id = state.id, mode = state.mode) {
  const key = captureKey(id, mode);
  return state.status.active === key || state.status.queued.includes(key);
}
function renderCapture() {
  stopBlink();
  const capture = state.detail?.capture;
  const primary = safeLocalURL(capture?.imageUrl);
  const repeat = safeLocalURL(capture?.repeatImageUrl);
  if (!repeat && state.view !== 'primary') state.view = 'primary';
  for (const [view, id] of Object.entries({ primary: 'view-primary', repeat: 'view-repeat', side: 'view-side', blink: 'view-blink' })) {
    $(id).setAttribute('aria-pressed', String(state.view === view));
    $(id).disabled = !primary || (view !== 'primary' && !repeat);
  }
  $('images').replaceChildren();
  $('images').hidden = !primary;
  $('images').classList.toggle('side', state.view === 'side');
  const error = state.status.errors?.[captureKey()];
  $('render-state').textContent = isPending() ? (state.status.active === captureKey() ? 'Rendering… The existing capture, if any, remains below.' : 'Queued for capture…') : error ? `Capture failed: ${text(error)}\nYou can retry with “Capture + repeat”.` : !primary ? 'No rendered image available for this mode. Capture this case to compare its source and generated flow.' : '';
  $('capture').disabled = isPending();
  $('capture').textContent = isPending() ? 'Capture queued' : 'Capture + repeat';
  function image(url, label) {
    const svg = capture?.format === 'svg';
    const preview = document.createElement(svg ? 'iframe' : 'img');
    const description = `${label} ${svg ? 'SVG preview' : 'legacy image'} flow for ${caseLabel()} (${state.mode})`;
    const figure = document.createElement('figure');
    const caption = document.createElement('figcaption');
    caption.id = `capture-caption-${$('images').children.length + 1}`;
    caption.textContent = `${caseLabel()} · ${state.mode} · ${label} · ${svg ? 'SVG preview' : 'Legacy image'}`;
    preview.setAttribute('aria-describedby', caption.id);
    if (svg) {
      preview.title = description;
      // Same-origin access permits sizing only. Never allow scripts in captured HTML.
      preview.setAttribute('sandbox', 'allow-same-origin');
      preview.addEventListener('load', () => {
        try {
          const doc = preview.contentDocument;
          const diagram = doc?.querySelector('svg');
          if (!diagram) {
            // The server deliberately emits this document for captures with no diagram.
            // Check each preview independently: first and repeat can have different results.
            if (!doc?.querySelector('main.flow-view')?.textContent.includes('SVG absent for this capture. No diagram preview is available.')) throw new Error('Missing SVG');
            caption.textContent += ' · SVG absent — no diagram for this view';
            preview.style.height = `${Math.max(410, doc.documentElement.scrollHeight)}px`;
            preview.dataset.result = 'absent';
            preview.dataset.loaded = 'true';
            return;
          }
          const width = diagram.viewBox?.baseVal.width || diagram.getBoundingClientRect().width || 800;
          if (!$('fit').checked) preview.style.width = `${Math.max(320, width)}px`;
          preview.style.height = `${Math.max(410, doc.documentElement.scrollHeight, diagram.getBoundingClientRect().bottom + 16)}px`;
          preview.dataset.loaded = 'true';
        } catch {
          $('render-state').textContent = 'The SVG preview could not be loaded. Try capturing this case again.';
        }
      });
    } else preview.alt = description;
    preview.addEventListener('error', () => {
      $('render-state').textContent = 'The capture could not be loaded. Try capturing this case again.';
    });
    preview.src = url;
    figure.append(caption, preview);
    $('images').append(figure);
    return figure;
  }
  if (primary) {
    if (state.view === 'side') { image(primary, 'First capture'); image(repeat, 'Repeat capture'); }
    else if (state.view === 'blink') {
      const first = image(primary, 'First capture');
      const second = image(repeat, 'Repeat capture');
      second.hidden = true;
      state.blink = setInterval(() => { first.hidden = !first.hidden; second.hidden = !second.hidden; }, 700);
    } else image(state.view === 'repeat' ? repeat : primary, state.view === 'repeat' ? 'Repeat capture' : 'First capture');
  }
  $('capture-meta').textContent = `${caseLabel()} · ${state.mode} · ` + (capture ? [capture.origin, capture.createdAt, capture.comparison ? `Comparison: ${text(capture.comparison)}` : null].filter(Boolean).join(' · ') : 'No capture');
  $('capture-links').replaceChildren();
  for (const [label, value] of [[capture?.format === 'svg' ? 'SVG preview' : 'Legacy image', capture?.imageUrl], ['Raw SVG', capture?.svgUrl], ['HTML', capture?.htmlUrl]]) {
    const url = safeLocalURL(value);
    if (!url) continue;
    const link = document.createElement('a');
    link.textContent = label;
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    $('capture-links').append(link);
  }
}
async function loadCases() {
  const result = await api('/api/cases');
  state.cases = result.cases || [];
  renderList();
}
async function poll() {
  if (state.polling) return;
  state.polling = true;
  try {
    const selectedKey = captureKey();
    const wasPending = isPending();
    const next = await api('/api/status');
    state.status = { active: next.active || null, queued: next.queued || [], errors: next.errors || {} };
    $('queue-status').textContent = state.status.active ? `Rendering ${state.status.active} · ${state.status.queued.length} queued` : state.status.queued.length ? `${state.status.queued.length} captures queued` : 'Renderer idle · Captures stored locally';
    if (state.detail) {
      if (selectedKey === captureKey() && wasPending && !isPending()) {
        await selectCase(state.id, { refresh: true });
        await loadCases();
      } else {
        const error = state.status.errors[captureKey()];
        $('capture').disabled = isPending();
        $('capture').textContent = isPending() ? 'Capture queued' : 'Capture + repeat';
        if (isPending()) $('render-state').textContent = state.status.active === captureKey() ? 'Rendering…' : 'Queued for capture…';
        else if (error) $('render-state').textContent = `Capture failed: ${text(error)}. You can retry with “Capture + repeat”.`;
      }
    }
  } catch (error) {
    $('queue-status').textContent = `Server unavailable: ${error.message}. Retrying…`;
  } finally { state.polling = false; }
}

$('search').addEventListener('input', () => {
  const exact = resolveCase($('search').value.trim());
  if (exact && !filteredCases().includes(exact)) $('filter').value = 'all';
  renderList();
});
$('copy-link').addEventListener('click', async () => {
  updateURL();
  try {
    await navigator.clipboard.writeText(location.href);
    notice(`Link copied for ${caseLabel()}.`);
  } catch { notice(`Copy this link: ${location.href}`); }
});
$('filter').addEventListener('change', renderList);
$('source-file').addEventListener('change', renderSource);
$('previous').addEventListener('click', () => { const id = unreviewedNeighbor(-1); if (id) selectCase(id); });
$('next').addEventListener('click', () => { const id = unreviewedNeighbor(1); if (id) selectCase(id); });
$('mode').addEventListener('change', async () => {
  if (!discardDraft()) { $('mode').value = state.mode; return; }
  state.mode = $('mode').value;
  updateURL();
  state.dirty = false;
  notice();
  if (state.id) { const id = state.id; state.id = null; await selectCase(id); }
});
for (const [view, id] of Object.entries({ primary: 'view-primary', repeat: 'view-repeat', side: 'view-side', blink: 'view-blink' })) {
  $(id).addEventListener('click', () => { state.view = view; renderCapture(); });
}
$('fit').addEventListener('change', () => {
  $('images').classList.toggle('fit', $('fit').checked);
  renderCapture();
});
for (const id of ['note', 'review-status']) $(id).addEventListener('input', () => {
  state.dirty = true;
  $('save-status').textContent = 'Unsaved changes';
});
$('save').addEventListener('click', async () => {
  if (!state.id || state.saving) return;
  const id = state.id;
  const review = { status: $('review-status').value, note: $('note').value };
  state.saving = true;
  $('save').disabled = true;
  $('save-status').textContent = 'Saving…';
  try {
    await api(`${casePath(id)}/review`, review);
    const item = state.cases.find((entry) => entry.id === id);
    if (item) item.review = review;
    if (state.detail) state.detail.review = review;
    state.dirty = $('note').value !== review.note || $('review-status').value !== review.status;
    $('save-status').textContent = state.dirty ? 'Saved. New changes are unsaved.' : 'Saved locally';
    renderList();
  } catch (error) { $('save-status').textContent = `Not saved: ${error.message}`; }
  finally { state.saving = false; $('save').disabled = false; }
});
$('capture').addEventListener('click', async () => {
  if (!state.id) return;
  const id = state.id;
  const mode = state.mode;
  const key = captureKey(id, mode);
  $('capture').disabled = true;
  notice();
  try {
    await api(`${casePath(id)}/capture`, { mode, repeat: true });
    if (!isPending(id, mode)) state.status.queued.push(key);
    if (captureKey() === key && state.detail) renderCapture();
    await poll();
  } catch (error) { notice(`Unable to queue capture: ${error.message}`); if (captureKey() === key) $('capture').disabled = isPending(); }
});
$('capture-all').addEventListener('click', async () => {
  if (!window.confirm(`Queue missing ${state.mode} captures across all ${state.cases.length} cases? This may take some time. Existing baselines will not be changed.`)) return;
  $('capture-all').disabled = true;
  try {
    await api('/api/capture-all', { mode: state.mode, repeat: false });
    notice('Missing captures queued. You can continue reviewing while the renderer works.');
    await poll();
  } catch (error) { notice(`Unable to queue captures: ${error.message}`); }
  finally { $('capture-all').disabled = false; }
});
window.addEventListener('beforeunload', (event) => {
  if (state.dirty || state.saving) { event.preventDefault(); event.returnValue = ''; }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopBlink();
  else if (state.detail) renderCapture();
});
(async function start() {
  try {
    const params = new URLSearchParams(location.search);
    const requestedMode = params.get('mode');
    if (['development', 'production'].includes(requestedMode)) {
      state.mode = requestedMode;
      $('mode').value = requestedMode;
    }
    await loadCases();
    const requestedCase = params.get('case');
    const linked = requestedCase ? resolveCase(requestedCase) : null;
    if (linked && !filteredCases().includes(linked)) { $('filter').value = 'all'; renderList(); }
    if (requestedCase && !linked) notice(`Case “${requestedCase}” was not found. Choose a case from the list.`);
    const first = linked || filteredCases()[0];
    if (first) await selectCase(first.id);
    else {
      $('empty-state').firstElementChild.textContent = state.cases.length ? 'No cases need feedback' : 'No cases available';
      $('empty-state').lastElementChild.textContent = 'Choose “All cases” to explore the full corpus.';
    }
    await poll();
  } catch (error) {
    notice(`Unable to load cases: ${error.message}. Reload this page to retry.`);
    $('empty-state').firstElementChild.textContent = 'Workspace unavailable';
    $('empty-state').lastElementChild.textContent = 'Check that the local review server is running.';
  }
  setInterval(poll, 1800);
})();
