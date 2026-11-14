// The contextual hints: one declarative list. `id` is stable (it is what is stored), `where` says how it is shown:
//   'map'    a small card on the map, after something the visitor did there (see help-ui.js triggers in main.js)
//   'panel'  inside the pane of the side-panel tab `tab`, at the top, the first time that tab opens
//   'hub'    inside the Flight Sessions dialog, the first time it opens
// `replay` is the label of the entry in the dashboard's "Tips" list. A future feature (Community Flying Areas) adds an entry here and a trigger; nothing else changes.
// Hints explain how to use a feature. They never replace the flight-safety warnings or the privacy confirmations, which are separate and always shown.
export const HELP = [
  { id: 'map-tools', where: 'map', replay: 'Map buttons', text: 'The buttons on the left each do one thing. The last one, the tag button, writes the name of every button beside it.' },
  { id: 'point-check', where: 'map', replay: 'Checking a spot', text: 'A spot check is not saved. To keep the place, use Add as marker in the check window. To check another spot, press and hold the map for 2 seconds or right-click.' },
  { id: 'poi', where: 'panel', tab: 'poi', replay: 'Points of Interest', text: 'Pick a type, then Place on map (tap the map), At map centre or At my location. Pins you save stay in this browser.' },
  { id: 'trips', where: 'panel', tab: 'trips', replay: 'Trips', text: 'A trip is a list of days. Each day holds stops and Side Quests (optional extras). Press and hold a stop to move it to another day or place.' },
  { id: 'friends', where: 'panel', tab: 'friends', replay: 'Friends', text: 'Adding a friend does not share your location. Sharing is a separate switch, off until you turn it on.' },
  { id: 'map-config', where: 'panel', tab: 'config', replay: 'Map Configs', text: 'Choose the map style, which zones show and how strong they look. These choices are remembered on this device.' },
  { id: 'sessions', where: 'hub', replay: 'Flight Sessions', text: 'Discover lists sessions near the map centre, My sessions are the ones you host or joined, and Invitations are private invites sent to you.' },
];

export const helpById = (id) => HELP.find((h) => h.id === id) || null;
