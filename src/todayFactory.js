/*
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';
import { DosageApplication } from './main.js';

import { clockIs12 } from './utils.js';

export const todayHeaderFactory = new Gtk.SignalListItemFactory();
export const todayItemFactory = new Gtk.SignalListItemFactory();

todayHeaderFactory.connect('setup', (factory, listHeaderItem) => {
	const box = new Gtk.Box({
		hexpand: true,
	});
	const selectTimeGroupBtn = new Gtk.Button({
		css_classes: ['time-group-selection', 'flat'],
		valign: Gtk.Align.START,
	});
	box.append(selectTimeGroupBtn);
	listHeaderItem.set_child(box);
});

todayHeaderFactory.connect('bind', (factory, listHeaderItem) => {
	const item = listHeaderItem.get_item().obj;
	const selectTimeGroupBtn = listHeaderItem.get_child().get_first_child();
	const itemTime = new Date();
	itemTime.setHours(item.time[0], item.time[1]);
	const formatOpt = { hour: 'numeric', minute: 'numeric', hour12: clockIs12 };
	const time = itemTime.toLocaleTimeString(undefined, formatOpt);

	selectTimeGroupBtn.connect('clicked', _btn => {
		const DosageWindow = DosageApplication.get_default().activeWindow;

		const start = listHeaderItem.get_start();
		const end = listHeaderItem.get_end();

		for (let pos = start; pos < end; pos++) {
			DosageWindow._selectTodayItems(DosageWindow._todayList, pos, true);
		}
	});

	selectTimeGroupBtn.label = time;
});

todayItemFactory.connect('setup', (factory, listItem) => {
	const box = new Gtk.Box({
		css_classes: ['item-box'],
		height_request: 64,
	});
	const icon = new Gtk.Image({
		margin_start: 17,
		margin_end: 4,
		icon_name: 'pill-symbolic',
	});
	box.append(icon);
	const labelsBox = new Gtk.Box({
		valign: Gtk.Align.CENTER,
		hexpand: true,
		orientation: Gtk.Orientation.VERTICAL,
		margin_start: 9,
		margin_end: 12,
	});
	box.append(labelsBox);
	const name = new Gtk.Label({
		halign: Gtk.Align.START,
		ellipsize: Pango.EllipsizeMode.END,
		margin_bottom: 1,
	});
	labelsBox.append(name);
	const doseAndNotes = new Gtk.Label({
		css_classes: ['subtitle'],
		halign: Gtk.Align.START,
		ellipsize: Pango.EllipsizeMode.END,
	});
	labelsBox.append(doseAndNotes);
	const amountBox = new Gtk.Box({
		css_classes: ['spin-box', 'spin-today-amount'],
	});
	const amountRow = new Adw.SpinRow({
		digits: 2,
		adjustment: new Gtk.Adjustment({
			lower: 0.25,
			upper: 999,
			step_increment: 0.25,
		}),
	});
	amountBox.append(amountRow);
	const amountBtn = new Gtk.MenuButton({
		tooltip_text: _('Change dose'),
		css_classes: ['circular', 'today-amount'],
		icon_name: 'view-more-horizontal-symbolic',
		valign: Gtk.Align.CENTER,
		halign: Gtk.Align.CENTER,
		margin_end: 10,
		visible: false,
		popover: new Gtk.Popover({
			child: amountBox,
		}),
	});
	box.append(amountBtn);
	const checkButton = new Gtk.CheckButton({
		css_classes: ['selection-mode'],
		valign: Gtk.Align.CENTER,
		halign: Gtk.Align.CENTER,
		margin_end: 11,
		can_focus: false,
		can_target: false,
	});
	box.append(checkButton);
	listItem.set_child(box);
});

todayItemFactory.connect('bind', (factory, listItem) => {
	const item = listItem.get_item().obj;
	const box = listItem.get_child();
	const row = box.get_parent();
	const icon = box.get_first_child();
	const labelsBox = icon.get_next_sibling();
	const amtBtn = labelsBox.get_next_sibling();
	const amtBtnPopover = amtBtn.get_popover();
	const amtSpinRow = amtBtnPopover.get_child().get_first_child();
	const name = labelsBox.get_first_child();
	const doseAndNotes = name.get_next_sibling();
	const checkButton = box.get_last_child();

	item.doseAndNotes = doseAndNotes;
	item.amtBtn = amtBtn;
	item.amtSpinRow = amtSpinRow;
	item.checkButton = checkButton;

	// activate item with space bar
	const keyController = new Gtk.EventControllerKey();
	keyController.connect('key-pressed', (_, keyval, keycode, state) => {
		if (keyval === Gdk.KEY_space) {
			let listView = row.get_parent();
			listView.emit('activate', listItem.position);
		}
	});
	row.add_controller(keyController);

	['default', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple'].forEach(c =>
		box.remove_css_class(c),
	);

	box.add_css_class(item.color);

	name.label = item.name;
	doseAndNotes.label = `${item.dose} ${item.unit}`;

	if (item.notes !== '') {
		doseAndNotes.label += ` • ${item.notes}`;
	}

	icon.icon_name = item.icon;
});
