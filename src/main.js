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

import { PrefsDialog } from './prefsDialog.js';
import { releaseNotes } from './releaseNotes.js';
import { sortTreatments } from './treatmentsSorter.js';
import { DosageWindow } from './window.js';

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

			const appId = this.get_application_id();
			globalThis.settings = new Gio.Settings({ schemaId: appId });

			const treatmentsSorterAction = new Gio.SimpleAction({
				enabled: true,
				name: 'treatments-sorter',
				state: new GLib.Variant('s', settings.get_string('treatments-sorting')),
				parameter_type: new GLib.VariantType('s'),
			});
			treatmentsSorterAction.connect('activate', (action, parameter) => {
				treatmentsSorterAction.state = parameter;
				const sortingOrder = parameter.get_string()[0];
				settings.set_string('treatments-sorting', sortingOrder);
				sortTreatments(sortingOrder);
			});
			this.add_action(treatmentsSorterAction);

			const showPrefAction = new Gio.SimpleAction({ name: 'preferences' });
			showPrefAction.connect('activate', () => {
				const prefsDialog = new PrefsDialog();
				prefsDialog.present(this.activeWindow);
			});
			this.add_action(showPrefAction);
			this.set_accels_for_action('app.preferences', ['<primary>comma']);

			const showAboutAction = new Gio.SimpleAction({ name: 'about' });
			showAboutAction.connect('activate', () => {
				let aboutParams = {
					application_name: _('Dosage'),
					application_icon: 'io.github.diegopvlk.Dosage',
					developer_name: 'Diego Povliuk',
					developers: ['Diego Povliuk'],
					version: '2.0.1',
					issue_url: 'https://github.com/diegopvlk/Dosage/issues',
					license_type: Gtk.License.GPL_3_0_ONLY,
					copyright: '© 2023 Diego Povliuk',
					// TRANSLATORS: "Your Name <your@email.com>"
					translator_credits: _('translator-credits'),
					release_notes: releaseNotes,
				};
				const aboutDialog = new Adw.AboutDialog(aboutParams);
				aboutDialog.add_acknowledgement_section(_('Thanks to These Projects!'), [
					'GNOME https://www.gnome.org/',
					'GTK https://www.gtk.org/',
					'Libadwaita https://gnome.pages.gitlab.gnome.org/libadwaita/',
					'Workbench https://apps.gnome.org/Workbench/',
					'Blueprint https://jwestman.pages.gitlab.gnome.org/blueprint-compiler/index.html',
					'GTK4 + GJS Book https://rmnvgr.gitlab.io/gtk4-gjs-book/',
					'GJS Guide https://gjs.guide/',
					'Flatpak https://github.com/flatpak/',
				]);
				aboutDialog.add_link('Donate', 'https://github.com/diegopvlk/Dosage#donate');
				aboutDialog.add_other_app(
					'io.github.diegopvlk.Tomatillo',
					'Tomatillo',
					'Focus better, work smarter',
				);
				aboutDialog.present(this.activeWindow);
			});
			this.add_action(showAboutAction);

			const newOneTimeAction = new Gio.SimpleAction({ name: 'new-one-time' });
			newOneTimeAction.connect('activate', () => {
				this.activeWindow.unselectTodayItems();
				this.activeWindow._viewStack.visible_child_name = 'today-page';
				this.activeWindow.addTodayOrOneTimeToHist();
			});
			this.add_action(newOneTimeAction);
			this.set_accels_for_action('app.new-one-time', ['<primary>t']);

			const newTreatAction = new Gio.SimpleAction({ name: 'new-treatment' });
			newTreatAction.connect('activate', () => {
				this.activeWindow._viewStack.visible_child_name = 'treatments-page';
				this.activeWindow._presentMedDialog();
			});
			this.add_action(newTreatAction);
			this.set_accels_for_action('app.new-treatment', ['<primary>n']);

			const shWhenNeededAction = new Gio.SimpleAction({ name: 'sh-when-needed' });
			shWhenNeededAction.connect('activate', () => {
				this.activeWindow.setShowWhenNeeded(null, true);
			});
			this.add_action(shWhenNeededAction);
			this.set_accels_for_action('app.sh-when-needed', ['<primary>h']);

			const quitAction = new Gio.SimpleAction({ name: 'quit' });
			quitAction.connect('activate', () => {
				this.activeWindow.withdrawPastNotifications();
				this.quit();
			});
			this.add_action(quitAction);
			this.set_accels_for_action('app.quit', ['<primary>q', '<primary>w']);

			this.add_main_option(
				'startup',
				null,
				GLib.OptionFlags.NONE,
				GLib.OptionArg.NONE,
				'Start app hidden at startup',
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

export const getDosageWindow = () => DosageApplication.get_default().activeWindow;
