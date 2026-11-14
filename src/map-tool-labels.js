// The words shown beside the map's left-hand buttons when the labels are expanded. Pure (no DOM), so Node tests can use it.
// Each button carries data-tool; the label names what pressing it does NOW, from the state the owning module already keeps on the button
// (aria-pressed, and for the location button its aria-label). The +/- zoom buttons are not labelled: their meaning is plain, and their labels would sit under the search button.
export const TOOLS = ['locate', 'compass', 'crosshair', 'details', 'side-quests', 'trips', 'sessions', 'labels'];

/** `state`: { pressed: true | false | null (no such state), text: the button's aria-label }. Returns the label, or null for an unknown tool. */
export function toolLabel(tool, { pressed = null, text = '' } = {}) {
  switch (tool) {
    case 'locate': return /^Stop following/i.test(text) ? 'Stop following' : /^Follow me/i.test(text) ? 'Follow me' : 'My location';
    case 'compass': return 'Reset to north';
    case 'crosshair': return pressed ? 'Hide crosshair' : 'Show crosshair';
    case 'details': return pressed ? 'Hide marker details' : 'Show marker details';
    case 'side-quests': return pressed ? 'Hide Side Quests' : 'Show all Side Quests';
    case 'trips': return pressed ? 'Hide trip markers' : 'Show trip markers';
    case 'sessions': return 'Browse flight sessions';
    case 'labels': return pressed ? 'Hide labels' : 'Show map tool labels';
    default: return null;
  }
}
