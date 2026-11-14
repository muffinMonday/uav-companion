import { sha256, stringify } from './core.js';

// Required precondition for any future full integration derivative. This is not publication approval.
export function assertCompleteReference(collection, report) {
  const full = report.completeReference;
  if (!full?.emitted || collection?.type !== 'FeatureCollection' ||
      collection.features?.length !== full.features || full.features !== report.uniqueGeometries ||
      sha256(stringify(collection)) !== full.contentSha256) {
    throw new Error('Complete reference identity/count mismatch: never substitute normalized.geojson or a filtered subset');
  }
  return true;
}
