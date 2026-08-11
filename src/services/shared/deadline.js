'use strict';

function defaultDeadlineError(milliseconds) {
  const error = new Error(`Operation exceeded its ${milliseconds}ms response deadline`);
  error.status = 503;
  error.code = 'operation_deadline_exceeded';
  error.publicMessage = 'This service is temporarily busy. Please retry in a moment.';
  return error;
}

async function withDeadline(work, milliseconds, createError = defaultDeadlineError) {
  const duration = Math.max(1, Number(milliseconds || 0));
  const operation = typeof work === 'function'
    ? Promise.resolve().then(work)
    : Promise.resolve(work);
  let timer;
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(createError(duration)), duration);
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { withDeadline, defaultDeadlineError };
