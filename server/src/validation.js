import { z } from 'zod';
import { HttpError } from './errors.js';

const baseTask = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(''),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  dueTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().min(1).max(100),
  weeklyDay: z.number().int().min(0).max(6).optional(),
  monthlyDay: z.number().int().min(1).max(31).optional(),
  yearlyMonth: z.number().int().min(1).max(12).optional(),
  yearlyDay: z.number().int().min(1).max(31).optional(),
});

export function parseTaskInput(body) {
  const input = baseTask.parse(body);
  if (input.frequency === 'weekly' && input.weeklyDay === undefined) {
    throw new HttpError(400, 'Choose a weekday for a weekly task');
  }
  if (input.frequency === 'monthly' && input.monthlyDay === undefined) {
    throw new HttpError(400, 'Choose a day for a monthly task');
  }
  if (input.frequency === 'yearly' && (input.yearlyMonth === undefined || input.yearlyDay === undefined)) {
    throw new HttpError(400, 'Choose a month and day for a yearly task');
  }
  if (
    input.frequency === 'yearly'
    && input.yearlyMonth === 2
    && input.yearlyDay === 29
  ) {
    throw new HttpError(400, 'February 29 is not available for yearly tasks');
  }

  const isValidDate = input.frequency !== 'yearly'
    || input.yearlyDay <= new Date(Date.UTC(2000, input.yearlyMonth, 0)).getUTCDate();
  if (!isValidDate) throw new HttpError(400, 'That date does not exist in the selected month');

  try {
    new Intl.DateTimeFormat('en', { timeZone: input.timezone });
  } catch (error) {
    if (error instanceof RangeError) throw new HttpError(400, 'Choose a valid timezone');
    throw error;
  }

  return input;
}
