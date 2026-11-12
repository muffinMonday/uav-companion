// What's new: the entries the dashboard shows once, newest first. To announce a change, add an entry at the top with a new id
// (the date is a good id): visitors who have not seen it get the dashboard opened with it, once. Keep each entry to a few short lines.
export const WHATS_NEW = [
  {
    id: '2026-11-14-progression',
    date: '2026-11-14',
    title: 'Ranks and achievements',
    items: [
      'Sign in and open the Friends tab: your new Progression card shows your rank, XP and the achievements you have unlocked. You can feature up to three.',
      'Friends and people in your shared trips see your rank and achievements in your profile, and you see theirs. The "Show my bio, location, interests and progression" switch in Edit profile turns that off.',
      'XP from simulator hours and flight sessions is coming in the next updates.',
    ],
  },
  {
    id: '2026-11-12-sidequests',
    date: '2026-11-12',
    title: 'Side Quests',
    items: [
      'A Side Quest is an optional stop near a main stop. Add one from the point-check window, the edit form, or "Make Side Quest" on any marker.',
      'They stay folded under their main stop (a +N badge on the pin, a ▾ chip on the card) until you open it.',
      'Hold a Side Quest for a second to drag it between its siblings or onto another stop. A main stop takes its Side Quests along when you move it to another day.',
    ],
  },
  {
    id: '2026-11-12-setup',
    date: '2026-11-12',
    title: 'Quick setup',
    items: [
      'New visitors now choose to plan a trip or plan a flight. You can run it again from the ? button at the top of this dashboard, or under Map Configs.',
      'Plan a trip hands you a prompt for any AI assistant, from a few questions or from an itinerary link, in a format this app can import.',
    ],
  },
  {
    id: '2026-11-12-swipes',
    date: '2026-11-12',
    title: 'More swipes, and a shorter map key',
    items: [
      'Swipe the side panel to the right to close it, on a phone too. Swipe the unfolded icons to the left to open it. Swipe the collapsed dashboard (the strip or the arrow) up to open it.',
      'How it works moved to the ? button at the top of the dashboard.',
      'The map key shows half of itself; See more shows the rest.',
    ],
  },
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
