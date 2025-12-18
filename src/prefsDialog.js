/*
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Xdp from 'gi://Xdp?version=1.0';
import { saveHistFile, saveTreatFile } from './utils/saveFiles.js';
import { historyLS, treatmentsLS } from './window.js';

export const PrefsDialog = GObject.registerClass(
	{
		GTypeName: 'PrefsDialog',
		Template: 'resource:///io/github/diegopvlk/Dosage/ui/preferences.ui',
		InternalChildren: ['exportHistFmt', 'saveHistoryBtn', 'saveTreatmentsBtn'],
	},
	class PrefsDialog extends Adw.Dialog {
		constructor() {
			super({});
			this._initPrefs();
		}

		_initPrefs() {
			// Export format
			this._exportHistFmt.set_selected(settings.get_int('export-history-format'));
			this._exportHistFmt.connect('notify::selected-item', () => {
				settings.set_int('export-history-format', this._exportHistFmt.get_selected());
			});

			this._saveHistoryBtn.sensitive = historyLS.n_items > 0;
			this._saveTreatmentsBtn.sensitive = treatmentsLS.n_items > 0;

			// Necessary for saving the files
			Gio._promisify(Gtk.FileDialog.prototype, 'save', 'save_finish');
			Gio._promisify(Gio.File.prototype, 'replace_contents_async', 'replace_contents_finish');
		}

		_setSwitchStartStateFromKey(_prefsDialog, key, switchRow) {
			switchRow.settingsKey = key;
			return settings.get_boolean(key);
		}

		_setSwitchSettingsKey(switchRow) {
			settings.set_boolean(switchRow.settingsKey, switchRow.active);
		}

		/** Autostart handling (flatpak or native) */
		_handleAutostart(switchRow) {
			settings.set_boolean(switchRow.settingsKey, switchRow.active);
			const state = switchRow.active;

			if (GLib.getenv('container') === 'flatpak') {
				const portal = new Xdp.Portal();
				const flags = state ? Xdp.BackgroundFlags.AUTOSTART : Xdp.BackgroundFlags.NONE;

				portal.request_background(
					null,
					_('Accept to allow running in the background and receive notifications'),
					['io.github.diegopvlk.Dosage', '--startup'],
					flags,
					null,
					(_portal, result) => {
						try {
							portal.request_background_finish(result);
							const alertDialog = new Adw.AlertDialog({
								heading: _('An Issue Has Occurred'),
								body: err.message,
							});
							alertDialog.add_response('close', _('Close'));
							alertDialog.present(this);
						} catch (err) {
							console.error(err);
							if (!state) return;
							const alertDialog = new Adw.AlertDialog({
								heading: _('An Issue Has Occurred'),
								body: err.message,
							});
							alertDialog.add_response('close', _('Close'));
							alertDialog.present(this);
						}
					},
				);
			} else {
				const path = GLib.build_filenamev([
					GLib.get_home_dir(),
					'.config',
					'autostart',
					'dosage-tracker-startup.desktop',
				]);

				if (state) {
					GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o755);
					const desktopEntry = [
						'[Desktop Entry]',
						'Type=Application',
						'Name=io.github.diegopvlk.Dosage',
						'Exec=dosage-tracker --startup',
					].join('\n');
					GLib.file_set_contents(path, desktopEntry);
				} else {
					const file = Gio.File.new_for_path(path);
					if (file) file.delete(null);
				}
			}
		}

		_saveHistory() {
			const fmt = this._exportHistFmt.get_selected();
			const isISO = fmt === 1 || fmt === 3;
			const isHTML = fmt === 2 || fmt === 3;

			saveHistFile(isISO, isHTML, this).catch(console.error);
		}

		_saveTreatments() {
			saveTreatFile();
		}
	},
);
