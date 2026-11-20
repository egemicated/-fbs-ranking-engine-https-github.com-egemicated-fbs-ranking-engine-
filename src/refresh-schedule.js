// Live publication and watchdog schedule, checked against the GitHub workflow.
// The older value in src/weekly.js is kept in that frozen research input.
// The production publisher replaces it before committing the snapshot.
export const UPDATE_SCHEDULE = Object.freeze({
  day: 'Daily', hour: 3, minute: 45, timeZone: 'America/Denver', cron: '45 3 * * *',
  sundayNight: { day: 'Sunday', hour: 20, minute: 11, cron: '11 20 * * 0' },
});
