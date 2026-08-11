'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = require('../package.json');
const home = read('src/views/pages/home.ejs');
const seed = read('scripts/seed-launch-seo-operators.js');
const app = read('src/app.js');
const listingCard = read('src/views/partials/listing-card.ejs');
const blogs = read('src/views/pages/blogs.ejs');
const post = read('src/views/pages/blog-post.ejs');

const checks = [];
const check = (name, ok) => checks.push([name, Boolean(ok)]);

check('release includes the v1.6.44 Home/media contract', Number(pkg.version.split('.')[2]) >= 44);
check('Home keeps exactly three blog previews', home.includes("var homeBlogs = (bootstrap.blogs || []).slice(0, 3)") && !home.includes('bootstrap.blogs.forEach'));
check('Home More blogs button opens the complete directory', /class="moreRow blogMoreRow"[^>]*><a[^>]+href="\/blogs"[^>]*>/.test(home));
check('all seven seeded blogs use meaningful travel photographs', (seed.match(/^  '[^']+': \{ url: 'https:\/\//gm) || []).length >= 7 && !seed.includes("image: '/images/launch-lockup-512.png'"));
check('legacy logo placeholders are upgraded without overwriting custom blog images', seed.includes('const isLegacyLogo = isMissingOrLogoLikeImage(currentImage)') && seed.includes('if (isLegacyLogo)'));
check('all six launch operators have real bus media', ['bebeto-coach-services','trinity-express','zawadi-travel-service','eco-bus','friendship-bus','yy-coaches'].every((key) => seed.includes(`'${key}': {`)) && seed.includes("label: 'Real operator coach photograph'"));
check('listing images are populated only through empty-field enrichment', seed.includes('shortDescription: operator.description, media: listingMedia') && seed.includes('async function enrichSeededDoc'));
check('external image hosts are explicitly CSP allowlisted', ['bebetocoachservices.com','zawadigroups.com','trinityexpress.rw','pbs.twimg.com','cdn.bookaway.com','booking.ttta.co.ug'].every((host) => app.includes(`https://${host}`)));
check('external photographs use no-referrer loading', [home, listingCard, blogs, post].every((body) => body.includes('referrerpolicy="no-referrer"')));
check('one editable research Draft departure is prepared for every operator', seed.includes("const TripSchedule = require('../src/models/TripSchedule')") && (seed.match(/sourceLabel: '[^']+', sourceUrl:/g) || []).length >= 6 && seed.includes("status: 'draft'"));
check('seeded departures can never masquerade as live inventory', seed.includes('operatorConfirmationRequired: true') && seed.includes("failures: ['operator_confirmation_required', 'vehicle_required', 'seat_map_required', 'fare_inventory_required']") && !/TripSchedule[\s\S]{0,800}status:\s*'published'/.test(seed));

const failed = checks.filter(([, ok]) => !ok);
checks.forEach(([name, ok]) => console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`));
if (failed.length) {
  console.error(`v1.6.44 checks failed (${checks.length - failed.length}/${checks.length}).`);
  process.exit(1);
}
console.log(`v1.6.44 checks passed (${checks.length}/${checks.length}).`);
