/*
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import Gtk from 'gi://Gtk';

export default function openPrefsWindow(DosageApplication, container) {
	const builder = Gtk.Builder.new_from_resource(
		'/io/github/diegopvlk/Dosage/ui/preferences.ui',
	);

	const prefsWindow = builder.get_object('prefsWindow');
	const autostartRow = builder.get_object('autostartRow');
	const autostartSwitch = builder.get_object('autostartSwitch');
	const clearHistSwitch = builder.get_object('clearHistSwitch');
	const prioritySwitch = builder.get_object('prioritySwitch');
	const notifSoundSwitch = builder.get_object('notifSoundSwitch');
	const confirmSwitch = builder.get_object('confirmSwitch');
	const skipSwitch = builder.get_object('skipSwitch');
	const notifBtns = builder.get_object('notifBtns');

	const notifBtnsHeader = notifBtns
		.get_first_child()
		.get_first_child()
		.get_first_child();
	const notifBtnsExpanderBtn = notifBtnsHeader
		.get_first_child()
		.get_last_child()
		.get_first_child()
		.get_next_sibling()
		.get_next_sibling();
	notifBtnsHeader.set_activatable(false);
	notifBtnsExpanderBtn.set_visible(false);

	if (container === 'flatpak') {
		autostartSwitch.set_active(settings.get_boolean('autostart'));
		autostartSwitch.connect('state-set', () => {
			const state = autostartSwitch.get_active();
			settings.set_boolean('autostart', state);
			DosageApplication._requestBackground(state);
		});
	} else {
		// no option to disable auto-start
		autostartRow.set_visible(false);
	}

	clearHistSwitch.set_active(settings.get_boolean('clear-old-hist'));

	clearHistSwitch.connect('state-set', () => {
		const state = clearHistSwitch.get_active();
		settings.set_boolean('clear-old-hist', state);
	});

	prioritySwitch.set_active(settings.get_boolean('priority'));

	prioritySwitch.connect('state-set', () => {
		const state = prioritySwitch.get_active();
		settings.set_boolean('priority', state);
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

	const prefsPage = builder.get_object('prefsPage');
	const [prefsPageHeight] = prefsPage
		.get_first_child()
		.get_first_child()
		.measure(Gtk.Orientation.VERTICAL, -1);
	prefsWindow.default_height = prefsPageHeight + 64;

	prefsWindow.set_transient_for(DosageApplication.activeWindow);
	prefsWindow.present();
}
