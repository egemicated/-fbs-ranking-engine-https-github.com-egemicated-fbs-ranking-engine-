// Live publication schedule, checked against the GitHub workflows.
// The older value in src/weekly.js is kept in that frozen research input.
// The production publisher replaces it before committing the snapshot.
export const UPDATE_SCHEDULE = Object.freeze({
  day: 'Daily', hour: 2, minute: 45, timeZone: 'America/New_York', cron: '45 2 * * *',
  backup: Object.freeze({ hour: 4, minute: 45, cron: '45 4 * * *' }),
});
