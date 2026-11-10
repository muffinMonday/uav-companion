You are helping me prepare waypoints for a drone-travel map called UAV Companion. Read my itinerary at the end of this message and turn it into map markers.

Reply with ONE JSON object inside a single code block, and nothing else before or after it.

FORMAT: a GeoJSON FeatureCollection. Each place is one Feature:

{
  "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [LONGITUDE, LATITUDE] },
  "properties": {
    "name": "short name of the place",
    "type": "hotel",
    "note": "useful facts for me",
    "date": "2026-11-12",
    "endDate": "2026-11-14",
    "day": 1,
    "order": 1
  }
}

RULES

1. Make one Feature for each place where I will stay, take off, land, take photos or video, or which I should avoid with a drone.

2. properties.name is required: at most 80 characters, in the language I wrote the itinerary in.

3. properties.type must be exactly one of these:
   - "home"      the drone's home point: the spot flights start from and return to
   - "hotel"     where I am staying
   - "takeoff"   a good place to launch the drone
   - "landing"   a good place to land or recover it
   - "photo"     a scenic spot worth flying or filming at
   - "train"     a train or metro station I will use
   - "airport"   an airport I fly in or out of
   - "hazard"    something to avoid: crowds, power lines, a military or government site, a no-fly sign
   - "residence" my own home, where I actually live. NOT the drone's home point. Add one only if my itinerary asks for it (for example a departure address); never guess an address
   - "other"     anything else

4. properties.date, properties.endDate, properties.day and properties.order are all OPTIONAL. Never invent them.
   - date is the calendar date of the visit as "YYYY-MM-DD" with the year, for example "2026-11-12". Give it only when my itinerary states the full date including the year. Do not guess the year.
   - endDate is the last date of a stay of several days (for example a hotel check-out), also "YYYY-MM-DD", later than date. Use it only together with date.
   - day is the itinerary day as a whole number (1 is the first day). order is the position within that day (1 is the first stop). Leave them out when the itinerary does not make them clear.

5. properties.note is optional, at most 300 characters: facts from my itinerary such as check-in time, address, opening hours, or a reminder. Do not present guesses as facts.

6. COORDINATES: coordinates are [longitude, latitude] in decimal degrees (WGS84), in that order, for example [114.3055, 30.5928]. Give coordinates ONLY if you are confident they are accurate for that exact place. Do not estimate, round to a city centre, or make them up. If you are not sure:
   - set "geometry": null, and
   - add properties.query: text precise enough to find the place in a map search (venue name, street address, city, country).
   The app will look it up and mark the result unverified for me to check.

7. Do not add flight zones, permissions, legal advice or weather. The app checks the flight zones itself.

8. At most 100 Features. If my itinerary has more places, keep the ones most relevant to flying.

9. If the whole itinerary is ONE trip, also add a top-level "trip" object next to "features" (not inside a Feature):
   {"name": "short trip name", "country": "country name in English", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "description": "one or two sentences"}
   Only "name" is required. startDate and endDate follow the same rules as date above (full date with the year, never guessed; endDate only together with startDate). Leave out whatever you do not know. The app puts every place of the reply in that trip, except a "residence", which never belongs to a trip.

EXAMPLE OF THE REPLY

```json
{
  "type": "FeatureCollection",
  "trip": { "name": "Wuhan weekend", "country": "China", "startDate": "2026-11-12", "endDate": "2026-11-14", "description": "Three days of filming along the Yangtze." },
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [114.3055, 30.5928] },
      "properties": { "name": "Riverside Hotel", "type": "hotel", "note": "Check-in after 14:00", "date": "2026-11-12", "endDate": "2026-11-14", "day": 1, "order": 1 }
    },
    {
      "type": "Feature",
      "geometry": null,
      "properties": { "name": "Yellow Crane Tower", "type": "photo", "query": "Yellow Crane Tower, Wuchang District, Wuhan, China", "date": "2026-11-13", "day": 2, "order": 1 }
    }
  ]
}
```

MY ITINERARY:

