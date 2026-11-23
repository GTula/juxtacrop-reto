/* =========================================================
   juxtacrop · Live data access
   Every function here talks to a public, key-free service:
   - NASA POWER API (climatology + daily, incl. GPM IMERG rain)
   - NASA GIBS WMTS tiles (SMAP, MODIS NDVI, Landsat WELD imagery)
   - Esri Living Atlas Landsat 8/9 image service (scene history)
     → numeric values are recovered by decoding the published
       color maps of each layer.
   - FAO GAEZ v4 ImageServer (crop suitability)
   - Elevation: Copernicus DEM GLO-90 via the Open-Meteo elevation API (CORS-enabled, no key)
   Results are cached in localStorage per location.
   ========================================================= */

const Sources = (() => {
  const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
  const POWER = 'https://power.larc.nasa.gov/api/temporal';
  const GAEZ = 'https://gaez-services.fao.org/server/rest/services/res05/ImageServer';
  const CACHE_PREFIX = 'jx2:';

  // ---------- helpers ----------
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;

  function cacheGet(key) {
    try { const v = localStorage.getItem(CACHE_PREFIX + key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function cacheSet(key, value) {
    try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value)); } catch (e) { /* quota or private mode */ }
  }
  async function cached(key, fn) {
    const hit = cacheGet(key);
    if (hit) return hit;
    const v = await fn();
    if (v != null) cacheSet(key, v);
    return v;
  }
  async function getJSON(url, opts) {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
  }
  /** Runs async tasks with limited concurrency. */
  async function pool(items, limit, fn, onProgress) {
    const out = new Array(items.length);
    let next = 0, done = 0;
    async function worker() {
      while (next < items.length) {
        const i = next++;
        try { out[i] = await fn(items[i], i); } catch (e) { out[i] = null; }
        done++; if (onProgress) onProgress(done, items.length);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
  }
  const locKey = (lat, lon) => `${lat.toFixed(2)},${lon.toFixed(2)}`;

  // ---------- NASA POWER ----------
  const MONTH_KEYS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  /** Long-term monthly climatology for the point. */
  function powerClimatology(lat, lon) {
    return cached(`clim:${locKey(lat, lon)}`, async () => {
      const params = 'T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,RH2M,GWETROOT,FROST_DAYS,EVPTRNS,ALLSKY_SFC_SW_DWN';
      const d = await getJSON(`${POWER}/climatology/point?parameters=${params}&community=AG&longitude=${lon.toFixed(3)}&latitude=${lat.toFixed(3)}&format=JSON`);
      const p = d.properties.parameter;
      const out = { elevation: d.geometry.coordinates[2] };
      for (const k of Object.keys(p)) out[k] = MONTH_KEYS.map(m => p[k][m]);
      return out;
    });
  }

  /** Daily IMERG precipitation + max/min temperature, 2001 → ~4 months ago. */
  function powerDaily(lat, lon) {
    const end = new Date(); end.setUTCMonth(end.getUTCMonth() - 4); end.setUTCDate(0); // last day of a month ~4 months ago (IMERG Final latency)
    return cached(`daily:${locKey(lat, lon)}:${ymd(end)}`, async () => {
      const url = `${POWER}/daily/point?parameters=IMERG_PRECTOT,T2M_MAX,T2M_MIN&community=AG&longitude=${lon.toFixed(3)}&latitude=${lat.toFixed(3)}`
        + `&start=20010101&end=${ymd(end)}&format=JSON&time-standard=UTC`;
      const d = await getJSON(url);
      const p = d.properties.parameter;
      const dates = Object.keys(p.IMERG_PRECTOT).sort();
      const val = (k, dt) => { const v = p[k][dt]; return v === -999 ? null : v; };
      return {
        dates, // 'YYYYMMDD'
        rain: dates.map(dt => val('IMERG_PRECTOT', dt)),
        tmax: dates.map(dt => val('T2M_MAX', dt)),
        tmin: dates.map(dt => val('T2M_MIN', dt)),
      };
    });
  }

  // ---------- NASA GIBS tile sampling ----------
  const colormaps = {};
  /** Parses a GIBS color map XML into a lookup "r,g,b" → numeric value. */
  async function colormap(url) {
    if (colormaps[url]) return colormaps[url];
    const txt = await (await fetch(url)).text();
    const map = new Map();
    const re = /<ColorMapEntry([^>]*)\/>/g;
    let m;
    while ((m = re.exec(txt))) {
      const attrs = m[1];
      const rgb = (attrs.match(/rgb="([^"]+)"/) || [])[1];
      const value = (attrs.match(/value="([^"]+)"/) || [])[1];
      if (!rgb || !value || /nodata="true"/.test(attrs)) continue;
      const nums = value.replace(/[\[\]()]/g, '').split(',').map(s => s.trim());
      const lo = parseFloat(nums[0]);
      const hi = nums[1] === undefined || /INF/.test(nums[1]) ? lo : parseFloat(nums[1]);
      if (!Number.isFinite(lo)) continue;
      map.set(rgb.replace(/\s/g, ''), (lo + hi) / 2);
    }
    colormaps[url] = map;
    return map;
  }

  function tileFor(lat, lon, z) {
    const n = 2 ** z;
    const x = (lon + 180) / 360 * n;
    const r = lat * Math.PI / 180;
    const y = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
    const tx = Math.floor(x), ty = Math.floor(y);
    return { tx, ty, px: Math.floor((x - tx) * 256), py: Math.floor((y - ty) * 256) };
  }

  async function tilePixels(url) {
    const r = await fetch(url);
    if (!r.ok) return null;
    const blob = await r.blob();
    if (!blob.type.startsWith('image/')) return null;
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    return ctx.getImageData(0, 0, c.width, c.height);
  }

  /** Reads the value of a GIBS data layer at a point by inverting its color map. */
  async function sampleGibs(layer, date, matrixSet, z, lat, lon, cmap) {
    const t = tileFor(lat, lon, z);
    const img = await tilePixels(`${GIBS}/${layer}/default/${date}/${matrixSet}/${z}/${t.ty}/${t.tx}.png`);
    if (!img) return null;
    // Exact pixel first, then a small neighbourhood (coast/no-data edges)
    for (let rad = 0; rad <= 2; rad++) {
      const vals = [];
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        const x = Math.min(255, Math.max(0, t.px + dx)), y = Math.min(255, Math.max(0, t.py + dy));
        const i = (y * img.width + x) * 4;
        if (img.data[i + 3] < 200) continue;
        const v = cmap.get(`${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`);
        if (v !== undefined) vals.push(v);
      }
      if (vals.length) return vals.reduce((a, b) => a + b, 0) / vals.length;
    }
    return null;
  }

  function monthList(fromY, fromM, toDate) {
    const out = [];
    let y = fromY, m = fromM;
    while (y < toDate.getUTCFullYear() || (y === toDate.getUTCFullYear() && m <= toDate.getUTCMonth() + 1)) {
      out.push({ y, m });
      m++; if (m > 12) { m = 1; y++; }
    }
    return out;
  }

  /** SMAP L4 root-zone soil moisture on the 15th of every month since April 2015. */
  function smapSeries(lat, lon, onProgress) {
    const end = new Date(); end.setUTCMonth(end.getUTCMonth() - 2);
    return cached(`smap:${locKey(lat, lon)}:${end.getUTCFullYear()}-${end.getUTCMonth()}`, async () => {
      const cmap = await colormap('https://gibs.earthdata.nasa.gov/colormaps/v1.3/SMAP_Analyzed_Soil_Moisture.xml');
      const months = monthList(2015, 4, end);
      const vals = await pool(months, 8, ({ y, m }) =>
        sampleGibs('SMAP_L4_Analyzed_Root_Zone_Soil_Moisture', `${y}-${pad(m)}-15`, 'GoogleMapsCompatible_Level6', 6, lat, lon, cmap), onProgress);
      return months.map((mm, i) => ({ ...mm, v: vals[i] })).filter(x => x.v != null);
    });
  }

  /** MODIS Terra monthly NDVI for the last 10 years. */
  function ndviSeries(lat, lon, onProgress) {
    const end = new Date(); end.setUTCMonth(end.getUTCMonth() - 2);
    return cached(`ndvi:${locKey(lat, lon)}:${end.getUTCFullYear()}-${end.getUTCMonth()}`, async () => {
      const cmap = await colormap('https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_L3_NDVI.xml');
      const months = monthList(end.getUTCFullYear() - 10, end.getUTCMonth() + 1, end);
      const vals = await pool(months, 8, ({ y, m }) =>
        sampleGibs('MODIS_Terra_L3_NDVI_Monthly', `${y}-${pad(m)}-01`, 'GoogleMapsCompatible_Level7', 7, lat, lon, cmap), onProgress);
      return months.map((mm, i) => ({ ...mm, v: vals[i] })).filter(x => x.v != null);
    });
  }

  // ---------- FAO GAEZ v4 ----------
  /** Suitability index (0-10000) for each GAEZ crop name, now (1981-2010) and 2041-2070 (RCP4.5 ensemble). */
  function gaezSuitability(lat, lon, cropNames, onProgress) {
    return cached(`gaez:${locKey(lat, lon)}:${cropNames.join('|')}`, async () => {
      const list = cropNames.map(n => `'${n}'`).join(',');
      const base = "sub_theme_name='Suitability Index' AND variable LIKE 'Suitability index  range (0 _ 10000); all land%' AND water_supply='Rainfed' AND input_level='High'";
      const where = `${base} AND crop IN (${list}) AND ((year='1981-2010' AND model='CRUTS32') OR (year='2041-2070' AND model='ENSEMBLE' AND rcp='RCP4.5' AND c02_fertilization='With CO2 Fertilization'))`;
      const q = await getJSON(`${GAEZ}/query?` + new URLSearchParams({ where, outFields: 'objectid,crop,year', returnGeometry: 'false', f: 'json' }));
      const rasters = (q.features || []).map(f => f.attributes);
      const geometry = JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } });
      const values = await pool(rasters, 6, async r => {
        const mosaicRule = JSON.stringify({ mosaicMethod: 'esriMosaicLockRaster', lockRasterIds: [r.objectid] });
        const d = await getJSON(`${GAEZ}/identify?` + new URLSearchParams({ geometry, geometryType: 'esriGeometryPoint', mosaicRule, returnGeometry: 'false', returnCatalogItems: 'false', f: 'json' }));
        const v = parseFloat(d.value);
        return Number.isFinite(v) ? v : null;
      }, onProgress);
      const out = {};
      rasters.forEach((r, i) => {
        out[r.crop] = out[r.crop] || { now: null, future: null };
        out[r.crop][r.year === '1981-2010' ? 'now' : 'future'] = values[i];
      });
      return out;
    });
  }

  // ---------- Elevation (Copernicus DEM via Open-Meteo, called straight from the browser) ----------
  // Points are [lat, lon]; the API accepts up to 100 coordinates per request.
  async function srtmElevations(points) {
    const out = [];
    for (let i = 0; i < points.length; i += 100) {
      const chunk = points.slice(i, i + 100);
      const lat = chunk.map(p => p[0].toFixed(5)).join(','), lon = chunk.map(p => p[1].toFixed(5)).join(',');
      const d = await getJSON(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`);
      if (!Array.isArray(d.elevation) || d.elevation.length !== chunk.length) throw new Error(d.reason || 'Elevation error');
      out.push(...d.elevation);
    }
    return out;
  }

  // ---------- Landsat history ----------
  // 1983–2000: NASA GIBS WELD annual composites (Landsat 5/7).
  // 2013–today: individual Landsat 8/9 scenes from the public Esri Living Atlas
  // Landsat image service, choosing the least cloudy one of the growing season.
  const WELD_YEARS = [1983, 1984, 1985, 1988, 1989, 1990, 1998, 1999, 2000];
  const firstL8Year = 2013;
  const LANDSAT_IS = 'https://landsat2.arcgis.com/arcgis/rest/services/Landsat/MS/ImageServer';

  async function landsatScene(year, lat, lon, south) {
    return cached(`l8:${locKey(lat, lon)}:${year}`, async () => {
      // peak growing season: Dec–Mar (south) / Jun–Sep (north)
      const from = south ? `${year - 1}-12-01` : `${year}-06-01`;
      const to = south ? `${year}-04-01` : `${year}-10-01`;
      const d = await getJSON(`${LANDSAT_IS}/query?` + new URLSearchParams({
        where: `AcquisitionDate >= DATE '${from}' AND AcquisitionDate < DATE '${to}' AND CloudCover < 0.3 AND Category = 1`,
        geometry: JSON.stringify({ x: lon, y: lat }), inSR: '4326', geometryType: 'esriGeometryPoint', spatialRel: 'esriSpatialRelIntersects',
        outFields: 'OBJECTID,AcquisitionDate,CloudCover,SensorName', orderByFields: 'CloudCover', returnGeometry: 'false', f: 'json',
      }));
      const f = (d.features || [])[0];
      if (!f) return null;
      const a = f.attributes;
      return { id: a.OBJECTID, date: new Date(a.AcquisitionDate).toISOString().slice(0, 10), cloud: a.CloudCover, sensor: a.SensorName };
    });
  }

  /** Leaflet tile layer that renders one Landsat scene through the image service's exportImage. */
  function landsatTileLayer(sceneId) {
    const mosaicRule = encodeURIComponent(JSON.stringify({ mosaicMethod: 'esriMosaicLockRaster', lockRasterIds: [sceneId] }));
    const renderingRule = encodeURIComponent(JSON.stringify({ rasterFunction: 'Natural Color with DRA' }));
    const R = 20037508.342789244;
    const Layer = L.TileLayer.extend({
      getTileUrl(c) {
        const size = 2 * R / 2 ** c.z;
        const minx = -R + c.x * size, maxy = R - c.y * size;
        return `${LANDSAT_IS}/exportImage?bbox=${minx},${maxy - size},${minx + size},${maxy}&bboxSR=3857&imageSR=3857&size=256,256`
          + `&format=jpgpng&f=image&mosaicRule=${mosaicRule}&renderingRule=${renderingRule}`;
      },
    });
    return new Layer('', { maxNativeZoom: 15, maxZoom: 19, attribution: 'Landsat 8/9 courtesy of USGS/NASA via Esri Living Atlas' });
  }

  return {
    powerClimatology, powerDaily, smapSeries, ndviSeries, gaezSuitability, srtmElevations,
    landsatScene, landsatTileLayer, WELD_YEARS, firstL8Year, GIBS, tileFor,
  };
})();
