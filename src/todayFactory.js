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
	listHeaderItem.box = new Gtk.Box({
		hexpand: true,
	});

	listHeaderItem.selectTimeGroupBtn = new Gtk.Button({
		css_classes: ['time-group-selection', 'flat'],
		valign: Gtk.Align.START,
	});

	listHeaderItem.box.append(listHeaderItem.selectTimeGroupBtn);
	listHeaderItem.set_child(listHeaderItem.box);
});

todayHeaderFactory.connect('bind', (factory, listHeaderItem) => {
	const item = listHeaderItem.get_item().obj;
	const selectTimeGroupBtn = listHeaderItem.selectTimeGroupBtn;

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
	listItem.box = new Gtk.Box();

	listItem.icon = new Gtk.Image({
		margin_start: 17,
		margin_end: 4,
		icon_name: 'pill-symbolic',
	});

	listItem.box.append(listItem.icon);

	listItem.labelsBox = new Gtk.Box({
		valign: Gtk.Align.CENTER,
		hexpand: true,
		orientation: Gtk.Orientation.VERTICAL,
		margin_start: 9,
		margin_end: 12,
	});

	listItem.box.append(listItem.labelsBox);

	listItem.nameLabel = new Gtk.Label({
		halign: Gtk.Align.START,
		ellipsize: Pango.EllipsizeMode.END,
		margin_bottom: 1,
	});

	listItem.labelsBox.append(listItem.nameLabel);

	listItem.doseAndNotes = new Gtk.Label({
		css_classes: ['subtitle'],
		halign: Gtk.Align.START,
		ellipsize: Pango.EllipsizeMode.END,
	});

	listItem.labelsBox.append(listItem.doseAndNotes);

	listItem.amountBox = new Gtk.Box({
		css_classes: ['spin-box', 'spin-today-amount'],
	});

	listItem.amtSpinRow = new Adw.SpinRow({
		digits: 2,
		adjustment: new Gtk.Adjustment({
			lower: 0.25,
			upper: 9999,
			step_increment: 0.25,
		}),
	});

	listItem.amountBox.append(listItem.amtSpinRow);

	listItem.amountBtn = new Gtk.MenuButton({
		tooltip_text: _('Change dose'),
		css_classes: ['circular', 'today-amount'],
		icon_name: 'view-more-horizontal-symbolic',
		valign: Gtk.Align.CENTER,
		halign: Gtk.Align.CENTER,
		margin_end: 10,
		visible: false,
		popover: new Gtk.Popover({
			css_classes: ['menu', 'popover-scrolled'],
			child: new Gtk.ScrolledWindow({
				propagate_natural_height: true,
				propagate_natural_width: true,
				child: listItem.amountBox,
			}),
		}),
	});

	listItem.box.append(listItem.amountBtn);

	listItem.checkButton = new Gtk.CheckButton({
		css_classes: ['selection-mode'],
		valign: Gtk.Align.CENTER,
		halign: Gtk.Align.CENTER,
		margin_end: 11,
		can_focus: false,
		can_target: false,
	});

	listItem.box.append(listItem.checkButton);
	listItem.set_child(listItem.box);
});

todayItemFactory.connect('bind', (factory, listItem) => {
	const item = listItem.get_item().obj;
	const box = listItem.box;
	const row = box.get_parent();
	const icon = listItem.icon;
	const amountBtn = listItem.amountBtn;
	const amtSpinRow = listItem.amtSpinRow;
	const name = listItem.nameLabel;
	const doseAndNotes = listItem.doseAndNotes;
	const checkButton = listItem.checkButton;

	item.doseAndNotes = doseAndNotes;
	item.amountBtn = amountBtn;
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

	name.label = item.name;
	doseAndNotes.label = `${item.dose} ${item.unit}`;

	if (item.notes !== '') {
		doseAndNotes.label += ` • ${item.notes}`;
	}

	icon.icon_name = item.icon;
	box.set_css_classes(['item-box', item.color]);
});
