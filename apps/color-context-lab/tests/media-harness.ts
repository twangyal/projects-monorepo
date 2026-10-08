import { normalizeImage } from '../src/images.ts';
import { createImageAsset, createProject, decodePixels } from '../src/model.ts';
import { cancelJobs, exportPng, exportReport, normalize, preview } from '../src/jobs.ts';
import { buildHtmlReport } from '../src/report.ts';
import type { Project, Raster } from '../src/types.ts';
export const media = { normalizeImage, createImageAsset, createProject, decodePixels, cancelJobs, exportPng, exportReport, normalize, preview, buildHtmlReport,
  rawProject(raster: Raster): Project { return createProject(createImageAsset(raster, { format: 'png', fileName: 'Original raw fixture.png', width: raster.width, height: raster.height }), 'Raw <artist> & study'); },
};
declare global { interface Window { colorMedia: typeof media } }
window.colorMedia = media;
