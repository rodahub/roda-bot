'use strict';

/**
 * RODA CUP startup guard.
 *
 * This file is loaded before legacy preload files. It blocks unsafe route
 * registration patterns and keeps production startup strict.
 */

const Module = require('module');

const BLOCKED_LEGACY_ROUTES = new Set([
  '/api/dashboard/team-slot',
  '/api/dashboard/team-slots/recalibrate'
]);

function shouldBlockLegacyRoute(pathValue) {
  if (process.env.ENABLE_LEGACY_TEAM_SLOT_ROUTES === 'true') {
    return false;
  }

  return typeof pathValue === 'string' && BLOCKED_LEGACY_ROUTES.has(pathValue);
}

function installExpressRouteGuard(expressModule) {
  if (!expressModule || expressModule.__rodaStartupGuardPatched) {
    return expressModule;
  }

  const originalExpress = expressModule;

  function patchApp(app) {
    if (!app || app.__rodaRouteGuardInstalled) {
      return app;
    }

    Object.defineProperty(app, '__rodaRouteGuardInstalled', {
      value: true,
      enumerable: false
    });

    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      if (typeof app[method] !== 'function') continue;

      const original = app[method];

      app[method] = function guardedRoute(pathValue, ...handlers) {
        if (shouldBlockLegacyRoute(pathValue)) {
          console.warn(`[startup-guard] Rotta legacy non autenticata bloccata: ${method.toUpperCase()} ${pathValue}`);
          return this;
        }

        return original.call(this, pathValue, ...handlers);
      };
    }

    return app;
  }

  function guardedExpress(...args) {
    return patchApp(originalExpress(...args));
  }

  Object.setPrototypeOf(guardedExpress, originalExpress);
  Object.assign(guardedExpress, originalExpress);
  guardedExpress.application = originalExpress.application;
  guardedExpress.request = originalExpress.request;
  guardedExpress.response = originalExpress.response;
  guardedExpress.Router = originalExpress.Router;
  guardedExpress.__rodaStartupGuardPatched = true;

  return guardedExpress;
}

try {
  const expressPath = require.resolve('express');
  const originalLoad = Module._load;

  Module._load = function guardedLoad(request, parent, isMain) {
    const loaded = originalLoad.apply(this, arguments);

    if (request === 'express') {
      return installExpressRouteGuard(loaded);
    }

    return loaded;
  };

  if (require.cache[expressPath]?.exports) {
    require.cache[expressPath].exports = installExpressRouteGuard(require.cache[expressPath].exports);
  }
} catch (error) {
  console.error('[startup-guard] Impossibile installare guard Express:', error.message);
}
