// Keep live schedule metadata separate from the frozen weekly snapshot builder.
export const UPDATE_SCHEDULE = Object.freeze({
  day: 'Daily', hour: 3, minute: 45, timeZone: 'America/Denver', cron: '45 3 * * *',
  sundayNight: { day: 'Sunday', hour: 20, minute: 11, cron: '11 20 * * 0' },
});
