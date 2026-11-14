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

1. Make one Feature for each place where I will stay, eat, visit, take off, land, take photos or video, or which I should avoid with a drone.

2. properties.name is required: at most 80 characters, in the language I wrote the itinerary in.

3. properties.type must be exactly one of these:
   - "home"      the drone's home point: the spot flights start from and return to
   - "hotel"     where I am staying: a hotel, hostel, rental or friends (the app shows this as "Accommodation")
   - "takeoff"   a good place to launch the drone
   - "landing"   a good place to land or recover it
   - "photo"     a scenic spot worth flying or filming at (for a place to visit that is not mainly a viewpoint, use "attraction")
   - "attraction" a museum, monument or other sight to visit
   - "food"      a restaurant, cafe, street food or food court
   - "shopping"  a mall, market or shopping street
   - "nature"    a park, lake, trail or nature reserve
   - "meeting"   a place where my group gathers
   - "train"     a train or metro station I will use
   - "airport"   an airport I fly in or out of
   - "transport" any other transport stop: a bus stop or terminal, a ferry pier, a car park. NOT a train station or an airport (use "train" or "airport" for those)
   - "hazard"    something to avoid: crowds, power lines, a military or government site, a no-fly sign
   - "residence" my own home, where I actually live. NOT the drone's home point (that is "home"). Add one only if my itinerary asks for it (for example a departure address); never guess an address
   - "other"     anything else

4. properties.date, properties.endDate, properties.day and properties.order are all OPTIONAL. Never invent them.
   - date is the calendar date of the visit as "YYYY-MM-DD" with the year, for example "2026-11-12". Give it only when my itinerary states the full date including the year. Do not guess the year.
   - endDate is the last date of a stay of several days (for example a hotel check-out), also "YYYY-MM-DD", later than date. Use it only together with date.
   - order is the position within that day (1 is the first stop). Leave it out when the itinerary does not make it clear.
   - day is the itinerary day as a whole number (1 is the first day). Give it ONLY when the itinerary has no calendar dates. When you give dates (trip startDate and a date for each place) leave day out: the app works the day out from the dates, and ignores a day that disagrees.

5. properties.note is optional, at most 300 characters: facts from my itinerary such as check-in time, address, opening hours, or a reminder. Do not present guesses as facts.

6. COORDINATES: coordinates are [longitude, latitude] in decimal degrees (WGS84), in that order, for example [114.3055, 30.5928]. Give coordinates ONLY if you are confident they are accurate for that exact place. Do not estimate, round to a city centre, or make them up. If you are not sure:
   - set "geometry": null, and
   - add properties.query: text precise enough to find the place in a map search (venue name, street address, city, country), written IN ENGLISH (the official English or romanised name), whatever language my itinerary is in.
   - optionally add properties.queryLocal: the same place written in its own local language and script (for example Chinese characters in China), which the app tries if the English query finds nothing.
   The app will look it up and mark the result unverified for me to check.

7. Do not add flight zones, permissions, legal advice or weather. The app checks the flight zones itself.

8. At most 100 Features. If my itinerary has more places, keep the ones most relevant to flying.

9. If the whole itinerary is ONE trip, also add a top-level "trip" object next to "features" (not inside a Feature):
   {"name": "short trip name", "country": "country name in English", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "description": "one or two sentences"}
   "name" is required, and so are startDate and endDate whenever the itinerary gives dates (a one-day trip has the same date twice). They follow the same rules as date above: a full date with the year, never guessed. If the itinerary has no dates, leave them out and the app will ask the person for them. Leave out whatever you do not know. The app puts every place of the reply in that trip, except a "residence", which never belongs to a trip.

10. SIDE QUESTS are optional. If my itinerary mentions a nearby extra that I would visit only if there is time (an optional detour, "worth a look if you pass by"), make it a Feature like the others and add "sideQuest": true to its properties, plus "near": the exact name of the main stop (another Feature in your reply) that it is close to. The main stops are the places I am actually planning to go. A hotel, home point or residence is never a side quest. Leave both properties out of ordinary stops.

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
    },
    {
      "type": "Feature",
      "geometry": null,
      "properties": { "name": "Hubu Alley snack street", "type": "food", "query": "Hubuxiang, Wuchang District, Wuhan, China", "queryLocal": "户部巷, 武昌区, 武汉, 中国", "date": "2026-11-13", "sideQuest": true, "near": "Yellow Crane Tower" }
    }
  ]
}
```

MY ITINERARY:

