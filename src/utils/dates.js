function addMinutes(date, minutes) {
  return new Date(new Date(date).getTime() + minutes * 60 * 1000);
}

function asDateInput(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
}

function humanDate(date) {
  return new Intl.DateTimeFormat('en-UG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date));
}

module.exports = { addMinutes, asDateInput, humanDate };
