// What's new: the entries the dashboard shows once, newest first. To announce a change, add an entry at the top with a new id
// (the date is a good id): visitors who have not seen it get the dashboard opened with it, once. Keep each entry to a few short lines.
export const WHATS_NEW = [
  {
    id: '2026-11-12-compass',
    date: '2026-11-12',
    title: 'A map that turns with you, and OpenStreetMap layers',
    items: [
      'Press the location button once to find yourself (the marker now has an arrow for the way you face), a second time to follow you and turn the map with your phone, a third time to stop.',
      'Turn the map with two fingers at any time; the compass button turns it back to north.',
      'The map layers are now all OpenStreetMap-based: OpenStreetMap, Humanitarian, CyclOSM and OpenTopoMap. The Esri street and satellite layers were removed.',
    ],
  },
  {
    id: '2026-11-11-checkin',
    date: '2026-11-11',
    title: 'Check in at your markers',
    items: [
      'Turn on Check in at markers under the shield button (privacy settings). When you are within 300 m of a marker, a Check in button opens on its row in the Markers list.',
      'A check-in saves the time and your position with the marker, in this browser only. Your position is read only while the markers list is showing, and it is never sent anywhere.',
    ],
  },
  {
    id: '2026-11-11',
    date: '2026-11-11',
    title: 'Trip planning, Singapore and a tidier map',
    items: [
      'Singapore no-fly zones (CAAS, MHA, NParks via OneMap) are on the map. They are approximate: every window links to the official OneMap Drone Query.',
      'A trip opens into a day-by-day plan: flip through the days, with distances, a forecast per day (when automatic weather is on), a no-fly check of the stops, notes and a checklist.',
      'Open in a map app and Navigate are now small icons beside the coordinates. Choose the app and your usual way of travelling under Maps in Map Configs.',
      'Select markers by tapping their pins on the map. The search box folds into a magnifying glass, and the side panel can roll up with the ^ button.',
    ],
  },
];
