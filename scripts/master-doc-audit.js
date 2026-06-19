#!/usr/bin/env node
const masterDocCoverage = require('../src/services/implementation/masterDocCoverageService');
const report = masterDocCoverage.audit();
console.log(JSON.stringify(report, null, 2));
if (!report.complete) process.exit(1);
