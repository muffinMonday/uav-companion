// Build-time HTML only. Register new components here; includes never accept filesystem paths.
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const COMPONENT_NAMES = Object.freeze([
  'search.html', 'dock.html', 'panel.html', 'map-config.html',
  'trips-panel.html', 'poi-panel.html', 'privacy-panel.html', 'dashboard.html',
]);

/** Expand standalone <!-- include: name.html --> lines, preserving fragment markup. */
export function assembleHtml(html, root) {
  const directory = path.resolve(root, 'src/components');
  const error = (message, chain) => new Error(`[html-components] ${message} (${chain.join(' -> ')})`);
  function expand(text, chain) {
    const result = text.replace(/^[\t ]*<!--[\t ]*include:[\t ]*([^\r\n]*?)[\t ]*-->[\t ]*(\r?\n|$)/gm, (_, name, newline) => {
      const next = [...chain, name];
      if (!COMPONENT_NAMES.includes(name)) throw error(`Unknown component "${name}"; use a registered filename`, next);
      if (chain.includes(name)) throw error('Include cycle', next);
      let fragment;
      try { fragment = readFileSync(path.join(directory, name), 'utf8'); }
      catch (cause) { throw error(`Cannot read "${name}": ${cause.code}`, next); }
      const content = expand(fragment, next);
      return content + (newline && !content.endsWith('\n') ? newline : '');
    });
    if (/<!--\s*include\b/i.test(result)) throw error('Malformed include; use a standalone <!-- include: name.html --> line', chain);
    return result;
  }
  return expand(html, ['index.html']);
}

export function htmlComponents() {
  let root;
  return {
    name: 'html-components',
    configResolved(config) { root = config.root; },
    buildStart() {
      for (const name of COMPONENT_NAMES) this.addWatchFile(path.resolve(root, 'src/components', name));
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) { return assembleHtml(html, root); },
    },
    configureServer(server) {
      const directory = path.resolve(server.config.root, 'src/components');
      server.watcher.add(directory);
      const reload = (event, file) => {
        if (['add', 'change', 'unlink'].includes(event) && COMPONENT_NAMES.includes(path.relative(directory, file))) {
          server.ws.send({ type: 'full-reload', path: '*' });
        }
      };
      server.watcher.on('all', reload);
      server.httpServer?.once('close', () => server.watcher.off('all', reload));
    },
  };
}
