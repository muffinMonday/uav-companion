# Planning with an AI

Any AI assistant can turn a travel itinerary into UAV Companion markers. There is no API and no account: the app is static and your markers live in your browser, so the hand-off is a file format that you copy and paste.

## For the person using it

1. Open the **Trips** tab, **Plan with an AI**, and press **Copy AI prompt**.
2. Paste it into any AI assistant (Gemini, ChatGPT, Claude, a local model) and add your itinerary after it.
3. Copy the AI's reply (the JSON in the code block) and paste it into **Paste the AI's answer**, then press **Preview…**.
4. Untick anything you do not want, press **Add**. Each new marker is marked **Unverified** until you open it and press **Mark as checked**.

The same flow works from a **share link**: **Backup > Copy share link** copies a link that carries your markers (compressed, in the part after `#`, which is never sent to a server). Opening it, even by pasting it into a tab where the app is already open, shows a preview and asks before adding anything.

## What an AI should produce

The format is in `public/ai/` and served from the site root: `ai/prompt.md` (the instructions and an example reply), `ai/schema.json` (JSON Schema), `ai/example.geojson`, and `llms.txt` for assistants that read sites. In short, one GeoJSON `FeatureCollection`:

| Field | Required | Meaning |
|---|---|---|
| `geometry` | yes | `{"type":"Point","coordinates":[lon, lat]}`, or `null` |
| `properties.name` | yes | up to 80 characters |
| `properties.type` | no | `home`, `hotel`, `takeoff`, `landing`, `photo`, `train`, `airport`, `hazard`, `residence`, `other` (default `other`) |
| `properties.note` | no | up to 500 characters |
| `properties.date` | **no** | calendar date of the visit, `YYYY-MM-DD` with the year |
| `properties.endDate` | **no** | last date of a multi-day stay (a hotel), `YYYY-MM-DD`, after `date`; only with `date` |
| `properties.day` | **no** | itinerary day, a whole number from 1 (1 = first day). Only for itineraries with no calendar dates: with dates the app works the day out itself and ignores this |
| `properties.order` | **no** | position within the day, from 1 |
| `trip` (top level, not per place) | **no** | `{ name, country?, startDate, endDate, description? }` (the dates are required to create the trip; the app asks for them if they are missing); every place in the reply is put in this trip (a Home marker is not). `country` is a name or ISO code from the standard list |
| `properties.query` | when `geometry` is `null` | text to search: venue, address, city, country |

`home` is the **drone's home point** (where flights start and return to). `residence` is the **traveller's own home**; an AI should add one only if the itinerary asks for it, and never guess an address. The app keeps `residence` markers private: they are left out of share links and automatic weather and elevation lookups.

`date`, `endDate`, `day` and `order` are optional, individually and together, and `day` and `date` are independent. Markers without them behave exactly as before. Dates must be real ISO dates (the year included); anything else is dropped, never guessed, and an end date without a start date or before it is dropped. When any marker has a date, the list is grouped under date headings; otherwise, when any has a day, under "Day N" headings; otherwise it is newest first. The dates also decide which hotel a waypoint is measured from: see below.

## What the app does with the result

A place that appears twice with different dates (a landmark on day 1 and day 3) is fine: the app keeps both as separate visits. Repeating the same place with the same date, or with no date, is treated as a duplicate and skipped.


Besides the zone check, each waypoint shows its straight-line distance to the nearest **home point** and **hotel** in its own trip whose dates overlap its own (an undated one applies to every date), and every marker except Home shows its distance to the nearest **Home** (residence), whatever the trip or dates. A reply with a `trip` object creates that trip (or reuses a saved trip with the same name, country and dates) unless the person picks another trip or none in the import preview. So an itinerary that gives hotels check-in and check-out dates gets the right hotel for each day. The AI does not need to compute any distances.

## The rule that matters most: no invented coordinates

Language models often return plausible but wrong coordinates. The prompt tells the AI to give coordinates only when it is confident, and otherwise to set `geometry` to `null` and give a `query`. Then:

- A place **with coordinates** is added as given, marked unverified. A swapped latitude and longitude (an impossible latitude) is corrected and reported; `[0, 0]` is treated as missing.
- A place **with only a query** is looked up by name, if the person has turned on **Privacy settings > Place lookup**. It is off by default because it sends the names to a third party (Photon, then Nominatim). Lookup runs only when **Add** is pressed, at most 30 places at a time, and can be stopped. Looked-up places are marked unverified.
- Everything is previewed first. Places already saved (same name within about 30 m) are flagged and unticked.

The app never trusts an AI to know the flight zones. Each marker's zone status is checked live from the zone data when its window opens.

## What is accepted, and what is not trusted

The parser is lenient about wrapping, because chat assistants are: JSON inside prose, inside a ```` ```json ```` fence, a single Feature, or a bare array of `{name, type, lat, lon, note, day, order, query}` objects. It is strict about content: every value goes through the same validation as saved markers (types, ranges, lengths; `day` and `order` must be whole numbers 1 to 999 or they are dropped, never guessed), names and notes are only ever shown as text, at most 200 places are read, and nothing is added without confirmation. Links never add anything on their own.

Files exported by this app carry `"uavzones": 1`; for those, the `unverified` flag is kept as saved (a verified marker stays verified when it travels by link). Anything else is treated as AI output and marked unverified.

## Keeping the spec in step with the app

`public/ai/prompt.md` is the single source for the prompt (the app fetches it when "Copy AI prompt" is pressed). If a marker type is added or renamed in `src/poi.js`, update `prompt.md`, `schema.json` (the `type` enum) and `llms.txt` too. The unit tests compare the prompt and schema against the type list and fail if they drift.

## Not done, on purpose

A tool or API integration (function calling, an MCP server): it would need a server or a local helper to write into, because the markers are only in the browser. The paste-and-link route covers the use case without sending anything to a server.
