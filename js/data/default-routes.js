/**
 * Default routes — pre-bundled GPX routes.
 * These are loaded into IndexedDB on first launch.
 */

import { importRoute, hasRoutes } from '../storage/routes.js';

const DEFAULT_ROUTES = [
    {
        key: 'col_du_galibier',
        metadata: {
            key: 'col_du_galibier',
            name: 'Col du Galibier',
            description: 'Epic Alpine climb. 1400m of elevation gain.',
            emoji: '⛰️',
        },
        gpx: `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="FUCK_ZWIFT" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Col du Galibier</name><trkseg>
    <trkpt lat="45.2200" lon="6.4700"><ele>700</ele></trkpt>
    <trkpt lat="45.2218" lon="6.4718"><ele>730</ele></trkpt>
    <trkpt lat="45.2236" lon="6.4736"><ele>762</ele></trkpt>
    <trkpt lat="45.2254" lon="6.4754"><ele>796</ele></trkpt>
    <trkpt lat="45.2272" lon="6.4772"><ele>832</ele></trkpt>
    <trkpt lat="45.2290" lon="6.4790"><ele>870</ele></trkpt>
    <trkpt lat="45.2308" lon="6.4808"><ele>910</ele></trkpt>
    <trkpt lat="45.2326" lon="6.4826"><ele>952</ele></trkpt>
    <trkpt lat="45.2344" lon="6.4844"><ele>995</ele></trkpt>
    <trkpt lat="45.2362" lon="6.4862"><ele>1040</ele></trkpt>
    <trkpt lat="45.2380" lon="6.4880"><ele>1086</ele></trkpt>
    <trkpt lat="45.2398" lon="6.4898"><ele>1128</ele></trkpt>
    <trkpt lat="45.2416" lon="6.4916"><ele>1168</ele></trkpt>
    <trkpt lat="45.2434" lon="6.4934"><ele>1206</ele></trkpt>
    <trkpt lat="45.2452" lon="6.4952"><ele>1242</ele></trkpt>
    <trkpt lat="45.2470" lon="6.4970"><ele>1278</ele></trkpt>
    <trkpt lat="45.2488" lon="6.4988"><ele>1314</ele></trkpt>
    <trkpt lat="45.2506" lon="6.5006"><ele>1352</ele></trkpt>
    <trkpt lat="45.2524" lon="6.5024"><ele>1392</ele></trkpt>
    <trkpt lat="45.2542" lon="6.5042"><ele>1434</ele></trkpt>
    <trkpt lat="45.2560" lon="6.5060"><ele>1480</ele></trkpt>
    <trkpt lat="45.2578" lon="6.5078"><ele>1528</ele></trkpt>
    <trkpt lat="45.2596" lon="6.5096"><ele>1578</ele></trkpt>
    <trkpt lat="45.2614" lon="6.5114"><ele>1628</ele></trkpt>
    <trkpt lat="45.2632" lon="6.5132"><ele>1678</ele></trkpt>
    <trkpt lat="45.2650" lon="6.5150"><ele>1726</ele></trkpt>
    <trkpt lat="45.2668" lon="6.5168"><ele>1772</ele></trkpt>
    <trkpt lat="45.2686" lon="6.5186"><ele>1816</ele></trkpt>
    <trkpt lat="45.2704" lon="6.5204"><ele>1858</ele></trkpt>
    <trkpt lat="45.2722" lon="6.5222"><ele>1898</ele></trkpt>
    <trkpt lat="45.2740" lon="6.5240"><ele>1936</ele></trkpt>
    <trkpt lat="45.2758" lon="6.5258"><ele>1972</ele></trkpt>
    <trkpt lat="45.2776" lon="6.5276"><ele>2006</ele></trkpt>
    <trkpt lat="45.2794" lon="6.5294"><ele>2038</ele></trkpt>
    <trkpt lat="45.2812" lon="6.5312"><ele>2068</ele></trkpt>
    <trkpt lat="45.2830" lon="6.5330"><ele>2094</ele></trkpt>
    <trkpt lat="45.2848" lon="6.5348"><ele>2100</ele></trkpt>
  </trkseg></trk>
</gpx>`,
    },
    {
        key: 'richmond_flat',
        metadata: {
            key: 'richmond_flat',
            name: 'Richmond Flat Loop',
            description: 'Rolling criterium loop. Great for intervals.',
            emoji: '🏁',
        },
        gpx: `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="FUCK_ZWIFT" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Richmond Flat Loop</name><trkseg>
    <trkpt lat="37.5400" lon="-77.4350"><ele>10</ele></trkpt>
    <trkpt lat="37.5418" lon="-77.4332"><ele>12</ele></trkpt>
    <trkpt lat="37.5436" lon="-77.4314"><ele>15</ele></trkpt>
    <trkpt lat="37.5454" lon="-77.4296"><ele>18</ele></trkpt>
    <trkpt lat="37.5472" lon="-77.4278"><ele>20</ele></trkpt>
    <trkpt lat="37.5490" lon="-77.4260"><ele>22</ele></trkpt>
    <trkpt lat="37.5508" lon="-77.4242"><ele>25</ele></trkpt>
    <trkpt lat="37.5526" lon="-77.4224"><ele>30</ele></trkpt>
    <trkpt lat="37.5544" lon="-77.4206"><ele>35</ele></trkpt>
    <trkpt lat="37.5562" lon="-77.4188"><ele>38</ele></trkpt>
    <trkpt lat="37.5580" lon="-77.4170"><ele>40</ele></trkpt>
    <trkpt lat="37.5598" lon="-77.4170"><ele>38</ele></trkpt>
    <trkpt lat="37.5616" lon="-77.4170"><ele>35</ele></trkpt>
    <trkpt lat="37.5634" lon="-77.4170"><ele>32</ele></trkpt>
    <trkpt lat="37.5652" lon="-77.4170"><ele>28</ele></trkpt>
    <trkpt lat="37.5670" lon="-77.4170"><ele>25</ele></trkpt>
    <trkpt lat="37.5688" lon="-77.4188"><ele>24</ele></trkpt>
    <trkpt lat="37.5706" lon="-77.4206"><ele>23</ele></trkpt>
    <trkpt lat="37.5724" lon="-77.4224"><ele>22</ele></trkpt>
    <trkpt lat="37.5742" lon="-77.4242"><ele>24</ele></trkpt>
    <trkpt lat="37.5760" lon="-77.4260"><ele>28</ele></trkpt>
    <trkpt lat="37.5778" lon="-77.4278"><ele>32</ele></trkpt>
    <trkpt lat="37.5796" lon="-77.4296"><ele>34</ele></trkpt>
    <trkpt lat="37.5814" lon="-77.4314"><ele>30</ele></trkpt>
    <trkpt lat="37.5832" lon="-77.4332"><ele>26</ele></trkpt>
    <trkpt lat="37.5850" lon="-77.4350"><ele>22</ele></trkpt>
    <trkpt lat="37.5832" lon="-77.4368"><ele>18</ele></trkpt>
    <trkpt lat="37.5814" lon="-77.4386"><ele>15</ele></trkpt>
    <trkpt lat="37.5796" lon="-77.4404"><ele>13</ele></trkpt>
    <trkpt lat="37.5778" lon="-77.4386"><ele>12</ele></trkpt>
    <trkpt lat="37.5760" lon="-77.4368"><ele>11</ele></trkpt>
    <trkpt lat="37.5742" lon="-77.4350"><ele>10</ele></trkpt>
    <trkpt lat="37.5706" lon="-77.4350"><ele>10</ele></trkpt>
    <trkpt lat="37.5670" lon="-77.4350"><ele>10</ele></trkpt>
    <trkpt lat="37.5634" lon="-77.4350"><ele>11</ele></trkpt>
    <trkpt lat="37.5598" lon="-77.4350"><ele>11</ele></trkpt>
    <trkpt lat="37.5562" lon="-77.4350"><ele>10</ele></trkpt>
    <trkpt lat="37.5526" lon="-77.4350"><ele>10</ele></trkpt>
    <trkpt lat="37.5490" lon="-77.4350"><ele>10</ele></trkpt>
    <trkpt lat="37.5454" lon="-77.4350"><ele>10</ele></trkpt>
    <trkpt lat="37.5418" lon="-77.4350"><ele>10</ele></trkpt>
    <trkpt lat="37.5400" lon="-77.4350"><ele>10</ele></trkpt>
  </trkseg></trk>
</gpx>`,
    },
];

/**
 * Load default routes into IndexedDB if none exist yet.
 */
export async function ensureDefaultRoutes() {
    const exists = await hasRoutes();
    if (exists) return;

    console.log('[ROUTES] Loading default routes...');
    for (const route of DEFAULT_ROUTES) {
        try {
            await importRoute(route.gpx, route.metadata);
        } catch (err) {
            console.error(`[ROUTES] Failed to load ${route.key}:`, err);
        }
    }
    console.log(`[ROUTES] Loaded ${DEFAULT_ROUTES.length} default routes`);
}
