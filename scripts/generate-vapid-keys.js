'use strict';
const crypto = require('crypto');

const ecdh = crypto.createECDH('prime256v1');
ecdh.generateKeys();
const publicKey = ecdh.getPublicKey().toString('base64url');
const privateKey = ecdh.getPrivateKey().toString('base64url');

console.log('Classic Trip Web Push VAPID keys');
console.log('Keep the private key secret. Do not commit it to Git.');
console.log('');
console.log(`PUSH_VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`PUSH_VAPID_PRIVATE_KEY=${privateKey}`);
console.log('PUSH_VAPID_SUBJECT=mailto:support@classictrip.org');
