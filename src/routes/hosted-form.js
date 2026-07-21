/**
 * Hosted Form Page + Embed Widget
 * Epic 2.5, MP-2.5-S9/S10 — the actual renderable surfaces a GP shares as a
 * link/QR code or embeds on their own website. The public JSON API
 * (routes/v1/public-forms.js) only returns data; this is what turns that
 * data into something an applicant can fill out.
 *
 * The page shell below is identical for every slug — it hydrates by
 * fetching /api/v1/public/forms/:slug client-side, so branding fields never
 * get server-interpolated into HTML (avoids reflecting untrusted GP-entered
 * strings unescaped).
 */

const express = require('express');
const router = express.Router();
const { publicFormRateLimiter } = require('../middleware/publicFormProtection');

router.get('/forms/:slug', publicFormRateLimiter, (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderShell());
});

router.get('/embed.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(EMBED_SCRIPT);
});

function renderShell() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Application</title>
<meta name="robots" content="noindex" />
<style>
  :root {
    --accent: #7C3AED;
    --text: #1a1a1f;
    --muted: #6b6b76;
    --border: #e4e2e8;
    --bg: #ffffff;
    --danger: #c0392b;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: var(--flora-font, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
    color: var(--text);
    background: var(--bg);
    line-height: 1.5;
  }
  .wrap { max-width: 560px; margin: 0 auto; padding: 32px 20px 60px; }
  .header-image { width: 100%; max-height: 220px; object-fit: cover; border-radius: 12px; margin-bottom: 20px; display: none; }
  .brand-row { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; }
  .brand-row img { height: 32px; width: auto; display: none; }
  h1 { font-size: 24px; font-weight: 700; margin: 0 0 8px; }
  .desc { color: var(--muted); font-size: 15px; margin: 0 0 28px; }
  .field { margin-bottom: 20px; }
  .field.hidden { display: none; }
  label { display: block; font-size: 14px; font-weight: 600; margin-bottom: 6px; }
  label .opt { font-weight: 400; color: var(--muted); }
  .help { font-size: 12.5px; color: var(--muted); margin-top: 4px; }
  input[type="text"], input[type="email"], input[type="tel"], input[type="number"],
  input[type="date"], input[type="url"], textarea, select {
    width: 100%; font: inherit; font-size: 15px; padding: 10px 12px;
    border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text);
  }
  input:focus, textarea:focus, select:focus { outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }
  textarea { resize: vertical; min-height: 90px; }
  .section-header { font-size: 17px; font-weight: 700; margin: 30px 0 6px; padding-top: 16px; border-top: 1px solid var(--border); }
  .checkbox-group label { display: flex; align-items: center; gap: 8px; font-weight: 400; margin-bottom: 6px; }
  .checkbox-group input { width: auto; }
  .file-drop {
    border: 1.5px dashed var(--border); border-radius: 8px; padding: 18px; text-align: center;
    font-size: 13.5px; color: var(--muted); cursor: pointer;
  }
  .file-drop.busy { opacity: 0.6; pointer-events: none; }
  .file-drop.done { border-color: var(--accent); color: var(--text); }
  .field-error { color: var(--danger); font-size: 12.5px; margin-top: 5px; display: none; }
  .field.invalid input, .field.invalid textarea, .field.invalid select { border-color: var(--danger); }
  .field.invalid .field-error { display: block; }
  .actions { display: flex; justify-content: space-between; gap: 10px; margin-top: 28px; }
  button {
    font: inherit; font-size: 15px; font-weight: 600; padding: 11px 22px; border-radius: 8px;
    border: none; cursor: pointer; background: var(--accent); color: #fff;
  }
  button.secondary { background: transparent; color: var(--muted); border: 1px solid var(--border); }
  button:disabled { opacity: 0.6; cursor: default; }
  .hp { position: absolute; left: -9999px; top: -9999px; }
  .state { text-align: center; padding: 60px 20px; }
  .state h2 { font-size: 20px; margin-bottom: 8px; }
  .state p { color: var(--muted); }
  .state a { color: var(--accent); }
  .powered { text-align: center; font-size: 11.5px; color: var(--muted); margin-top: 40px; }
  .powered a { color: inherit; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
  <div class="wrap">
    <div id="loading" class="state"><p>Loading…</p></div>
    <div id="unavailable" class="state" hidden>
      <h2>This application isn't available right now</h2>
      <p>It may have closed, reached its limit, or the link may be out of date.</p>
    </div>
    <div id="success" class="state" hidden>
      <h2 id="successMessage"></h2>
      <p id="successRedirect" hidden><a id="successLink" href="#">Continue</a></p>
    </div>
    <form id="form" hidden>
      <img id="headerImage" class="header-image" alt="" />
      <div class="brand-row"><img id="logo" alt="" /></div>
      <h1 id="formName"></h1>
      <p class="desc" id="formDesc"></p>
      <div id="fields"></div>
      <input class="hp" type="text" name="_hp" id="hp" tabindex="-1" autocomplete="off" />
      <div class="actions">
        <button type="button" id="backBtn" class="secondary" hidden>Back</button>
        <span style="flex:1"></span>
        <button type="button" id="nextBtn" hidden>Next</button>
        <button type="submit" id="submitBtn" hidden>Submit</button>
      </div>
    </form>
    <div class="powered">Powered by <a href="https://flora.dev" target="_blank" rel="noopener">Flora</a></div>
  </div>
<script>
${CLIENT_SCRIPT}
</script>
</body>
</html>`;
}

const CLIENT_SCRIPT = `
(function () {
  var slug = location.pathname.replace(/^\\/forms\\//, '').replace(/\\/$/, '');
  var apiBase = '/api/v1/public/forms/' + encodeURIComponent(slug);
  var form, fields = [], answers = {}, files = [], page = 1, maxPage = 1, started = false;

  var els = {
    loading: document.getElementById('loading'),
    unavailable: document.getElementById('unavailable'),
    success: document.getElementById('success'),
    successMessage: document.getElementById('successMessage'),
    successRedirect: document.getElementById('successRedirect'),
    successLink: document.getElementById('successLink'),
    form: document.getElementById('form'),
    headerImage: document.getElementById('headerImage'),
    logo: document.getElementById('logo'),
    formName: document.getElementById('formName'),
    formDesc: document.getElementById('formDesc'),
    fieldsContainer: document.getElementById('fields'),
    backBtn: document.getElementById('backBtn'),
    nextBtn: document.getElementById('nextBtn'),
    submitBtn: document.getElementById('submitBtn')
  };

  function show(el) { el.hidden = false; }
  function hide(el) { el.hidden = true; }

  function postResize() {
    var height = document.body.scrollHeight;
    try { parent.postMessage({ type: 'flora-form-resize', slug: slug, height: height }, '*'); } catch (e) {}
  }

  function markStarted() {
    if (started) return;
    started = true;
    fetch(apiBase + '/start', { method: 'POST' }).catch(function () {});
  }

  function isVisible(field) {
    if (!field.conditional) return true;
    var actual = answers[field.conditional.fieldId];
    var value = field.conditional.value;
    switch (field.conditional.operator) {
      case 'not_equals': return actual !== value;
      case 'contains': return Array.isArray(actual) ? actual.indexOf(value) !== -1 : String(actual || '').indexOf(value) !== -1;
      default: return actual === value;
    }
  }

  function fieldEl(id) { return document.querySelector('[data-field="' + id + '"]'); }

  function refreshVisibility() {
    fields.forEach(function (f) {
      var el = fieldEl(f.id);
      if (!el) return;
      el.classList.toggle('hidden', !isVisible(f));
    });
  }

  function buildField(field) {
    var wrap = document.createElement('div');
    wrap.className = 'field';
    wrap.dataset.field = field.id;
    wrap.dataset.page = field.page || 1;

    if (field.type === 'section_header') {
      var h = document.createElement('div');
      h.className = 'section-header';
      h.textContent = field.label;
      wrap.appendChild(h);
      wrap.className += ' section-header-wrap';
      return wrap;
    }

    var label = document.createElement('label');
    label.textContent = field.label + ' ';
    if (!field.required) {
      var opt = document.createElement('span');
      opt.className = 'opt';
      opt.textContent = '(optional)';
      label.appendChild(opt);
    }
    wrap.appendChild(label);

    var input;
    if (field.type === 'long_text') {
      input = document.createElement('textarea');
    } else if (field.type === 'dropdown') {
      input = document.createElement('select');
      var blank = document.createElement('option');
      blank.value = ''; blank.textContent = 'Select…';
      input.appendChild(blank);
      (field.options || []).forEach(function (opt) {
        var o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        input.appendChild(o);
      });
    } else if (field.type === 'multi_select') {
      var group = document.createElement('div');
      group.className = 'checkbox-group';
      (field.options || []).forEach(function (opt) {
        var l = document.createElement('label');
        var cb = document.createElement('input');
        cb.type = 'checkbox'; cb.value = opt; cb.name = field.id;
        cb.addEventListener('change', function () {
          var current = answers[field.id] || [];
          if (cb.checked) { current = current.concat([opt]); } else { current = current.filter(function (v) { return v !== opt; }); }
          answers[field.id] = current;
          markStarted();
        });
        l.appendChild(cb);
        l.appendChild(document.createTextNode(opt));
        group.appendChild(l);
      });
      wrap.appendChild(group);
      var err = document.createElement('div');
      err.className = 'field-error';
      err.textContent = field.label + ' is required';
      wrap.appendChild(err);
      return wrap;
    } else if (field.type === 'file_upload') {
      var drop = document.createElement('label');
      drop.className = 'file-drop';
      drop.textContent = 'Click to upload' + (field.required ? '' : ' (optional)');
      var fileInput = document.createElement('input');
      fileInput.type = 'file'; fileInput.style.display = 'none';
      if (field.validation && field.validation.allowedFileTypes) {
        fileInput.accept = field.validation.allowedFileTypes.join(',');
      }
      fileInput.addEventListener('change', function () {
        var f = fileInput.files[0];
        if (!f) return;
        drop.classList.add('busy');
        drop.textContent = 'Uploading…';
        var body = new FormData();
        body.append('file', f);
        body.append('fieldId', field.id);
        fetch(apiBase + '/upload', { method: 'POST', body: body })
          .then(function (r) { return r.json().then(function (json) { return { ok: r.ok, json: json }; }); })
          .then(function (res) {
            drop.classList.remove('busy');
            if (!res.ok) {
              drop.textContent = res.json.error || 'Upload failed — click to retry';
              return;
            }
            files = files.filter(function (ref) { return ref.fieldId !== field.id; });
            files.push(res.json);
            drop.classList.add('done');
            drop.textContent = f.name + ' — uploaded';
          })
          .catch(function () {
            drop.classList.remove('busy');
            drop.textContent = 'Upload failed — click to retry';
          });
      });
      drop.appendChild(fileInput);
      wrap.appendChild(drop);
      var ferr = document.createElement('div');
      ferr.className = 'field-error';
      ferr.textContent = field.label + ' is required';
      wrap.appendChild(ferr);
      return wrap;
    } else {
      input = document.createElement('input');
      var typeMap = { email: 'email', phone: 'tel', number: 'number', date: 'date', url: 'url' };
      input.type = typeMap[field.type] || 'text';
    }

    input.name = field.id;
    if (field.placeholder) input.placeholder = field.placeholder;
    input.addEventListener('input', function () {
      answers[field.id] = input.value;
      markStarted();
      refreshVisibility();
    });
    if (field.type === 'dropdown') {
      input.addEventListener('change', function () { answers[field.id] = input.value; refreshVisibility(); });
    }
    wrap.appendChild(input);

    if (field.helpText) {
      var help = document.createElement('div');
      help.className = 'help';
      help.textContent = field.helpText;
      wrap.appendChild(help);
    }
    var errEl = document.createElement('div');
    errEl.className = 'field-error';
    errEl.textContent = field.label + ' is required';
    wrap.appendChild(errEl);

    return wrap;
  }

  function renderPage() {
    fields.forEach(function (f) {
      var el = fieldEl(f.id);
      if (!el) return;
      el.style.display = (Number(el.dataset.page) === page) ? '' : 'none';
    });
    els.backBtn.hidden = page <= 1;
    var isLast = page >= maxPage;
    els.nextBtn.hidden = isLast;
    els.submitBtn.hidden = !isLast;
    postResize();
  }

  function validatePage() {
    var valid = true;
    fields.forEach(function (f) {
      if (f.type === 'section_header') return;
      if (Number(f.page || 1) !== page) return;
      var el = fieldEl(f.id);
      if (!el || el.classList.contains('hidden') || !isVisible(f)) { if (el) el.classList.remove('invalid'); return; }
      if (!f.required) { el.classList.remove('invalid'); return; }

      var hasValue;
      if (f.type === 'file_upload') {
        hasValue = files.some(function (r) { return r.fieldId === f.id; });
      } else if (f.type === 'multi_select') {
        hasValue = (answers[f.id] || []).length > 0;
      } else {
        hasValue = answers[f.id] !== undefined && String(answers[f.id]).trim() !== '';
      }
      el.classList.toggle('invalid', !hasValue);
      if (!hasValue) valid = false;
    });
    return valid;
  }

  els.backBtn.addEventListener('click', function () { page = Math.max(1, page - 1); renderPage(); });
  els.nextBtn.addEventListener('click', function () {
    if (!validatePage()) return;
    page = Math.min(maxPage, page + 1);
    renderPage();
  });

  els.form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!validatePage()) return;
    els.submitBtn.disabled = true;
    els.submitBtn.textContent = 'Submitting…';

    var body = { answers: answers, files: files };
    body[document.getElementById('hp').name] = document.getElementById('hp').value;

    fetch(apiBase + '/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (r) { return r.json().then(function (json) { return { ok: r.ok, json: json }; }); })
      .then(function (res) {
        if (!res.ok) {
          els.submitBtn.disabled = false;
          els.submitBtn.textContent = 'Submit';
          alert(res.json.error || 'Something went wrong — please try again.');
          return;
        }
        hide(els.form);
        show(els.success);
        els.successMessage.textContent = res.json.message || 'Thanks — your response has been received.';
        if (res.json.redirectUrl) {
          els.successLink.href = res.json.redirectUrl;
          show(els.successRedirect);
          setTimeout(function () { location.href = res.json.redirectUrl; }, 2500);
        }
        postResize();
      })
      .catch(function () {
        els.submitBtn.disabled = false;
        els.submitBtn.textContent = 'Submit';
        alert('Network error — please try again.');
      });
  });

  fetch(apiBase)
    .then(function (r) { return r.json().then(function (json) { return { ok: r.ok, json: json }; }); })
    .then(function (res) {
      hide(els.loading);
      if (!res.ok) { show(els.unavailable); postResize(); return; }

      var data = res.json.form;
      fields = data.fields || [];
      maxPage = fields.reduce(function (max, f) { return Math.max(max, f.page || 1); }, 1);

      document.title = data.name;
      els.formName.textContent = data.name;
      els.formDesc.textContent = data.description || '';

      var branding = data.branding || {};
      if (branding.accentColor) document.documentElement.style.setProperty('--accent', branding.accentColor);
      if (branding.fontFamily) document.body.style.setProperty('--flora-font', branding.fontFamily);
      if (branding.logoUrl) { els.logo.src = branding.logoUrl; els.logo.style.display = ''; }
      if (branding.headerImageUrl) { els.headerImage.src = branding.headerImageUrl; els.headerImage.style.display = ''; }
      if (branding.buttonText) { els.submitBtn.textContent = branding.buttonText; }
      else { els.submitBtn.textContent = 'Submit'; }

      fields.forEach(function (f) { els.fieldsContainer.appendChild(buildField(f)); });
      refreshVisibility();
      renderPage();
      show(els.form);
      postResize();
    })
    .catch(function () {
      hide(els.loading);
      show(els.unavailable);
    });

  window.addEventListener('resize', postResize);
})();
`;

const EMBED_SCRIPT = `
(function () {
  var thisScript = document.currentScript;
  if (!thisScript) return;

  var slug = thisScript.getAttribute('data-flora-form');
  if (!slug) { console.error('[Flora embed] missing data-flora-form attribute'); return; }

  var origin = new URL(thisScript.src, location.href).origin;
  var targetId = thisScript.getAttribute('data-flora-target');
  var container = targetId ? document.getElementById(targetId) : null;

  var iframe = document.createElement('iframe');
  iframe.src = origin + '/forms/' + encodeURIComponent(slug);
  iframe.title = 'Application form';
  iframe.style.width = '100%';
  iframe.style.border = '0';
  iframe.style.minHeight = '400px';
  iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups');

  if (container) {
    container.appendChild(iframe);
  } else {
    thisScript.parentNode.insertBefore(iframe, thisScript);
  }

  window.addEventListener('message', function (event) {
    if (!event.data || event.data.type !== 'flora-form-resize') return;
    if (event.data.slug !== slug) return;
    if (event.source !== iframe.contentWindow) return;
    iframe.style.height = Math.max(300, event.data.height) + 'px';
  });
})();
`;

module.exports = router;
