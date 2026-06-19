Automated in `tests/e2e/routeSmoke.test.js`; manual smoke path after npm install:
1. GET /
2. GET /search?serviceType=bus&bookable=true
3. GET /companies/classic-express
4. GET /book/bus/kampala-juba-executive-coach-classic-express
5. POST /bookings/guest with listingId, fullName, email, phone
6. GET /tickets/:bookingRef
7. POST /api/scanner/validate with qrCodeValue
