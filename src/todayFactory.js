/*
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';

import { amPmStr, clockIs12, timeDot } from './utils.js';

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
	let [hours, minutes] = item.time;
	let period = '';

	if (clockIs12) {
		period = ` ${amPmStr[0]}`;
		if (hours >= 12) period = ` ${amPmStr[1]}`;
		if (hours > 12) hours -= 12;
		if (hours === 0) hours = 12;
	}

	const h = clockIs12 ? String(hours) : String(hours).padStart(2, 0);
	const m = String(minutes).padStart(2, 0);

	selectTimeGroupBtn.connect('clicked', _btn => {
		let DosageWindow = selectTimeGroupBtn;
		for (let i = 0; i < 12; i++) {
			DosageWindow = DosageWindow.get_parent();
		}

		const start = listHeaderItem.get_start();
		const end = listHeaderItem.get_end();

		for (let i = start; i < end; i++) {
			DosageWindow._selectTodayItems(DosageWindow._todayList, i, true);
		}
	});

	let time = `${h}:${m}`;
	if (timeDot) time = time.replace(':', '.');

	selectTimeGroupBtn.label = time + period;
});

todayItemFactory.connect('setup', (factory, listItem) => {
	const box = new Gtk.Box({
		css_classes: ['card'],
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
		name: 'doseAndNotes',
		css_classes: ['subtitle'],
		halign: Gtk.Align.START,
		ellipsize: Pango.EllipsizeMode.END,
	});
	labelsBox.append(doseAndNotes);
	const amountBox = new Gtk.Box({
		css_classes: ['spin-box', 'spin-today-amount'],
	});
	const amountRow = new Adw.SpinRow({
		name: 'amtSpinRow',
		digits: 2,
		adjustment: new Gtk.Adjustment({
			lower: 0.25,
			upper: 999,
			step_increment: 0.25,
		}),
	});
	amountBox.append(amountRow);
	const amountBtn = new Gtk.MenuButton({
		name: 'amountBtn',
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
		name: 'checkButton',
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
	const nameLabel = labelsBox.get_first_child();
	const doseLabel = nameLabel.get_next_sibling();

	// activate item with space bar
	const keyController = new Gtk.EventControllerKey();
	keyController.connect('key-pressed', (_, keyval, keycode, state) => {
		if (keyval === Gdk.KEY_space) {
			let listView = row.get_parent();
			listView.emit('activate', listItem.position);
		}
	});
	row.add_controller(keyController);

	row.remove_css_class('activatable');
	box.add_css_class('activatable');

	['default', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple'].forEach(c =>
		box.remove_css_class(c),
	);

	box.add_css_class(item.color);

	nameLabel.label = item.name;
	doseLabel.label = `${item.dose} ${item.unit}`;

	if (item.notes !== '') {
		doseLabel.label += ` • ${item.notes}`;
	}

	icon.icon_name = item.icon;
});
