import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import {
	isMacOS, MacNotification, sendMacNotification, withdrawMacNotification,
	stopMacNotifications, setMacAutostart, acquireMacInstance,
} from '../src/utils/platform.js';
import { firstWeekday, firstWorkDay, clockIs12, amPmStr, timeFormat } from '../src/utils/locale.js';

function assert(value, message) { if (!value) throw new Error(message); }
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
assert(isMacOS, 'Run these integration checks on macOS');
assert(Number.isInteger(firstWeekday) && firstWeekday >= 0 && firstWeekday <= 6, 'Valid first weekday');
assert(Number.isInteger(firstWorkDay) && firstWorkDay >= 0 && firstWorkDay <= 6, 'Valid first workday');
assert(typeof clockIs12 === 'boolean', 'Clock format is boolean');
assert(Array.isArray(amPmStr) && amPmStr.length === 2 && amPmStr.every(Boolean), 'AM/PM labels are an array');
assert(timeFormat.includes('%M'), 'Time format includes minutes');

setMacAutostart(true);
const plist = Gio.File.new_for_path(GLib.build_filenamev([
	GLib.get_home_dir(), 'Library', 'LaunchAgents', 'io.github.diegopvlk.Dosage.plist',
]));
assert(plist.query_exists(null), 'Login agent created');
setMacAutostart(false);
assert(!plist.query_exists(null), 'Login agent removed');
setMacAutostart(false); // Disabling twice is harmless.
setMacAutostart(true); // Parsed independently by the shell test runner.

const actions = [];
let activations = 0;
let shutdown;
const app = {
	activate_action: action => actions.push(action),
	activate: () => activations++,
	connect: (_signal, callback) => { shutdown = callback; },
};
assert(acquireMacInstance(app), 'First instance owns the socket');
assert(!acquireMacInstance(app), 'Second launch reuses the first instance');
await delay(100);
assert(activations === 1, 'Second launch opens the existing window');
assert(!acquireMacInstance(app, true), 'Hidden login launch reuses the first instance');
await delay(100);
assert(activations === 1, 'Login launch does not reveal an existing window');
shutdown();
assert(acquireMacInstance(app), 'Socket is released at shutdown');
shutdown();

globalThis.settings = { get_boolean: () => true };
const notification = new MacNotification();
notification.set_title('[test]');
notification.set_body('$(touch /tmp/dosage-command-must-not-run) "quoted" & text');
notification.add_button('Confirm', 'app.confirm123');
withdrawMacNotification('test');
sendMacNotification(app, 'test', notification);
await delay(500);
assert(actions.join() === 'confirm123', 'Notification response activates its app action');

notification.set_title('delayed');
sendMacNotification(app, 'cancelled', notification);
await delay(100);
withdrawMacNotification('cancelled');
await delay(500);
assert(actions.length === 1, 'Withdrawn notifications cannot record a dose');

const [, bytes] = GLib.file_get_contents(GLib.build_filenamev([GLib.getenv('DOSAGE_TEST_TMP'), 'notifications.jsonl']));
const calls = new TextDecoder().decode(bytes).trim().split('\n').map(line => JSON.parse(line));
assert(calls[0].join() === '-remove,dosage.test', 'Removal precedes delivery');
assert(calls[1].includes('\\[test]'), 'Leading plist punctuation is escaped');
assert(calls[1].includes(notification.body), 'Message text is passed literally as an argument');
assert(!Gio.File.new_for_path('/tmp/dosage-command-must-not-run').query_exists(null), 'Message text is never executed');
assert(calls[1].includes('-sound'), 'Sound uses the native notification backend');
stopMacNotifications();
print('PASS: locale, LaunchAgent, single instance, native notification arguments/actions/cancellation');
