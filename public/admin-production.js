(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));

  const dangerWords = [
    'elimina',
    'reset',
    'azzera',
    'nuovo torneo',
    'archivia',
    'chiudi torneo',
    'forza',
    'squalifica'
  ];

  function toast(title, text) {
    let el = $('.roda-admin-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'roda-admin-toast';
      document.body.appendChild(el);
    }
    el.innerHTML = `<b>${title}</b><span>${text}</span>`;
    el.classList.add('show');
    clearTimeout(el.__timer);
    el.__timer = setTimeout(() => el.classList.remove('show'), 4200);
  }

  function clickByText(texts) {
    const lowerTexts = texts.map(t => String(t).toLowerCase());
    const candidates = $$('button, a, [role="button"]');
    const found = candidates.find(el => {
      const txt = (el.textContent || '').trim().toLowerCase();
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
    const target = $$('button, a').find(el => (el.textContent || '').toLowerCase().includes(text.toLowerCase()));
    if (target) target.click();
  }

  function getStatText(labels) {
    const stats = $$('.stat, .roda-status-tile, .box, .card');
    for (const stat of stats) {
      const text = (stat.textContent || '').toLowerCase();
      if (labels.some(label => text.includes(label))) {
        const strong = stat.querySelector('strong');
        if (strong && strong.textContent.trim()) return strong.textContent.trim();
      }
    }
    return '—';
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
          <div>
            <h2>Regia torneo</h2>
            <p>Azioni principali per gestire un evento live senza cercare tra mille sezioni.</p>
          </div>
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
        <div class="roda-command-title">
          <div>
            <h2>Stato evento</h2>
            <p>Controlli rapidi prima di iniziare o passare match.</p>
          </div>
        </div>
        <div class="roda-status-grid">
          <div class="roda-status-tile"><span>Match corrente</span><strong data-roda-stat="match">${getStatText(['match corrente','current match'])}</strong></div>
          <div class="roda-status-tile"><span>Team iscritti</span><strong data-roda-stat="teams">${getStatText(['team registrati','team iscritti','iscritti'])}</strong></div>
          <div class="roda-status-tile"><span>Pending</span><strong data-roda-stat="pending">${getStatText(['pending','in attesa'])}</strong></div>
          <div class="roda-status-tile"><span>Sistema</span><strong>LIVE</strong></div>
        </div>
      </div>
    `;

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
      <div class="roda-step" data-step="05"><b>Archivia evento</b><span>Salva storico e prepara il prossimo torneo.</span></div>
    `;
    command.insertAdjacentElement('afterend', flow);
  }

  function enhanceDangerButtons() {
    $$('button, a, [role="button"]').forEach(el => {
      if (el.__rodaDangerEnhanced) return;
      const text = (el.textContent || '').trim().toLowerCase();
      if (!dangerWords.some(word => text.includes(word))) return;
      el.__rodaDangerEnhanced = true;
      el.classList.add('btn-danger-confirm');
      el.addEventListener('click', event => {
        if (el.__rodaConfirmedAt && Date.now() - el.__rodaConfirmedAt < 5000) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        el.__rodaConfirmedAt = Date.now();
        toast('Conferma richiesta', `Premi di nuovo “${(el.textContent || 'azione').trim()}” entro 5 secondi per confermare.`);
      }, true);
    });
  }

  function labelSections() {
    const title = $('.page-title');
    if (title && !title.dataset.productionLabel) {
      title.dataset.productionLabel = 'true';
      const sub = $('.page-sub');
      if (sub && !sub.textContent.includes('regia')) {
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
    buildCommandCenter();
    buildWorkflow();
    enhanceDangerButtons();
    labelSections();
  }

  document.addEventListener('DOMContentLoaded', () => {
    refreshProductionLayer();
    bindActions();
    toast('Regia torneo attiva', 'Dashboard ottimizzata per gestire il prossimo torneo RØDA CUP.');
    const observer = new MutationObserver(() => refreshProductionLayer());
    observer.observe(document.body, { childList: true, subtree: true });
  });
})();
