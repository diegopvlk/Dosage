/*
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Xdp from 'gi://Xdp';
import { historyLS, treatmentsLS } from './window.js';
import { clockIs12, createTempObj } from './utils.js';

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
	const exportHistoryFormat = builder.get_object('exportHistoryFormat');
	const saveHistory = builder.get_object('saveHistory');

	const notifBtnsHeader = notifBtns.get_first_child().get_first_child().get_first_child();
	notifBtnsHeader.set_activatable(false);

	autostartSwitch.set_active(settings.get_boolean('autostart'));

	autostartSwitch.connect('state-set', () => {
		const state = autostartSwitch.get_active();
		settings.set_boolean('autostart', state);

		if (container === 'flatpak') {
			const portal = new Xdp.Portal();
			const autostartState = state ? Xdp.BackgroundFlags.AUTOSTART : Xdp.BackgroundFlags.NONE;
			portal.request_background(
				null,
				_('Accept to allow running in the background and receive notifications'),
				['io.github.diegopvlk.Dosage', '--startup'],
				autostartState,
				null,
				(_portal, result) => {
					try {
						portal.request_background_finish(result);
					} catch (err) {
						console.error(err);
						if (!state) return;
						const alertDialog = new Adw.AlertDialog({
							heading: _('An Issue Has Occurred'),
							body: err.message,
						});
						alertDialog.add_response('close', _('Close'));
						alertDialog.present(prefsDialog);
					}
				},
			);
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

	saveHistory.sensitive = historyLS.n_items > 0;

	exportHistoryFormat.set_selected(settings.get_int('export-history-format'));

	exportHistoryFormat.connect('notify::selected-item', () => {
		const selected = exportHistoryFormat.get_selected();
		settings.set_int('export-history-format', selected);
	});

	saveHistory.connect('activated', () => {
		let isISO = false;
		let isHTML = false;

		const selected = exportHistoryFormat.get_selected();
		if (selected === 1 || selected === 3) isISO = true;
		if (selected === 2 || selected === 3) isHTML = true;

		saveHistFile(isISO, isHTML, DosageWindow).catch(console.error);
	});

	prefsDialog.present(DosageWindow);
}

async function saveHistFile(isISO, isHTML, DosageWindow) {
	let name = _('Dosage') + '_' + _('History') + (isISO ? '_ISO' : '');

	const fileDialog = new Gtk.FileDialog({
		initial_name: name + (isHTML ? '.html' : '.csv'),
	});

	const file = await fileDialog.save(DosageWindow, null);

	let tempObj, fileToSave;

	tempObj = createTempObj('history', historyLS);
	fileToSave = isHTML
		? getHistoryHTML(tempObj.history, isISO)
		: getHistoryCSV(tempObj.history, isISO);

	const contents = new TextEncoder().encode(fileToSave);
	await file.replace_contents_async(contents, null, false, Gio.FileCreateFlags.NONE, null);
}

function getHistoryCSV(history, isISO) {
	const header = [_('Date'), _('Time'), _('Name'), _('Dose'), _('Status'), _('Time Confirmed')];

	const rows = history.map(med => {
		const time = new Date();
		time.setHours(med.time[0]);
		time.setMinutes(med.time[1]);

		const timeString = time.toLocaleTimeString(undefined, {
			hour: 'numeric',
			minute: 'numeric',
			hour12: clockIs12,
		});

		const dateTaken = new Date(med.taken[0]);

		const dateString = isISO
			? dateTaken.toISOString().split('T')[0]
			: dateTaken.toLocaleDateString(undefined, {
					year: 'numeric',
					month: '2-digit',
					day: '2-digit',
			  });

		let timeConfirmedStr = '';

		let status;
		switch (med.taken[1]) {
			case -1:
				status = _('Missed');
				break;
			case 0:
				status = _('Skipped');
				break;
			case 1:
				status = _('Confirmed');
				timeConfirmedStr = new Date(med.taken[0]).toLocaleTimeString(undefined, {
					hour: 'numeric',
					minute: 'numeric',
					hour12: clockIs12,
				});
				break;
			case 2:
				status = _('Auto-Confirmed');
				break;
			case 3:
				status = _('Confirmed') + ` (${_('Time Unknown')})`;
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

function getHistoryHTML(history, isISO) {
	const escapeHTML = str =>
		String(str)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');

	const header = [_('Date'), _('Time'), _('Name'), _('Dose'), _('Status'), _('Time Confirmed')];

	const thead = `
	<thead>
			<tr>
					${header.map(label => `<th>${escapeHTML(label)}</th>`).join('')}
			</tr>
	</thead>`;

	const tbodyRows = history
		.map(med => {
			const time = new Date();
			time.setHours(med.time[0]);
			time.setMinutes(med.time[1]);

			const timeString = time.toLocaleTimeString(undefined, {
				hour: 'numeric',
				minute: 'numeric',
				hour12: clockIs12,
			});

			const dateTaken = new Date(med.taken[0]);
			const dateString = isISO
				? dateTaken.toISOString().split('T')[0]
				: dateTaken.toLocaleDateString(undefined, {
						year: 'numeric',
						month: '2-digit',
						day: '2-digit',
				  });

			let status;
			let timeConfirmedStr = '';
			let statusClass = '';

			switch (med.taken[1]) {
				case -1:
					status = _('Missed');
					statusClass = 'status-missed';
					break;
				case 0:
					status = _('Skipped');
					statusClass = 'status-skipped';
					break;
				case 1:
					status = _('Confirmed');
					statusClass = 'status-confirmed';
					timeConfirmedStr = new Date(med.taken[0]).toLocaleTimeString(undefined, {
						hour: 'numeric',
						minute: 'numeric',
						hour12: clockIs12,
					});
					break;
				case 2:
					status = _('Auto-Confirmed');
					statusClass = 'status-confirmed';
					break;
				case 3:
					status = _('Confirmed') + ` (${_('Time Unknown')})`;
					statusClass = 'status-confirmed';
					break;
			}

			const doseUnit = `${med.dose} ${med.unit}`;

			const cells = [dateString, timeString, med.name, doseUnit, status, timeConfirmedStr].map(
				escapeHTML,
			);

			const statusCell = `<td class="${statusClass}">${cells[4]}</td>`;

			return `
			<tr>
					<td>${cells[0]}</td>
					<td>${cells[1]}</td>
					<td>${cells[2]}</td>
					<td>${cells[3]}</td>
					${statusCell}
					<td>${cells[5]}</td>
			</tr>`;
		})
		.join('\n');

	const tbody = `<tbody>\n${tbodyRows}\n</tbody>`;

	const style = `
	<style>
		:root {
			color-scheme: light dark;
		}
		.history-table {
			width: 100%;
			border-collapse: collapse;
			font-family: system-ui, Arial, sans-serif;
			overflow-x: auto;
		}
		.history-table th,
		.history-table td {
			padding: 0.4rem;
			border: 1px solid light-dark(#77767B, #5E5C64);
		}
		.history-table thead th {
			background-color: light-dark(#5E5C64, #9A9996);
			color: light-dark(#FFFFFF, #000000);
			font-weight: 700;
			position: sticky;
			top: 0;
			z-index: 2;
		}
		.history-table tbody tr:nth-child(even) {
			background-color: light-dark(#F6F5F4, #2b2b2b);
		}
		.history-table tbody tr:hover {
			background-color: light-dark(#C0BFBC, #4c4c4c);
		}
		.status-missed   { color: light-dark(#C01C28, #ff6b6b); font-weight: 600; }
		.status-skipped  { color: light-dark(#3D3846, #DEDDDA); font-weight: 600; }
		.status-confirmed{ color: light-dark(#26A269, #2EC27E); font-weight: 600; }
	</style>`;

	return minifyHTML(`${style}
	<table class="history-table">
	${thead}
	${tbody}
	</table>`);
}

function minifyHTML(html) {
	return html
		.replace(/\s+/g, ' ')
		.replace(/\s*(<[^>]+>)\s*/g, '$1')
		.trim();
}
