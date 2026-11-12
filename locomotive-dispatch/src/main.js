/** Entry point: styles, built-in data, start the app. */
import 'leaflet/dist/leaflet.css';
import './styles/index.css';

import snapshot from '../data/snapshot.json';
import plan from '../data/static-plan.json';
import base2home from '../data/base2home.json';
import multiHome from '../data/base2home-multi.json';
import lcsFleet from '../data/lcs-fleet.json';
import cnNetwork from '../data/cn-network.json';
import { startApp } from './ui/app.js';
import { markerByKey, deadByLoco, dhByLoco, layers } from './ui/map/mapView.js';

const app = startApp({
  snapshot,
  reference: { plan, base2home, multiHome, lcs: new Set(lcsFleet) },
  network: cnNetwork,
});

// handy for debugging in the console (also used by the e2e parity test)
window.dispatchApp = { app, markers: { markerByKey, deadByLoco, dhByLoco, layers } };
