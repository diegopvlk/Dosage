import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

export const isMacOS = GLib.get_os_info('ID') === 'macos' ||
	Gio.File.new_for_path('/System/Library/CoreServices/SystemVersion.plist').query_exists(null);

// libportal is a Linux integration, not a requirement for the macOS build.
export const Xdp = isMacOS ? null : (await import('gi://Xdp?version=1.0')).default;

export class MacNotification {
	constructor() { this.buttons = []; }
	set_title(value) { this.title = value; }
	set_body(value) { this.body = value; }
	set_icon() {}
	set_priority() {} // macOS controls alert presentation and Focus policy.
	set_default_action(value) { this.defaultAction = value; }
	add_button(label, action) { this.buttons.push({ label, action }); }
}

let shuttingDown = false;
const pending = new Map();
const operations = new Map();

function notifier(args) {
	const executable = GLib.getenv('DOSAGE_NOTIFIER') || GLib.find_program_in_path('terminal-notifier');
	if (!executable) throw new Error('Install terminal-notifier to enable macOS reminders');
	return Gio.Subprocess.new([executable, ...args],
		Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
}

function communicate(process, callback) {
	process.communicate_utf8_async(null, null, (proc, result) => {
		try {
			const [, stdout, stderr] = proc.communicate_utf8_finish(result);
			callback(proc, stdout.trim(), stderr.trim());
		} catch (error) { console.error(error); }
	});
}

// Order remove/send requests per reminder, without waiting for interactive clicks.
function enqueue(id, operation) {
	const previous = operations.get(id) || Promise.resolve();
	const next = previous.then(operation).catch(console.error);
	operations.set(id, next);
	next.finally(() => { if (operations.get(id) === next) operations.delete(id); });
}

function stopPending(id) {
	const previous = pending.get(id);
	pending.delete(id);
	if (previous) previous.force_exit();
}

// NSUserDefaults parses leading punctuation as a plist unless escaped.
const notificationText = value => /^[\[({"']/.test(value) ? `\\${value}` : value;

export function sendMacNotification(app, id, notification) {
	enqueue(id, () => {
		if (shuttingDown) return;
		stopPending(id);
		const args = ['-title', notificationText(notification.title || 'Dosage'),
			'-message', notificationText(notification.body || ''),
			'-group', `dosage.${id}`];
		if (globalThis.settings?.get_boolean('sound')) args.push('-sound', 'default');
		for (const button of notification.buttons) args.push('-action', notificationText(button.label));
		if (notification.buttons.length) args.push('-timeout', '86400');
		else if (GLib.getenv('DOSAGE_MACOS_LAUNCHER')) {
			const bundle = Gio.File.new_for_path(GLib.getenv('DOSAGE_MACOS_LAUNCHER')).get_parent().get_parent().get_parent();
			args.push('-open', bundle.get_uri());
		}
		const process = notifier(args);
		pending.set(id, process);
		communicate(process, (proc, output, error) => {
			if (pending.get(id) !== proc) return;
			pending.delete(id);
			if (!proc.get_successful()) {
				if (proc.get_if_exited() && proc.get_exit_status() !== 6)
					console.error(`macOS notification failed: ${error}`);
				return;
			}
			const action = notification.buttons.find(button => button.label === output)?.action;
			if (action) app.activate_action(action.replace(/^app\./, ''), null);
			else if (output === '@ACTIONCLICKED') app.activate();
		});
	});
}

export function withdrawMacNotification(id) {
	// Invalidate callbacks immediately, before the queued removal starts.
	stopPending(id);
	enqueue(id, () => new Promise(resolve => {
		stopPending(id);
		communicate(notifier(['-remove', `dosage.${id}`]), (proc, _out, error) => {
			if (!proc.get_successful()) console.error(`macOS notification removal failed: ${error}`);
			resolve();
		});
	}));
}

export function stopMacNotifications() {
	shuttingDown = true;
	for (const id of pending.keys()) stopPending(id);
}

export function setMacAutostart(enabled) {
	const file = Gio.File.new_for_path(GLib.build_filenamev([
		GLib.get_home_dir(), 'Library', 'LaunchAgents', 'io.github.diegopvlk.Dosage.plist',
	]));
	if (!enabled) {
		if (file.query_exists(null)) file.delete(null);
		return;
	}
	const launcher = GLib.getenv('DOSAGE_MACOS_LAUNCHER');
	if (!launcher || !GLib.file_test(launcher, GLib.FileTest.IS_EXECUTABLE))
		throw new Error('Launch Dosage from the macOS app bundle before enabling automatic startup');
	GLib.mkdir_with_parents(file.get_parent().get_path(), 0o700);
	const escaped = GLib.markup_escape_text(launcher, -1);
	const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>io.github.diegopvlk.Dosage</string>
<key>ProgramArguments</key><array><string>${escaped}</string><string>--startup</string></array>
<key>RunAtLoad</key><true/>
<key>LimitLoadToSessionType</key><string>Aqua</string>
</dict></plist>`;
	GLib.file_set_contents(file.get_path(), plist);
}

// macOS has no session D-Bus to provide GApplication's usual single-instance
// activation. A private local socket makes Finder launches reopen the same window.
export function acquireMacInstance(app, startup = false) {
	const directory = GLib.build_filenamev([GLib.get_user_cache_dir(), 'dosage']);
	GLib.mkdir_with_parents(directory, 0o700);
	const path = GLib.build_filenamev([directory, 'instance.sock']);
	const address = new Gio.UnixSocketAddress({ path });
	let staleSocket = false;
	const activateExisting = () => {
		try {
			const connection = new Gio.SocketClient().connect(address, null);
			connection.get_output_stream().write_all(new TextEncoder().encode(startup ? 'hidden' : 'open'), null);
			connection.close(null);
			return true;
		} catch (error) {
			if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND) &&
				!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CONNECTION_REFUSED)) throw error;
			staleSocket = error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CONNECTION_REFUSED);
			return false;
		}
	};
	if (activateExisting()) return false;
	const socketFile = Gio.File.new_for_path(path);
	if (staleSocket && socketFile.query_exists(null)) socketFile.delete(null);
	const service = new Gio.SocketService();
	try {
		service.add_address(address, Gio.SocketType.STREAM, Gio.SocketProtocol.DEFAULT, null);
	} catch (error) {
		// A second launch may have won the bind while this one was starting.
		if (activateExisting()) return false;
		throw error;
	}
	service.connect('incoming', (_service, connection) => {
		const stream = connection.get_input_stream();
		stream.read_bytes_async(16, GLib.PRIORITY_DEFAULT, null, (input, result) => {
			try {
				const message = new TextDecoder().decode(input.read_bytes_finish(result).get_data());
				if (message === 'open') app.activate();
			} catch (error) { console.error(error); }
			finally { connection.close(null); }
		});
		return true;
	});
	service.start();
	app.connect('shutdown', () => {
		service.stop();
		service.close();
		if (socketFile.query_exists(null)) socketFile.delete(null);
	});
	return true;
}
