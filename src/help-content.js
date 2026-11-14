// The contextual hints: one declarative list. `id` is stable (it is what is stored), `where` says how it is shown:
//   'map'    a small card on the map, after something the visitor did there (see help-ui.js triggers in main.js)
//   'panel'  inside the pane of the side-panel tab `tab`, at the top, the first time that tab opens
//   'hub'    inside the Flight Sessions dialog, the first time it opens
//   'poi'    inside the Points of Interest pane, at `anchor` ('type' under the type picker, 'list' above the saved list, 'top'), after a first use of that part
// `ack: true` marks a notice the visitor must dismiss: it is not used up by being on screen for a moment.
// `replay` is the label of the entry in the dashboard's "Tips" list. A future feature (Community Flying Areas) adds an entry here and a trigger; nothing else changes.
// Hints explain how to use a feature. They never replace the flight-safety warnings or the privacy confirmations, which are separate and always shown.
export const HELP = [
  { id: 'map-tools', where: 'map', replay: 'Map buttons', text: 'Zoom, My location and More tools are on the left. More tools holds marker details, Side Quests, trip markers, the crosshair and Flight Sessions.' },
  { id: 'point-check', where: 'map', replay: 'Checking a spot', text: 'A spot check is not saved. To keep the place, use Add as marker in the check window. To check another spot, press and hold the map for 2 seconds or right-click.' },
  { id: 'poi', where: 'panel', tab: 'poi', replay: 'Points of Interest', text: 'Open Add a marker to choose a type and place it. Search all saved places, and open a trip to see its days. Pins you save stay in this browser.' },
  { id: 'poi-types', where: 'poi', anchor: 'type', replay: 'Choose a marker type', text: 'Markers are grouped: Travel & Places, Transportation, Drone & Safety and Special. Pick a group, then a type. Accommodation is what Hotel was called; saved ones are unchanged.' },
  { id: 'trip-visibility', where: 'poi', anchor: 'list', replay: 'Show or hide trip pins', text: 'On map shows or hides a trip\u2019s pins on this device only. The list keeps every place, and a trip you hide stays hidden after a reload.' },
  { id: 'newtype-shared', where: 'poi', anchor: 'top', ack: true, replay: 'Newer marker types', text: 'This shared trip now has a newer marker type. A friend on an older app version may see it as Other, and may save it back that way. Ask them to refresh the app.' },
  { id: 'trips', where: 'panel', tab: 'trips', replay: 'Trips', text: 'A trip is a list of days. Each day holds stops and Side Quests (optional extras). Press and hold a stop to move it to another day or place.' },
  { id: 'friends', where: 'panel', tab: 'friends', replay: 'Friends', text: 'Adding a friend does not share your location. Sharing is a separate switch, off until you turn it on.' },
  { id: 'map-config', where: 'panel', tab: 'config', replay: 'Map Configs', text: 'Choose the map style, which zones show and how strong they look. These choices are remembered on this device.' },
  { id: 'sessions', where: 'hub', replay: 'Flight Sessions', text: 'Discover lists sessions near the map centre, My sessions are the ones you host or joined, and Invitations are private invites sent to you.' },
];

export const helpById = (id) => HELP.find((h) => h.id === id) || null;
