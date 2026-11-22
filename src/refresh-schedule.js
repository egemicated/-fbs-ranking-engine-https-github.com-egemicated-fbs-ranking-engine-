// Live publication schedule for the daily Codex refresh.
// The older value in src/weekly.js is kept in that frozen research input.
// The production publisher replaces it before committing the snapshot.
export const UPDATE_SCHEDULE = Object.freeze({
  day: 'Daily', hour: 7, minute: 30, timeZone: 'Etc/GMT+7',
});
