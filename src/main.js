/* 
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only 
 */
'use strict';

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Xdp from 'gi://Xdp?version=1.0';

import { DosageWindow } from './window.js';

pkg.initGettext();
pkg.initFormat();

export const DosageApplication = GObject.registerClass(
	class DosageApplication extends Adw.Application {
		constructor() {
			super({
				application_id: 'io.github.diegopvlk.Dosage',
				flags: Gio.ApplicationFlags.DEFAULT_FLAGS,
				resource_base_path: "/io/github/diegopvlk/Dosage/",
			});

			const quitAction = new Gio.SimpleAction({ name: "quit" });
			quitAction.connect("activate", () => this.quit());
			this.add_action(quitAction);
			this.set_accels_for_action('app.quit', ["<primary>q"]);

			this._hidden = false;

			const container = GLib.getenv('container');

			// auto-start for non-flatpak
			if (container !== 'flatpak') {
				const autostartDir = GLib.build_filenamev([
					GLib.get_home_dir(),
					'.config',
					'autostart',
				]);
				const autostartFilePath = GLib.build_filenamev([
					autostartDir,
					'dosage-tracker-startup.desktop',
				]);

				if (!GLib.file_test(autostartFilePath, GLib.FileTest.EXISTS)) {
					GLib.mkdir_with_parents(autostartDir, 0o755);

					const fileContents =
						'[Desktop Entry]\nType=Application\nName=io.github.diegopvlk.Dosage\nExec=dosage-tracker --startup';
					
					GLib.file_set_contents(autostartFilePath, fileContents);
				}
			}

			const showPrefAction = new Gio.SimpleAction({ name: "preferences" });
			showPrefAction.connect("activate", () => {
				const builder = Gtk.Builder.new_from_resource(
					'/io/github/diegopvlk/Dosage/ui/preferences.ui'
				);
				
				const prefWindow = builder.get_object('prefWindow');
				const autostartRow = builder.get_object('autostartRow');
				const autostartSwitch = builder.get_object('autostartSwitch');
				const prioritySwitch = builder.get_object('prioritySwitch');
				const confirmSwitch = builder.get_object('confirmSwitch');
				const skipSwitch = builder.get_object('skipSwitch');
				
				if (container === 'flatpak') {
					autostartSwitch.set_active(settings.get_boolean('autostart'));
					autostartSwitch.connect('state-set', () => {
						const state = autostartSwitch.get_active();
						settings.set_boolean('autostart', state);
						this._requestBackground(state);
					});
				} 
				else // no option to disable auto-start
					autostartRow.set_visible(false);
				
				prioritySwitch.set_active(settings.get_boolean('priority'));
				
				prioritySwitch.connect('state-set', () => {
					const state = prioritySwitch.get_active();
					settings.set_boolean('priority', state)
				});

				confirmSwitch.set_active(settings.get_boolean('confirm-button'));
				skipSwitch.set_active(settings.get_boolean('skip-button'));

				confirmSwitch.connect('state-set', () => {
					const state = confirmSwitch.get_active();
					settings.set_boolean('confirm-button', state)
				});
				skipSwitch.connect('state-set', () => {
					const state = skipSwitch.get_active();
					settings.set_boolean('skip-button', state)
				});

				prefWindow.set_transient_for(this.active_window);
				prefWindow.present();
			});
			this.add_action(showPrefAction);
			this.set_accels_for_action('app.preferences', ["<primary>comma"]);
			
			const showAboutAction = new Gio.SimpleAction({ name: "about" });
			showAboutAction.connect("activate", () => {
				let aboutParams = {
					transient_for: this.active_window,
					application_name: _('Dosage'),
					application_icon: 'io.github.diegopvlk.Dosage',
					developer_name: "Diego Povliuk",
					version: "1.1.3",
					issue_url: 'https://github.com/diegopvlk/Dosage/issues',
					license_type: Gtk.License.GPL_3_0_ONLY,
					copyright: "© 2023 Diego Povliuk",
					// TRANSLATORS: "Your Name <your@email.com>"
					translator_credits: _("translator-credits"),
				};
				const aboutWindow = new Adw.AboutWindow(aboutParams);
				aboutWindow.add_acknowledgement_section(_("Thanks to these projects!"), [
					"GNOME https://www.gnome.org/", 
					"GTK https://www.gtk.org/", 
					"Libadwaita https://gnome.pages.gitlab.gnome.org/libadwaita/", 
					"Workbench https://apps.gnome.org/Workbench/", 
					"Blueprint https://jwestman.pages.gitlab.gnome.org/blueprint-compiler/index.html",
					"GTK4 + GJS Book https://rmnvgr.gitlab.io/gtk4-gjs-book/",
					"GJS Guide https://gjs.guide/",
					"Flatpak https://github.com/flatpak/",
				]);
				aboutWindow.add_link(_("Donate"), "https://github.com/diegopvlk/Dosage#donate") 
				aboutWindow.present();
			});
			this.add_action(showAboutAction);

			this.add_main_option(
				'startup',
				null,
				GLib.OptionFlags.NONE,
				GLib.OptionArg.NONE,
				"Start app hidden at startup",
				null
			);
		}

		_requestBackground(autostart) {
			const portal = new Xdp.Portal();
			const setAutostart = autostart
				? Xdp.BackgroundFlags.AUTOSTART
				: Xdp.BackgroundFlags.NONE;
			portal.request_background(
				null,
				// TRANSLATORS: Confirmation message to allow background permission
				_("Accept to allow running in the background and receive notifications"),
				['io.github.diegopvlk.Dosage', '--startup'],
				setAutostart,
				null,
				null
			);
		}

		vfunc_handle_local_options(options) {
			if (options.contains('startup')) 
				this._hidden = true;

			return -1; // continue execution
		}

		vfunc_activate() {
			let { active_window } = this;

			if (!active_window) {
				active_window = new DosageWindow(this);
				active_window.set_hide_on_close(true);
			}

			if (this._hidden) {
				active_window.hide();
				this._hidden = false;
			} else {
				active_window.present();
			}
		}
	}
);

export function main(argv) {
	const application = new DosageApplication();
	return application.runAsync(argv);
}
