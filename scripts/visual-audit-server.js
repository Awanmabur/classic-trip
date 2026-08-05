#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.resolve(__dirname, '..');
const fixtureRoot = path.join(root, '.visual-audit');
const publicRoot = path.join(root, 'public');
const port = Number(process.env.VISUAL_AUDIT_PORT || 4173);

const types = { '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json' };

function sendFile(res, file) {
  if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

const rooms = [
  { id: 'deluxe-garden', roomType: 'Deluxe Garden Room', nightlyPrice: 185000, stayPrice: 370000, inventory: 4, availableUnits: 4, capacity: 2 },
  { id: 'family-suite', roomType: 'Family Two-Bedroom Suite', nightlyPrice: 320000, stayPrice: 640000, inventory: 2, availableUnits: 2, capacity: 5 },
  { id: 'entire-villa', roomType: 'Entire Four-Bedroom Villa', nightlyPrice: 780000, stayPrice: 1560000, inventory: 1, availableUnits: 1, capacity: 8 },
  { id: 'rooftop-studio', roomType: 'Rooftop Studio', nightlyPrice: 210000, stayPrice: 420000, inventory: 0, availableUnits: 0, capacity: 2 },
];

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/visual/stay') return sendFile(res, path.join(fixtureRoot, 'stay.html'));
  if (url.pathname === '/visual/hotel-dashboard') return sendFile(res, path.join(fixtureRoot, 'hotel-dashboard.html'));
  if (url.pathname === '/api/v1/listings/stay-1/availability') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ checkIn: url.searchParams.get('checkIn'), checkOut: url.searchParams.get('checkOut'), nights: 2, rooms }));
    return;
  }
  if (url.pathname.startsWith('/css/') || url.pathname.startsWith('/js/') || url.pathname.startsWith('/images/') || url.pathname === '/site.webmanifest') {
    return sendFile(res, path.join(publicRoot, url.pathname));
  }
  res.writeHead(302, { location: '/visual/stay' }).end();
}).listen(port, '0.0.0.0', () => process.stdout.write(`Visual audit ready on ${port}\n`));
