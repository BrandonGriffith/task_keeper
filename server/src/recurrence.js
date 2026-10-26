const dateFormatterCache = new Map();

function formatterFor(timeZone) {
  if (!dateFormatterCache.has(timeZone)) {
    dateFormatterCache.set(
      timeZone,
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }),
    );
  }
  return dateFormatterCache.get(timeZone);
}

export function localDateParts(instant, timeZone) {
  const values = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return { year: values.year, month: values.month, day: values.day };
}

function localDateTimeParts(instant, timeZone) {
  const values = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function dateString({ year, month, day }) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}

function addDays(value, count) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addMonths(year, month, count) {
  const date = new Date(Date.UTC(year, month - 1 + count, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function addYears(year, count) {
  return year + count;
}

function weekday(value) {
  return new Date(`${value}T00:00:00.000Z`).getUTCDay();
}

function toUtcInstant(date, dueTime, timeZone) {
  const { year, month, day } = parseDate(date);
  const [hour, minute] = dueTime.split(':').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = new Date(target);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = localDateTimeParts(candidate, timeZone);
    const represented = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const difference = target - represented;
    if (difference === 0) break;
    candidate = new Date(candidate.getTime() + difference);
  }

  return candidate;
}

function dueForDate(config, date) {
  return {
    dueAt: toUtcInstant(date, config.dueTime, config.timezone),
    dateAdjusted: false,
  };
}

function monthlyDue(config, year, month) {
  const selectedDay = config.monthlyDay;
  const actualDay = Math.min(selectedDay, daysInMonth(year, month));
  const date = dateString({ year, month, day: actualDay });
  return {
    dueAt: toUtcInstant(date, config.dueTime, config.timezone),
    dateAdjusted: actualDay !== selectedDay,
  };
}

function candidateForDate(config, date) {
  if (config.frequency === 'monthly') {
    const { year, month } = parseDate(date);
    return monthlyDue(config, year, month);
  }
  return dueForDate(config, date);
}

function followingOccurrence(config, previousDueAt) {
  const previous = localDateParts(previousDueAt, config.timezone);
  const previousDate = dateString(previous);

  if (config.frequency === 'daily') {
    return candidateForDate(config, addDays(previousDate, 1));
  }
  if (config.frequency === 'weekly') {
    const daysUntil = ((config.weeklyDay - weekday(previousDate) + 7) % 7) || 7;
    return candidateForDate(config, addDays(previousDate, daysUntil));
  }
  if (config.frequency === 'monthly') {
    const next = addMonths(previous.year, previous.month, 1);
    return monthlyDue(config, next.year, next.month);
  }

  const year = addYears(previous.year, 1);
  return dueForDate(
    config,
    dateString({ year, month: config.yearlyMonth, day: config.yearlyDay }),
  );
}

export function firstOccurrence(config, now = new Date()) {
  const today = dateString(localDateParts(now, config.timezone));
  const { year, month, day } = parseDate(today);
  let first;

  if (config.frequency === 'daily') {
    first = candidateForDate(config, today);
  } else if (config.frequency === 'weekly') {
    const daysUntil = (config.weeklyDay - weekday(today) + 7) % 7;
    first = candidateForDate(config, addDays(today, daysUntil));
  } else if (config.frequency === 'monthly') {
    first = monthlyDue(config, year, month);
  } else {
    first = dueForDate(
      config,
      dateString({ year, month: config.yearlyMonth, day: config.yearlyDay }),
    );
  }

  if (first.dueAt <= now) {
    first = followingOccurrence(config, first.dueAt);
  }

  return first;
}

export function nextOccurrence(config, previousDueAt) {
  return followingOccurrence(config, new Date(previousDueAt));
}

export function validDaysInMonth(year, month) {
  return daysInMonth(year, month);
}

export function occurrenceDateAdjusted(config, dueAt) {
  if (config.frequency !== 'monthly') return false;
  const localDay = localDateParts(new Date(dueAt), config.timezone).day;
  return localDay < config.monthlyDay;
}
