import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';

export type CalendarDateFilter = 'today' | 'yesterday' | 'week' | 'month' | 'all';

const APP_WEEK_OPTIONS = { weekStartsOn: 1 as const };

export const toLocalDateString = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getCalendarDateRange = (
  filter: CalendarDateFilter,
  now: Date = new Date(),
): { start: Date; end: Date } => {
  switch (filter) {
    case 'today':
      return { start: startOfDay(now), end: endOfDay(now) };
    case 'yesterday': {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return { start: startOfDay(yesterday), end: endOfDay(yesterday) };
    }
    case 'week':
      return {
        start: startOfWeek(now, APP_WEEK_OPTIONS),
        end: endOfWeek(now, APP_WEEK_OPTIONS),
      };
    case 'month':
      return { start: startOfMonth(now), end: endOfMonth(now) };
    case 'all':
      return { start: new Date(2000, 0, 1), end: new Date(2100, 0, 1) };
  }
};

export const getCalendarDateRangeStrings = (
  filter: Exclude<CalendarDateFilter, 'all'>,
  now: Date = new Date(),
): { start: string; end: string } => {
  const range = getCalendarDateRange(filter, now);
  return {
    start: toLocalDateString(range.start),
    end: toLocalDateString(range.end),
  };
};

export const isDateInCalendarRange = (
  value: string | Date | null | undefined,
  filter: CalendarDateFilter,
  now: Date = new Date(),
): boolean => {
  if (filter === 'all') return true;
  if (!value) return false;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return false;

  const { start, end } = getCalendarDateRange(filter, now);
  return date >= start && date <= end;
};
