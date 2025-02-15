/*
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { historyLS, treatmentsLS } from './window.js';
import { createTempObj } from './utils.js';

export default function openPrefsDialog(DosageApplication) {
	const container = GLib.getenv('container');

	const builder = Gtk.Builder.new_from_resource('/io/github/diegopvlk/Dosage/ui/preferences.ui');

	const prefsDialog = builder.get_object('prefsDialog');
	const autostartSwitch = builder.get_object('autostartSwitch');
	const clearHistSwitch = builder.get_object('clearHistSwitch');
	const notifStockSwitch = builder.get_object('notifStockSwitch');
	const notifSoundSwitch = builder.get_object('notifSoundSwitch');
	const confirmSwitch = builder.get_object('confirmSwitch');
	const skipSwitch = builder.get_object('skipSwitch');
	const notifBtns = builder.get_object('notifBtns');
	const exportHistory = builder.get_object('exportHistory');

	const notifBtnsHeader = notifBtns.get_first_child().get_first_child().get_first_child();
	const notifBtnsExpanderBtn = notifBtnsHeader
		.get_first_child()
		.get_last_child()
		.get_first_child()
		.get_next_sibling()
		.get_next_sibling();
	notifBtnsHeader.set_activatable(false);
	notifBtnsExpanderBtn.set_visible(false);

	autostartSwitch.set_active(settings.get_boolean('autostart'));

	autostartSwitch.connect('state-set', () => {
		const state = autostartSwitch.get_active();
		settings.set_boolean('autostart', state);

		if (container === 'flatpak') {
			DosageApplication._requestBackground(state);
		} else {
			const autostartFilePath = GLib.build_filenamev([
				GLib.get_home_dir(),
				'.config',
				'autostart',
				'dosage-tracker-startup.desktop',
			]);
			if (state) {
				GLib.mkdir_with_parents(GLib.path_get_dirname(autostartFilePath), 0o755);
				const fileContents =
					'[Desktop Entry]\nType=Application\nName=io.github.diegopvlk.Dosage\nExec=dosage-tracker --startup';
				GLib.file_set_contents(autostartFilePath, fileContents);
			} else {
				const file = Gio.File.new_for_path(autostartFilePath);
				if (file) file.delete(null);
			}
		}
	});

	clearHistSwitch.set_active(settings.get_boolean('clear-old-hist'));

	clearHistSwitch.connect('state-set', () => {
		const state = clearHistSwitch.get_active();
		settings.set_boolean('clear-old-hist', state);
	});

	notifStockSwitch.set_active(settings.get_boolean('low-stock-notif'));

	notifStockSwitch.connect('state-set', () => {
		const state = notifStockSwitch.get_active();
		settings.set_boolean('low-stock-notif', state);
	});

	notifSoundSwitch.set_active(settings.get_boolean('sound'));

	notifSoundSwitch.connect('state-set', () => {
		const state = notifSoundSwitch.get_active();
		settings.set_boolean('sound', state);
	});

	confirmSwitch.set_active(settings.get_boolean('confirm-button'));
	skipSwitch.set_active(settings.get_boolean('skip-button'));

	confirmSwitch.connect('state-set', () => {
		const state = confirmSwitch.get_active();
		settings.set_boolean('confirm-button', state);
	});
	skipSwitch.connect('state-set', () => {
		const state = skipSwitch.get_active();
		settings.set_boolean('skip-button', state);
	});

	Gio._promisify(Gtk.FileDialog.prototype, 'save', 'save_finish');
	Gio._promisify(Gio.File.prototype, 'replace_contents_async', 'replace_contents_finish');

	const DosageWindow = DosageApplication.activeWindow;

	exportHistory.sensitive = historyLS.n_items > 0;

	exportHistory.connect('activated', () => {
		saveFile('history', DosageWindow).catch(console.error);
	});

	prefsDialog.present(DosageWindow);
}

async function saveFile(type, DosageWindow) {
	let name = _('Dosage') + '_';
	name += type === 'history' ? _('History') : _('Treatments');

	const fileDialog = new Gtk.FileDialog({
		initial_name: name + '.csv',
	});

	const file = await fileDialog.save(DosageWindow, null);

	let tempObj, csv;

	if (type === 'history') {
		tempObj = createTempObj('history', historyLS);
		csv = getHistoryCSV(tempObj.history);
	} else {
		// tempObj = createTempObj('treatments', treatmentsLS);
		// csv = getTreatmentsCSV(tempObj.treatments);
	}

	const contents = new TextEncoder().encode(csv);
	await file.replace_contents_async(contents, null, false, Gio.FileCreateFlags.NONE, null);
}

function getHistoryCSV(history) {
	const header = [_('Date'), _('Time'), _('Name'), _('Dose'), _('Status'), _('Time Confirmed')];

	const rows = history.map(med => {
		const time = new Date();
		time.setHours(med.time[0]);
		time.setMinutes(med.time[1]);

		const timeString = time.toLocaleTimeString(undefined, {
			hour: 'numeric',
			minute: 'numeric',
		});

		const dateString = new Date(med.taken[0]).toLocaleDateString(undefined, {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
		});

		let timeConfirmedStr = '';

		let status;
		switch (med.taken[1]) {
			case 0:
				status = _('Skipped');
				break;
			case -1:
				status = _('Missed');
				break;
			case 1:
				status = _('Confirmed');
				timeConfirmedStr = new Date(med.taken[0]).toLocaleTimeString(undefined, {
					hour: 'numeric',
					minute: 'numeric',
				});
				break;
			case 2:
				status = _('Auto-confirmed');
				break;
			case 3:
				status = _('Confirmed') + ` (${_('Time unknown')})`;
				break;
		}

		const doseUnit = `${med.dose} ${med.unit}`;

		return [
			`"${dateString}"`,
			`"${timeString}"`,
			`"${med.name.replace(/"/g, '""')}"`,
			`"${doseUnit.replace(/"/g, '""')}"`,
			`"${status}"`,
			`"${timeConfirmedStr}"`,
		].join(',');
	});

	return [header.join(','), ...rows].join('\n');
}
