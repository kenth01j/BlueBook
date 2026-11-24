const PHILIPPINE_TIME_ZONE = 'Asia/Manila';
const OPEN_MINUTE = 8 * 60;
const CLOSE_MINUTE = 17 * 60;

const philippineTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: PHILIPPINE_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

function isOrderWindowOpen(date = new Date()) {
  const parts = philippineTimeFormatter.formatToParts(date);
  const hour = Number(parts.find(part => part.type === 'hour')?.value);
  const minute = Number(parts.find(part => part.type === 'minute')?.value);
  const minuteOfDay = hour * 60 + minute;
  return minuteOfDay >= OPEN_MINUTE && minuteOfDay < CLOSE_MINUTE;
}

module.exports = { isOrderWindowOpen };
