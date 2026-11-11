// What's new: the entries the dashboard shows once, newest first. To announce a change, add an entry at the top with a new id
// (the date is a good id): visitors who have not seen it get the dashboard opened with it, once. Keep each entry to a few short lines.
export const WHATS_NEW = [
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
