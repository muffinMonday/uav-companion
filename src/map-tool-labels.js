// The words of the More tools menu (map-more-tools.js). Pure (no DOM), so Node tests can use it.
// Each left-hand map button carries data-tool. Zoom, locate and the compass stay on the map; the rest live in the menu. A row names the thing and
// says how it is now, from the state the owning module already keeps on its button (aria-pressed: the feature is on). The rows never hold state of their own.
export const DIRECT = ['locate', 'compass'];                                        // stay on the map as buttons
export const FOLDED = ['details', 'side-quests', 'trips', 'crosshair', 'sessions']; // reached from More tools, in this order
export const TOOLS = [...DIRECT, 'more', ...FOLDED];

/** `state`: { pressed: true | false | null (an action with no on/off state) }. Returns { name, state } for a row, or null for an unknown tool. */
export function toolRow(tool, { pressed = null } = {}) {
  const on = (a, b) => (pressed ? a : b);
  switch (tool) {
    case 'details': return { name: 'Marker details', state: on('On', 'Off') };
    case 'side-quests': return { name: 'Side Quests', state: on('All shown', 'Open stop only') };
    case 'trips': return { name: 'Trip markers', state: on('Shown', 'Hidden') };
    case 'crosshair': return { name: 'Crosshair', state: on('On', 'Off') };
    case 'sessions': return { name: 'Flight Sessions', state: null };
    default: return null;
  }
}
