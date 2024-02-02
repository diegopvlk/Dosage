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

import openPrefsWindow from './prefsWindow.js';
import { DosageWindow } from './window.js';
import { releaseNotes } from './releaseNotes.js';

pkg.initGettext();
pkg.initFormat();

export const DosageApplication = GObject.registerClass(
	class DosageApplication extends Adw.Application {
		constructor() {
			super({
				application_id: 'io.github.diegopvlk.Dosage',
				flags: Gio.ApplicationFlags.DEFAULT_FLAGS,
				resource_base_path: '/io/github/diegopvlk/Dosage/',
			});

			this.hidden = false;

			const showPrefAction = new Gio.SimpleAction({ name: 'preferences' });
			showPrefAction.connect('activate', () => openPrefsWindow(this));
			this.add_action(showPrefAction);
			this.set_accels_for_action('app.preferences', ['<primary>comma']);

			const showAboutAction = new Gio.SimpleAction({ name: 'about' });
			showAboutAction.connect('activate', () => {
				let aboutParams = {
					transient_for: this.activeWindow,
					application_name: _('Dosage'),
					application_icon: 'io.github.diegopvlk.Dosage',
					developer_name: 'Diego Povliuk',
					developers: ['Diego Povliuk'],
					version: '1.5.1',
					issue_url: 'https://github.com/diegopvlk/Dosage/issues',
					license_type: Gtk.License.GPL_3_0_ONLY,
					copyright: '© 2023 Diego Povliuk',
					// TRANSLATORS: 'Your Name <your@email.com>'
					translator_credits: _('translator-credits'),
					release_notes: releaseNotes,
				};
				const aboutWindow = new Adw.AboutWindow(aboutParams);
				aboutWindow.add_acknowledgement_section(_('Thanks to these projects!'), [
					'GNOME https://www.gnome.org/',
					'GTK https://www.gtk.org/',
					'Libadwaita https://gnome.pages.gitlab.gnome.org/libadwaita/',
					'Workbench https://apps.gnome.org/Workbench/',
					'Blueprint https://jwestman.pages.gitlab.gnome.org/blueprint-compiler/index.html',
					'GTK4 + GJS Book https://rmnvgr.gitlab.io/gtk4-gjs-book/',
					'GJS Guide https://gjs.guide/',
					'Flatpak https://github.com/flatpak/',
				]);
				aboutWindow.add_link('Donate', 'https://github.com/diegopvlk/Dosage#donate');
				aboutWindow.present();
			});
			this.add_action(showAboutAction);

			const quitAction = new Gio.SimpleAction({ name: 'quit' });
			quitAction.connect('activate', () => this.quit());
			this.add_action(quitAction);
			this.set_accels_for_action('app.quit', ['<primary>q']);

			this.add_main_option(
				'startup',
				null,
				GLib.OptionFlags.NONE,
				GLib.OptionArg.NONE,
				'Start app hidden at startup',
				null,
			);
		}

		_requestBackground(autostart) {
			const portal = new Xdp.Portal();
			const setAutostart = autostart ? Xdp.BackgroundFlags.AUTOSTART : Xdp.BackgroundFlags.NONE;
			portal.request_background(
				null,
				// TRANSLATORS: Confirmation message to allow background permission
				_('Accept to allow running in the background and receive notifications'),
				['io.github.diegopvlk.Dosage', '--startup'],
				setAutostart,
				null,
				null,
			);
		}

		vfunc_handle_local_options(options) {
			if (options.contains('startup')) {
				this.hidden = true;
			}
			return -1; // continue execution
		}

		vfunc_activate() {
			let { activeWindow } = this;

			if (!activeWindow) {
				activeWindow = new DosageWindow(this);
				activeWindow.set_hide_on_close(true);
			}

			if (this.hidden) {
				activeWindow.hide();
				this.hidden = false;
			} else {
				activeWindow.present();
			}
		}
	},
);

export function main(argv) {
	const application = new DosageApplication();
	return application.runAsync(argv);
}
