// Supabase edge function: one driving route between two itinerary stops, cache first. See handler.js for the rules and tests/route-leg-unit.mjs for the tests.
// Secrets (set with `supabase secrets set`, never in the repository or the browser): HEIGIT_API_KEY. Optional limits: ROUTE_USER_DAY (150), ROUTE_ALL_DAY (1500), ROUTE_ALL_MINUTE (30).
// The service-role key is supplied by the platform. The platform checks the caller's token first (verify_jwt in config.toml); the handler checks it again.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handle } from './handler.js';

const ORS = 'https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson';
const num = (name: string, dflt: number) => { const v = Number(Deno.env.get(name)); return Number.isInteger(v) && v > 0 ? v : dflt; };

Deno.serve((req: Request) => {
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const rpc = async (fn: string, args: Record<string, unknown>) => { const { data, error } = await admin.rpc(fn, args); if (error) { const e = new Error(error.message) as Error & { code?: string }; e.code = error.code; throw e; } return data; };
  return handle(req, {
    getUser: async (authorization: string) => { const { data, error } = await createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } }).auth.getUser(); return error ? null : data.user; },
    begin: (a: any) => rpc('route_begin', { p_user: a.user, p_trip: a.trip, p_key: a.key, p_from_id: a.from.id, p_from_lat: a.from.lat, p_from_lon: a.from.lon, p_to_id: a.to.id, p_to_lat: a.to.lat, p_to_lon: a.to.lon, p_user_day: a.userDay, p_all_day: a.allDay, p_all_minute: a.allMinute }),
    store: (a: any) => rpc('route_store', { p_user: a.user, p_trip: a.trip, p_key: a.key, p_from_id: a.from.id, p_from_lat: a.from.lat, p_from_lon: a.from.lon, p_to_id: a.to.id, p_to_lat: a.to.lat, p_to_lon: a.to.lon, p_profile: a.profile, p_schema: a.schema, p_geometry: a.route.geometry, p_points: a.route.points, p_distance: a.route.distance_m, p_duration: a.route.duration_s }),
    ors: async (leg: any) => {
      // The key goes in the Authorization header, server side only. Only the two coordinate pairs (longitude, latitude) are sent.
      const r = await fetch(ORS, { method: 'POST', signal: AbortSignal.timeout(8000), headers: { Authorization: Deno.env.get('HEIGIT_API_KEY') ?? '', 'Content-Type': 'application/json', Accept: 'application/geo+json' }, body: JSON.stringify({ coordinates: [[leg.from.lon, leg.from.lat], [leg.to.lon, leg.to.lat]], instructions: false }) });
      let json = null; try { json = await r.json(); } catch { json = null; }
      return { status: r.status, json };
    },
    env: { userDay: num('ROUTE_USER_DAY', 150), allDay: num('ROUTE_ALL_DAY', 1500), allMinute: num('ROUTE_ALL_MINUTE', 30) },
  });
});
