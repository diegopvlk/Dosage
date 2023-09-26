/* 
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only 
 */

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Xdp from 'gi://Xdp?version=1.0';

import { DosefyWindow } from './window.js';

pkg.initGettext();
pkg.initFormat();

export const DosefyApplication = GObject.registerClass(
	class DosefyApplication extends Adw.Application {
		constructor() {
			super({
				application_id: 'com.github.diegopvlk.Dosefy',
				flags: Gio.ApplicationFlags.DEFAULT_FLAGS,
			});

			const quitAction = new Gio.SimpleAction({ name: "quit" });
			quitAction.connect("activate", (action) => {
				this.quit();
			});
			this.add_action(quitAction);
			this.set_accels_for_action('app.quit', ["<primary>q"]);

			this._hidden = false;

			const showPrefAction = new Gio.SimpleAction({ name: "preferences" });
			showPrefAction.connect("activate", (action) => {
				const builder = Gtk.Builder.new_from_resource(
					'/com/github/diegopvlk/Dosefy/ui/preferences.ui'
				);
				const prefWindow = builder.get_object('prefWindow');
				const autostartSwitch = builder.get_object('autostartSwitch');
				const prioritySwitch = builder.get_object('prioritySwitch');
				
				autostartSwitch.set_active(settings.get_boolean('autostart'));
				prioritySwitch.set_active(settings.get_boolean('priority'));

				autostartSwitch.connect('state-set', () => {
					const state = autostartSwitch.get_active();
					settings.set_boolean('autostart', state);
					this._requestBackground(state);
				})
				prioritySwitch.connect('state-set', () => {
					const state = prioritySwitch.get_active();
					settings.set_boolean('priority', state)
				})

				prefWindow.set_transient_for(this.active_window);
				prefWindow.present();
			});
			this.add_action(showPrefAction);
			
			const showAboutAction = new Gio.SimpleAction({ name: "about" });
			showAboutAction.connect("activate", (action) => {
				let aboutParams = {
					transient_for: this.active_window,
					application_name: 'Dosefy',
					application_icon: 'com.github.diegopvlk.Dosefy',
					developer_name: "Diego Povliuk",
					version: "1.0.0",
					issue_url: 'https://github.com/diegopvlk/Dosefy/issues',
					website: 'https://github.com/diegopvlk/Dosefy',
					license_type: Gtk.License.GPL_3_0_ONLY,
					copyright: "© 2023 Diego Povliuk",
				};
				const aboutWindow = new Adw.AboutWindow(aboutParams);
				aboutWindow.add_acknowledgement_section(_("Thanks to these projects!"), [
					"GNOME https://www.gnome.org/", 
					"GTK https://www.gtk.org/", 
					"Libadwaita https://gnome.pages.gitlab.gnome.org/libadwaita/", 
					"Workbench https://apps.gnome.org/Workbench/", 
					"Blueprint https://jwestman.pages.gitlab.gnome.org/blueprint-compiler/index.html",
					"GTK4 + GJS Book https://rmnvgr.gitlab.io/gtk4-gjs-book/"
				]);
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
				_("Allow Dosefy to run in background."),
				['com.github.diegopvlk.Dosefy', '--startup'],
				setAutostart,
				null,
				null
			);
		}

		vfunc_handle_local_options(options) {
			if (options.contains('startup')) this._hidden = true;

			return -1; // continue execution
		}

		vfunc_activate() {
			let { active_window } = this;

			if (!active_window) {
				active_window = new DosefyWindow(this);
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
	const application = new DosefyApplication();
	return application.runAsync(argv);
}
