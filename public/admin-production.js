(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));

  const dangerWords = ['elimina','reset','azzera','nuovo torneo','archivia','chiudi torneo','forza','squalifica'];

  const professionalMenu = [
    { label: 'Dashboard', hint: 'Regia live', icon: '🎛️', aliases: ['dashboard','home','overview','regia'] },
    { label: 'Torneo Live', hint: 'Stato e match', icon: '🏆', aliases: ['torneo','live','stato','match corrente','prossimo match'] },
    { label: 'Team', hint: 'Iscritti e slot', icon: '👥', aliases: ['team','iscritti','registrati','slot'] },
    { label: 'Match', hint: 'Risultati per match', icon: '🎮', aliases: ['match','partite','round'] },
    { label: 'Risultati', hint: 'Pending staff', icon: '📸', aliases: ['risultati','pending','approva','in attesa'] },
    { label: 'Classifiche', hint: 'Team e fragger', icon: '📊', aliases: ['classifica','classifiche','fragger','leaderboard'] },
    { label: 'Discord', hint: 'Pannelli e stanze', icon: '💬', aliases: ['discord','stanze','pannelli','canali','bot'] },
    { label: 'Archivio', hint: 'Storico tornei', icon: '🗂️', aliases: ['archivio','storico','tornei salvati'] },
    { label: 'Staff', hint: 'Admin e ruoli', icon: '🛡️', aliases: ['staff','admin','utenti','account','ruoli'] },
    { label: 'Impostazioni', hint: 'Configurazione', icon: '⚙️', aliases: ['impostazioni','settings','config','opzioni'] }
  ];

  function toast(title, text) {
    let el = $('.roda-admin-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'roda-admin-toast';
      document.body.appendChild(el);
    }
    el.innerHTML = `<b>${escapeHtml(title)}</b><span>${escapeHtml(text)}</span>`;
    el.classList.add('show');
    clearTimeout(el.__timer);
    el.__timer = setTimeout(() => el.classList.remove('show'), 4200);
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[c]));
  }

  function textOf(el) {
    return (el && el.textContent ? el.textContent : '').replace(/\s+/g, ' ').trim();
  }

  function normalize(value) {
    return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function allOriginalNavItems() {
    return $$('.nav button, .nav a.nav-ext, .sidebar button, .sidebar a').filter(el => {
      if (el.closest('.roda-pro-menu')) return false;
      const txt = textOf(el);
      return txt && txt.length < 80;
    });
  }

  function findOriginalMenuTarget(item) {
    const originals = allOriginalNavItems();
    const scored = originals.map(el => {
      const txt = normalize(textOf(el));
      let score = 0;
      item.aliases.forEach(alias => {
        const a = normalize(alias);
        if (!a) return;
        if (txt === a) score += 10;
        else if (txt.includes(a)) score += 5;
        else if (a.includes(txt) && txt.length > 3) score += 2;
      });
      return { el, score };
    }).sort((a,b) => b.score - a.score);
    return scored[0] && scored[0].score > 0 ? scored[0].el : null;
  }

  function clickByText(texts) {
    const lowerTexts = texts.map(t => normalize(t));
    const candidates = $$('button, a, [role="button"]');
    const found = candidates.find(el => {
      if (el.closest('.roda-pro-menu')) return false;
      const txt = normalize(textOf(el));
      return lowerTexts.some(t => txt.includes(t));
    });
    if (found) {
      found.click();
      return true;
    }
    toast('Azione non trovata', 'Questa azione non è ancora collegata nella pagina corrente.');
    return false;
  }

  function setActiveNavByText(text) {
    const wanted = normalize(text);
    const target = $$('button, a').find(el => {
      if (el.closest('.roda-pro-menu')) return false;
      return normalize(textOf(el)).includes(wanted);
    });
    if (target) target.click();
  }

  function getStatText(labels) {
    const stats = $$('.stat, .roda-status-tile, .box, .card');
    for (const stat of stats) {
      const text = normalize(textOf(stat));
      if (labels.some(label => text.includes(normalize(label)))) {
        const strong = stat.querySelector('strong');
        if (strong && strong.textContent.trim()) return strong.textContent.trim();
      }
    }
    return '—';
  }

  function installProfessionalMenu() {
    const sidebar = $('.sidebar');
    const nav = $('.sidebar .nav') || $('.nav');
    if (!sidebar || !nav || $('.roda-pro-menu')) return;

    const oldNav = nav;
    oldNav.classList.add('roda-original-nav-hidden');

    const menu = document.createElement('nav');
    menu.className = 'roda-pro-menu';
    menu.setAttribute('aria-label', 'Menu regia torneo');

    const title = document.createElement('div');
    title.className = 'roda-pro-menu-title';
    title.innerHTML = `<span>Menu torneo</span><small>Regia operativa</small>`;
    menu.appendChild(title);

    professionalMenu.forEach((item, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'roda-pro-menu-item';
      btn.dataset.rodaMenu = item.label;
      btn.innerHTML = `<span class="roda-pro-icon">${item.icon}</span><span class="roda-pro-copy"><b>${item.label}</b><small>${item.hint}</small></span>`;
      btn.addEventListener('click', () => {
        $$('.roda-pro-menu-item').forEach(x => x.classList.remove('active'));
        btn.classList.add('active');
        const target = findOriginalMenuTarget(item);
        if (target) {
          target.click();
          toast(item.label, `Sezione aperta: ${item.hint}.`);
        } else if (index === 0) {
          const first = allOriginalNavItems()[0];
          if (first) first.click();
        } else {
          toast('Sezione da collegare', `${item.label}: non ho trovato una voce originale corrispondente.`);
        }
      });
      if (index === 0) btn.classList.add('active');
      menu.appendChild(btn);
    });

    const utilities = document.createElement('div');
    utilities.className = 'roda-pro-utility';
    utilities.innerHTML = `
      <button type="button" data-roda-action="results">📸 Pending</button>
      <button type="button" data-roda-action="leaderboard">📊 Classifiche</button>
    `;
    menu.appendChild(utilities);

    oldNav.parentNode.insertBefore(menu, oldNav);
  }

  function buildCommandCenter() {
    if ($('.roda-command-center')) return;
    const content = $('.content') || $('.main') || document.body;
    const firstPage = $('.page.active') || $('.page') || content.firstElementChild;
    const wrapper = document.createElement('section');
    wrapper.className = 'roda-command-center';
    wrapper.innerHTML = `
      <div class="roda-command-card">
        <div class="roda-command-title">
          <div><h2>Regia torneo</h2><p>Azioni principali per gestire un evento live senza cercare tra mille sezioni.</p></div>
          <div class="roda-live-badge">Pannello pronto</div>
        </div>
        <div class="roda-quick-grid">
          <button class="roda-quick-action" data-roda-action="open-registrations"><b>Apri iscrizioni</b><span>Avvia raccolta team e pannello Discord</span></button>
          <button class="roda-quick-action" data-roda-action="generate-rooms"><b>Genera stanze</b><span>Crea vocali e pannelli team</span></button>
          <button class="roda-quick-action" data-roda-action="results"><b>Risultati pending</b><span>Vai subito alle approvazioni</span></button>
          <button class="roda-quick-action" data-roda-action="leaderboard"><b>Classifiche</b><span>Controlla team e top fragger</span></button>
        </div>
      </div>
      <div class="roda-command-card">
        <div class="roda-command-title"><div><h2>Stato evento</h2><p>Controlli rapidi prima di iniziare o passare match.</p></div></div>
        <div class="roda-status-grid">
          <div class="roda-status-tile"><span>Match corrente</span><strong data-roda-stat="match">${getStatText(['match corrente','current match'])}</strong></div>
          <div class="roda-status-tile"><span>Team iscritti</span><strong data-roda-stat="teams">${getStatText(['team registrati','team iscritti','iscritti'])}</strong></div>
          <div class="roda-status-tile"><span>Pending</span><strong data-roda-stat="pending">${getStatText(['pending','in attesa'])}</strong></div>
          <div class="roda-status-tile"><span>Sistema</span><strong>LIVE</strong></div>
        </div>
      </div>`;
    if (firstPage && firstPage.parentNode) firstPage.parentNode.insertBefore(wrapper, firstPage);
    else content.prepend(wrapper);
  }

  function buildWorkflow() {
    if ($('.roda-workflow')) return;
    const command = $('.roda-command-center');
    if (!command) return;
    const flow = document.createElement('section');
    flow.className = 'roda-workflow';
    flow.innerHTML = `
      <div class="roda-step" data-step="01"><b>Configura torneo</b><span>Nome fisso RØDA CUP, match, iscrizioni e canali.</span></div>
      <div class="roda-step" data-step="02"><b>Apri iscrizioni</b><span>I team entrano e vengono verificati prima del live.</span></div>
      <div class="roda-step" data-step="03"><b>Genera Discord</b><span>Stanze, pannelli match e canale classifica.</span></div>
      <div class="roda-step" data-step="04"><b>Gestisci match</b><span>Approva risultati, foto e punti reali.</span></div>
      <div class="roda-step" data-step="05"><b>Archivia evento</b><span>Salva storico e prepara il prossimo torneo.</span></div>`;
    command.insertAdjacentElement('afterend', flow);
  }

  function enhanceDangerButtons() {
    $$('button, a, [role="button"]').forEach(el => {
      if (el.__rodaDangerEnhanced) return;
      const text = normalize(textOf(el));
      if (!dangerWords.some(word => text.includes(normalize(word)))) return;
      el.__rodaDangerEnhanced = true;
      el.classList.add('btn-danger-confirm');
      el.addEventListener('click', event => {
        if (el.__rodaConfirmedAt && Date.now() - el.__rodaConfirmedAt < 5000) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        el.__rodaConfirmedAt = Date.now();
        toast('Conferma richiesta', `Premi di nuovo “${textOf(el) || 'azione'}” entro 5 secondi per confermare.`);
      }, true);
    });
  }

  function labelSections() {
    const title = $('.page-title');
    if (title && !title.dataset.productionLabel) {
      title.dataset.productionLabel = 'true';
      const sub = $('.page-sub');
      if (sub && !normalize(sub.textContent).includes('regia')) {
        sub.textContent = 'Regia operativa RØDA CUP: controlli torneo, team, match, risultati, Discord e archivi.';
      }
    }
  }

  function bindActions() {
    document.addEventListener('click', event => {
      const action = event.target.closest('[data-roda-action]');
      if (!action) return;
      const type = action.dataset.rodaAction;
      if (type === 'open-registrations') clickByText(['apri iscrizioni', 'iscrizioni aperte']);
      if (type === 'generate-rooms') clickByText(['genera stanze', 'crea stanze', 'genera struttura']);
      if (type === 'results') setActiveNavByText('risult');
      if (type === 'leaderboard') setActiveNavByText('classific');
    });
  }

  function refreshProductionLayer() {
    document.body.classList.add('roda-admin-production');
    installProfessionalMenu();
    buildCommandCenter();
    buildWorkflow();
    enhanceDangerButtons();
    labelSections();
  }

  document.addEventListener('DOMContentLoaded', () => {
    refreshProductionLayer();
    bindActions();
    toast('Regia torneo attiva', 'Dashboard e menù ottimizzati per il prossimo torneo RØDA CUP.');
    const observer = new MutationObserver(() => refreshProductionLayer());
    observer.observe(document.body, { childList: true, subtree: true });
  });
})();
